import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertController, IonButton, IonIcon, IonInput, IonSelect, IonSelectOption, IonToggle } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { AdminRole, TeamMember } from '../../core/models/admin.models';
import { initials, shortDate, titleCase } from '../../core/utils/format';
import { CozyToastService } from '../../shared/components/toast.service';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

@Component({
  selector: 'cc-team-page',
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonIcon, IonInput, IonSelect, IonSelectOption, IonToggle, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page team-page">
      <header class="cc-page-heading"><div><p class="cc-eyebrow">SECURITY & ACCESS</p><h1>The team behind the craft</h1><p>Every person receives an individual, role-protected account.</p></div><button type="button" (click)="inviteOpen.set(!inviteOpen())"><ion-icon [name]="inviteOpen() ? 'close-outline' : 'person-add-outline'"></ion-icon>{{ inviteOpen() ? 'Close' : 'Invite' }}</button></header>
      <section class="team-summary"><div><strong>{{ activeCount() }}</strong><span>active members</span></div><div><strong>{{ adminCount() }}</strong><span>administrators</span></div><div><strong>{{ suspendedCount() }}</strong><span>suspended</span></div></section>
      @if (inviteOpen()) {
        <form class="invite-card cc-card cc-reveal" [formGroup]="inviteForm" (ngSubmit)="invite()">
          <div><span class="invite-icon"><ion-icon name="mail-unread-outline"></ion-icon></span><p class="cc-eyebrow">NEW TEAM MEMBER</p><h2>Send a secure invitation</h2><p>They will create their own password from the approved invitation link.</p></div>
          <label class="cc-field"><span>Full name</span><ion-input formControlName="fullName" placeholder="Team member’s name"></ion-input></label>
          <label class="cc-field"><span>Work email</span><ion-input formControlName="email" type="email" inputmode="email" placeholder="name&#64;cozycraft.com"></ion-input></label>
          <label class="cc-field"><span>Workspace role</span><ion-select formControlName="role" interface="action-sheet"><ion-select-option value="staff">Staff</ion-select-option><ion-select-option value="admin">Administrator</ion-select-option><ion-select-option value="superadmin">Super Administrator</ion-select-option></ion-select></label>
          <div class="role-preview"><b>{{ roleLabel(inviteForm.controls.role.value) }}</b><span>{{ roleDescription(inviteForm.controls.role.value) }}</span></div>
          <ion-button type="submit" class="cc-primary-button" expand="block" [disabled]="inviteForm.invalid || working()">{{ working() ? 'Sending invitation…' : 'Send invitation' }}</ion-button>
        </form>
      }
      <section class="member-list">
        @for (member of data.team(); track member.id) {
          <article class="member-card cc-card">
            <div class="member-card__identity"><span>{{ initials(member.full_name || member.email) }}</span><div><b>{{ member.full_name || member.email }}</b><small>{{ member.email }}</small></div><cc-status-pill [value]="member.staff_active ? 'active' : 'suspended'"></cc-status-pill></div>
            <div class="member-card__meta"><span><small>JOINED</small><b>{{ shortDate(member.created_at) }}</b></span><span><small>ACCOUNT</small><b>{{ member.id === auth.userId() ? 'This device' : 'Team member' }}</b></span></div>
            <div class="member-card__controls">
              <ion-select label="Role" labelPlacement="stacked" interface="action-sheet" [value]="member.role" [disabled]="member.id === auth.userId() || working()" (ionChange)="changeRole(member, $any($event).detail.value)"><ion-select-option value="staff">Staff</ion-select-option><ion-select-option value="admin">Administrator</ion-select-option><ion-select-option value="superadmin">Super Administrator</ion-select-option></ion-select>
              <label class="member-toggle"><span><b>{{ member.staff_active ? 'Access enabled' : 'Access suspended' }}</b><small>{{ member.staff_active ? 'Can enter assigned tools' : 'Sessions lose workspace access' }}</small></span><ion-toggle [checked]="member.staff_active" [disabled]="member.id === auth.userId() || working()" (ionChange)="toggleStatus(member, $any($event).detail.checked)"></ion-toggle></label>
            </div>
          </article>
        } @empty { <p class="team-empty">Team accounts will appear after the secure workspace loads.</p> }
      </section>
      <section class="role-guide"><p class="cc-eyebrow">ROLE GUIDE</p><div>@for (role of roles; track role) { <article><span><ion-icon [name]="role === 'superadmin' ? 'key-outline' : role === 'admin' ? 'shield-checkmark-outline' : 'person-outline'"></ion-icon></span><h2>{{ roleLabel(role) }}</h2><p>{{ roleDescription(role) }}</p></article> }</div></section>
    </main>
  `,
  styleUrl: './team.page.scss',
})
export class TeamPage {
  readonly initials = initials; readonly shortDate = shortDate; readonly titleCase = titleCase; readonly roles: AdminRole[] = ['superadmin', 'admin', 'staff'];
  readonly inviteOpen = signal(false); readonly working = signal(false);
  readonly inviteForm = new FormGroup({ fullName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(100)] }), email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }), role: new FormControl<AdminRole>('staff', { nonNullable: true, validators: [Validators.required] }) });
  readonly activeCount = computed(() => this.data.team().filter((member) => member.staff_active).length); readonly adminCount = computed(() => this.data.team().filter((member) => ['admin', 'superadmin'].includes(member.role) && member.staff_active).length); readonly suspendedCount = computed(() => this.data.team().filter((member) => !member.staff_active).length);
  constructor(readonly data: AdminDataService, readonly auth: AdminAuthService, private readonly actions: AdminActionsService, private readonly alerts: AlertController, private readonly toast: CozyToastService) {}
  roleLabel(role: AdminRole) { return ({ staff: 'Staff', admin: 'Administrator', superadmin: 'Super Administrator' })[role]; }
  roleDescription(role: AdminRole) { return ({ staff: 'Catalog, inventory, fulfillment, reviews, and customer care.', admin: 'Adds customers, payments, reports, activity, cancellations, and refunds.', superadmin: 'Full access including team roles, security, and global store settings.' })[role]; }
  async invite() { if (this.inviteForm.invalid || this.working()) return; this.working.set(true); const value = this.inviteForm.getRawValue(); const result = await this.actions.manageTeamMember('invite', value); this.working.set(false); if (!result.error) { this.inviteForm.reset({ fullName: '', email: '', role: 'staff' }); this.inviteOpen.set(false); } await this.toast.show(result.error ?? result.data?.message ?? 'Secure invitation sent.', result.error ? 'danger' : 'success'); }
  async changeRole(member: TeamMember, role: AdminRole) { if (role === member.role) return; const alert = await this.alerts.create({ header: `Change ${member.full_name || member.email}’s role?`, message: role === 'superadmin' ? 'This grants full store, financial, team, and security access.' : `Their workspace will change to ${this.roleLabel(role)} access.`, buttons: [{ text: 'Keep current role', role: 'cancel' }, { text: 'Change role', handler: () => void this.runRoleChange(member.id, role) }] }); await alert.present(); }
  private async runRoleChange(id: string, role: AdminRole) { this.working.set(true); const result = await this.actions.manageTeamMember('update-role', { userId: id, role }); this.working.set(false); await this.toast.show(result.error ?? result.data?.message ?? 'Team role updated.', result.error ? 'danger' : 'success'); }
  async toggleStatus(member: TeamMember, active: boolean) { if (active === member.staff_active) return; const alert = await this.alerts.create({ header: active ? 'Restore workspace access?' : 'Suspend workspace access?', message: active ? `${member.full_name || member.email} can sign in again.` : `Active admin sessions for ${member.full_name || member.email} will lose access.`, buttons: [{ text: 'Cancel', role: 'cancel', handler: () => void this.data.loadTeam() }, { text: active ? 'Restore access' : 'Suspend access', role: active ? undefined : 'destructive', handler: () => void this.runStatusChange(member.id, active) }] }); await alert.present(); }
  private async runStatusChange(id: string, active: boolean) { this.working.set(true); const result = await this.actions.manageTeamMember('set-status', { userId: id, active }); this.working.set(false); await this.toast.show(result.error ?? result.data?.message ?? 'Team access updated.', result.error ? 'danger' : 'success'); }
}
