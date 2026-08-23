import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { compactMoney, money, timeAgo } from '../../core/utils/format';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

@Component({
  selector: 'cc-dashboard-page',
  standalone: true,
  imports: [RouterLink, IonIcon, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page dashboard-page">
      <header class="overview-intro cc-reveal">
        <div class="overview-intro__copy">
          <div class="overview-intro__meta">
            <p class="cc-eyebrow">{{ manilaDate() }}</p>
            <span class="sync-state" [class.is-live]="data.realtimeStatus() === 'live'">
              <i></i>{{ data.realtimeStatus() === 'live' ? 'Live' : 'Syncing' }}
            </span>
          </div>
          <h1>{{ greeting() }}, <em>{{ firstName() }}</em>.</h1>
          <p class="overview-intro__summary">
            {{ activePriorities() ? activePriorities() + (activePriorities() === 1 ? ' area needs' : ' areas need') + ' your attention today.' : 'Everything is calm and up to date.' }}
          </p>
        </div>

        <div class="overview-intro__actions" aria-label="Quick actions">
          <a routerLink="/app/orders" class="quick-action quick-action--primary">
            <ion-icon name="receipt-outline"></ion-icon><span>Work orders</span><ion-icon name="arrow-forward-outline"></ion-icon>
          </a>
          <a routerLink="/app/products/new" class="quick-action" aria-label="Add a new product">
            <ion-icon name="add-outline"></ion-icon><span>Add product</span>
          </a>
        </div>
      </header>

      <section class="pulse-card cc-reveal" aria-labelledby="pulse-title">
        <div class="pulse-card__revenue">
          <div class="pulse-card__heading">
            <div>
              <p class="cc-eyebrow">STORE PULSE</p>
              <h2 id="pulse-title">{{ compactMoney(data.dashboardMetrics().monthRevenue) }}</h2>
              <p>Settled revenue this month</p>
            </div>
            @if (auth.role() !== 'staff') {
              <a routerLink="/app/reports" aria-label="Open revenue reports"><ion-icon name="arrow-up-outline"></ion-icon></a>
            }
          </div>

          <div class="pulse-chart" aria-label="Settled revenue over the last seven months">
            @for (point of chart(); track point.label) {
              <div class="pulse-chart__column" [attr.aria-label]="point.label + ': ' + money(point.value)">
                <i [style.height.%]="point.height"></i>
                <small>{{ point.label }}</small>
              </div>
            }
          </div>
        </div>

        <nav class="pulse-metrics" aria-label="Essential store metrics">
          @for (metric of metrics(); track metric.label) {
            <a [routerLink]="metric.route" class="pulse-metric">
              <span class="pulse-metric__icon"><ion-icon [name]="metric.icon"></ion-icon></span>
              <span class="pulse-metric__copy"><small>{{ metric.label }}</small><b>{{ metric.value }}</b><em>{{ metric.note }}</em></span>
              <ion-icon name="chevron-forward-outline"></ion-icon>
            </a>
          }
        </nav>
      </section>

      <div class="dashboard-grid">
        <section class="cc-card focus-card cc-reveal">
          <div class="section-heading">
            <div><p class="cc-eyebrow">PRIORITY QUEUE</p><h2>Needs attention</h2></div>
            @if (priorities().length) { <span>{{ priorities().length }}</span> }
          </div>

          <div class="focus-list">
            @for (item of priorities(); track item.label) {
              <a [routerLink]="item.route" [class]="'focus-row focus-row--' + item.tone">
                <span class="focus-row__icon"><ion-icon [name]="item.icon"></ion-icon></span>
                <span class="focus-row__copy"><b>{{ item.label }}</b><small>{{ item.note }}</small></span>
                <strong>{{ item.value }}</strong>
                <ion-icon name="chevron-forward-outline"></ion-icon>
              </a>
            } @empty {
              <div class="focus-empty">
                <span><ion-icon name="checkmark-outline"></ion-icon></span>
                <div><b>All caught up</b><small>No operational items need attention right now.</small></div>
              </div>
            }
          </div>
        </section>

        <section class="cc-card recent-card cc-reveal">
          <div class="section-heading">
            <div><p class="cc-eyebrow">LATEST ACTIVITY</p><h2>Recent orders</h2></div>
            <a routerLink="/app/orders" class="section-link">View all <ion-icon name="arrow-forward-outline"></ion-icon></a>
          </div>

          <div class="order-list">
            @for (order of data.orders().slice(0, 4); track order.id) {
              <a [routerLink]="['/app/orders', order.id]" class="order-row">
                <span class="order-row__number">{{ order.order_number.slice(-4) }}</span>
                <span class="order-row__copy">
                  <b>{{ order.shipping_address.name || order.profiles?.full_name || 'Customer' }}</b>
                  <small>{{ timeAgo(order.created_at) }} · {{ order.order_number }}</small>
                </span>
                <span class="order-row__meta"><b>{{ money(order.total) }}</b><cc-status-pill [value]="order.status"></cc-status-pill></span>
                <ion-icon name="chevron-forward-outline"></ion-icon>
              </a>
            } @empty {
              <div class="orders-empty"><ion-icon name="receipt-outline"></ion-icon><p>No orders have arrived yet.</p></div>
            }
          </div>
        </section>
      </div>
    </main>
  `,
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  readonly money = money;
  readonly compactMoney = compactMoney;
  readonly timeAgo = timeAgo;
  readonly firstName = computed(() => this.auth.displayName().trim().split(/\s+/)[0] || 'there');
  readonly greeting = computed(() => {
    const hour = Number(new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  });
  readonly manilaDate = computed(() => new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date()).toUpperCase());

  readonly metrics = computed(() => {
    const values = this.data.dashboardMetrics();
    return [
      { label: 'Order queue', value: String(values.fulfillmentQueue), note: `${values.pendingOrders} waiting to start`, icon: 'bag-handle-outline', route: '/app/orders' },
      { label: 'Low stock', value: String(values.lowStock), note: `Threshold at ${this.data.settings().low_stock_threshold}`, icon: 'layers-outline', route: '/app/inventory' },
      { label: 'Customer care', value: String(values.openSupport), note: 'Open conversations', icon: 'chatbubble-ellipses-outline', route: '/app/support' },
    ];
  });

  readonly priorities = computed(() => {
    const values = this.data.dashboardMetrics();
    return [
      { label: 'Pending orders', value: values.pendingOrders, note: 'Ready to begin fulfillment', icon: 'time-outline', route: '/app/orders', tone: 'clay' },
      { label: 'Low-stock products', value: values.lowStock, note: 'A stock count may be needed', icon: 'file-tray-stacked-outline', route: '/app/inventory', tone: 'sand' },
      { label: 'Customer concerns', value: values.openSupport, note: `${this.data.urgentTickets()} marked high or urgent`, icon: 'chatbubble-ellipses-outline', route: '/app/support', tone: 'sage' },
      { label: 'Reviews to moderate', value: values.pendingReviews, note: 'Waiting for storefront review', icon: 'star-outline', route: '/app/reviews', tone: 'stone' },
    ].filter((item) => item.value > 0);
  });

  readonly activePriorities = computed(() => this.priorities().length);
  readonly chart = computed(() => {
    const source = this.data.revenueSeries();
    const maximum = Math.max(1, ...source.map((point) => point.value));
    return source.map((point) => ({ ...point, height: point.value ? Math.max(10, point.value / maximum * 100) : 3 }));
  });

  constructor(readonly data: AdminDataService, readonly auth: AdminAuthService) {}
}
