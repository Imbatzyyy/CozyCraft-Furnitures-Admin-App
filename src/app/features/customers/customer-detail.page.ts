import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { compactMoney, dateTime, initials, money, shortDate, titleCase } from '../../core/utils/format';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

@Component({
  selector: 'cc-customer-detail-page',
  standalone: true,
  imports: [RouterLink, IonIcon, StatusPillComponent, SkeletonListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page customer-detail-page">
      <a routerLink="/app/customers" class="detail-back"><ion-icon name="arrow-back-outline" aria-hidden="true"></ion-icon><span>Customer directory</span></a>

      @if (!data.initialized() && !customer()) {
        <div class="customer-detail-loading"><cc-skeleton-list [count]="6" /></div>
      } @else if (customer(); as item) {
        <section class="customer-profile-hero" aria-labelledby="customer-name">
          <div class="profile-identity">
            <span class="profile-avatar">
              <i aria-hidden="true">{{ initials(displayName()) }}</i>
              @if (item.avatar_url) { <img [src]="item.avatar_url" [alt]="displayName() + ' profile photo'" referrerpolicy="no-referrer" decoding="async" (error)="hideAvatar($event)" /> }
            </span>
            <div><p class="cc-eyebrow">Customer profile</p><h1 id="customer-name">{{ displayName() }}</h1><p>{{ item.username ? '@' + item.username : 'CozyCraft member' }} · joined {{ shortDate(item.created_at) }}</p></div>
          </div>
          <div class="profile-value"><small>Settled lifetime value</small><strong>{{ compactMoney(lifetimeValue()) }}</strong><span>{{ customerOrders().length }} recorded {{ customerOrders().length === 1 ? 'order' : 'orders' }}</span></div>
          <div class="profile-actions" aria-label="Customer contact actions">
            @if (item.email) { <a [href]="'mailto:' + item.email"><ion-icon name="mail-outline" aria-hidden="true"></ion-icon>Email</a> }
            @if (item.phone) { <a [href]="'tel:' + item.phone"><ion-icon name="call-outline" aria-hidden="true"></ion-icon>Call</a> }
            <span><ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon>Read-only record</span>
          </div>
        </section>

        <section class="profile-stats" aria-label="Customer activity summary">
          <div><span>Orders</span><strong>{{ item.order_count ?? customerOrders().length }}</strong><small>all purchases</small></div>
          <div><span>Addresses</span><strong>{{ item.address_count ?? item.addresses?.length ?? 0 }}</strong><small>saved locations</small></div>
          <div><span>Support</span><strong>{{ item.support_ticket_count ?? customerTickets().length }}</strong><small>service tickets</small></div>
        </section>

        <div class="profile-grid">
          <section class="profile-card">
            <header><div><p class="cc-eyebrow">Account details</p><h2>Contact & identity</h2></div><ion-icon name="person-outline" aria-hidden="true"></ion-icon></header>
            <dl>
              <div><dt><ion-icon name="mail-outline" aria-hidden="true"></ion-icon>Email</dt><dd>{{ item.email || 'Not provided' }}</dd></div>
              <div><dt><ion-icon name="call-outline" aria-hidden="true"></ion-icon>Mobile</dt><dd>{{ item.phone || 'Not provided' }}</dd></div>
              <div><dt><ion-icon name="person-circle-outline" aria-hidden="true"></ion-icon>Gender</dt><dd>{{ titleCase(item.gender || 'Not provided') }}</dd></div>
              <div><dt><ion-icon name="calendar-clear-outline" aria-hidden="true"></ion-icon>Birthday</dt><dd>{{ item.date_of_birth ? shortDate(item.date_of_birth) : 'Not provided' }}</dd></div>
              <div class="profile-card__wide"><dt><ion-icon name="finger-print-outline" aria-hidden="true"></ion-icon>Customer ID</dt><dd class="is-mono">{{ item.id }}</dd></div>
              <div class="profile-card__wide"><dt><ion-icon name="time-outline" aria-hidden="true"></ion-icon>Registered</dt><dd>{{ dateTime(item.created_at) }}</dd></div>
            </dl>
          </section>

          <section class="primary-address">
            <header><div><p class="cc-eyebrow">Primary delivery</p><h2>{{ primaryAddress()?.label || 'No saved address' }}</h2></div><ion-icon name="location-outline" aria-hidden="true"></ion-icon></header>
            @if (primaryAddress(); as address) {
              <div class="address-recipient"><b>{{ address.recipient_name }}</b><span>{{ addressLine(address) }}</span></div>
              <div class="address-contact"><span><ion-icon name="call-outline" aria-hidden="true"></ion-icon>{{ address.mobile || 'No mobile' }}</span><span><ion-icon name="mail-outline" aria-hidden="true"></ion-icon>{{ address.email || 'No email' }}</span></div>
              @if (address.delivery_note) { <blockquote><ion-icon name="chatbox-ellipses-outline" aria-hidden="true"></ion-icon><span>{{ address.delivery_note }}</span></blockquote> }
            } @else {
              <div class="address-missing"><ion-icon name="navigate-circle-outline" aria-hidden="true"></ion-icon><b>No delivery address yet</b><p>This customer has not added a saved delivery address.</p></div>
            }
          </section>
        </div>

        <section class="customer-orders">
          <header class="orders-head">
            <div><p class="cc-eyebrow">Order history</p><h2>{{ customerOrders().length }} {{ customerOrders().length === 1 ? 'order' : 'orders' }}</h2></div>
            <div class="orders-head__meta"><span>Newest first</span>@if (customerOrders().length) { <small>Page {{ orderPage() }} of {{ orderPageCount() }}</small> }</div>
          </header>
          @if (customerOrders().length) {
            <div class="customer-order-list">
              @for (order of visibleCustomerOrders(); track order.id) {
                <a [routerLink]="['/app/orders', order.id]" class="customer-order">
                  <span class="customer-order__icon"><ion-icon name="bag-handle-outline" aria-hidden="true"></ion-icon></span>
                  <span class="customer-order__copy"><b>{{ order.order_number }}</b><small>{{ shortDate(order.created_at) }} · {{ order.payment_method.toUpperCase() }}</small></span>
                  <span class="customer-order__value"><strong>{{ money(order.total) }}</strong><cc-status-pill [value]="order.status"></cc-status-pill></span>
                  <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                </a>
              }
            </div>
            @if (orderPageCount() > 1) {
              <nav class="order-pagination" aria-label="Customer order history pages">
                <div class="order-pagination__range"><strong>{{ orderRangeStart() }}–{{ orderRangeEnd() }}</strong><span>of {{ customerOrders().length }}</span></div>
                <div class="order-pagination__controls">
                  <button type="button" [disabled]="orderPage() === 1" (click)="previousOrderPage()" aria-label="Previous order history page"><ion-icon name="chevron-back-outline" aria-hidden="true"></ion-icon><span>Previous</span></button>
                  <b aria-current="page">{{ orderPage() }} / {{ orderPageCount() }}</b>
                  <button type="button" [disabled]="orderPage() === orderPageCount()" (click)="nextOrderPage()" aria-label="Next order history page"><span>Next</span><ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon></button>
                </div>
              </nav>
            }
          } @else {
            <div class="inline-empty"><ion-icon name="bag-outline" aria-hidden="true"></ion-icon><b>No orders yet</b><p>This customer has not placed an order.</p></div>
          }
        </section>
      } @else {
        <section class="missing"><ion-icon name="person-remove-outline" aria-hidden="true"></ion-icon><h1>Customer unavailable</h1><p>This record is not present or your role cannot read it.</p><a routerLink="/app/customers">Return to customers</a></section>
      }
    </main>
  `,
  styleUrl: './customers.scss',
})
export class CustomerDetailPage {
  private readonly orderPageSize = 6;
  private readonly requestedOrderPage = signal(1);
  readonly initials = initials;
  readonly shortDate = shortDate;
  readonly dateTime = dateTime;
  readonly compactMoney = compactMoney;
  readonly money = money;
  readonly titleCase = titleCase;
  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly customer = computed(() => this.data.customers().find((item) => item.id === this.id));
  readonly customerOrders = computed(() => this.data.orders()
    .filter((order) => order.user_id === this.id)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()));
  readonly orderPageCount = computed(() => Math.max(1, Math.ceil(this.customerOrders().length / this.orderPageSize)));
  readonly orderPage = computed(() => Math.min(this.requestedOrderPage(), this.orderPageCount()));
  readonly visibleCustomerOrders = computed(() => {
    const start = (this.orderPage() - 1) * this.orderPageSize;
    return this.customerOrders().slice(start, start + this.orderPageSize);
  });
  readonly orderRangeStart = computed(() => this.customerOrders().length ? (this.orderPage() - 1) * this.orderPageSize + 1 : 0);
  readonly orderRangeEnd = computed(() => Math.min(this.orderPage() * this.orderPageSize, this.customerOrders().length));
  readonly customerTickets = computed(() => this.data.tickets().filter((ticket) => ticket.user_id === this.id));
  readonly lifetimeValue = computed(() => this.customerOrders()
    .filter((order) => order.payment_status === 'paid' && order.status !== 'cancelled')
    .reduce((total, order) => total + Number(order.total), 0));
  readonly primaryAddress = computed(() => this.customer()?.addresses?.find((address) => address.is_primary) ?? this.customer()?.addresses?.[0]);
  readonly displayName = computed(() => {
    const item = this.customer();
    return item?.full_name || item?.username || item?.email || 'Customer';
  });

  constructor(readonly data: AdminDataService, private readonly route: ActivatedRoute) {}

  addressLine(address: NonNullable<ReturnType<typeof this.primaryAddress>>) {
    return [address.address_line, address.barangay, address.city, address.province, address.postal_code].filter(Boolean).join(', ');
  }

  previousOrderPage() {
    this.requestedOrderPage.set(Math.max(1, this.orderPage() - 1));
  }

  nextOrderPage() {
    this.requestedOrderPage.set(Math.min(this.orderPageCount(), this.orderPage() + 1));
  }

  hideAvatar(event: Event) {
    (event.target as HTMLImageElement).hidden = true;
  }
}
