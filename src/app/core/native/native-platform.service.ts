import { computed, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications, Token } from '@capacitor/push-notifications';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { AdminAuthService } from '../auth/admin-auth.service';
import { AppLockService } from '../auth/app-lock.service';
import { AdminNotification } from '../models/admin.models';
import { canAccessRoute } from '../utils/admin-permissions';
import { environment } from '../../../environments/environment.generated';

export type NativePushPhase =
  | 'checking'
  | 'unavailable'
  | 'setup-required'
  | 'ready'
  | 'denied'
  | 'registering'
  | 'registered'
  | 'error';

export interface NativePushRegistration {
  phase: NativePushPhase;
  title: string;
  detail: string;
  action: string;
  canRegister: boolean;
}

@Injectable({ providedIn: 'root' })
export class NativePlatformService {
  private static readonly BACKGROUND_UNLOCK_GRACE_MS = 15_000;
  private static readonly PUSH_REGISTRATION_TIMEOUT_MS = 25_000;
  private static readonly ANDROID_PUSH_CHANNEL = 'cozycraft_operations';
  private static readonly ANDROID_ORDER_CHANNEL = 'cozycraft_orders';
  private static readonly IOS_LOCAL_ALERT_OWNER_KEY = 'cozycraft-admin-ios-local-alert-owner';
  readonly native = signal(Capacitor.isNativePlatform());
  readonly platform = signal(Capacitor.getPlatform());
  readonly online = signal(navigator.onLine);
  readonly foreground = signal(true);
  private pushToken = localStorage.getItem('cozycraft-admin-push-token') ?? '';
  private pushOwner = localStorage.getItem('cozycraft-admin-push-owner') ?? '';
  private iosLocalAlertOwner = localStorage.getItem(NativePlatformService.IOS_LOCAL_ALERT_OWNER_KEY) ?? '';
  private readonly presentedLocalAlertIds = new Set<number>();
  private pendingPushRevocations = this.readPendingRevocations();
  private readonly pushRegistrationValid = signal(Boolean(this.pushToken));
  private readonly pushRegistrationState = signal<NativePushRegistration>({
    phase: 'checking',
    title: 'Checking alerts',
    detail: 'Confirming this device can receive native notifications.',
    action: 'Wait',
    canRegister: false,
  });
  readonly pushRegistration = this.pushRegistrationState.asReadonly();
  readonly pushEnabled = computed(() => this.pushRegistrationState().phase === 'registered'
    && ((this.pushRegistrationValid() && Boolean(this.pushToken) && this.pushOwner === this.auth.userId())
      || (this.platform() === 'ios' && !environment.iosPushConfigured
        && Boolean(this.iosLocalAlertOwner) && this.iosLocalAlertOwner === this.auth.userId())));
  private pushListenersSetup: Promise<void> | null = null;
  private localNotificationListenersSetup: Promise<void> | null = null;
  private pushRegistrationAttempt: Promise<string | null> | null = null;
  private pendingNativeRegistration: {
    settle: (message: string | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
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
    if (!this.native()) {
      this.setPushState('unavailable');
      return;
    }
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
    await this.configurePushListeners().catch((error: unknown) => {
      this.setPushState('error', this.errorMessage(error, 'Native notification listeners could not be prepared.'));
    });
    await this.configureLocalNotificationListeners().catch(() => undefined);
    await this.prepareAndroidPushChannel();
    await this.refreshPushRegistrationState(true);
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
    if (this.pushRegistrationAttempt) return this.pushRegistrationAttempt;
    const attempt = this.performPushRegistration();
    this.pushRegistrationAttempt = attempt;
    try {
      return await attempt;
    } finally {
      if (this.pushRegistrationAttempt === attempt) this.pushRegistrationAttempt = null;
    }
  }

  async refreshPushRegistrationState(validateServer = false) {
    if (!this.native()) {
      this.setPushState('unavailable');
      return;
    }
    if (this.platform() === 'android' && !environment.androidPushConfigured) {
      this.setPushState('setup-required');
      return;
    }

    if (this.platform() === 'ios' && !environment.iosPushConfigured) {
      try {
        const permission = await LocalNotifications.checkPermissions();
        if (permission.display === 'denied') {
          this.setPushState('denied');
          return;
        }
        if (this.iosLocalAlertOwner && this.iosLocalAlertOwner === this.auth.userId()) {
          this.setPushState(
            'registered',
            'Live operational alerts are active on this iPhone through the same local notification path as CozyCraft Customer.',
          );
          return;
        }
        this.setPushState(
          'ready',
          permission.display === 'granted'
            ? 'Permission is ready. Register this iPhone for live operational alerts.'
            : 'Register to show live operational alerts on this iPhone.',
        );
      } catch (error: unknown) {
        this.setPushState('error', this.errorMessage(error, 'iPhone notification permission could not be checked.'));
      }
      return;
    }

    try {
      const permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'denied') {
        this.setPushState('denied');
        return;
      }

      const ownsStoredToken = Boolean(this.pushToken)
        && this.pushOwner === this.auth.userId()
        && this.pushRegistrationValid();
      if (ownsStoredToken && validateServer && this.auth.userId()) {
        const { data, error } = await this.connection.client
          .from('mobile_push_tokens')
          .select('active')
          .eq('user_id', this.auth.userId()!)
          .eq('token', this.pushToken)
          .maybeSingle();
        if (error) {
          this.setPushState('error', `Native alert registration could not be verified: ${error.message}`);
          return;
        }
        if (!data?.active) this.clearCurrentPushRegistration();
      }

      if (Boolean(this.pushToken) && this.pushOwner === this.auth.userId() && this.pushRegistrationValid()) {
        this.setPushState('registered');
        return;
      }
      this.setPushState('ready', permission.receive === 'granted'
        ? 'Permission is ready. Register this device for operational alerts.'
        : 'Register to allow time-sensitive operational alerts on this device.');
    } catch (error: unknown) {
      this.setPushState('error', this.errorMessage(error, 'Notification permission could not be checked.'));
    }
  }

