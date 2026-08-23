import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { AlertController, IonIcon, IonSearchbar, IonSegment, IonSegmentButton, IonLabel } from '@ionic/angular/standalone';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { ExportService } from '../../core/native/export.service';
import { money, shortDate, titleCase } from '../../core/utils/format';
import { CozyToastService } from '../../shared/components/toast.service';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

@Component({
  selector: 'cc-payments-page',
  standalone: true,
  imports: [IonIcon, IonSearchbar, IonSegment, IonSegmentButton, IonLabel, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page payments-page">
      <section class="finance-hero"><div><p class="cc-eyebrow">PAYMENT RECONCILIATION</p><h1>{{ money(collected()) }}</h1><p>Collected across {{ paidCount() }} settled orders.</p></div><button type="button" (click)="exportCsv()"><ion-icon name="download-outline"></ion-icon> Export settlement</button></section>
      <section class="finance-stats"><div><span class="finance-stat__icon"><ion-icon name="wallet-outline"></ion-icon></span><div><small>PENDING</small><strong>{{ money(pendingValue()) }}</strong><span>{{ pendingCount() }} orders</span></div></div><div><span class="finance-stat__icon"><ion-icon name="return-down-back-outline"></ion-icon></span><div><small>REFUNDED</small><strong>{{ money(refundedValue()) }}</strong><span>{{ refundedCount() }} orders</span></div></div></section>
      <div class="finance-tools"><ion-searchbar mode="ios" placeholder="Order or customer…" [debounce]="150" (ionInput)="query.set($any($event).detail.value ?? '')"></ion-searchbar><ion-segment [value]="filter()" (ionChange)="filter.set($any($event).detail.value)"><ion-segment-button value="all"><ion-label>All</ion-label></ion-segment-button><ion-segment-button value="pending"><ion-label>Pending</ion-label></ion-segment-button><ion-segment-button value="paid"><ion-label>Paid</ion-label></ion-segment-button><ion-segment-button value="refunded"><ion-label>Refunded</ion-label></ion-segment-button></ion-segment></div>
      <section class="transaction-list cc-card"><div class="transaction-list__head"><span>Recorded orders</span><span>{{ visible().length }} records</span></div>@for (order of visible(); track order.id) { <article class="transaction-row"><div><b>{{ order.order_number }}</b><small>{{ order.shipping_address.name || order.profiles?.full_name || 'Customer' }} · {{ shortDate(order.created_at) }}</small></div><span class="method-chip">{{ order.payment_method.toUpperCase() }}</span><strong>{{ money(order.total) }}</strong><cc-status-pill [value]="order.payment_status"></cc-status-pill>@if (order.payment_method === 'cod' && order.payment_status === 'pending' && order.status === 'delivered') { <button type="button" (click)="markReceived(order.id, order.order_number)">Mark received</button> } @else if (order.payment_method === 'cod' && order.payment_status === 'pending') { <small class="provider-note">Confirm after delivery</small> } @else if (order.payment_method !== 'cod') { <small class="provider-note">PayMongo managed</small> }</article> } @empty { <p class="inline-empty">No payments match the current view.</p> }</section>
    </main>
  `,
  styleUrl: './reports.scss',
})
export class PaymentsPage {
  readonly money = money; readonly shortDate = shortDate; readonly titleCase = titleCase;
  readonly query = signal(''); readonly filter = signal<'all' | 'pending' | 'paid' | 'refunded'>('all');
  readonly collected = computed(() => this.data.orders().filter((o) => o.payment_status === 'paid').reduce((sum, o) => sum + Number(o.total), 0));
  readonly paidCount = computed(() => this.data.orders().filter((o) => o.payment_status === 'paid').length);
  readonly pendingValue = computed(() => this.data.orders().filter((o) => o.payment_status === 'pending').reduce((sum, o) => sum + Number(o.total), 0));
  readonly pendingCount = computed(() => this.data.orders().filter((o) => o.payment_status === 'pending').length);
  readonly refundedValue = computed(() => this.data.orders().filter((o) => o.payment_status === 'refunded').reduce((sum, o) => sum + Number(o.total), 0));
  readonly refundedCount = computed(() => this.data.orders().filter((o) => o.payment_status === 'refunded').length);
  readonly visible = computed(() => { const q = this.query().trim().toLocaleLowerCase(); return this.data.orders().filter((o) => (this.filter() === 'all' || o.payment_status === this.filter()) && (!q || `${o.order_number} ${o.shipping_address.name} ${o.profiles?.full_name}`.toLocaleLowerCase().includes(q))); });
  constructor(readonly data: AdminDataService, private readonly actions: AdminActionsService, private readonly alerts: AlertController, private readonly toast: CozyToastService, private readonly exports: ExportService) {}
  async exportCsv() { const error = await this.exports.csv(`cozycraft-payments-${new Date().toISOString().slice(0, 10)}.csv`, [['Order', 'Customer', 'Method', 'Status', 'Total', 'Created'], ...this.visible().map((o) => [o.order_number, o.shipping_address.name || o.profiles?.full_name, o.payment_method.toUpperCase(), o.payment_status, o.total, o.created_at])]); await this.toast.show(error ?? 'Settlement report is ready to save or share.', error ? 'danger' : 'success'); }
  async markReceived(id: string, number: string) { const alert = await this.alerts.create({ header: 'Confirm cash received?', message: `${number} will be marked paid across CozyCraft.`, buttons: [{ text: 'Not yet', role: 'cancel' }, { text: 'Mark paid', handler: () => void this.runMarkReceived(id) }] }); await alert.present(); }
  private async runMarkReceived(id: string) { const result = await this.actions.markCodPaymentReceived(id); await this.toast.show(result.error ?? 'Cash payment marked received.', result.error ? 'danger' : 'success'); }
}
