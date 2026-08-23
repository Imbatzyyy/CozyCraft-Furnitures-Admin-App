import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AlertController, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { canAccessRoute } from '../../core/utils/admin-permissions';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { CozyToastService } from '../../shared/components/toast.service';
import { AppLockService } from '../../core/auth/app-lock.service';
import { initials } from '../../core/utils/format';

@Component({
  selector: 'cc-more-page',
  standalone: true,
  imports: [RouterLink, IonIcon, IonSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page more-page">
      <header class="more-head">
        <div><p class="cc-eyebrow">WORKSPACE</p><h1>More</h1><p>Every secondary admin tool, in one compact place.</p></div>
        <span class="more-head__mark" aria-hidden="true"><ion-icon name="apps-outline"></ion-icon></span>
      </header>

      <section class="workspace-pulse" aria-label="Workspace status">
        <span class="workspace-pulse__live"><i [class.is-live]="data.realtimeStatus() === 'live'"></i><b>{{ data.realtimeStatus() === 'live' ? 'Live' : 'Syncing' }}</b></span>
        <span></span>
        <span><small>ACCESS</small><b>{{ roleLabel() }}</b></span>
      </section>

      @for (group of visibleGroups(); track group.label) {
        <section class="more-group">
          <p class="cc-eyebrow">{{ group.label }}</p>
          <div class="more-grid">
            @for (item of group.items; track item.route) {
              <a [routerLink]="item.route">
                <span class="more-icon"><ion-icon [name]="item.icon"></ion-icon>@if (item.badge() > 0) { <i>{{ item.badge() > 99 ? '99+' : item.badge() }}</i> }</span>
                <span><b>{{ item.label }}</b><small>{{ item.detail }}</small></span>
                <ion-icon name="arrow-forward-outline"></ion-icon>
              </a>
            }
          </div>
        </section>
      }

      <section class="more-group device-group">
        <p class="cc-eyebrow">THIS DEVICE</p>
        <div class="device-grid">
          <article class="device-card device-security">
            <span><ion-icon [name]="lock.biometricLabel() === 'Face ID' ? 'scan-outline' : 'finger-print-outline'"></ion-icon><i [class.is-on]="lock.biometricEnabled()"></i></span>
            <div><small>SECURE UNLOCK</small><b>{{ lock.biometricEnabled() ? lock.biometricLabel() + ' enabled' : lock.biometricAvailable() ? lock.biometricLabel() + ' available' : 'PIN protected' }}</b><p>Biometrics stay private to this device.</p></div>
            @if (lock.biometricAvailable()) {
              <button type="button" [disabled]="biometricWorking()" (click)="toggleBiometrics()">
                @if (biometricWorking()) { <ion-spinner name="crescent"></ion-spinner> } @else { {{ lock.biometricEnabled() ? 'Remove' : 'Enable' }} }
              </button>
            }
          </article>
          <article class="device-card device-alerts">
            <span><ion-icon name="notifications-outline"></ion-icon><i [class.is-on]="native.pushEnabled()"></i></span>
            <div><small>NATIVE ALERTS</small><b>{{ native.pushRegistration().title }}</b><p>{{ native.pushRegistration().detail }}</p></div>
            <button
              type="button"
              [disabled]="pushWorking() || (!native.pushEnabled() && !native.pushRegistration().canRegister)"
              (click)="togglePush()"
            >
              @if (pushWorking()) { <ion-spinner name="crescent"></ion-spinner> } @else { {{ native.pushEnabled() ? 'Remove' : native.pushRegistration().action }} }
            </button>
          </article>
        </div>
      </section>

      <section class="account-card">
        <span class="account-avatar">{{ initials(auth.displayName()) }}</span>
        <span><small>SIGNED IN</small><b>{{ auth.displayName() }}</b><p>{{ accessDescription() }}</p></span>
        <button type="button" (click)="confirmSignOut()" aria-label="Sign out"><ion-icon name="log-out-outline"></ion-icon></button>
      </section>
    </main>
  `,
  styleUrl: './more.page.scss',
})
export class MorePage {
  readonly initials = initials;
  readonly pushWorking = signal(false);
  readonly biometricWorking = signal(false);
  readonly groups = [
    { label: 'CATALOG & STOCK', items: [
      { label: 'Products', detail: 'Create and publish pieces', icon: 'cube-outline', route: '/app/products', badge: () => 0 },
      { label: 'Categories', detail: 'Shape customer discovery', icon: 'albums-outline', route: '/app/categories', badge: () => 0 },
      { label: 'Inventory', detail: 'Atomic stock adjustments', icon: 'file-tray-stacked-outline', route: '/app/inventory', badge: () => this.data.dashboardMetrics().lowStock },
    ]},
    { label: 'CUSTOMERS & TRUST', items: [
      { label: 'Customers', detail: 'Account and order context', icon: 'people-outline', route: '/app/customers', badge: () => 0 },
      { label: 'Reviews', detail: 'Moderate customer stories', icon: 'star-outline', route: '/app/reviews', badge: () => this.data.dashboardMetrics().pendingReviews },
      { label: 'Support', detail: 'Resolve customer concerns', icon: 'chatbubbles-outline', route: '/app/support', badge: () => this.data.dashboardMetrics().openSupport },
      { label: 'Notifications', detail: 'Live operational signals', icon: 'notifications-outline', route: '/app/notifications', badge: () => this.data.unreadNotifications() },
    ]},
    { label: 'FINANCE & INSIGHT', items: [
      { label: 'Payments', detail: 'Reconcile COD and PayMongo', icon: 'card-outline', route: '/app/payments', badge: () => 0 },
      { label: 'Reports', detail: 'Sales and inventory exports', icon: 'analytics-outline', route: '/app/reports', badge: () => 0 },
      { label: 'Activity', detail: 'Audit people and systems', icon: 'pulse-outline', route: '/app/activity', badge: () => this.data.clientErrors().length },
    ]},
    { label: 'WORKSPACE CONTROL', items: [
      { label: 'Team access', detail: 'Invite, role, suspend', icon: 'shield-outline', route: '/app/team', badge: () => 0 },
      { label: 'Store settings', detail: 'Global store configuration', icon: 'options-outline', route: '/app/settings', badge: () => 0 },
    ]},
  ];
  readonly visibleGroups = computed(() => this.groups.map((group) => ({ ...group, items: group.items.filter((item) => canAccessRoute(this.auth.role(), item.route)) })).filter((group) => group.items.length));
  readonly roleLabel = computed(() => ({ staff: 'Staff', admin: 'Administrator', superadmin: 'Super Admin' })[this.auth.role() ?? 'staff']);
  readonly accessDescription = computed(() => this.auth.role() === 'superadmin' ? 'Full store, people, finance, security, and configuration access.' : this.auth.role() === 'admin' ? 'Operations, customers, payments, reporting, and audit access.' : 'Catalog, fulfillment, moderation, and customer-care access.');
  constructor(
    readonly data: AdminDataService,
    readonly auth: AdminAuthService,
    readonly native: NativePlatformService,
    readonly lock: AppLockService,
    private readonly toast: CozyToastService,
    private readonly alerts: AlertController,
    private readonly router: Router,
  ) {}

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

  async togglePush() {
    if (this.pushWorking()) return;
    this.pushWorking.set(true);
    if (this.native.pushEnabled()) {
      const message = await this.native.unregisterPushNotifications();
      this.pushWorking.set(false);
      await this.toast.show(message ?? 'Device registration removed.', message ? 'neutral' : 'success');
      return;
    }
    const message = await this.native.registerPushNotifications();
    this.pushWorking.set(false);
    if (!message) await this.native.success();
    else await this.native.warning();
    await this.toast.show(message ?? 'Native alerts are active on this device.', message ? 'neutral' : 'success');
  }

  async toggleBiometrics() {
    if (this.biometricWorking()) return;
    this.biometricWorking.set(true);
    if (this.lock.biometricEnabled()) {
      await this.lock.disableBiometrics();
      this.biometricWorking.set(false);
      await this.native.tap();
      await this.toast.show(`${this.lock.biometricLabel()} removed from this device. Your PIN still works.`, 'success');
      return;
    }
    const result = await this.lock.enableBiometrics();
    this.biometricWorking.set(false);
    if (result.ok) await this.native.success();
    else await this.native.warning();
    await this.toast.show(result.message, result.ok ? 'success' : 'neutral');
  }
}
