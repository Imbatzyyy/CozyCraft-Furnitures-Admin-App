import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonIcon, IonInput, IonToolbar, ModalController } from '@ionic/angular/standalone';
import { AdminAuthService } from '../core/auth/admin-auth.service';
import { AdminDataService } from '../core/data/admin-data.service';
import { WorkspaceSearchKind, WorkspaceSearchResult } from '../core/models/admin.models';
import { NativePlatformService } from '../core/native/native-platform.service';
import { canAccessRoute } from '../core/utils/admin-permissions';

interface RankedSearchResult {
  item: WorkspaceSearchResult;
  score: number;
}

interface IndexedSearchResult {
  item: WorkspaceSearchResult;
  title: string;
  detail: string;
  keywords: string;
  source: string;
  compactSource: string;
}

const WORKSPACE_DESTINATIONS: readonly WorkspaceSearchResult[] = [
  { id: 'page-dashboard', kind: 'page', title: 'Overview', detail: 'Store pulse and priority queue', route: '/app/dashboard', icon: 'grid-outline', keywords: 'home dashboard revenue summary metrics performance' },
  { id: 'page-orders', kind: 'page', title: 'Orders', detail: 'Fulfillment and order decisions', route: '/app/orders', icon: 'receipt-outline', keywords: 'order queue delivery cancellation refund status fulfillment' },
  { id: 'page-products', kind: 'page', title: 'Catalog', detail: 'Products, pricing, and visibility', route: '/app/products', icon: 'cube-outline', keywords: 'product catalog add edit price furniture visibility' },
  { id: 'page-categories', kind: 'page', title: 'Categories', detail: 'Storefront product organization', route: '/app/categories', icon: 'albums-outline', keywords: 'category collection sort organize storefront' },
  { id: 'page-inventory', kind: 'page', title: 'Inventory', detail: 'Stock levels and adjustments', route: '/app/inventory', icon: 'file-tray-stacked-outline', keywords: 'stock low receive deduct adjustment quantity movement' },
  { id: 'page-payments', kind: 'page', title: 'Store payments', detail: 'Settlements, refunds, and exports', route: '/app/payments', icon: 'card-outline', keywords: 'payment settlement transaction cash gcash card refund export csv pdf' },
  { id: 'page-customers', kind: 'page', title: 'Customers', detail: 'Profiles, addresses, and order history', route: '/app/customers', icon: 'people-outline', keywords: 'customer account profile address order history' },
  { id: 'page-member-tiers', kind: 'page', title: 'Member tiers', detail: 'Rewards and customer levels', route: '/app/member-tiers', icon: 'ribbon-outline', keywords: 'membership loyalty tier reward points recent activity' },
  { id: 'page-experience', kind: 'page', title: 'Merchandising', detail: 'Delivery areas and search language', route: '/app/experience', icon: 'sparkles-outline', keywords: 'experience merchandising delivery area synonym search language intent watchlist' },
  { id: 'page-content', kind: 'page', title: 'Content studio', detail: 'Pages, campaigns, and email', route: '/app/content', icon: 'newspaper-outline', keywords: 'content studio homepage banner campaign newsletter email template page' },
  { id: 'page-reviews', kind: 'page', title: 'Reviews', detail: 'Moderation and customer photos', route: '/app/reviews', icon: 'star-outline', keywords: 'review rating moderation approve publish hide photo' },
  { id: 'page-support', kind: 'page', title: 'Inbox', detail: 'Customer care and support tickets', route: '/app/support', icon: 'chatbubbles-outline', keywords: 'inbox support ticket message customer care reply conversation' },
  { id: 'page-reports', kind: 'page', title: 'Reports', detail: 'Performance reports and exports', route: '/app/reports', icon: 'analytics-outline', keywords: 'report analytics revenue operations export pdf csv' },
  { id: 'page-activity', kind: 'page', title: 'Activity', detail: 'Audit trail and client errors', route: '/app/activity', icon: 'pulse-outline', keywords: 'activity audit log record error security history' },
  { id: 'page-notifications', kind: 'page', title: 'Notifications', detail: 'Operational alerts and updates', route: '/app/notifications', icon: 'notifications-outline', keywords: 'notification alert push update unread' },
  { id: 'page-team', kind: 'page', title: 'Team access', detail: 'Administrator roles and access', route: '/app/team', icon: 'shield-outline', keywords: 'team staff admin role access permission invite' },
  { id: 'page-settings', kind: 'page', title: 'Store settings', detail: 'Business and workspace configuration', route: '/app/settings', icon: 'options-outline', keywords: 'settings configuration business checkout fulfillment account notification integration' },
  { id: 'page-more', kind: 'page', title: 'More tools', detail: 'Every secondary admin tool', route: '/app/more', icon: 'apps-outline', keywords: 'more menu workspace tools sign out security biometric' },
];

const QUICK_DESTINATION_IDS = [
  'page-orders',
  'page-products',
  'page-inventory',
  'page-support',
  'page-payments',
  'page-customers',
];

