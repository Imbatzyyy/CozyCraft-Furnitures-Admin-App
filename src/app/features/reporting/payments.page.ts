import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, IonIcon, IonSearchbar, IonSpinner } from '@ionic/angular/standalone';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Order, PaymentStatus } from '../../core/models/admin.models';
import { ExportService, PremiumReport } from '../../core/native/export.service';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { compactMoney, currentPayment, money, settledOrder, shortDate, titleCase } from '../../core/utils/format';
import { CozyToastService } from '../../shared/components/toast.service';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

type PaymentFilter = 'all' | PaymentStatus;
type ExportFormat = 'pdf' | 'csv';

const paymentFilters: Array<{ value: PaymentFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed', label: 'Failed' },
];

@Component({
  selector: 'cc-payments-page',
  standalone: true,
  imports: [IonIcon, IonSearchbar, IonSpinner, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page payments-page">
      <header class="payments-intro">
        <div>
          <p class="cc-eyebrow">STORE FINANCE / LIVE</p>
          <h1>Payments</h1>
          <p>Reconcile collections and carry a clean settlement record in your pocket.</p>
        </div>
        <button type="button" class="refresh-button" (click)="refresh()" [disabled]="refreshing()" aria-label="Refresh payment records">
          @if (refreshing()) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="refresh-outline"></ion-icon> }
        </button>
      </header>

      <section class="settlement-hero">
        <div class="settlement-hero__top">
          <span><i></i> Reconciled snapshot</span>
          <small>{{ paidCount() }} paid order{{ paidCount() === 1 ? '' : 's' }}</small>
        </div>
        <p>COLLECTED</p>
        <h2>{{ compactMoney(collected()) }}</h2>
        <span class="settlement-hero__exact">{{ money(collected()) }} settled</span>
        <div class="settlement-hero__split">
          <div><small>ONLINE</small><strong>{{ compactMoney(onlineCollected()) }}</strong></div>
          <div><small>CASH</small><strong>{{ compactMoney(cashCollected()) }}</strong></div>
          <div><small>RATE</small><strong>{{ settlementRate() }}%</strong></div>
        </div>
      </section>

      <section class="payment-glance" aria-label="Payment highlights">
        <article>
          <span class="payment-glance__icon payment-glance__icon--pending"><ion-icon name="time-outline"></ion-icon></span>
          <div><small>PENDING</small><strong>{{ compactMoney(pendingValue()) }}</strong><p>{{ pendingCount() }} awaiting settlement</p></div>
        </article>
        <article>
          <span class="payment-glance__icon payment-glance__icon--refund"><ion-icon name="return-down-back-outline"></ion-icon></span>
          <div><small>REFUNDED</small><strong>{{ compactMoney(refundedValue()) }}</strong><p>{{ refundedCount() }} returned payment{{ refundedCount() === 1 ? '' : 's' }}</p></div>
        </article>
        <article>
          <span class="payment-glance__icon payment-glance__icon--failed"><ion-icon name="alert-circle-outline"></ion-icon></span>
          <div><small>FAILED</small><strong>{{ failedCount() }}</strong><p>Needs payment retry</p></div>
        </article>
      </section>

      <section class="settlement-export cc-card">
        <div class="settlement-export__heading">
          <div><p class="cc-eyebrow">EXPORT CENTER</p><h2>Settlement file</h2><span>{{ exportScopeLabel() }}</span></div>
          <div class="payment-format" role="group" aria-label="Settlement export format">
            <button type="button" [class.is-active]="format() === 'pdf'" [attr.aria-pressed]="format() === 'pdf'" (click)="format.set('pdf')">PDF</button>
            <button type="button" [class.is-active]="format() === 'csv'" [attr.aria-pressed]="format() === 'csv'" (click)="format.set('csv')">CSV</button>
          </div>
        </div>
        <div class="settlement-export__action">
          <span class="export-document"><ion-icon [name]="format() === 'pdf' ? 'document-text-outline' : 'grid-outline'"></ion-icon></span>
          <div><strong>{{ format() === 'pdf' ? 'Designed settlement report' : 'Spreadsheet-ready ledger' }}</strong><small>{{ format() === 'pdf' ? 'Branded cover, KPIs, formatted rows, and page numbers.' : 'Complete filtered records with numeric PHP totals.' }}</small></div>
          <button type="button" (click)="exportSettlement()" [disabled]="exporting()">
            @if (exporting()) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="share-outline"></ion-icon><span>Export</span> }
          </button>
        </div>
      </section>

      <section class="payment-tools" aria-label="Find payment records">
        <ion-searchbar
          mode="ios"
          aria-label="Search payments"
          placeholder="Order, customer, or payment method"
          [debounce]="180"
          [value]="query()"
          (ionInput)="setQuery(valueFrom($event))"
        ></ion-searchbar>
        <nav class="payment-filters" aria-label="Filter by payment status">
          @for (option of paymentFilters; track option.value) {
            <button type="button" [class.is-active]="filter() === option.value" [attr.aria-pressed]="filter() === option.value" (click)="setFilter(option.value)">
              {{ option.label }}<span>{{ statusCount(option.value) }}</span>
            </button>
          }
        </nav>
      </section>

      <section class="payments-ledger cc-card">
        <header class="payments-ledger__head">
          <div><p class="cc-eyebrow">PAYMENT LEDGER</p><h2>{{ filteredPayments().length }} record{{ filteredPayments().length === 1 ? '' : 's' }}</h2></div>
          @if (filteredPayments().length) { <span>{{ rangeStart() }}-{{ rangeEnd() }} of {{ filteredPayments().length }}</span> }
        </header>

        <div class="payment-records">
          @for (order of pageRecords(); track order.id) {
            <article class="payment-record">
              <button type="button" class="payment-record__main" (click)="openOrder(order.id)" [attr.aria-label]="'Open payment for order ' + order.order_number">
                <span [class]="'method-mark method-mark--' + normalizedMethod(order.payment_method)"><ion-icon [name]="methodIcon(order.payment_method)"></ion-icon></span>
                <span class="payment-record__identity">
                  <b>{{ order.order_number }}</b>
                  <small>{{ customerName(order) }}</small>
                  <em>{{ methodLabel(order.payment_method) }} · {{ shortDate(order.created_at) }}</em>
                </span>
                <span class="payment-record__amount"><strong>{{ money(order.total) }}</strong><cc-status-pill [value]="order.payment_status"></cc-status-pill></span>
                <ion-icon class="payment-record__chevron" name="chevron-forward-outline"></ion-icon>
              </button>
              <footer>
                <span><ion-icon [name]="providerIcon(order)"></ion-icon>{{ providerNote(order) }}</span>
                @if (canMarkReceived(order)) {
                  <button type="button" (click)="markReceived(order.id, order.order_number)" [disabled]="receiving() === order.id">
                    @if (receiving() === order.id) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="checkmark-circle-outline"></ion-icon> Mark cash received }
                  </button>
                }
              </footer>
            </article>
          } @empty {
            <div class="payments-empty"><span><ion-icon name="wallet-outline"></ion-icon></span><h3>No payments in this view</h3><p>Try another status or remove the search phrase.</p></div>
          }
        </div>

        @if (filteredPayments().length > pageSize) {
          <nav class="payment-pagination" aria-label="Payment record pages">
            <button type="button" (click)="goToPage(displayPage() - 1)" [disabled]="displayPage() === 0" aria-label="Previous payment page"><ion-icon name="chevron-back-outline"></ion-icon></button>
            <span><b>Page {{ displayPage() + 1 }}</b><small>of {{ totalPages() }}</small></span>
            <button type="button" (click)="goToPage(displayPage() + 1)" [disabled]="displayPage() + 1 >= totalPages()" aria-label="Next payment page"><ion-icon name="chevron-forward-outline"></ion-icon></button>
          </nav>
        }
      </section>
    </main>
  `,
  styleUrl: './payments.page.scss',
})
export class PaymentsPage {
  readonly compactMoney = compactMoney;
  readonly money = money;
  readonly shortDate = shortDate;
  readonly paymentFilters = paymentFilters;
  readonly pageSize = 8;
  readonly query = signal('');
  readonly filter = signal<PaymentFilter>('all');
  readonly page = signal(0);
  readonly format = signal<ExportFormat>('pdf');
  readonly exporting = signal(false);
  readonly refreshing = signal(false);
  readonly receiving = signal<string | null>(null);

  readonly settled = computed(() => this.data.orders().filter(settledOrder));
  readonly collected = computed(() => this.sum(this.settled()));
  readonly paidCount = computed(() => this.settled().length);
  readonly cashCollected = computed(() => this.sum(this.settled().filter((order) => order.payment_method === 'cod')));
  readonly onlineCollected = computed(() => this.sum(this.settled().filter((order) => order.payment_method !== 'cod')));
  readonly pendingOrders = computed(() => this.data.orders().filter((order) => order.payment_status === 'pending' && order.status !== 'cancelled'));
  readonly pendingValue = computed(() => this.sum(this.pendingOrders()));
  readonly pendingCount = computed(() => this.pendingOrders().length);
  readonly refundedOrders = computed(() => this.data.orders().filter((order) => order.payment_status === 'refunded'));
  readonly refundedValue = computed(() => this.sum(this.refundedOrders()));
  readonly refundedCount = computed(() => this.refundedOrders().length);
  readonly failedCount = computed(() => this.data.orders().filter((order) => order.payment_status === 'failed').length);
  readonly settlementRate = computed(() => {
    const eligible = this.data.orders().filter((order) => order.status !== 'cancelled' && order.payment_status !== 'refunded');
    return eligible.length ? Math.round(eligible.filter(settledOrder).length / eligible.length * 100) : 0;
  });

  readonly filteredPayments = computed(() => {
    const phrase = this.query().trim().toLocaleLowerCase();
    return this.data.orders().filter((order) => {
      if (this.filter() !== 'all' && order.payment_status !== this.filter()) return false;
      if (!phrase) return true;
      return [order.order_number, this.customerName(order), order.payment_method, order.payment_status, order.profiles?.email]
        .join(' ')
        .toLocaleLowerCase()
        .includes(phrase);
    });
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredPayments().length / this.pageSize)));
  readonly displayPage = computed(() => Math.min(this.page(), this.totalPages() - 1));
  readonly pageRecords = computed(() => {
    const first = this.displayPage() * this.pageSize;
    return this.filteredPayments().slice(first, first + this.pageSize);
  });
  readonly rangeStart = computed(() => this.filteredPayments().length ? this.displayPage() * this.pageSize + 1 : 0);
  readonly rangeEnd = computed(() => Math.min(this.filteredPayments().length, this.rangeStart() + this.pageSize - 1));
  readonly exportScopeLabel = computed(() => {
    const searchScope = this.query().trim() ? ' · Search filtered' : '';
    return `${this.filter() === 'all' ? 'All payment states' : titleCase(this.filter())} · ${this.filteredPayments().length} records${searchScope}`;
  });

  constructor(
    readonly data: AdminDataService,
    private readonly actions: AdminActionsService,
    private readonly alerts: AlertController,
    private readonly toast: CozyToastService,
    private readonly exports: ExportService,
    private readonly router: Router,
    private readonly native: NativePlatformService,
  ) {}

  valueFrom(event: Event): string {
    return String((event as CustomEvent<{ value?: string | null }>).detail?.value ?? '');
  }

  setQuery(value: string): void {
    this.query.set(value.trimStart().slice(0, 90));
    this.page.set(0);
  }

  setFilter(value: PaymentFilter): void {
    if (!paymentFilters.some((option) => option.value === value) || value === this.filter()) return;
    this.filter.set(value);
    this.page.set(0);
    void this.native.tap();
  }

  statusCount(status: PaymentFilter): number {
    return status === 'all' ? this.data.orders().length : this.data.orders().filter((order) => order.payment_status === status).length;
  }

  goToPage(value: number): void {
    const next = Math.max(0, Math.min(this.totalPages() - 1, value));
    if (next === this.displayPage()) return;
    this.page.set(next);
    void this.native.tap();
  }

  async refresh(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    try {
      await this.data.loadOrders();
      await this.toast.show('Payment records are up to date.', 'success');
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error, 'Payment records could not be refreshed.'), 'danger');
    } finally {
      this.refreshing.set(false);
    }
  }

  openOrder(orderId: string): void {
    void this.native.tap();
    void this.router.navigate(['/app/orders', orderId]);
  }

  async exportSettlement(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const error = this.format() === 'pdf'
        ? await this.exports.premiumPdf(this.settlementPdf())
        : await this.exports.csv(this.exportFilename('csv'), this.settlementCsv());
      await this.toast.show(error ?? `${this.format().toUpperCase()} settlement is ready to save or share.`, error ? 'danger' : 'success');
    } finally {
      this.exporting.set(false);
    }
  }

  async markReceived(id: string, number: string): Promise<void> {
    if (this.receiving()) return;
    const alert = await this.alerts.create({
      header: 'Confirm cash received?',
      message: `${number} will be marked paid across CozyCraft and included in the next settlement export.`,
      buttons: [
        { text: 'Not yet', role: 'cancel' },
        { text: 'Mark paid', handler: () => void this.runMarkReceived(id) },
      ],
    });
    await alert.present();
  }

  canMarkReceived(order: Order): boolean {
    return order.payment_method === 'cod' && order.payment_status === 'pending' && order.status === 'delivered';
  }

  normalizedMethod(method: string): string {
    return ['cod', 'gcash', 'card'].includes(method) ? method : 'online';
  }

  methodLabel(method: string): string {
    if (method === 'cod') return 'Cash on delivery';
    if (method === 'gcash') return 'GCash';
    if (method === 'card') return 'Card';
    return titleCase(method || 'Online');
  }

  methodIcon(method: string): string {
    if (method === 'cod') return 'cash-outline';
    if (method === 'gcash') return 'phone-portrait-outline';
    return 'card-outline';
  }

  customerName(order: Order): string {
    return order.shipping_address.name || order.profiles?.full_name || 'Customer';
  }

  providerNote(order: Order): string {
    if (order.payment_method === 'cod') {
      if (order.payment_status === 'paid') return 'Cash receipt confirmed';
      if (order.status === 'delivered') return 'Delivery complete · confirmation required';
      return 'Confirm cash after delivery';
    }
    const transaction = currentPayment(order);
    if (transaction?.status === 'paid' && transaction.paid_at) return `PayMongo settled · ${shortDate(transaction.paid_at)}`;
    if (transaction?.status) return `PayMongo · ${titleCase(transaction.status)}`;
    return 'PayMongo managed payment';
  }

  providerIcon(order: Order): string {
    if (this.canMarkReceived(order)) return 'alert-circle-outline';
    if (order.payment_status === 'paid') return 'shield-checkmark-outline';
    if (order.payment_status === 'refunded') return 'return-down-back-outline';
    return 'information-circle-outline';
  }

  private async runMarkReceived(id: string): Promise<void> {
    if (this.receiving()) return;
    this.receiving.set(id);
    try {
      const result = await this.actions.markCodPaymentReceived(id);
      await this.toast.show(result.error ?? 'Cash payment marked received.', result.error ? 'danger' : 'success');
    } finally {
      this.receiving.set(null);
    }
  }

  private settlementPdf(): PremiumReport {
    const records = this.filteredPayments();
    const summary = this.reportSummary(records);
    return {
      filename: this.exportFilename('pdf'),
      title: 'Store payment settlement',
      subtitle: 'A reconciled ledger of CozyCraft customer collections and payment outcomes.',
      period: this.exportScopeLabel(),
      generatedAt: this.generatedAt(),
      kpis: [
        { label: 'Collected', value: money(summary.collected), detail: `${summary.paidCount} settled orders in scope` },
        { label: 'Pending', value: money(summary.pending), detail: `${summary.pendingCount} awaiting settlement` },
        { label: 'Refunded', value: money(summary.refunded), detail: `${summary.refundedCount} returned payments` },
        { label: 'Settlement rate', value: `${summary.rate}%`, detail: 'paid share of active records' },
      ],
      columns: [
        { label: 'Order', weight: .92 },
        { label: 'Customer', weight: 1.62 },
        { label: 'Method', weight: 1.03 },
        { label: 'Payment', weight: .9 },
        { label: 'Fulfillment', weight: .95 },
        { label: 'Created', weight: 1.15 },
        { label: 'Amount', weight: 1.05, align: 'right' },
      ],
      rows: records.map((order) => [order.order_number, this.customerName(order), this.methodLabel(order.payment_method), titleCase(order.payment_status), titleCase(order.status), shortDate(order.created_at), money(order.total)]),
      note: 'Paid totals exclude cancelled orders. COD enters collected revenue only after cash receipt confirmation.',
    };
  }

  private settlementCsv(): Array<Array<string | number | null | undefined>> {
    const records = this.filteredPayments();
    const summary = this.reportSummary(records);
    return [
      ['CozyCraft Furnitures', 'Store payment settlement'],
      ['Scope', this.exportScopeLabel()],
      ['Generated', this.generatedAt()],
      ['Collected PHP', summary.collected],
      ['Pending PHP', summary.pending],
      ['Refunded PHP', summary.refunded],
      ['Settlement rate', `${summary.rate}%`],
      [],
      ['Order', 'Customer', 'Customer email', 'Payment method', 'Payment status', 'Fulfillment status', 'Subtotal PHP', 'Delivery PHP', 'Total PHP', 'Created'],
      ...records.map((order) => [order.order_number, this.customerName(order), order.shipping_address.email || order.profiles?.email, this.methodLabel(order.payment_method), order.payment_status, order.status, Number(order.subtotal), Number(order.delivery_fee), Number(order.total), order.created_at]),
    ];
  }

  private reportSummary(records: Order[]) {
    const paid = records.filter(settledOrder);
    const pending = records.filter((order) => order.payment_status === 'pending' && order.status !== 'cancelled');
    const refunded = records.filter((order) => order.payment_status === 'refunded');
    const active = records.filter((order) => order.status !== 'cancelled' && order.payment_status !== 'refunded');
    return {
      collected: this.sum(paid),
      paidCount: paid.length,
      pending: this.sum(pending),
      pendingCount: pending.length,
      refunded: this.sum(refunded),
      refundedCount: refunded.length,
      rate: active.length ? Math.round(paid.length / active.length * 100) : 0,
    };
  }

  private exportFilename(extension: 'pdf' | 'csv'): string {
    const filter = this.filter() === 'all' ? 'all' : this.filter();
    return `cozycraft-payment-settlement-${filter}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  }

  private generatedAt(): string {
    return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date());
  }

  private sum(orders: Order[]): number {
    return orders.reduce((total, order) => total + Number(order.total), 0);
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return fallback;
  }
}
