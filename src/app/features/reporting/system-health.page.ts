import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { dateTime } from '../../core/utils/format';
import { orderMatchesView } from '../../core/utils/order-filters';

@Component({
  selector: 'cc-system-health-page', standalone: true,
  imports: [RouterLink, IonIcon], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page health-page">
      <header><div><p class="cc-eyebrow">OPERATIONS CHECK</p><h1>System health</h1><p>Exceptions first. Open a card to investigate.</p></div><button type="button" [disabled]="busy()" (click)="refresh()" aria-label="Refresh system health"><ion-icon name="refresh-outline" [class.cc-spin]="busy()" /></button></header>
      <section class="health-status" [class.has-issue]="needsAttention()" aria-live="polite"><ion-icon [name]="needsAttention() ? 'warning-outline' : 'checkmark-circle-outline'" /><div><b>{{ busy() ? 'Checking workspace…' : issue() || data.error() ? 'Some checks are unavailable' : needsAttention() ? 'Attention needed' : 'No current exceptions' }}</b><p>{{ checkedAt() ? 'Checked ' + dateTime(checkedAt()) : 'Waiting for a complete check' }}</p></div></section>
      @if (issue()) { <p class="health-error" role="alert">{{ issue() }}</p> }
      <section class="health-grid" aria-label="Operational signals">
        @for (card of cards(); track card.label) {
          <a [routerLink]="card.route" [queryParams]="card.params" [class.has-issue]="card.attention"><span class="health-icon"><ion-icon [name]="card.icon" /></span><div><b>{{ card.label }}</b><p>{{ card.note }}</p></div><strong>{{ card.value }}</strong><ion-icon name="chevron-forward-outline" aria-hidden="true" /></a>
        }
      </section>
      <details class="health-errors"><summary>Recent error details <span>Latest {{ errors().length }}</span></summary>
        @for (error of errors(); track error.id) { <article><b>{{ error.message }}</b><small>{{ error.path || 'Unknown screen' }} · {{ dateTime(error.created_at) }}</small></article> }
        @if (!errors().length) { <p>{{ issue() ? 'Error records could not be checked.' : 'No recorded UI errors in the last 24 hours.' }}</p> }
      </details>
      <p class="health-note">Operational indicators use the synchronized workspace. Error count covers the last 24 hours, with at most 30 details downloaded. This is not a payment-provider uptime test.</p>
    </main>
  `,
  styles: `
    :host { display:block; } .health-page { display:grid; gap:16px; }
    header { display:flex; gap:12px; align-items:center; justify-content:space-between; } h1 { margin:4px 0; font-size:28px; } p { margin:4px 0; line-height:1.5; color:#77736b; font-size:13px; }
    header button { width:44px; height:44px; flex:0 0 44px; border:1px solid #dedad2; border-radius:14px; background:#fffdfa; } ion-icon { font-size:22px; flex-shrink:0; }
    .health-status { display:flex; gap:12px; align-items:center; background:#e8eee4; padding:16px; border-radius:20px; } .health-status.has-issue { background:#f0e5d6; } .health-status b { font-size:15px; }
    .health-grid { display:grid; gap:10px; } .health-grid a { display:flex; align-items:center; gap:12px; padding:14px; border:1px solid #dedad2; background:#fffdfa; border-radius:20px; text-decoration:none; color:#25231f; } .health-grid a > div { flex:1; min-width:0; } .health-grid b { font-size:14px; } .health-grid p { font-size:12px; } .health-grid strong { font-size:20px; } .health-icon { display:grid; place-items:center; background:#eeebe6; border-radius:14px; width:42px; height:42px; flex:0 0 42px; } .health-grid .has-issue .health-icon { background:#f0e5d6; color:#865e3d; }
    .health-errors { border:1px solid #dedad2; border-radius:20px; background:#fffdfa; padding:16px; min-width:0; } summary { cursor:pointer; font-weight:700; font-size:14px; min-height:32px; } summary span { font-size:12px; font-weight:400; margin-left:8px; } article { padding:12px 0; border-top:1px solid #dedad2; overflow-wrap:anywhere; } article b { font-size:13px; } small { display:block; color:#77736b; margin-top:6px; font-size:11px; } .health-error { color:#9d4939; } .health-note { font-size:12px; }
    @media(min-width:700px) { .health-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } } @media(max-width:360px) { .health-icon { display:none; } .health-grid a { gap:8px; } }
  `,
})
export class SystemHealthPage {
  readonly data = inject(AdminDataService);
  private readonly client = inject(SupabaseAdminService).client;
  readonly dateTime = dateTime;
  readonly busy = signal(false);
  readonly issue = signal('');
  readonly checkedAt = signal('');
  readonly errors = signal<Array<{ id: number; message: string; path: string | null; created_at: string }>>([]);
  readonly errorCount = signal<number | null>(null);
  readonly cards = computed(() => {
    this.checkedAt();
    const orders = this.data.orders();
    const failed = orders.filter((order) => order.payment_status === 'failed').length;
    const refunds = orders.filter((order) => order.refund_status === 'failed').length;
    const overdue = orders.filter((order) => orderMatchesView(order, 'overdue', new Set())).length;
    const stock = this.data.products().filter((product) => product.status !== 'inactive' && product.stock_quantity === 0).length;
    const live = this.data.realtimeStatus() === 'live';
    return [
      { label: 'Live synchronization', value: live ? 'Live' : 'Offline', note: 'Order and workspace updates', icon: 'sync-outline', route: '/app/orders', params: {}, attention: !live },
      { label: 'Payment exceptions', value: failed + refunds, note: `${failed} failed payments · ${refunds} failed refunds`, icon: 'card-outline', route: refunds ? '/app/orders' : '/app/payments', params: refunds ? { view: 'refund_attention' } : {}, attention: failed + refunds > 0 },
      { label: '48-hour backlog', value: overdue, note: 'Pending, processing or packed', icon: 'time-outline', route: '/app/orders', params: { view: 'overdue', sort: 'longest_waiting' }, attention: overdue > 0 },
      { label: 'Priority support', value: this.data.urgentTickets(), note: 'Open high and urgent tickets', icon: 'chatbubbles-outline', route: '/app/support', params: { scope: 'attention' }, attention: this.data.urgentTickets() > 0 },
      { label: 'Out of stock', value: stock, note: 'Active or draft products at zero', icon: 'cube-outline', route: '/app/inventory', params: {}, attention: stock > 0 },
      { label: 'UI errors · 24h', value: this.errorCount() ?? '—', note: 'Customer and admin error records', icon: 'pulse-outline', route: '/app/activity', params: {}, attention: (this.errorCount() ?? 0) > 0 },
    ];
  });
  readonly needsAttention = computed(() => !this.checkedAt() || Boolean(this.issue() || this.data.error()) || this.cards().some((card) => card.attention));

  ngOnInit() { void this.refresh(); }

  async refresh() {
    if (this.busy()) return;
    this.busy.set(true);
    this.issue.set('');
    try {
      await this.data.start();
      if (this.data.error()) await this.data.refreshAll();
      const { data, error, count } = await this.client.from('client_error_events')
        .select('id,message,path,created_at', { count: 'exact' })
        .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 29);
      if (error) throw error;
      this.errors.set(data ?? []);
      this.errorCount.set(count);
      this.checkedAt.set(new Date().toISOString());
    } catch {
      this.issue.set('Health records could not be refreshed. Check your connection and retry.');
      this.errorCount.set(null);
    } finally { this.busy.set(false); }
  }
}
