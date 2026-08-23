import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { IonIcon, IonSegment, IonSegmentButton, IonLabel } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { ExportService } from '../../core/native/export.service';
import { Order } from '../../core/models/admin.models';
import { compactMoney, money, settledOrder } from '../../core/utils/format';
import { CozyToastService } from '../../shared/components/toast.service';

type Range = 'week' | 'month' | 'quarter';

@Component({
  selector: 'cc-reports-page',
  standalone: true,
  imports: [IonIcon, IonSegment, IonSegmentButton, IonLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page reports-page">
      <header class="cc-page-heading"><div><p class="cc-eyebrow">BUSINESS INTELLIGENCE</p><h1>The store, in perspective</h1><p>Live operational reports computed from settled CozyCraft records.</p></div><button type="button" class="report-refresh" (click)="data.refreshAll()"><ion-icon name="refresh-outline"></ion-icon> Refresh</button></header>
      <ion-segment [value]="range()" (ionChange)="range.set($any($event).detail.value)"><ion-segment-button value="week"><ion-label>This week</ion-label></ion-segment-button><ion-segment-button value="month"><ion-label>This month</ion-label></ion-segment-button><ion-segment-button value="quarter"><ion-label>Quarter</ion-label></ion-segment-button></ion-segment>
      <section class="report-metrics">@for (metric of metrics(); track metric.label) { <article><span class="report-metric__icon"><ion-icon [name]="metric.icon"></ion-icon></span><p>{{ metric.label }}</p><strong>{{ metric.value }}</strong><small>{{ metric.note }}</small></article> }</section>
      <div class="report-grid"><section class="cc-card performance-card"><div class="cc-section-head"><div><p class="cc-eyebrow">SALES PERFORMANCE</p><h2>Revenue by month</h2></div><strong>{{ compactMoney(revenue()) }}</strong></div><div class="report-chart">@for (point of chart(); track point.label) { <div><span>{{ compactMoney(point.value) }}</span><i><b [style.height.%]="point.height"></b></i><small>{{ point.label }}</small></div> }</div></section><section class="category-card"><p class="cc-eyebrow">LEADING ROOM</p><ion-icon name="trophy-outline"></ion-icon><h2>{{ leadingCategory().name }}</h2><strong>{{ money(leadingCategory().value) }}</strong><p>in attributable settled sales</p></section></div>
      <section class="cc-card report-library"><div class="cc-section-head"><div><p class="cc-eyebrow">REPORT LIBRARY</p><h2>Ready to take with you</h2></div></div><button type="button" (click)="exportSales()"><span class="library-icon"><ion-icon name="trending-up-outline"></ion-icon></span><span><b>Sales performance</b><small>Settled orders in this range</small></span><ion-icon name="download-outline"></ion-icon></button><button type="button" (click)="exportInventory()"><span class="library-icon"><ion-icon name="layers-outline"></ion-icon></span><span><b>Inventory velocity</b><small>Current catalog stock and value</small></span><ion-icon name="download-outline"></ion-icon></button><button type="button" (click)="exportCustomers()"><span class="library-icon"><ion-icon name="people-outline"></ion-icon></span><span><b>Customer retention</b><small>Order frequency and lifetime value</small></span><ion-icon name="download-outline"></ion-icon></button></section>
      <section class="schedule-note"><span><ion-icon name="calendar-outline"></ion-icon></span><div><p class="cc-eyebrow">SCHEDULED BRIEFING</p><h2>{{ data.settings().weekly_report_enabled ? 'The ' + data.settings().report_settings.frequency + ' briefing is active.' : 'Scheduled briefings are paused.' }}</h2><p>Super Administrators can change report delivery and privacy controls in Store Settings.</p></div></section>
    </main>
  `,
  styleUrl: './reports.scss',
})
export class ReportsPage {
  readonly compactMoney = compactMoney; readonly money = money; readonly range = signal<Range>('month');
  readonly start = computed(() => { const now = new Date(); if (this.range() === 'month') return new Date(now.getFullYear(), now.getMonth(), 1); if (this.range() === 'quarter') return new Date(now.getFullYear(), now.getMonth() - (now.getMonth() % 3), 1); const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6); return start; });
  readonly orders = computed(() => this.data.orders().filter((order) => new Date(order.created_at) >= this.start()));
  readonly settled = computed(() => this.orders().filter(settledOrder)); readonly revenue = computed(() => this.settled().reduce((sum, o) => sum + Number(o.total), 0));
  readonly refunded = computed(() => this.orders().filter((o) => o.payment_status === 'refunded').reduce((sum, o) => sum + Number(o.total), 0));
  readonly repeatCustomers = computed(() => { const counts = new Map<string, number>(); for (const order of this.data.orders().filter(settledOrder)) counts.set(order.user_id, (counts.get(order.user_id) ?? 0) + 1); return [...counts.values()].filter((count) => count > 1).length; });
  readonly metrics = computed(() => [{ label: 'Settled sales', value: money(this.revenue()), note: `${this.settled().length} paid orders`, icon: 'cash-outline' }, { label: 'Average order', value: money(this.settled().length ? this.revenue() / this.settled().length : 0), note: 'for selected range', icon: 'analytics-outline' }, { label: 'Refunded value', value: money(this.refunded()), note: `${this.orders().filter((o) => o.payment_status === 'refunded').length} refunded orders`, icon: 'return-down-back-outline' }, { label: 'Repeat customers', value: String(this.repeatCustomers()), note: 'all-time paid buyers', icon: 'heart-outline' }]);
  readonly leadingCategory = computed(() => { const values = new Map<string, number>(); for (const order of this.settled()) for (const item of order.order_items) { const product = this.data.products().find((p) => p.id === item.product_id); const category = product?.category ?? 'Other'; values.set(category, (values.get(category) ?? 0) + Number(item.unit_price) * item.quantity); } const top = [...values.entries()].sort((a, b) => b[1] - a[1])[0]; return { name: top?.[0] ?? 'No settled sales', value: top?.[1] ?? 0 }; });
  readonly chart = computed(() => { const now = new Date(); const points = Array.from({ length: 12 }, (_, index) => { const start = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1); const end = new Date(start.getFullYear(), start.getMonth() + 1, 1); return { label: start.toLocaleDateString('en-PH', { month: 'short' }), value: this.data.orders().filter((o) => settledOrder(o) && new Date(o.created_at) >= start && new Date(o.created_at) < end).reduce((sum, o) => sum + Number(o.total), 0) }; }); const max = Math.max(1, ...points.map((p) => p.value)); return points.map((p) => ({ ...p, height: p.value ? Math.max(7, p.value / max * 100) : 2 })); });
  constructor(
    readonly data: AdminDataService,
    private readonly exports: ExportService,
    private readonly toast: CozyToastService,
  ) {}

  async exportSales() {
    await this.shareCsv(`cozycraft-sales-${this.range()}.csv`, [['Order', 'Customer', 'Status', 'Payment', 'Total', 'Created'], ...this.orders().map((o) => [o.order_number, o.shipping_address.name || o.profiles?.full_name, o.status, o.payment_status, o.total, o.created_at])]);
  }

  async exportInventory() {
    await this.shareCsv('cozycraft-inventory.csv', [['Product', 'Category', 'Subcategory', 'Status', 'Stock', 'Price', 'Stock value'], ...this.data.products().map((p) => [p.name, p.category, p.subcategory, p.status, p.stock_quantity, p.price, p.stock_quantity * p.price])]);
  }

  async exportCustomers() {
    await this.shareCsv('cozycraft-customer-retention.csv', [['Customer', 'Email', 'Orders', 'Settled lifetime value'], ...this.data.customers().map((c) => [c.full_name, c.email, this.data.orders().filter((o) => o.user_id === c.id).length, this.data.orders().filter((o) => o.user_id === c.id && settledOrder(o)).reduce((sum, o) => sum + Number(o.total), 0)])]);
  }

  private async shareCsv(filename: string, rows: Parameters<ExportService['csv']>[1]) {
    const error = await this.exports.csv(filename, rows);
    await this.toast.show(error ?? 'Report is ready to save or share.', error ? 'danger' : 'success');
  }
}
