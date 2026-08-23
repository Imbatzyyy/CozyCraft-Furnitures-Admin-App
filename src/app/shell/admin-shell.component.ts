import { AfterViewInit, ChangeDetectionStrategy, Component, effect, OnDestroy, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  AlertController,
  IonContent,
  IonHeader,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { AdminAuthService } from '../core/auth/admin-auth.service';
import { AdminDataService } from '../core/data/admin-data.service';
import { NativePlatformService } from '../core/native/native-platform.service';
import { canAccessRoute } from '../core/utils/admin-permissions';
import { WorkspaceSearchComponent } from './workspace-search.component';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  badge?: () => number;
  primary?: boolean;
}

@Component({
  selector: 'cc-admin-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterOutlet,
    IonContent,
    IonHeader,
    IonIcon,
    IonRefresher,
    IonRefresherContent,
    IonToolbar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ion-page" id="admin-workspace" [class.is-tab-switching]="tabSwitching()">
        <ion-header class="cc-app-header">
          @if (!native.online()) {
            <div class="offline-strip"><ion-icon name="cloud-offline-outline"></ion-icon> Offline · showing the last synchronized workspace</div>
          }
          <ion-toolbar>
            <div class="mobile-toolbar">
              <div class="page-context">
                <span class="page-context__brand">COZYCRAFT <i aria-hidden="true">/</i> ADMIN</span>
                <h1>{{ pageTitle() }}</h1>
              </div>

              <div class="header-actions" aria-label="Workspace actions">
                <button type="button" class="header-action" (click)="openSearch()" aria-label="Search workspace">
                  <ion-icon name="search-outline"></ion-icon>
                </button>
                <span class="header-actions__divider" aria-hidden="true"></span>
                <a routerLink="/app/notifications" class="header-action notification-action" aria-label="Open notifications">
                  <ion-icon name="notifications-outline"></ion-icon>
                  @if (data.unreadNotifications() > 0) { <span class="notification-count">{{ data.unreadNotifications() > 99 ? '99+' : data.unreadNotifications() }}</span> }
                </a>
              </div>
            </div>
          </ion-toolbar>
        </ion-header>

        <ion-content [fullscreen]="false" class="workspace-content">
          <ion-refresher slot="fixed" (ionRefresh)="refresh($event)">
            <ion-refresher-content pullingIcon="chevron-down-outline" refreshingSpinner="crescent" pullingText="Pull to sync CozyCraft"></ion-refresher-content>
          </ion-refresher>
          @if (data.error()) {
            <div class="workspace-sync-error" role="alert"><ion-icon name="warning-outline"></ion-icon><span>{{ data.error() }}</span><button type="button" (click)="data.refreshAll()">Retry</button></div>
          }
          @if (auth.error()) {
            <div class="workspace-sync-error workspace-sync-error--auth" role="alert"><ion-icon name="shield-outline"></ion-icon><span>{{ auth.error() }}</span><button type="button" (click)="auth.revalidateAccess()">Recheck</button></div>
          }
          @if (data.loading()) {
            <div class="workspace-loader" role="status" aria-live="polite" aria-label="Opening your live workspace">
              <div class="workspace-loader__visual" aria-hidden="true">
                <span class="workspace-loader__pulse"></span>
                <span class="workspace-loader__orbit"><i></i></span>
                <span class="workspace-loader__core">
                  <span class="workspace-loader__grid">
                    <i></i><i></i><i></i><i></i>
                  </span>
                </span>
              </div>

              <div class="workspace-loader__copy">
                <span class="workspace-loader__eyebrow"><i></i> Secure live sync</span>
                <p>Opening your workspace<span class="workspace-loader__dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
                <span class="workspace-loader__progress" aria-hidden="true"><i></i></span>
              </div>
            </div>
          }
          <div class="workspace-router" [class.is-loading]="data.loading()"><router-outlet></router-outlet></div>
        </ion-content>

        <nav class="cc-app-footer" aria-label="Primary administration">
          <div class="cc-mobile-tabs">
            <span class="cc-mobile-tabs__glass" aria-hidden="true"></span>
            @for (item of primaryNav; track item.route) {
              <button
                type="button"
                class="cc-tab-button"
                (pointerdown)="navigatePrimaryTab(item)"
                (click)="navigatePrimaryTab(item)"
                [class.tab-selected]="isPrimaryTabActive(item)"
                [class.tab-overview]="item.route === '/app/dashboard'"
                [attr.aria-label]="item.label"
                [attr.aria-current]="isPrimaryTabActive(item) ? 'page' : null"
              >
                <span class="tab-icon"><ion-icon [name]="item.icon"></ion-icon>@if (item.badge && item.badge() > 0) { <i>{{ item.badge() > 99 ? '99+' : item.badge() }}</i> }</span>
              </button>
            }
          </div>
        </nav>
    </div>
  `,
  styleUrl: './admin-shell.component.scss',
})
export class AdminShellComponent implements AfterViewInit, OnDestroy {
  readonly allNav: NavItem[] = [
    { label: 'Overview', route: '/app/dashboard', icon: 'grid-outline', primary: true },
    { label: 'Orders', route: '/app/orders', icon: 'receipt-outline', badge: () => this.data.dashboardMetrics().pendingOrders, primary: true },
    { label: 'Catalog', route: '/app/products', icon: 'cube-outline', primary: true },
    { label: 'Categories', route: '/app/categories', icon: 'albums-outline' },
    { label: 'Inventory', route: '/app/inventory', icon: 'file-tray-stacked-outline', badge: () => this.data.dashboardMetrics().lowStock },
    { label: 'Payments', route: '/app/payments', icon: 'card-outline' },
    { label: 'Customers', route: '/app/customers', icon: 'people-outline' },
    { label: 'Member tiers', route: '/app/member-tiers', icon: 'ribbon-outline' },
    { label: 'Merchandising', route: '/app/experience', icon: 'sparkles-outline' },
    { label: 'Content studio', route: '/app/content', icon: 'newspaper-outline' },
    { label: 'Reviews', route: '/app/reviews', icon: 'star-outline', badge: () => this.data.dashboardMetrics().pendingReviews },
    { label: 'Inbox', route: '/app/support', icon: 'chatbubbles-outline', badge: () => this.data.dashboardMetrics().openSupport, primary: true },
    { label: 'Reports', route: '/app/reports', icon: 'analytics-outline' },
    { label: 'Activity', route: '/app/activity', icon: 'pulse-outline' },
    { label: 'Notifications', route: '/app/notifications', icon: 'notifications-outline', badge: () => this.data.unreadNotifications() },
    { label: 'Team access', route: '/app/team', icon: 'shield-outline' },
    { label: 'Store settings', route: '/app/settings', icon: 'options-outline' },
    { label: 'More', route: '/app/more', icon: 'apps-outline', primary: true },
  ];

  readonly primaryNav = [
    '/app/orders',
    '/app/products',
    '/app/dashboard',
    '/app/support',
    '/app/more',
  ].map((route) => this.allNav.find((item) => item.route === route)!);
  readonly pageTitle = signal('Overview');
  readonly tabSwitching = signal(false);
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private tabSettleFrame = 0;
  private tabHitCheckFrame = 0;
  private requestedPrimaryRoute = '';
  private readonly activityEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;
  private readonly recordActivity = () => this.auth.recordActivity();
  private readonly scheduleTabHitCheck = () => {
    if (this.tabHitCheckFrame) cancelAnimationFrame(this.tabHitCheckFrame);
    this.tabHitCheckFrame = requestAnimationFrame(() => this.verifyTabHitTargets());
  };
  /**
   * WKWebView can occasionally dispatch a touch to the composited ion-content
   * underneath a filtered floating control. Capture the physical coordinate
   * before target dispatch and map the five equal visual segments directly.
   */
  private readonly handlePrimaryTabTouch = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const item = this.primaryTabAtPoint(touch.clientX, touch.clientY);
    if (!item) return;

    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.auth.recordActivity();
    this.navigatePrimaryTab(item);
  };
  private readonly handlePrimaryTabPointer = (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const item = this.primaryTabAtPoint(event.clientX, event.clientY);
    if (!item) return;

    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.auth.recordActivity();
    this.navigatePrimaryTab(item);
  };
  private readonly handlePrimaryTabClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const item = this.primaryTabAtPoint(event.clientX, event.clientY);
    if (!item) return;

    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.auth.recordActivity();
    this.navigatePrimaryTab(item);
  };
  private readonly routerSubscription: Subscription;

  constructor(
    readonly auth: AdminAuthService,
    readonly data: AdminDataService,
    readonly native: NativePlatformService,
    private readonly router: Router,
    private readonly modals: ModalController,
    private readonly alerts: AlertController,
  ) {
    effect(() => {
      if (!this.auth.ready()) return;
      if (!this.auth.signedIn()) {
        void this.data.stop();
        if (!this.router.url.startsWith('/auth/')) void this.router.navigateByUrl('/auth/login', { replaceUrl: true });
        return;
      }
      if (this.auth.mfaRequired() && !this.auth.mfaSatisfied()) {
        void this.router.navigateByUrl(this.auth.hasVerifiedMfa() ? '/auth/mfa' : '/auth/mfa-enroll', { replaceUrl: true });
        return;
      }
      if (!canAccessRoute(this.auth.role(), this.router.url)) {
        void this.router.navigateByUrl('/app/dashboard', { replaceUrl: true });
      }
      void this.data.start();
    });
    this.routerSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && event.url.startsWith('/app/')) {
        this.cancelTabSettleFrame();
        this.tabSwitching.set(true);
      } else if (event instanceof NavigationEnd) {
        this.requestedPrimaryRoute = '';
        this.updateTitle();
        this.settleTabRendering();
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        this.requestedPrimaryRoute = '';
        this.settleTabRendering();
      }
    });
    this.updateTitle();
    this.installIdleTimer();
  }

  ngAfterViewInit() {
    // Authentication inputs live in a native WKWebView keyboard layer. Ensure
    // no stale accessory/viewport owner survives a PIN or Face ID transition
    // before installing the bottom navigation hit targets.
    void this.native.releaseInputFocus().then(() => this.scheduleTabHitCheck());
    this.scheduleTabHitCheck();
    document.addEventListener('pointerdown', this.handlePrimaryTabPointer, { capture: true, passive: false });
    document.addEventListener('touchstart', this.handlePrimaryTabTouch, { capture: true, passive: false });
    document.addEventListener('click', this.handlePrimaryTabClick, { capture: true, passive: false });
    window.addEventListener('resize', this.scheduleTabHitCheck, { passive: true });
    window.addEventListener('orientationchange', this.scheduleTabHitCheck, { passive: true });
  }

  private updateTitle() {
    const current = this.allNav
      .filter((item) => this.router.url === item.route || this.router.url.startsWith(`${item.route}/`))
      .sort((left, right) => right.route.length - left.route.length)[0];
    this.pageTitle.set(current?.label ?? 'Operations');
  }

  private settleTabRendering() {
    this.cancelTabSettleFrame();
    this.tabSettleFrame = requestAnimationFrame(() => {
      this.tabSettleFrame = requestAnimationFrame(() => {
        this.tabSwitching.set(false);
        this.tabSettleFrame = 0;
        this.scheduleTabHitCheck();
      });
    });
  }

  private cancelTabSettleFrame() {
    if (!this.tabSettleFrame) return;
    cancelAnimationFrame(this.tabSettleFrame);
    this.tabSettleFrame = 0;
  }

  private verifyTabHitTargets() {
    this.tabHitCheckFrame = 0;
    if (document.querySelector('#admin-workspace .stock-adjustment')) {
      document.documentElement.classList.remove('cc-tab-hit-fallback');
      return;
    }
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#admin-workspace .cc-tab-button'));
    const blocked = buttons.length !== this.primaryNav.length || buttons.some((button) => {
      const bounds = button.getBoundingClientRect();
      if (bounds.width < 40 || bounds.height < 40) return true;
      const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return !target || (target !== button && !button.contains(target));
    });
    document.documentElement.classList.toggle('cc-tab-hit-fallback', blocked);
  }

  private primaryTabAtPoint(clientX: number, clientY: number): NavItem | null {
    // Dialog actions own the full bottom interaction band while an inventory
    // adjustment is open. The shell installs capture-phase touch handlers for
    // iOS reliability, so this guard is required in addition to CSS pointer
    // events; otherwise a visually hidden tab could still consume the tap.
    if (document.querySelector('#admin-workspace .stock-adjustment')) return null;
    const nav = document.querySelector<HTMLElement>('#admin-workspace .cc-mobile-tabs');
    if (!nav) return null;
    const bounds = nav.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportBottom = visualViewport
      ? visualViewport.offsetTop + visualViewport.height
      : window.innerHeight;
    // iOS can report the touch in visual-viewport coordinates for one frame
    // after an auth/keyboard transition while getBoundingClientRect() has
    // already returned layout-viewport coordinates. Accept the compact bottom
    // band occupied by the footer as well as the exact painted rectangle.
    const hitTop = Math.min(bounds.top - 12, viewportBottom - 112);
    const hitBottom = Math.max(bounds.bottom + 12, viewportBottom);
    const inside = clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= hitTop
      && clientY <= hitBottom;
    if (!inside || bounds.width <= 0) return null;

    const relativeX = Math.min(bounds.width - 0.01, Math.max(0, clientX - bounds.left));
    const index = Math.min(this.primaryNav.length - 1, Math.floor(relativeX / bounds.width * this.primaryNav.length));
    return this.primaryNav[index] ?? null;
  }

  isPrimaryTabActive(item: NavItem) {
    // Reflect the pressed destination immediately; NavigationEnd will clear
    // this optimistic state once the retained/lazy page has attached.
    if (this.requestedPrimaryRoute) return item.route === this.requestedPrimaryRoute;
    const path = this.router.url.split(/[?#]/, 1)[0];
    if (item.route === '/app/dashboard') return path === '/app/dashboard';
    if (item.route === '/app/orders') return path === '/app/orders' || path.startsWith('/app/orders/');
    if (item.route === '/app/products') {
      return ['/app/products', '/app/categories', '/app/inventory']
        .some((route) => path === route || path.startsWith(`${route}/`));
    }
    if (item.route === '/app/support') return path === '/app/support' || path.startsWith('/app/support/');
    return [
      '/app/more',
      '/app/payments',
      '/app/customers',
      '/app/member-tiers',
      '/app/experience',
      '/app/content',
      '/app/reviews',
      '/app/reports',
      '/app/activity',
      '/app/notifications',
      '/app/team',
      '/app/settings',
    ].some((route) => path === route || path.startsWith(`${route}/`));
  }

  navigatePrimaryTab(item: NavItem) {
    const currentPath = this.router.url.split(/[?#]/, 1)[0];
    // A highlighted tab can also represent one of its detail or secondary
    // routes. Tapping that tab again should always return to the tab root,
    // just like a native mobile tab bar. Ignore only a true root re-tap or a
    // duplicate pointer/click event while the same navigation is in flight.
    if (this.requestedPrimaryRoute === item.route || currentPath === item.route) return;
    this.requestedPrimaryRoute = item.route;
    this.cancelTabSettleFrame();
    this.tabSwitching.set(true);
    void this.router.navigateByUrl(item.route).then((navigated) => {
      if (navigated) return;
      this.requestedPrimaryRoute = '';
      this.settleTabRendering();
    }).catch(() => {
      this.requestedPrimaryRoute = '';
      this.settleTabRendering();
    });
  }

  async refresh(event: Event) {
    await this.data.refreshAll();
    (event as CustomEvent<{ complete: () => void }>).detail.complete();
    await this.native.tap();
  }

  async openSearch() {
    const modal = await this.modals.create({
      component: WorkspaceSearchComponent,
      breakpoints: [0, 0.72, 1],
      initialBreakpoint: 0.72,
      cssClass: 'cc-search-modal',
    });
    await modal.present();
  }

  async confirmSignOut() {
    const alert = await this.alerts.create({
      header: 'Leave operations?',
      message: 'This securely removes the administrator session from this device.',
      buttons: [
        { text: 'Stay signed in', role: 'cancel' },
        { text: 'Sign out', role: 'destructive', handler: () => void this.signOut() },
      ],
    });
    await alert.present();
  }

  private async signOut() {
    await this.data.stop();
    await this.native.unregisterPushNotifications();
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  private installIdleTimer() {
    for (const event of this.activityEvents) window.addEventListener(event, this.recordActivity, { passive: true });
    this.auth.recordActivity(true);
    this.idleTimer = setInterval(() => void this.checkIdle(), 60_000);
  }

  private async checkIdle() {
    if (!this.auth.signedIn()) return;
    await this.auth.enforceInactivityTimeout();
  }

  ngOnDestroy() {
    this.cancelTabSettleFrame();
    if (this.tabHitCheckFrame) cancelAnimationFrame(this.tabHitCheckFrame);
    document.removeEventListener('pointerdown', this.handlePrimaryTabPointer, true);
    document.removeEventListener('touchstart', this.handlePrimaryTabTouch, true);
    document.removeEventListener('click', this.handlePrimaryTabClick, true);
    window.removeEventListener('resize', this.scheduleTabHitCheck);
    window.removeEventListener('orientationchange', this.scheduleTabHitCheck);
    document.documentElement.classList.remove('cc-tab-hit-fallback');
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.routerSubscription.unsubscribe();
    for (const event of this.activityEvents) window.removeEventListener(event, this.recordActivity);
    void this.data.stop();
  }
}
