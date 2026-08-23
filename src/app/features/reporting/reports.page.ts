import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { ExportService, PremiumReport } from '../../core/native/export.service';
import { Order } from '../../core/models/admin.models';
import { compactMoney, money, settledOrder, shortDate, titleCase } from '../../core/utils/format';
import { CozyToastService } from '../../shared/components/toast.service';

type Range = 'week' | 'month' | 'quarter';
type ExportFormat = 'pdf' | 'csv';
type ReportKind = 'sales' | 'inventory' | 'customers';

interface TimeSlice {
  label: string;
  start: Date;
  end: Date;
}

@Component({
  selector: 'cc-reports-page',
  standalone: true,
  imports: [IonIcon, IonSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page reports-page">
      <header class="reports-header">
        <div>
          <p class="cc-eyebrow">REPORTS / LIVE DATA</p>
          <h1>Business pulse</h1>
          <p>A focused view of sales, stock, and customer health.</p>
        </div>
        <button type="button" class="icon-button" aria-label="Refresh reports" [disabled]="data.loading()" (click)="data.refreshAll()">
          @if (data.loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="refresh-outline"></ion-icon> }
        </button>
      </header>

      <section class="range-control" aria-label="Report period">
        <div role="group" aria-label="Select report period">
          <button type="button" [class.is-active]="range() === 'week'" [attr.aria-pressed]="range() === 'week'" (click)="range.set('week')">7 days</button>
          <button type="button" [class.is-active]="range() === 'month'" [attr.aria-pressed]="range() === 'month'" (click)="range.set('month')">Month</button>
          <button type="button" [class.is-active]="range() === 'quarter'" [attr.aria-pressed]="range() === 'quarter'" (click)="range.set('quarter')">Quarter</button>
        </div>
        <span><i></i>{{ periodLabel() }}</span>
      </section>

      <section class="pulse-card">
        <div class="pulse-card__top">
          <div>
            <p>Settled revenue</p>
            <h2>{{ compactMoney(revenue()) }}</h2>
            <span>{{ money(revenue()) }} total</span>
          </div>
          <span class="change-chip" [class.is-down]="revenueChange() < 0" [class.is-neutral]="revenueChange() === 0">
            <ion-icon [name]="revenueChange() < 0 ? 'trending-down-outline' : revenueChange() > 0 ? 'trending-up-outline' : 'remove-outline'"></ion-icon>
            {{ changeLabel() }}
          </span>
        </div>

        <div class="pulse-chart" role="img" [attr.aria-label]="'Settled revenue chart for ' + periodLabel()">
          @for (point of chart(); track point.key) {
            <div class="pulse-chart__point">
              <span>{{ point.value ? compactMoney(point.value) : '' }}</span>
              <i><b [style.height.%]="point.height"></b></i>
              <small>{{ point.label }}</small>
            </div>
          }
        </div>

        <div class="pulse-card__footer">
          <div><strong>{{ settled().length }}</strong><span>settled orders</span></div>
          <div><strong>{{ money(averageOrder()) }}</strong><span>average order</span></div>
          <div><strong>{{ leadingCategory().name }}</strong><span>leading room</span></div>
        </div>
      </section>

      <section class="metric-strip" aria-label="Report highlights">
        @for (metric of metrics(); track metric.label) {
          <article>
            <span><ion-icon [name]="metric.icon"></ion-icon></span>
            <div><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><p>{{ metric.note }}</p></div>
          </article>
        }
      </section>

      <section class="report-library cc-card">
        <div class="library-heading">
          <div><p class="cc-eyebrow">EXPORT CENTER</p><h2>Prepared reports</h2><span>Download the selected view without another database request.</span></div>
          <div class="format-switch" role="group" aria-label="Export format">
            <button type="button" [class.is-active]="format() === 'pdf'" [attr.aria-pressed]="format() === 'pdf'" (click)="format.set('pdf')">PDF</button>
            <button type="button" [class.is-active]="format() === 'csv'" [attr.aria-pressed]="format() === 'csv'" (click)="format.set('csv')">CSV</button>
          </div>
        </div>

        <div class="report-list">
          <button type="button" [disabled]="exporting() !== null" (click)="exportReport('sales')">
            <span class="report-icon report-icon--dark"><ion-icon name="trending-up-outline"></ion-icon></span>
            <span><b>Sales performance</b><small>{{ settled().length }} settled records · {{ periodLabel() }}</small></span>
            <span class="export-action">
              @if (exporting() === 'sales') { <ion-spinner name="crescent"></ion-spinner> } @else { <em>{{ format().toUpperCase() }}</em><ion-icon name="arrow-down-circle-outline"></ion-icon> }
            </span>
          </button>
          <button type="button" [disabled]="exporting() !== null" (click)="exportReport('inventory')">
            <span class="report-icon"><ion-icon name="layers-outline"></ion-icon></span>
            <span><b>Inventory position</b><small>{{ data.products().length }} products · current snapshot</small></span>
            <span class="export-action">
              @if (exporting() === 'inventory') { <ion-spinner name="crescent"></ion-spinner> } @else { <em>{{ format().toUpperCase() }}</em><ion-icon name="arrow-down-circle-outline"></ion-icon> }
            </span>
          </button>
          <button type="button" [disabled]="exporting() !== null" (click)="exportReport('customers')">
            <span class="report-icon"><ion-icon name="people-outline"></ion-icon></span>
            <span><b>Customer retention</b><small>{{ data.customers().length }} profiles · lifetime behavior</small></span>
            <span class="export-action">
              @if (exporting() === 'customers') { <ion-spinner name="crescent"></ion-spinner> } @else { <em>{{ format().toUpperCase() }}</em><ion-icon name="arrow-down-circle-outline"></ion-icon> }
            </span>
          </button>
        </div>

        <p class="export-note"><ion-icon name="shield-checkmark-outline"></ion-icon>{{ format() === 'pdf' ? 'Designed PDF includes branded headers, KPI summaries, page numbers, and a formatted data table.' : 'CSV keeps the complete dataset ready for spreadsheet analysis.' }}</p>
      </section>

      <section class="schedule-note">
        <span><ion-icon name="calendar-clear-outline"></ion-icon></span>
        <div><p class="cc-eyebrow">SCHEDULED BRIEFING</p><h2>{{ briefingTitle() }}</h2><p>Delivery and privacy controls remain available in Store Settings.</p></div>
        <i [class.is-on]="data.settings().weekly_report_enabled">{{ data.settings().weekly_report_enabled ? 'Active' : 'Paused' }}</i>
      </section>
    </main>
  `,
  styleUrl: './reports.scss',
})
export class ReportsPage {
  readonly compactMoney = compactMoney;
  readonly money = money;
  readonly range = signal<Range>('month');
  readonly format = signal<ExportFormat>('pdf');
  readonly exporting = signal<ReportKind | null>(null);

  readonly bounds = computed(() => this.rangeBounds(this.range()));
  readonly periodLabel = computed(() => this.dateRangeLabel(this.bounds().start, this.bounds().end));
  readonly orders = computed(() => this.ordersBetween(this.bounds().start, this.bounds().end));
  readonly settled = computed(() => this.orders().filter(settledOrder));
  readonly revenue = computed(() => this.sumOrders(this.settled()));
  readonly averageOrder = computed(() => this.settled().length ? this.revenue() / this.settled().length : 0);
  readonly refundedOrders = computed(() => this.orders().filter((order) => order.payment_status === 'refunded'));
  readonly refunded = computed(() => this.sumOrders(this.refundedOrders()));

  readonly previousRevenue = computed(() => {
    const { start, previousStart } = this.bounds();
    return this.sumOrders(this.ordersBetween(previousStart, start).filter(settledOrder));
  });
  readonly revenueChange = computed(() => {
    const previous = this.previousRevenue();
    if (!previous) return this.revenue() ? 100 : 0;
    return Math.round((this.revenue() - previous) / previous * 100);
  });
  readonly changeLabel = computed(() => {
    if (!this.previousRevenue() && this.revenue()) return 'New activity';
    const change = this.revenueChange();
    return `${change > 0 ? '+' : ''}${change}% vs prior`;
  });

  readonly repeatCustomers = computed(() => {
    const counts = new Map<string, number>();
    for (const order of this.data.orders().filter(settledOrder)) counts.set(order.user_id, (counts.get(order.user_id) ?? 0) + 1);
    return [...counts.values()].filter((count) => count > 1).length;
  });
  readonly uniqueCustomers = computed(() => new Set(this.settled().map((order) => order.user_id)).size);
  readonly metrics = computed(() => [
    { label: 'Customers', value: String(this.uniqueCustomers()), note: 'settled buyers', icon: 'people-outline' },
    { label: 'Refunded', value: money(this.refunded()), note: `${this.refundedOrders().length} orders`, icon: 'return-down-back-outline' },
    { label: 'Repeat buyers', value: String(this.repeatCustomers()), note: 'all-time customers', icon: 'heart-outline' },
    { label: 'Stock value', value: compactMoney(this.stockValue()), note: `${this.lowStockCount()} low stock`, icon: 'cube-outline' },
  ]);
  readonly stockValue = computed(() => this.data.products().reduce((sum, product) => sum + product.stock_quantity * Number(product.price), 0));
  readonly lowStockCount = computed(() => this.data.products().filter((product) => product.stock_quantity <= this.data.settings().low_stock_threshold).length);
  readonly leadingCategory = computed(() => {
    const values = new Map<string, number>();
    for (const order of this.settled()) {
      for (const item of order.order_items) {
        const product = this.data.products().find((entry) => entry.id === item.product_id);
        const category = product?.category || 'Other';
        values.set(category, (values.get(category) ?? 0) + Number(item.unit_price) * item.quantity);
      }
    }
    const top = [...values.entries()].sort((left, right) => right[1] - left[1])[0];
    return { name: top?.[0] ?? 'No sales yet', value: top?.[1] ?? 0 };
  });
  readonly chart = computed(() => {
    const points = this.timeSlices(this.range(), this.bounds().start, this.bounds().end).map((slice) => ({
      key: slice.start.toISOString(),
      label: slice.label,
      value: this.sumOrders(this.ordersBetween(slice.start, slice.end).filter(settledOrder)),
    }));
    const maximum = Math.max(1, ...points.map((point) => point.value));
    return points.map((point) => ({ ...point, height: point.value ? Math.max(8, point.value / maximum * 100) : 3 }));
  });
  readonly briefingTitle = computed(() => {
    if (!this.data.settings().weekly_report_enabled) return 'Automatic delivery is paused.';
    return `${titleCase(this.data.settings().report_settings.frequency)} briefing is active.`;
  });

  constructor(
    readonly data: AdminDataService,
    private readonly exports: ExportService,
    private readonly toast: CozyToastService,
  ) {}

  async exportReport(kind: ReportKind): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(kind);
    try {
      const error = this.format() === 'pdf'
        ? await this.exports.premiumPdf(this.pdfReport(kind))
        : await this.exports.csv(this.csvFilename(kind), this.csvRows(kind));
      await this.toast.show(error ?? `${this.reportName(kind)} is ready to save or share.`, error ? 'danger' : 'success');
    } finally {
      this.exporting.set(null);
    }
  }

  private pdfReport(kind: ReportKind): PremiumReport {
    const generatedAt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date());
    const suffix = new Date().toISOString().slice(0, 10);
    if (kind === 'sales') {
      return {
        filename: `cozycraft-sales-${this.range()}-${suffix}.pdf`,
        title: 'Sales performance',
        subtitle: 'Settled CozyCraft orders for the selected operating period.',
        period: this.periodLabel(),
        generatedAt,
        kpis: [
          { label: 'Settled revenue', value: money(this.revenue()), detail: `${this.settled().length} paid orders` },
          { label: 'Average order', value: money(this.averageOrder()), detail: 'per settled order' },
          { label: 'Customers', value: String(this.uniqueCustomers()), detail: 'unique paid buyers' },
          { label: 'Leading room', value: this.leadingCategory().name, detail: money(this.leadingCategory().value) },
        ],
        columns: [
          { label: 'Order', weight: 1.05 }, { label: 'Customer', weight: 1.75 }, { label: 'Fulfillment', weight: 1 },
          { label: 'Payment', weight: 1 }, { label: 'Created', weight: 1.25 }, { label: 'Total', weight: 1.1, align: 'right' },
        ],
        rows: this.settled().map((order) => [order.order_number, this.customerName(order), titleCase(order.status), titleCase(order.payment_method), shortDate(order.created_at), money(order.total)]),
        note: 'Revenue includes paid, non-cancelled orders only.',
      };
    }

    if (kind === 'inventory') {
      const units = this.data.products().reduce((sum, product) => sum + product.stock_quantity, 0);
      return {
        filename: `cozycraft-inventory-${suffix}.pdf`,
        title: 'Inventory position',
        subtitle: 'Current catalog quantity, availability, and retail stock value.',
        period: `Snapshot · ${shortDate(new Date().toISOString())}`,
        generatedAt,
        kpis: [
          { label: 'Catalog', value: String(this.data.products().length), detail: 'product records' },
          { label: 'Units on hand', value: units.toLocaleString('en-PH'), detail: 'across all products' },
          { label: 'Low stock', value: String(this.lowStockCount()), detail: `at ${this.data.settings().low_stock_threshold} or below` },
          { label: 'Retail value', value: money(this.stockValue()), detail: 'price × units on hand' },
        ],
        columns: [
          { label: 'Product', weight: 2.1 }, { label: 'Category', weight: 1.25 }, { label: 'Status', weight: .9 },
          { label: 'Units', weight: .65, align: 'right' }, { label: 'Price', weight: 1, align: 'right' }, { label: 'Stock value', weight: 1.2, align: 'right' },
        ],
        rows: this.data.products().map((product) => [product.name, product.category, titleCase(product.status), product.stock_quantity, money(product.price), money(product.stock_quantity * product.price)]),
        note: 'Stock value is a retail estimate, not an accounting cost valuation.',
      };
    }

    const customerRows = this.customerReportRows();
    const lifetimeValue = customerRows.reduce((sum, row) => sum + row.value, 0);
    return {
      filename: `cozycraft-customer-retention-${suffix}.pdf`,
      title: 'Customer retention',
      subtitle: 'Customer order frequency and settled lifetime value.',
      period: 'Lifetime customer view',
      generatedAt,
      kpis: [
        { label: 'Customers', value: String(customerRows.length), detail: 'available profiles' },
        { label: 'Repeat buyers', value: String(this.repeatCustomers()), detail: 'more than one paid order' },
        { label: 'Settled orders', value: String(this.data.orders().filter(settledOrder).length), detail: 'all-time paid orders' },
        { label: 'Lifetime value', value: money(lifetimeValue), detail: 'all settled customers' },
      ],
      columns: [
        { label: 'Customer', weight: 1.8 }, { label: 'Email', weight: 2.1 }, { label: 'All orders', weight: .8, align: 'right' },
        { label: 'Paid orders', weight: .8, align: 'right' }, { label: 'Last order', weight: 1.15 }, { label: 'Lifetime value', weight: 1.2, align: 'right' },
      ],
      rows: customerRows.map((row) => [row.name, row.email, row.orders, row.paidOrders, row.lastOrder, money(row.value)]),
      note: 'Lifetime value includes paid, non-cancelled orders only.',
    };
  }

  private csvRows(kind: ReportKind): (string | number | null | undefined)[][] {
    const meta = [
      ['CozyCraft Furnitures', this.reportName(kind)],
      ['Period', kind === 'sales' ? this.periodLabel() : kind === 'inventory' ? 'Current snapshot' : 'Lifetime customer view'],
      ['Generated', new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date())],
      [],
    ];
    if (kind === 'sales') {
      return [...meta, ['Order', 'Customer', 'Fulfillment', 'Payment method', 'Total PHP', 'Created'], ...this.settled().map((order) => [order.order_number, this.customerName(order), order.status, order.payment_method, Number(order.total), order.created_at])];
    }
    if (kind === 'inventory') {
      return [...meta, ['Product', 'Category', 'Subcategory', 'Status', 'Units', 'Price PHP', 'Stock value PHP'], ...this.data.products().map((product) => [product.name, product.category, product.subcategory, product.status, product.stock_quantity, Number(product.price), product.stock_quantity * Number(product.price)])];
    }
    return [...meta, ['Customer', 'Email', 'All orders', 'Paid orders', 'Last order', 'Lifetime value PHP'], ...this.customerReportRows().map((row) => [row.name, row.email, row.orders, row.paidOrders, row.lastOrder, row.value])];
  }

  private csvFilename(kind: ReportKind): string {
    const date = new Date().toISOString().slice(0, 10);
    return `cozycraft-${kind === 'customers' ? 'customer-retention' : kind}-${kind === 'sales' ? `${this.range()}-` : ''}${date}.csv`;
  }

  private customerReportRows() {
    return this.data.customers().map((customer) => {
      const orders = this.data.orders().filter((order) => order.user_id === customer.id);
      const paid = orders.filter(settledOrder);
      const latest = [...orders].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
      return {
        name: customer.full_name || 'Customer',
        email: customer.email || 'Not supplied',
        orders: orders.length,
        paidOrders: paid.length,
        lastOrder: latest ? shortDate(latest.created_at) : 'No orders',
        value: this.sumOrders(paid),
      };
    });
  }

  private rangeBounds(range: Range) {
    const end = new Date();
    const start = new Date(end);
    if (range === 'week') {
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);
    } else if (range === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setMonth(start.getMonth() - (start.getMonth() % 3), 1);
      start.setHours(0, 0, 0, 0);
    }
    const previousStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    return { start, end, previousStart };
  }

  private timeSlices(range: Range, start: Date, end: Date): TimeSlice[] {
    if (range === 'week') {
      return Array.from({ length: 7 }, (_, index) => {
        const sliceStart = new Date(start);
        sliceStart.setDate(start.getDate() + index);
        const sliceEnd = new Date(sliceStart);
        sliceEnd.setDate(sliceEnd.getDate() + 1);
        return { label: sliceStart.toLocaleDateString('en-PH', { weekday: 'short' }).slice(0, 2), start: sliceStart, end: sliceEnd };
      });
    }
    if (range === 'quarter') {
      return Array.from({ length: 3 }, (_, index) => {
        const sliceStart = new Date(start.getFullYear(), start.getMonth() + index, 1);
        const sliceEnd = new Date(start.getFullYear(), start.getMonth() + index + 1, 1);
        return { label: sliceStart.toLocaleDateString('en-PH', { month: 'short' }), start: sliceStart, end: sliceEnd > end ? new Date(end.getTime() + 1) : sliceEnd };
      });
    }

    const slices: TimeSlice[] = [];
    let cursor = new Date(start);
    while (cursor <= end) {
      const sliceStart = new Date(cursor);
      const sliceEnd = new Date(cursor);
      sliceEnd.setDate(sliceEnd.getDate() + 7);
      slices.push({ label: `${sliceStart.getDate()}`, start: sliceStart, end: sliceEnd > end ? new Date(end.getTime() + 1) : sliceEnd });
      cursor = sliceEnd;
    }
    return slices;
  }

  private ordersBetween(start: Date, end: Date): Order[] {
    return this.data.orders().filter((order) => {
      const created = new Date(order.created_at);
      return created >= start && created < end;
    });
  }

  private sumOrders(orders: Order[]): number {
    return orders.reduce((sum, order) => sum + Number(order.total), 0);
  }

  private customerName(order: Order): string {
    return order.shipping_address.name || order.profiles?.full_name || 'Customer';
  }

  private reportName(kind: ReportKind): string {
    if (kind === 'sales') return 'Sales performance report';
    if (kind === 'inventory') return 'Inventory position report';
    return 'Customer retention report';
  }

  private dateRangeLabel(start: Date, end: Date): string {
    const startLabel = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(start);
    const endLabel = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(end);
    return `${startLabel}–${endLabel}`;
  }
}
