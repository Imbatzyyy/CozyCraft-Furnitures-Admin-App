import { computed, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { PushNotifications, Token } from '@capacitor/push-notifications';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { AdminAuthService } from '../auth/admin-auth.service';
import { AppLockService } from '../auth/app-lock.service';
import { canAccessRoute } from '../utils/admin-permissions';
import { environment } from '../../../environments/environment.generated';

@Injectable({ providedIn: 'root' })
export class NativePlatformService {
  private static readonly BACKGROUND_UNLOCK_GRACE_MS = 15_000;
  readonly native = signal(Capacitor.isNativePlatform());
  readonly platform = signal(Capacitor.getPlatform());
  readonly online = signal(navigator.onLine);
  readonly foreground = signal(true);
  private pushToken = localStorage.getItem('cozycraft-admin-push-token') ?? '';
  private pushOwner = localStorage.getItem('cozycraft-admin-push-owner') ?? '';
  private pendingPushRevocations = this.readPendingRevocations();
  private readonly pushRegistrationValid = signal(Boolean(this.pushToken));
  readonly pushEnabled = computed(() => this.pushRegistrationValid() && Boolean(this.pushToken) && this.pushOwner === this.auth.userId());
  private pushListenersReady = false;
  private lastAccessValidationAt = 0;
  private lastPinStatusRefreshAt = 0;
  private resumeValidation: Promise<void> | null = null;
  private inactiveAt: number | null = null;
  private backgroundLockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly connection: SupabaseAdminService,
    private readonly router: Router,
    private readonly auth: AdminAuthService,
    private readonly appLock: AppLockService,
  ) {
    this.auth.registerSessionEndHook(() => this.unregisterPushNotifications().then(() => undefined));
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }

  async initialize() {
    await this.auth.ensureInitialized();
    await this.retryPendingPushRevocations();
    if (!this.native()) return;
    if (this.platform() === 'ios') {
      // The PIN screen uses its own compact controls, so the iOS previous /
      // next accessory strip adds no value. More importantly, leaving that
      // native strip attached while Angular replaces the auth route can leave
      // an invisible UIKit hit surface over the app's bottom navigation.
      await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);
    }
    await App.addListener('appStateChange', ({ isActive }) => {
      this.foreground.set(isActive);
      if (!isActive) {
        // A quick app switch, notification interruption, or accidental Home
        // gesture should not immediately ask for credentials again. Keep a
        // short in-memory grace window, but lock while the app remains away.
        // Biometric system sheets have their own verified lifecycle and must
        // not be treated as the user leaving CozyCraft Admin.
        if (this.appLock.biometricBusy()) return;
        this.auth.recordActivity(true);
        if (this.inactiveAt === null) this.inactiveAt = Date.now();
        this.scheduleBackgroundLock();
        return;
      }
      const inactiveAt = this.inactiveAt;
      this.inactiveAt = null;
      this.clearBackgroundLockTimer();
      // Native biometric sheets can briefly produce an active event while the
      // authentication promise is still settling. Its result is the current
      // security decision, so do not launch a competing resume refresh.
      if (this.appLock.biometricBusy()) return;
      if (inactiveAt !== null
        && Date.now() - inactiveAt >= NativePlatformService.BACKGROUND_UNLOCK_GRACE_MS) {
        this.appLock.lock();
      }
      void this.revalidateOnResume();
    });
    await this.configurePushListeners();
  }

  async success() {
    if (!this.native()) return;
    await Haptics.notification({ type: NotificationType.Success }).catch(() => undefined);
  }

  async warning() {
    if (!this.native()) return;
    await Haptics.notification({ type: NotificationType.Warning }).catch(() => undefined);
  }

  async tap() {
    if (!this.native()) return;
    await Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
  }

  /**
   * Release native input ownership before leaving an authentication screen.
   * WKWebView can otherwise keep the keyboard/accessory view alive for a
   * frame (or, after resume, indefinitely) after the focused input is removed.
   * That stale native view intercepts touches independently of DOM z-index.
   */
  async releaseInputFocus() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    if (this.native()) await Keyboard.hide().catch(() => undefined);

    // Let both the DOM focus change and the native visual viewport restoration
    // finish before the protected workspace is attached.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  async openExternalUrl(url: string) {
    if (!/^https:\/\//i.test(url)) throw new Error('Only secure links can be opened.');
    if (this.native()) {
      await Browser.open({ url, presentationStyle: 'popover' });
      return;
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) throw new Error('Your browser blocked the secure attachment window.');
  }

  async registerPushNotifications(): Promise<string | null> {
    if (!this.native()) return 'Push notifications are available in installed Android and iOS builds.';
    if (this.platform() === 'android' && !environment.androidPushConfigured) {
      return 'Android push delivery is not configured yet. Add android/app/google-services.json, then rebuild the app.';
    }
    const current = await PushNotifications.checkPermissions();
    const permission = current.receive === 'prompt'
      ? await PushNotifications.requestPermissions()
      : current;
    if (permission.receive !== 'granted') return 'Notification permission was not granted.';

    await this.configurePushListeners();
    await this.retryPendingPushRevocations();
    await PushNotifications.register();
    return null;
  }

  private async configurePushListeners() {
    if (!this.native() || this.pushListenersReady) return;
    this.pushListenersReady = true;
    await PushNotifications.addListener('registration', (token: Token) => void this.savePushToken(token.value));
    await PushNotifications.addListener('registrationError', () => this.pushRegistrationValid.set(false));
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      void this.openPushDestination(notification.data);
    });
  }

  private async savePushToken(token: string) {
    if (!token) return;
    const { error } = await this.connection.client.rpc('register_mobile_push_token', {
      p_token: token,
      p_platform: this.platform(),
    });
    if (!error) {
      this.pushToken = token;
      localStorage.setItem('cozycraft-admin-push-token', token);
      this.pushOwner = this.auth.userId() ?? '';
      localStorage.setItem('cozycraft-admin-push-owner', this.pushOwner);
      this.pushRegistrationValid.set(true);
    }
  }

  async unregisterPushNotifications(): Promise<string | null> {
    const token = this.pushToken;
    const owner = this.pushOwner;
    let removalError: string | null = null;
    if (token && owner === this.auth.userId()) {
      const { error } = await this.connection.client.rpc('unregister_mobile_push_token', { p_token: token });
      removalError = error?.message ?? null;
      if (removalError) this.queuePushRevocation(token, owner);
    } else if (token && owner) {
      this.queuePushRevocation(token, owner);
    }
    // Capacitor's Android plugin calls Firebase directly. A local build without
    // google-services.json must not invoke it merely to clear an empty token;
    // the native exception is fatal before JavaScript can catch it.
    if (this.native() && token) await PushNotifications.unregister().catch(() => undefined);
    this.clearCurrentPushRegistration();
    return removalError ? `The device token was disabled locally, but server cleanup will retry automatically: ${removalError}` : null;
  }

  private notificationDestination(data: Record<string, unknown> | undefined) {
    if (!data) return null;
    const id = typeof data['entity_id'] === 'string' ? encodeURIComponent(data['entity_id']) : '';
    const entityDestination = (() => { switch (data['kind']) {
      case 'order': return id ? `/app/orders/${id}` : '/app/orders';
      case 'review': return id ? `/app/reviews?review=${id}` : '/app/reviews';
      case 'support': return id ? `/app/support/${id}` : '/app/support';
      case 'inventory': return id ? `/app/products/${id}` : '/app/inventory';
      case 'report': return '/app/reports';
      case 'system': return '/app/activity';
      default: return '';
    } })();
    const explicit = typeof data['route'] === 'string' ? data['route'].replace(/^\/admin(?=\/|$)/, '/app') : '';
    const safeExplicit = /^\/app\/(dashboard|orders|products|categories|inventory|payments|customers|reviews|support|reports|activity|notifications|team|settings|more)(?:[/?#]|$)/.test(explicit)
      ? explicit
      : '';
    return entityDestination || safeExplicit || '/app/notifications';
  }

  private async openPushDestination(data: Record<string, unknown> | undefined) {
    await this.auth.ensureInitialized();
    const intendedRoute = this.notificationDestination(data) ?? '/app/notifications';
    if (!this.auth.signedIn()) {
      // Preserve the syntactically validated destination until the user's role
      // is known. Login applies the role-aware return URL sanitizer.
      await this.router.navigate(['/auth/login'], { queryParams: { returnUrl: intendedRoute } });
      return;
    }
    await this.router.navigateByUrl(canAccessRoute(this.auth.role(), intendedRoute) ? intendedRoute : '/app/more');
  }

  private revalidateOnResume(): Promise<void> {
    if (this.appLock.biometricBusy()) return Promise.resolve();
    if (this.resumeValidation) return this.resumeValidation;
    const validation = this.performResumeValidation()
      .finally(() => {
        if (this.resumeValidation === validation) this.resumeValidation = null;
      });
    this.resumeValidation = validation;
    return validation;
  }

  private scheduleBackgroundLock() {
    this.clearBackgroundLockTimer();
    const inactiveAt = this.inactiveAt;
    if (inactiveAt === null) return;
    const remaining = Math.max(
      0,
      NativePlatformService.BACKGROUND_UNLOCK_GRACE_MS - (Date.now() - inactiveAt),
    );
    this.backgroundLockTimer = setTimeout(() => {
      this.backgroundLockTimer = null;
      if (!this.foreground() && !this.appLock.biometricBusy()) this.appLock.lock();
    }, remaining);
  }

  private clearBackgroundLockTimer() {
    if (this.backgroundLockTimer === null) return;
    clearTimeout(this.backgroundLockTimer);
    this.backgroundLockTimer = null;
  }

  private async performResumeValidation() {
    // Check the stored inactivity boundary before resume itself can count as
    // fresh activity. This prevents the first tap after a long absence from
    // reviving a session that should have ended.
    if (await this.auth.enforceInactivityTimeout()) {
      if (!this.router.url.startsWith('/auth/login')) {
        await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
      }
      return;
    }
    this.auth.recordActivity(true);

    const now = Date.now();
    if (now - this.lastAccessValidationAt >= 120_000) {
      await this.auth.revalidateAccess();
      this.lastAccessValidationAt = now;
    }
    await this.retryPendingPushRevocations();
    if (!this.auth.signedIn()) {
      if (!this.router.url.startsWith('/auth/login')) await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
      return;
    }
    if (this.auth.mfaRequired() && !this.auth.mfaSatisfied()) return;
    if (this.appLock.biometricBusy()) return;

    const refreshPinStatus = now - this.lastPinStatusRefreshAt >= 300_000;
    await this.appLock.ensureForCurrentSession(refreshPinStatus);
    if (refreshPinStatus) this.lastPinStatusRefreshAt = now;
    if (this.appLock.unlocked()) return;

    const currentRoute = this.router.url.startsWith('/app/') ? this.router.url : '/app/dashboard';
    const destination = this.appLock.needsSetup() ? '/auth/pin-setup' : '/auth/unlock';
    if (!this.router.url.startsWith(destination)) {
      await this.router.navigate([destination], { queryParams: { returnUrl: currentRoute }, replaceUrl: true });
    }
  }

  private clearCurrentPushRegistration() {
    this.pushToken = '';
    this.pushOwner = '';
    localStorage.removeItem('cozycraft-admin-push-token');
    localStorage.removeItem('cozycraft-admin-push-owner');
    this.pushRegistrationValid.set(false);
  }

  private queuePushRevocation(token: string, owner: string) {
    if (!this.pendingPushRevocations.some((item) => item.token === token && item.owner === owner)) {
      this.pendingPushRevocations.push({ token, owner });
      localStorage.setItem('cozycraft-admin-push-revocations', JSON.stringify(this.pendingPushRevocations));
    }
  }

  private async retryPendingPushRevocations() {
    const userId = this.auth.userId();
    if (!userId || !this.pendingPushRevocations.length) return;
    const remaining: Array<{ token: string; owner: string }> = [];
    for (const item of this.pendingPushRevocations) {
      if (item.owner !== userId) {
        remaining.push(item);
        continue;
      }
      const { error } = await this.connection.client.rpc('unregister_mobile_push_token', { p_token: item.token });
      if (error) remaining.push(item);
    }
    this.pendingPushRevocations = remaining;
    if (remaining.length) localStorage.setItem('cozycraft-admin-push-revocations', JSON.stringify(remaining));
    else localStorage.removeItem('cozycraft-admin-push-revocations');
  }

  private readPendingRevocations(): Array<{ token: string; owner: string }> {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('cozycraft-admin-push-revocations') ?? '[]');
      if (!Array.isArray(value)) return [];
      return value.filter((item): item is { token: string; owner: string } => Boolean(
        item && typeof item === 'object' && 'token' in item && 'owner' in item
        && typeof item.token === 'string' && typeof item.owner === 'string',
      ));
    } catch {
      return [];
    }
  }
}
