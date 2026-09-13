import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Profile } from '../../core/models/admin.models';

interface CustomerDraft { fullName: string; username: string; phone: string; gender: string; dateOfBirth: string; }

@Component({
  selector: 'cc-customer-management', standalone: true, imports: [FormsModule, IonIcon], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="customer-management" aria-label="Manage customer account">
      <div class="management-head"><div><b>Account management</b><p>Customer profile details</p></div><button type="button" (click)="open()" [disabled]="busy() || !!draft()"><ion-icon name="create-outline" aria-hidden="true" /> Edit</button></div>
      @if (notice()) { <p role="status" [class.is-error]="failed()">{{ notice() }}</p> }
      @if (draft(); as edit) {
        <form (ngSubmit)="save()"><fieldset [disabled]="busy()">
          <label>Full name<input name="fullName" [(ngModel)]="edit.fullName" required maxlength="150" autocomplete="off" /></label>
          <label>Username<input name="username" [(ngModel)]="edit.username" required minlength="3" maxlength="80" autocomplete="off" autocapitalize="none" /></label>
          <label>Phone<input name="phone" [(ngModel)]="edit.phone" type="tel" maxlength="30" /></label>
          <label>Gender<select name="gender" [(ngModel)]="edit.gender"><option value="">Not provided</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></label>
          <label>Date of birth<input name="dateOfBirth" [(ngModel)]="edit.dateOfBirth" type="date" [max]="today" /></label>
          <p>Email, saved addresses and authentication settings remain unchanged.</p>
          <div class="management-actions"><button type="button" (click)="draft.set(null)">Cancel</button><button type="submit" class="primary">{{ busy() ? 'Saving…' : 'Save changes' }}</button></div>
          @if (active() !== null) { <p>Account status: {{ active() ? 'Active' : 'Suspended' }}. Access changes are not available in this mobile release.</p> }
        </fieldset></form>
      }
    </section>
  `,
  styles: `
    :host { display:block; } .customer-management { padding:16px; border:1px solid #dedad2; border-radius:20px; background:#fffdfa; } .management-head { display:flex; align-items:center; justify-content:space-between; gap:12px; } b { font-size:14px; } p { margin:4px 0; color:#77736b; font-size:12px; line-height:1.5; }
    button { min-height:44px; border:1px solid #dedad2; border-radius:12px; padding:10px 14px; background:#f5f2ed; color:#25231f; font-weight:600; } button:disabled { opacity:.5; } ion-icon { vertical-align:middle; font-size:18px; }
    fieldset { border:0; padding:16px 0 0; margin:0; min-width:0; display:grid; gap:12px; } label { display:grid; gap:6px; font-size:12px; font-weight:600; } input, select { box-sizing:border-box; width:100%; min-width:0; min-height:44px; padding:10px; border:1px solid #dedad2; border-radius:12px; background:#fffdfa; color:#25231f; font-size:16px; }
    .management-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; } .primary { background:#25231f; color:#fff; } .is-error { color:#9b4639; }
  `,
})
export class CustomerManagementComponent {
  readonly customer = input.required<Profile>();
  private readonly connection = inject(SupabaseAdminService);
  private readonly auth = inject(AdminAuthService);
  private readonly data = inject(AdminDataService);
  readonly draft = signal<CustomerDraft | null>(null);
  readonly busy = signal(false);
  readonly active = signal<boolean | null>(null);
  readonly notice = signal('');
  readonly failed = signal(false);
  readonly today = new Date().toISOString().slice(0, 10);
  private currentId = '';

  constructor() {
    effect(() => {
      const id = this.customer().id;
      if (id === this.currentId) return;
      this.currentId = id; this.draft.set(null); this.notice.set(''); this.active.set(null);
    });
  }

  async open() {
    if (this.busy() || !['admin', 'superadmin'].includes(this.auth.role() ?? '')) return;
    const id = this.customer().id;
    this.busy.set(true); this.notice.set('');
    try {
      const { data, error } = await this.connection.client.from('profiles')
        .select('full_name,username,phone,gender,date_of_birth,customer_active').eq('id', id).eq('role', 'customer').maybeSingle();
      if (error || !data) throw new Error('Customer details could not be loaded. Reconnect and try again.');
      if (this.customer().id !== id) return;
      this.active.set(data.customer_active !== false);
      this.draft.set({ fullName: data.full_name ?? '', username: data.username ?? '', phone: data.phone ?? '', gender: data.gender ?? '', dateOfBirth: data.date_of_birth ?? '' });
    } catch (error) { this.report(error); } finally { this.busy.set(false); }
  }

  async save() {
    const draft = this.draft();
    if (!draft || this.busy()) return;
    if (!draft.fullName.trim() || draft.username.trim().length < 3 || draft.dateOfBirth > this.today) {
      this.report(new Error('Enter a full name, a username of at least 3 characters, and a valid birth date.')); return;
    }
    const id = this.customer().id;
    await this.perform({ action: 'update', userId: id, ...draft, dateOfBirth: draft.dateOfBirth || null }, () => {
      this.data.applyCustomerPatch(id, { full_name: draft.fullName.trim(), username: draft.username.trim(), phone: draft.phone.trim() || null, gender: draft.gender, date_of_birth: draft.dateOfBirth || null });
      this.draft.set(null);
    });
  }

  private async perform(body: Record<string, unknown>, apply: () => void) {
    if (!['admin', 'superadmin'].includes(this.auth.role() ?? '') || this.busy()) return;
    const owner = this.auth.userId();
    this.busy.set(true); this.notice.set(''); this.failed.set(false);
    try {
      const result = await this.connection.invokeAuthenticatedFunction<{ error?: string; success?: boolean; message?: string }>('manage-customer', body);
      if (result.error || !result.success) throw new Error(result.error || 'The account change could not be confirmed. Refresh before retrying.');
      if (this.auth.userId() !== owner || this.customer().id !== body['userId']) return;
      apply(); this.notice.set(result.message || 'Customer account updated.');
    } catch (error) { this.report(error); } finally { this.busy.set(false); }
  }

  private report(error: unknown) { this.failed.set(true); this.notice.set(error instanceof Error ? error.message : 'The account change could not be confirmed. Refresh before retrying.'); }
}
