import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Order, OrderStatus } from '../../core/models/admin.models';
import { money, timeAgo, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

@Component({
  selector: 'cc-orders-page',
  standalone: true,
  imports: [RouterLink, IonIcon, EmptyStateComponent, StatusPillComponent],
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
          <span>Latest first</span>
        </div>
      </section>

      @if (visibleOrders().length) {
        <section class="orders-list" aria-label="Orders">
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

        @if (displayedOrders().length < visibleOrders().length) {
          <button type="button" class="show-more-orders" (click)="showMore()">
            <span><strong>Show more orders</strong><small>{{ visibleOrders().length - displayedOrders().length }} remaining</small></span>
            <ion-icon name="chevron-down-outline"></ion-icon>
          </button>
        }
      } @else {
        <cc-empty-state icon="receipt-outline" title="No matching orders" message="Change the filter or search another order number or customer."></cc-empty-state>
      }
    </main>
  `,
  styleUrl: './orders.scss',
})
export class OrdersPage {
  private readonly pageSize = 16;
  readonly money = money;
  readonly timeAgo = timeAgo;
  readonly titleCase = titleCase;
  readonly query = signal('');
  readonly filter = signal<'all' | OrderStatus | 'active'>('all');
  readonly filters = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'In progress' },
    { value: 'pending', label: 'Pending' },
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
  readonly visibleLimit = signal(this.pageSize);
  readonly filterCounts = computed<Record<(typeof this.filters)[number]['value'], number>>(() => {
    const counts = { all: 0, active: 0, pending: 0, shipped: 0, delivered: 0, cancelled: 0 };
    for (const order of this.data.orders()) {
      counts.all += 1;
      if (['pending', 'processing', 'packed', 'shipped'].includes(order.status)) counts.active += 1;
      if (order.status === 'pending') counts.pending += 1;
      if (order.status === 'shipped') counts.shipped += 1;
      if (order.status === 'delivered') counts.delivered += 1;
      if (order.status === 'cancelled') counts.cancelled += 1;
    }
    return counts;
  });
  readonly visibleOrders = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const filter = this.filter();
    return this.data.orders().filter((order) => {
      const statusMatch = filter === 'all' || order.status === filter || (filter === 'active' && ['pending', 'processing', 'packed', 'shipped'].includes(order.status));
      const source = `${order.order_number} ${order.shipping_address.name ?? ''} ${order.shipping_address.email ?? ''} ${order.profiles?.full_name ?? ''} ${order.profiles?.email ?? ''}`.toLocaleLowerCase();
      return statusMatch && (!query || source.includes(query));
    });
  });
  readonly displayedOrders = computed(() => this.visibleOrders().slice(0, this.visibleLimit()));

  constructor(readonly data: AdminDataService) {}

  customerInitials(value: string | null | undefined) {
    return (value || 'CC').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  selectFilter(value: (typeof this.filters)[number]['value']) {
    this.filter.set(value);
    this.visibleLimit.set(this.pageSize);
  }

  updateQuery(value: string) {
    this.query.set(value);
    this.visibleLimit.set(this.pageSize);
  }

  clearQuery() { this.updateQuery(''); }

  filterCount(value: (typeof this.filters)[number]['value']) { return this.filterCounts()[value]; }

  showMore() { this.visibleLimit.update((limit) => limit + this.pageSize); }

  returnFor(orderId: string) { return this.returnLookup().get(orderId); }

  itemCount(order: Order) { return this.itemCounts().get(order.id) ?? 0; }

  destination(order: Order) {
    return [order.shipping_address.city, order.shipping_address.province].filter(Boolean).join(', ')
      || order.profiles?.email
      || 'CozyCraft customer';
  }
}