@Component({
  selector: 'cc-workspace-search',
  standalone: true,
  imports: [IonContent, IonHeader, IonIcon, IonInput, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header class="search-header">
      <ion-toolbar>
        <div class="search-heading">
          <div>
            <p>COZYCRAFT <i>/</i> FIND</p>
            <h1>Search workspace</h1>
          </div>
          <button type="button" class="search-close" (click)="dismiss()" aria-label="Close search">
            <ion-icon name="close-outline" />
          </button>
        </div>

        <div class="search-field" [class.has-value]="query().trim()">
          <ion-icon name="search-outline" aria-hidden="true" />
          <ion-input
            [autofocus]="true"
            [value]="query()"
            inputmode="search"
            enterkeyhint="go"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            aria-label="Search the admin workspace"
            placeholder="Order, customer, product, ticket…"
            (ionInput)="updateQuery($event)"
            (keyup.enter)="openTopResult()"
          />
          @if (query().trim()) {
            <button type="button" class="search-clear" (click)="clearQuery()" aria-label="Clear search">
              <ion-icon name="close-circle" />
            </button>
          } @else {
            <span class="search-field__hint" aria-hidden="true">GO</span>
          }
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="search-content" [forceOverscroll]="false">
      <main class="search-body">
        @if (!normalizedQuery()) {
          <section class="search-intro" aria-labelledby="search-intro-title">
            <span class="search-intro__icon"><ion-icon name="navigate-outline" /></span>
            <div>
              <p>ONE STEP AWAY</p>
              <h2 id="search-intro-title">Go exactly where work is waiting.</h2>
              <span>Find a page or open a specific live record without browsing through menus.</span>
            </div>
          </section>

          <section class="search-section" aria-labelledby="quick-destinations-title">
            <header class="search-section__header">
              <div><p>QUICK ACCESS</p><h2 id="quick-destinations-title">Frequent destinations</h2></div>
              <span>{{ quickDestinations().length }} tools</span>
            </header>
            <div class="search-shortcuts">
              @for (shortcut of quickDestinations(); track shortcut.id) {
                <button type="button" (click)="open(shortcut)">
                  <span class="shortcut-icon"><ion-icon [name]="shortcut.icon" /></span>
                  <span><b>{{ shortcut.title }}</b><small>{{ shortcut.detail }}</small></span>
                  <ion-icon name="chevron-forward-outline" />
                </button>
              }
            </div>
          </section>

          <section class="search-guide" aria-label="Things you can search">
            <p>SEARCH BY</p>
            <div>
              <span><ion-icon name="receipt-outline" /> Order number</span>
              <span><ion-icon name="person-outline" /> Name or email</span>
              <span><ion-icon name="cube-outline" /> Product name</span>
              <span><ion-icon name="chatbubble-outline" /> Ticket subject</span>
            </div>
          </section>
        } @else if (!allMatches().length) {
          <section class="search-empty">
            <span><ion-icon name="search-outline" /></span>
            <p>NO MATCH FOR “{{ query().trim() }}”</p>
            <h2>Try a more exact detail.</h2>
            <small>Use an order or ticket number, customer email, product name, or destination such as “payments”.</small>
            <button type="button" (click)="clearQuery()">Clear and try again</button>
          </section>
        } @else {
          <div class="search-summary" aria-live="polite">
            <span><i></i> {{ resultSummary() }}</span>
            <small>Best match first</small>
          </div>

          @if (pageMatches().length) {
            <section class="search-section search-section--results" aria-labelledby="page-results-title">
              <header class="search-section__header">
                <div><p>DESTINATIONS</p><h2 id="page-results-title">Go to a page</h2></div>
                <span>{{ pageMatches().length }}</span>
              </header>
              <div class="search-results search-results--pages">
                @for (result of pageMatches(); track result.id) {
                  <button type="button" (click)="open(result)">
                    <span class="result-icon" data-kind="page"><ion-icon [name]="result.icon" /></span>
                    <span class="result-copy"><small>ADMIN TOOL</small><b>{{ result.title }}</b><em>{{ result.detail }}</em></span>
                    <span class="result-action"><ion-icon name="arrow-forward-outline" /></span>
                  </button>
                }
              </div>
            </section>
          }

          @if (recordMatches().length) {
            <section class="search-section search-section--results" aria-labelledby="record-results-title">
              <header class="search-section__header">
                <div><p>LIVE WORKSPACE</p><h2 id="record-results-title">Exact records</h2></div>
                <span>{{ recordMatches().length }} shown</span>
              </header>
              <div class="search-results">
                @for (result of recordMatches(); track result.id) {
                  <button type="button" (click)="open(result)">
                    <span class="result-icon" [attr.data-kind]="result.kind"><ion-icon [name]="result.icon" /></span>
                    <span class="result-copy"><small>{{ kindLabel(result.kind) }}</small><b>{{ result.title }}</b><em>{{ result.detail }}</em></span>
                    <span class="result-action"><ion-icon name="arrow-forward-outline" /></span>
                  </button>
                }
              </div>
            </section>
          }
        }

        <footer class="search-footnote"><ion-icon name="leaf-outline" /> Searches the workspace already synced to this device—no extra database request.</footer>
      </main>
    </ion-content>
  `,
  styleUrl: './workspace-search.component.scss',
})
export class WorkspaceSearchComponent {
  readonly query = signal('');
  readonly openingId = signal('');
  readonly normalizedQuery = computed(() => this.normalize(this.query()));
  readonly destinations = computed(() => WORKSPACE_DESTINATIONS.filter((item) => canAccessRoute(this.auth.role(), item.route)));
  readonly quickDestinations = computed(() => QUICK_DESTINATION_IDS
    .map((id) => this.destinations().find((item) => item.id === id))
    .filter((item): item is WorkspaceSearchResult => Boolean(item)));
  readonly searchCorpus = computed<IndexedSearchResult[]>(() => [...this.destinations(), ...this.data.searchIndex()]
    .filter((item) => canAccessRoute(this.auth.role(), item.route))
    .map((item) => {
      const title = this.normalize(item.title);
      const detail = this.normalize(item.detail);
      const keywords = this.normalize(item.keywords);
      const source = `${title} ${detail} ${keywords}`;
      return { item, title, detail, keywords, source, compactSource: this.compact(source) };
    }));
  readonly rankedMatches = computed<RankedSearchResult[]>(() => {
    const query = this.normalizedQuery();
    if (!query) return [];

    return this.searchCorpus()
      .map((entry) => ({ item: entry.item, score: this.score(entry, query) }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title));
  });
  readonly allMatches = computed(() => this.rankedMatches().map((entry) => entry.item));
  readonly pageMatches = computed(() => this.rankedMatches()
    .filter((entry) => entry.item.kind === 'page')
    .slice(0, 5)
    .map((entry) => entry.item));
  readonly recordMatches = computed(() => this.rankedMatches()
    .filter((entry) => entry.item.kind !== 'page')
    .slice(0, 14)
    .map((entry) => entry.item));
  readonly resultSummary = computed(() => {
    const count = this.rankedMatches().length;
    return `${count} ${count === 1 ? 'match' : 'matches'} for “${this.query().trim()}”`;
  });

  constructor(
    readonly data: AdminDataService,
    private readonly auth: AdminAuthService,
    private readonly native: NativePlatformService,
    private readonly modal: ModalController,
    private readonly router: Router,
  ) {}

  updateQuery(event: Event) {
    this.query.set((event as CustomEvent<{ value?: string | null }>).detail.value ?? '');
  }

  clearQuery() {
    this.query.set('');
    requestAnimationFrame(() => (document.querySelector('cc-workspace-search ion-input') as HTMLIonInputElement | null)?.setFocus());
  }

  dismiss() {
    if (this.openingId()) return;
    void this.native.releaseInputFocus().then(() => this.modal.dismiss());
  }

  openTopResult() {
    const result = this.rankedMatches()[0]?.item;
    if (result) void this.open(result);
  }

  async open(result: WorkspaceSearchResult) {
    if (this.openingId() || !canAccessRoute(this.auth.role(), result.route)) return;
    this.openingId.set(result.id);
    await this.native.tap();
    await this.native.releaseInputFocus();
    await this.modal.dismiss({ destination: result.route }, 'navigate');
    await this.router.navigateByUrl(result.route);
  }

  kindLabel(kind: WorkspaceSearchKind) {
    return ({
      page: 'Admin tool',
      order: 'Order',
      product: 'Product',
      customer: 'Customer',
      ticket: 'Support ticket',
      review: 'Review',
      notification: 'Notification',
    } as const)[kind];
  }

  private normalize(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9@.+#-]+/g, ' ')
      .trim();
  }

  private compact(value: string) {
    return this.normalize(value).replace(/[^a-z0-9]/g, '');
  }

  private score(indexed: IndexedSearchResult, query: string) {
    const { item, title, detail, keywords, source, compactSource } = indexed;
    const terms = query.split(/\s+/).filter(Boolean);
    const compactQuery = this.compact(query);
    const compactMatch = compactQuery.length >= 3 && compactSource.includes(compactQuery);
    if (!terms.every((term) => source.includes(term)) && !compactMatch) return -1;

    let score = item.kind === 'page' ? 35 : 0;
    if (title === query) score += 1_000;
    else if (title.startsWith(query)) score += 760;
    else if (title.includes(query)) score += 560;
    else if (detail.includes(query)) score += 300;
    else if (keywords.includes(query)) score += 180;
    if (compactMatch) score += 260;

    for (const term of terms) {
      if (title.split(/\s+/).some((part) => part.startsWith(term))) score += 70;
      else if (title.includes(term)) score += 50;
      if (detail.includes(term)) score += 24;
      if (keywords.includes(term)) score += 12;
    }
    return score;
  }
}