  private async performPushRegistration(): Promise<string | null> {
    if (!this.native()) {
      const message = 'Native alerts are available only in the installed Android and iOS applications.';
      this.setPushState('unavailable', message);
      return message;
    }
    if (!this.auth.signedIn()) {
      const message = 'Sign in to an approved administrator account before registering native alerts.';
      this.setPushState('error', message);
      return message;
    }
    if (this.platform() === 'android' && !environment.androidPushConfigured) {
      const message = 'Android alerts need the project-specific android/app/google-services.json file before this device can register.';
      this.setPushState('setup-required', message);
      return message;
    }

    if (this.platform() === 'ios' && !environment.iosPushConfigured) {
      return this.registerIosLocalAlerts();
    }

    this.setPushState('registering');
    try {
      const current = await PushNotifications.checkPermissions();
      const permission = current.receive === 'granted'
        ? current
        : await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') {
        const message = this.platform() === 'ios'
          ? 'Notifications are disabled. Enable CozyCraft Admin in iPhone Settings › Notifications, then tap Retry.'
          : 'Notifications are disabled. Enable CozyCraft Admin notifications in Android Settings, then tap Retry.';
        this.setPushState('denied', message);
        return message;
      }

      await this.configurePushListeners();
      await this.retryPendingPushRevocations();
      await this.prepareAndroidPushChannel();

      return await this.waitForNativePushToken();
    } catch (error: unknown) {
      const message = this.nativeRegistrationError(this.errorMessage(error, 'Native alert registration failed.'));
      this.pushRegistrationValid.set(false);
      this.setPushState('error', message);
      this.settleNativeRegistration(message);
      return message;
    }
  }

  private async waitForNativePushToken(): Promise<string | null> {
    if (this.pendingNativeRegistration) {
      return 'A native alert registration is already in progress.';
    }
    const result = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pendingNativeRegistration) return;
        this.pendingNativeRegistration = null;
        const message = 'The device did not return a notification token in time. Check the native push capability and try again.';
        this.pushRegistrationValid.set(false);
        this.setPushState('error', message);
        resolve(message);
      }, NativePlatformService.PUSH_REGISTRATION_TIMEOUT_MS);
      this.pendingNativeRegistration = { settle: resolve, timer };
    });
    try {
      await PushNotifications.register();
    } catch (error: unknown) {
      const message = this.nativeRegistrationError(this.errorMessage(error, 'The operating system rejected push registration.'));
      this.pushRegistrationValid.set(false);
      this.setPushState('error', message);
      this.settleNativeRegistration(message);
    }
    return result;
  }

  private settleNativeRegistration(message: string | null) {
    const pending = this.pendingNativeRegistration;
    if (!pending) return;
    this.pendingNativeRegistration = null;
    clearTimeout(pending.timer);
    pending.settle(message);
  }

  private async prepareAndroidPushChannel() {
    if (this.platform() !== 'android' || !environment.androidPushConfigured) return;
    await Promise.all([
      PushNotifications.createChannel({
        id: NativePlatformService.ANDROID_ORDER_CHANNEL,
        name: 'Orders and payments',
        description: 'New orders, payment updates, cancellations, and return requests.',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#B8A58D',
      }),
      PushNotifications.createChannel({
        id: NativePlatformService.ANDROID_PUSH_CHANNEL,
        name: 'CozyCraft operations',
        description: 'Inventory, reviews, customer care, reports, and security alerts.',
        importance: 4,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#B8A58D',
      }),
    ]).catch(() => undefined);
  }

  private async registerIosLocalAlerts(): Promise<string | null> {
    this.setPushState('registering', 'Preparing live operational alerts on this iPhone.');
    try {
      const current = await LocalNotifications.checkPermissions();
      const permission = current.display === 'granted'
        ? current
        : await LocalNotifications.requestPermissions();
      if (permission.display !== 'granted') {
        const message = 'Notifications are disabled. Enable CozyCraft Admin in iPhone Settings › Notifications, then tap Retry.';
        this.setPushState('denied', message);
        return message;
      }
      await this.configureLocalNotificationListeners();
      this.iosLocalAlertOwner = this.auth.userId() ?? '';
      localStorage.setItem(NativePlatformService.IOS_LOCAL_ALERT_OWNER_KEY, this.iosLocalAlertOwner);
      this.setPushState(
        'registered',
        'Live operational alerts are active on this iPhone through the same local notification path as CozyCraft Customer.',
      );
      return null;
    } catch (error: unknown) {
      const message = this.errorMessage(error, 'Live iPhone alerts could not be enabled.');
      this.setPushState('error', message);
      return message;
    }
  }

  async presentLocalAdminNotification(notification: Pick<AdminNotification,
    'id' | 'kind' | 'title' | 'message' | 'entity_id' | 'route'>) {
    if (!this.native() || this.platform() !== 'ios' || environment.iosPushConfigured) return;
    if (!this.auth.signedIn() || !this.auth.userId() || this.iosLocalAlertOwner !== this.auth.userId()) return;
    if (this.presentedLocalAlertIds.has(notification.id)) return;
    const permission = await LocalNotifications.checkPermissions().catch(() => null);
    if (permission?.display !== 'granted') return;

    this.presentedLocalAlertIds.add(notification.id);
    if (this.presentedLocalAlertIds.size > 256) {
      const oldest = this.presentedLocalAlertIds.values().next().value as number | undefined;
      if (oldest !== undefined) this.presentedLocalAlertIds.delete(oldest);
    }
    const id = Math.abs(notification.id % 2_147_483_647) || 1;
    await LocalNotifications.schedule({ notifications: [{
      id,
      title: notification.title || 'CozyCraft Admin update',
      body: notification.message || 'A new operational update is available.',
      schedule: { at: new Date(Date.now() + 250) },
      sound: 'default',
      threadIdentifier: `cozycraft-admin-${notification.kind}`,
      summaryArgument: this.localNotificationSummary(notification.kind),
      relevanceScore: notification.kind === 'order' ? 1 : notification.kind === 'support' ? 0.85 : 0.7,
      extra: {
        notification_id: String(notification.id),
        kind: notification.kind,
        entity_id: notification.entity_id ?? '',
        route: notification.route || '/app/notifications',
      },
    }] }).catch(() => {
      this.presentedLocalAlertIds.delete(notification.id);
    });
  }

  private localNotificationSummary(kind: AdminNotification['kind']) {
    switch (kind) {
      case 'order': return 'Order update';
      case 'inventory': return 'Inventory alert';
      case 'review': return 'Customer review';
      case 'support': return 'Customer care';
      case 'report': return 'Performance report';
      default: return 'Admin update';
    }
  }

  private async configureLocalNotificationListeners() {
    if (!this.native() || this.platform() !== 'ios') return;
    if (!this.localNotificationListenersSetup) {
      this.localNotificationListenersSetup = LocalNotifications
        .addListener('localNotificationActionPerformed', ({ notification }) => {
          const extra = notification.extra && typeof notification.extra === 'object'
            ? notification.extra as Record<string, unknown>
            : undefined;
          void this.openPushDestination(extra);
        })
        .then(() => undefined)
        .catch((error: unknown) => {
          this.localNotificationListenersSetup = null;
          throw error;
        });
    }
    await this.localNotificationListenersSetup;
  }

  private async configurePushListeners() {
    if (!this.native()) return;
    if (!this.pushListenersSetup) {
      this.pushListenersSetup = (async () => {
        await PushNotifications.addListener('registration', (token: Token) => void this.savePushToken(token.value));
        await PushNotifications.addListener('registrationError', ({ error }) => {
          this.pushRegistrationValid.set(false);
          const message = this.nativeRegistrationError(error);
          this.setPushState('error', message);
          this.settleNativeRegistration(message);
        });
        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          window.dispatchEvent(new CustomEvent('cozycraft:native-push-received', { detail: notification }));
        });
        await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
          void this.openPushDestination(notification.data);
        });
      })().catch((error: unknown) => {
        this.pushListenersSetup = null;
        throw error;
      });
    }
    await this.pushListenersSetup;
  }

  private async savePushToken(token: string) {
    if (!token) {
      const message = 'The operating system returned an empty notification token. Please try again.';
      this.setPushState('error', message);
      this.settleNativeRegistration(message);
      return;
    }
    if (!this.auth.signedIn() || !this.auth.userId()) {
      const message = 'Sign in to an approved administrator account before registering native alerts.';
      this.setPushState('error', message);
      this.settleNativeRegistration(message);
      return;
    }
    const { error } = await this.connection.client.rpc('register_mobile_push_token', {
      p_token: token,
      p_platform: this.platform(),
    });
    if (error) {
      const message = `This device received a native token, but CozyCraft could not save it: ${error.message}`;
      this.pushRegistrationValid.set(false);
      this.setPushState('error', message);
      this.settleNativeRegistration(message);
      return;
    }
    this.pushToken = token;
    localStorage.setItem('cozycraft-admin-push-token', token);
    this.pushOwner = this.auth.userId() ?? '';
    localStorage.setItem('cozycraft-admin-push-owner', this.pushOwner);
    this.pushRegistrationValid.set(true);
    this.setPushState('registered');
    this.settleNativeRegistration(null);
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
    if (this.native() && token && (this.platform() !== 'android' || environment.androidPushConfigured)) {
      await PushNotifications.unregister().catch(() => undefined);
    }
    if (this.platform() === 'ios' && this.iosLocalAlertOwner) {
      const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
      if (pending.notifications.length) await LocalNotifications.cancel(pending).catch(() => undefined);
      await LocalNotifications.removeAllDeliveredNotifications().catch(() => undefined);
      this.iosLocalAlertOwner = '';
      localStorage.removeItem(NativePlatformService.IOS_LOCAL_ALERT_OWNER_KEY);
      this.presentedLocalAlertIds.clear();
    }
    this.clearCurrentPushRegistration();
    this.settleNativeRegistration('Native alert registration was cancelled.');
    await this.refreshPushRegistrationState(false);
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
    await this.refreshPushRegistrationState(false);
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

  private setPushState(phase: NativePushPhase, detail?: string) {
    const platformName = this.platform() === 'ios' ? 'iPhone' : this.platform() === 'android' ? 'Android device' : 'device';
    const state: NativePushRegistration = (() => {
      switch (phase) {
        case 'unavailable':
          return {
            phase,
            title: 'Installed app required',
            detail: detail ?? 'Native alerts are available in the installed Android and iOS applications.',
            action: 'Unavailable',
            canRegister: false,
          };
        case 'setup-required':
          return {
            phase,
            title: 'Push setup required',
            detail: detail ?? 'This Android build is missing its Firebase device configuration.',
            action: 'Setup needed',
            canRegister: false,
          };
        case 'ready':
          return {
            phase,
            title: 'Native alerts available',
            detail: detail ?? `Register this ${platformName} for operational notifications.`,
            action: 'Register',
            canRegister: true,
          };
        case 'denied':
          return {
            phase,
            title: 'Permission is off',
            detail: detail ?? `Enable CozyCraft Admin notifications in ${platformName} Settings, then retry.`,
            action: 'Retry',
            canRegister: true,
          };
        case 'registering':
          return {
            phase,
            title: 'Registering device',
            detail: detail ?? `Waiting for a protected notification token from this ${platformName}.`,
            action: 'Registering',
            canRegister: false,
          };
        case 'registered':
          return {
            phase,
            title: 'Native alerts active',
            detail: detail ?? `Operational notifications are registered to this ${platformName}.`,
            action: 'Remove',
            canRegister: true,
          };
        case 'error':
          return {
            phase,
            title: 'Registration needs attention',
            detail: detail ?? 'Native alert registration did not complete. Please try again.',
            action: 'Retry',
            canRegister: true,
          };
        default:
          return {
            phase: 'checking',
            title: 'Checking alerts',
            detail: detail ?? 'Confirming this device can receive native notifications.',
            action: 'Wait',
            canRegister: false,
          };
      }
    })();
    this.pushRegistrationState.set(state);
  }

  private nativeRegistrationError(error: string) {
    if (/aps-environment|entitlement|provisioning profile/i.test(error)) {
      return 'This iPhone build is not signed with the Push Notifications capability. Enable it for com.cozycraft.admin in Xcode and Apple Developer, then rebuild.';
    }
    if (/firebase|google-services|default firebaseapp/i.test(error)) {
      return 'This Android build is missing its matching Firebase configuration. Add android/app/google-services.json and rebuild.';
    }
    return error;
  }

  private errorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
      return error.message;
    }
    return fallback;
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
