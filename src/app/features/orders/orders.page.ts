import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { createPagination } from '../../core/utils/pagination';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { orderMatchesRange, orderMatchesView, orderSearchText, orderViews, OrderRange, OrderSort, OrderView } from '../../core/utils/order-filters';
import { IonIcon } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Order, OrderStatus } from '../../core/models/admin.models';
import { money, timeAgo, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

@Component({
  selector: 'cc-orders-page',
  standalone: true,
  imports: [RouterLink, IonIcon, EmptyStateComponent, StatusPillComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page orders-page">
      <header class="orders-intro">
        <div>
          <p class="cc-eyebrow">FULFILLMENT</p>
          <h1>Orders</h1>
          <p>Every checkout, clearly moving toward delivery.</p>
        </div>
        <span class="cc-live-chip" [class.is-live]="data.realtimeStatus() === 'live'" role="status">
          <i></i>{{ data.realtimeStatus() === 'live' ? 'Live' : 'Syncing' }}
        </span>
      </header>

      <section class="order-command" aria-label="Order priorities">
        <div class="order-command__lead">
          <span>ACTIVE QUEUE</span>
          <strong>{{ data.dashboardMetrics().fulfillmentQueue }}</strong>
          <small>orders moving</small>
        </div>
        <div class="order-command__priorities">
          <div>
            <span class="priority-icon is-pending"><ion-icon name="time-outline"></ion-icon></span>
            <span><strong>{{ data.dashboardMetrics().pendingOrders }}</strong><small>Need first touch</small></span>
          </div>
          <div>
            <span class="priority-icon is-return"><ion-icon name="return-down-back-outline"></ion-icon></span>
            <span><strong>{{ openReturns() }}</strong><small>Open returns</small></span>
          </div>
        </div>
      </section>

      <section class="order-tools" aria-label="Find and filter orders">
        <label class="order-search">
          <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
          <input
            type="search"
            inputmode="search"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-label="Search orders"
            placeholder="Order, customer, or email"
            [value]="query()"
            (input)="updateQuery($any($event.target).value ?? '')"
          />
          @if (query()) {
            <button type="button" class="order-search__clear" (click)="clearQuery()" aria-label="Clear order search">
              <ion-icon name="close-circle"></ion-icon>
            </button>
          }
        </label>

        <div class="order-filters" role="group" aria-label="Order status">
          @for (item of filters; track item.value) {
            <button
              type="button"
              [class.is-active]="filter() === item.value"
              [attr.aria-pressed]="filter() === item.value"
              (click)="selectFilter(item.value)"
            >
              <span>{{ item.label }}</span><i>{{ filterCount(item.value) }}</i>
            </button>
          }
        </div>

        <div class="order-results-meta" aria-live="polite">
          <span><strong>{{ visibleOrders().length }}</strong> {{ visibleOrders().length === 1 ? 'order' : 'orders' }}</span>
          <span>{{ sort() === 'highest_total' ? 'Highest value first' : sort() === 'newest' ? 'Latest first' : 'Oldest first' }}</span>
        </div>
        <details class="order-advanced">
          <summary><ion-icon name="options-outline" aria-hidden="true" /> More filters <span>{{ activeAdvanced() ? 'Applied' : 'Optional' }}</span></summary>
          <div class="order-advanced__grid">
            <label>Workflow<select [value]="view()" (change)="changeView($any($event.target).value)">@for (option of views; track option[0]) { <option [value]="option[0]">{{ option[1] }}</option> }</select></label>
            <label>Order date · PHT<select [value]="range()" (change)="range.set($any($event.target).value); pagination.reset()"><option value="all">All dates</option><option value="today">Today</option><option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option></select></label>
            <label>Payment state<select [value]="paymentStatus()" (change)="paymentStatus.set($any($event.target).value); pagination.reset()"><option value="all">All states</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select></label>
            <label>Payment method<select [value]="paymentMethod()" (change)="paymentMethod.set($any($event.target).value); pagination.reset()"><option value="all">All methods</option>@for (method of paymentMethods(); track method) { <option [value]="method">{{ method.toUpperCase() }}</option> }</select></label>
            <label>Sort by<select [value]="sort()" (change)="sort.set($any($event.target).value); pagination.reset()"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest_total">Highest total</option><option value="longest_waiting">Longest waiting</option></select></label>
            <button type="button" (click)="resetFilters()">Reset filters</button>
          </div>
        </details>
      </section>

      @if (visibleOrders().length) {
        <section class="orders-list" aria-label="Orders" data-page-list>
          @for (order of displayedOrders(); track order.id) {
            <a
              [routerLink]="['/app/orders', order.id]"
              class="order-card cc-reveal"
              [class.has-attention]="order.cancellation_status === 'pending' || !!returnFor(order.id)"
              [attr.aria-label]="'Open order ' + order.order_number"
            >
              <div class="order-card__top">
                <span class="order-id"><small>ORDER</small><b>{{ order.order_number }}</b></span>
                <span class="order-age">{{ timeAgo(order.created_at) }}</span>
                <cc-status-pill [value]="order.status"></cc-status-pill>
              </div>

              <div class="order-card__identity">
                <span class="customer-mark">{{ customerInitials(order.shipping_address.name || order.profiles?.full_name) }}</span>
                <span class="customer-copy">
                  <b>{{ order.shipping_address.name || order.profiles?.full_name || 'Customer' }}</b>
                  <small><ion-icon name="location-outline"></ion-icon>{{ destination(order) }}</small>
                </span>
                <span class="order-total"><small>TOTAL</small><strong>{{ money(order.total) }}</strong></span>
              </div>

              @if (order.cancellation_status === 'pending') {
                <div class="order-card__alert"><ion-icon name="alert-circle-outline"></ion-icon><span>Cancellation needs review</span></div>
              }
              @if (returnFor(order.id); as request) {
                <div class="order-card__alert is-return"><ion-icon name="return-down-back-outline"></ion-icon><span>{{ request.return_number }} · {{ titleCase(request.status) }}</span></div>
              }

              <div class="order-card__footer">
                <span class="payment-state" [class.is-paid]="order.payment_status === 'paid'">
                  <ion-icon [name]="order.payment_status === 'paid' ? 'checkmark-circle-outline' : 'card-outline'"></ion-icon>
                  {{ order.payment_method.toUpperCase() }} · {{ titleCase(order.payment_status) }}
                </span>
                <span class="item-count"><ion-icon name="cube-outline"></ion-icon>{{ itemCount(order) }} {{ itemCount(order) === 1 ? 'item' : 'items' }}</span>
                <ion-icon class="order-card__chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
              </div>
              <span class="order-card__progress" [attr.data-status]="order.status" aria-hidden="true"><i></i></span>
            </a>
          }
        </section>

        <cc-pagination [page]="pagination.page()" [pageSize]="pagination.pageSize" [total]="visibleOrders().length" (pageChange)="pagination.select($event)" label="Order pages" />
      } @else {
        <cc-empty-state icon="receipt-outline" title="No matching orders" message="Change the filter or search another order number or customer."></cc-empty-state>
      }
    </main>
  `,
  styleUrl: './orders.scss',
})
export class OrdersPage {
  readonly money = money;
  readonly timeAgo = timeAgo;
  readonly titleCase = titleCase;
  readonly query = signal('');
  readonly views = orderViews;
  readonly view = signal<OrderView>('all');
  readonly range = signal<OrderRange>('all');
  readonly sort = signal<OrderSort>('newest');
  readonly paymentStatus = signal('all');
  readonly paymentMethod = signal('all');
  readonly paymentMethods = computed(() => [...new Set(this.data.orders().map((order) => order.payment_method.toLowerCase()))].sort());
  readonly activeAdvanced = computed(() => this.view() !== 'all' || this.range() !== 'all' || this.sort() !== 'newest' || this.paymentStatus() !== 'all' || this.paymentMethod() !== 'all');
  readonly filter = signal<'all' | OrderStatus | 'active'>('all');
  readonly filters = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'In progress' },
    { value: 'pending', label: 'Pending' },
    { value: 'processing', label: 'Processing' },
    { value: 'packed', label: 'Packed' },
    { value: 'shipped', label: 'Shipped' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
  ] as const;
  readonly openReturns = computed(() => this.data.returnRequests().filter((request) => !['closed', 'rejected', 'refunded'].includes(request.status)).length);
  readonly returnLookup = computed(() => new Map(this.data.returnRequests().map((request) => [request.order_id, request])));
  readonly itemCounts = computed(() => new Map(this.data.orders().map((order) => [
    order.id,
    order.order_items.reduce((total, item) => total + item.quantity, 0),
  ])));
  readonly filterCounts = computed<Record<(typeof this.filters)[number]['value'], number>>(() => {
    const counts = { all: 0, active: 0, pending: 0, processing: 0, packed: 0, shipped: 0, delivered: 0, cancelled: 0 };
    for (const order of this.data.orders()) {
      counts.all += 1;
      if (['pending', 'processing', 'packed', 'shipped'].includes(order.status)) counts.active += 1;
      if (order.status === 'pending') counts.pending += 1;
      if (order.status === 'processing') counts.processing += 1;
      if (order.status === 'packed') counts.packed += 1;
      if (order.status === 'shipped') counts.shipped += 1;
      if (order.status === 'delivered') counts.delivered += 1;
      if (order.status === 'cancelled') counts.cancelled += 1;
    }
    return counts;
  });
  readonly visibleOrders = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const filter = this.filter();
    const returnIds = new Set(this.returnLookup().keys());
    return this.data.orders().filter((order) => {
      const statusMatch = filter === 'all' || order.status === filter || (filter === 'active' && ['pending', 'processing', 'packed', 'shipped'].includes(order.status));
      return statusMatch && (!query || orderSearchText(order).includes(query))
        && orderMatchesView(order, this.view(), returnIds)
        && orderMatchesRange(order.created_at, this.range())
        && (this.paymentStatus() === 'all' || order.payment_status === this.paymentStatus())
        && (this.paymentMethod() === 'all' || order.payment_method.toLowerCase() === this.paymentMethod());
    }).sort((left, right) => this.sort() === 'highest_total' ? right.total - left.total
      : this.sort() === 'newest' ? right.created_at.localeCompare(left.created_at) : left.created_at.localeCompare(right.created_at));
  });
  readonly pagination = createPagination(this.visibleOrders, 6);
  readonly displayedOrders = this.pagination.visible;
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  constructor(readonly data: AdminDataService, private readonly route: ActivatedRoute) {
    effect(() => {
      const params = this.params();
      this.resetFilters();
      const view = params.get('view');
      if (this.views.some((option) => option[0] === view)) this.view.set(view as OrderView);
      const range = params.get('range');
      if (['all', 'today', 'last_7_days', 'last_30_days'].includes(range ?? '')) this.range.set(range as OrderRange);
      const sort = params.get('sort');
      if (['newest', 'oldest', 'highest_total', 'longest_waiting'].includes(sort ?? '')) this.sort.set(sort as OrderSort);
      this.query.set(params.get('q') ?? '');
    });
  }

  changeView(view: OrderView) { this.view.set(view); this.pagination.reset(); }
  resetFilters() {
    this.query.set(''); this.filter.set('all'); this.view.set('all'); this.range.set('all'); this.sort.set('newest');
    this.paymentStatus.set('all'); this.paymentMethod.set('all'); this.pagination.reset();
  }

  customerInitials(value: string | null | undefined) {
    return (value || 'CC').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  selectFilter(value: (typeof this.filters)[number]['value']) {
    this.filter.set(value);
    this.pagination.reset();
  }

  updateQuery(value: string) {
    this.query.set(value);
    this.pagination.reset();
  }

  clearQuery() { this.updateQuery(''); }

  filterCount(value: (typeof this.filters)[number]['value']) { return this.filterCounts()[value]; }


  returnFor(orderId: string) { return this.returnLookup().get(orderId); }

  itemCount(order: Order) { return this.itemCounts().get(order.id) ?? 0; }

  destination(order: Order) {
    return [order.shipping_address.city, order.shipping_address.province].filter(Boolean).join(', ')
      || order.profiles?.email
      || 'CozyCraft customer';
  }
}
