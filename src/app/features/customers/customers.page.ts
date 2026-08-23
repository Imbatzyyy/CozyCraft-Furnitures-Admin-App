import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon, IonSearchbar } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Profile } from '../../core/models/admin.models';
import { compactMoney, initials, shortDate } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';

type CustomerFilter = 'all' | 'buyers' | 'new';

@Component({
  selector: 'cc-customers-page',
  standalone: true,
  imports: [RouterLink, IonIcon, IonSearchbar, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page customers-page">
      <section class="community-hero" aria-labelledby="customers-title">
        <div class="community-hero__status">
          <p class="cc-eyebrow">Customer directory</p>
          <span class="community-live" [attr.data-state]="data.realtimeStatus()"><i aria-hidden="true"></i>{{ data.realtimeStatus() }}</span>
        </div>
        <div class="community-hero__copy">
          <div><h1 id="customers-title">People behind every home.</h1><p>Find the right customer and open their complete service context without the clutter.</p></div>
          <div class="community-faces" aria-label="Customer profile photos">
            @for (customer of picturedCustomers(); track customer.id) {
              <span class="community-face">
                <i aria-hidden="true">{{ initials(displayName(customer)) }}</i>
                @if (customer.avatar_url) { <img [src]="customer.avatar_url" [alt]="displayName(customer) + ' profile photo'" referrerpolicy="no-referrer" (error)="hideAvatar($event)" /> }
              </span>
            }
            <b>{{ data.customers().length }}</b><small>registered</small>
          </div>
        </div>
        <div class="community-metrics" aria-label="Customer summary">
          <div><span>With orders</span><strong>{{ activeCustomers() }}</strong><small>active relationships</small></div>
          <div><span>Returning</span><strong>{{ returningCustomers() }}</strong><small>more than one order</small></div>
          <div><span>Settled value</span><strong>{{ compactMoney(totalValue()) }}</strong><small>across paid orders</small></div>
        </div>
      </section>

      <section class="directory-panel" aria-labelledby="directory-title">
        <div class="directory-tools">
          <ion-searchbar mode="ios" aria-label="Search customers" placeholder="Name, email, username or mobile…" [debounce]="160" [value]="query()" (ionInput)="query.set($any($event).detail.value ?? '')"></ion-searchbar>
          <div class="customer-filter" role="group" aria-label="Customer filter">
            <button type="button" [attr.data-active]="filter() === 'all'" (click)="filter.set('all')">All <i>{{ data.customers().length }}</i></button>
            <button type="button" [attr.data-active]="filter() === 'buyers'" (click)="filter.set('buyers')">Buyers <i>{{ activeCustomers() }}</i></button>
            <button type="button" [attr.data-active]="filter() === 'new'" (click)="filter.set('new')">New <i>{{ newCustomers() }}</i></button>
          </div>
        </div>

        <header class="directory-head">
          <div><p class="cc-eyebrow">Customer records</p><h2 id="directory-title">{{ visible().length }} {{ visible().length === 1 ? 'profile' : 'profiles' }}</h2></div>
          <span>Newest first</span>
        </header>

        @if (visible().length) {
          <div class="customer-grid">
            @for (customer of visible(); track customer.id) {
              <a [routerLink]="['/app/customers', customer.id]" class="customer-card cc-reveal" [attr.aria-label]="'Open ' + displayName(customer) + ' profile'">
                <header class="customer-card__head">
                  <span class="customer-avatar">
                    <i aria-hidden="true">{{ initials(displayName(customer)) }}</i>
                    @if (customer.avatar_url) { <img [src]="customer.avatar_url" [alt]="displayName(customer) + ' profile photo'" referrerpolicy="no-referrer" (error)="hideAvatar($event)" /> }
                  </span>
                  <span class="customer-identity"><b>{{ displayName(customer) }}</b><small>{{ customer.username ? '@' + customer.username : 'CozyCraft customer' }}</small></span>
                  <span class="customer-open"><ion-icon name="arrow-forward-outline" aria-hidden="true"></ion-icon></span>
                </header>

                <div class="customer-card__contact">
                  <ion-icon [name]="customer.email ? 'mail-outline' : 'call-outline'" aria-hidden="true"></ion-icon>
                  <span>{{ customer.email || customer.phone || 'No contact detail provided' }}</span>
                </div>

                <div class="customer-card__facts">
                  <div><span>Orders</span><strong>{{ orderCount(customer) }}</strong></div>
                  <div><span>Lifetime value</span><strong>{{ compactMoney(lifetimeValue(customer.id)) }}</strong></div>
                  <div><span>Joined</span><strong>{{ shortDate(customer.created_at) }}</strong></div>
                </div>

                <footer>
                  <span><ion-icon name="location-outline" aria-hidden="true"></ion-icon>{{ customerLocation(customer) }}</span>
                  <b>{{ orderCount(customer) > 1 ? 'Returning' : orderCount(customer) === 1 ? 'First order' : 'New profile' }}</b>
                </footer>
              </a>
            }
          </div>
        } @else {
          <div class="customer-empty"><cc-empty-state icon="people-outline" title="No matching customers" message="Try another name, email, username, or mobile number."></cc-empty-state></div>
        }
      </section>
    </main>
  `,
  styleUrl: './customers.scss',
})
export class CustomersPage {
  readonly compactMoney = compactMoney;
  readonly initials = initials;
  readonly shortDate = shortDate;
  readonly query = signal('');
  readonly filter = signal<CustomerFilter>('all');

  readonly customerSpend = computed(() => {
    const values = new Map<string, number>();
    for (const order of this.data.orders()) {
      if (order.payment_status !== 'paid' || order.status === 'cancelled') continue;
      values.set(order.user_id, (values.get(order.user_id) ?? 0) + Number(order.total));
    }
    return values;
  });
  readonly customerOrderCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const order of this.data.orders()) counts.set(order.user_id, (counts.get(order.user_id) ?? 0) + 1);
    return counts;
  });
  readonly activeCustomers = computed(() => this.data.customers().filter((customer) => this.orderCount(customer) > 0).length);
  readonly returningCustomers = computed(() => this.data.customers().filter((customer) => this.orderCount(customer) > 1).length);
  readonly newCustomers = computed(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return this.data.customers().filter((customer) => new Date(customer.created_at).getTime() >= cutoff).length;
  });
  readonly totalValue = computed(() => Array.from(this.customerSpend().values()).reduce((total, value) => total + value, 0));
  readonly picturedCustomers = computed(() => this.data.customers().filter((customer) => customer.avatar_url).slice(0, 4));
  readonly visible = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('en');
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return this.data.customers()
      .filter((customer) => this.filter() === 'all'
        || (this.filter() === 'buyers' && this.orderCount(customer) > 0)
        || (this.filter() === 'new' && new Date(customer.created_at).getTime() >= cutoff))
      .filter((customer) => !query || `${customer.full_name} ${customer.email} ${customer.username} ${customer.phone}`.toLocaleLowerCase('en').includes(query))
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  });

  constructor(readonly data: AdminDataService) {}

  displayName(customer: Profile) {
    return customer.full_name || customer.username || customer.email || 'Customer';
  }

  orderCount(customer: Profile) {
    return customer.order_count ?? this.customerOrderCounts().get(customer.id) ?? customer.orders?.length ?? 0;
  }

  lifetimeValue(id: string) {
    return this.customerSpend().get(id) ?? 0;
  }

  customerLocation(customer: Profile) {
    const address = customer.addresses?.find((item) => item.is_primary) ?? customer.addresses?.[0];
    return address?.city || address?.province || 'Location not provided';
  }

  hideAvatar(event: Event) {
    (event.target as HTMLImageElement).hidden = true;
  }
}
