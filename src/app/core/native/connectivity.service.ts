import { computed, Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment.generated';

export type ConnectivityStatus = 'checking' | 'online' | 'unstable' | 'offline';
export type ConnectivityBannerKind = 'offline' | 'unstable' | 'restored';

export interface ConnectivityBanner {
  kind: ConnectivityBannerKind;
  title: string;
  detail: string;
  icon: string;
  retryable: boolean;
}

interface NetworkInformationLike extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
}

@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private static readonly PROBE_INTERVAL_MS = 90_000;
  private static readonly PROBE_TIMEOUT_MS = 6_500;
  private static readonly SLOW_PROBE_MS = 2_400;
  private static readonly RESTORED_VISIBILITY_MS = 3_800;
  private static readonly SECOND_PROBE_DELAY_MS = 2_500;
  private static readonly OFFLINE_VERIFICATION_DELAY_MS = 1_200;

  private readonly statusState = signal<ConnectivityStatus>(navigator.onLine ? 'checking' : 'offline');
  private readonly checkingState = signal(false);
  private readonly restoredState = signal(false);
  private readonly networkInformation = this.readNetworkInformation();
  private initialized = false;
  private activeProbe: Promise<void> | null = null;
  private lastProbeAt = 0;
  private consecutiveFailures = navigator.onLine ? 0 : 2;
  private restoredTimer: ReturnType<typeof setTimeout> | null = null;
  private followUpTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = this.statusState.asReadonly();
  readonly checking = this.checkingState.asReadonly();
  readonly online = computed(() => this.statusState() !== 'offline');
  readonly offline = computed(() => this.statusState() === 'offline');
  readonly unstable = computed(() => this.statusState() === 'unstable');
  readonly banner = computed<ConnectivityBanner | null>(() => {
    if (this.restoredState()) {
      return {
        kind: 'restored',
        title: 'Connection restored',
        detail: 'Live CozyCraft updates are available again.',
        icon: 'checkmark-circle-outline',
        retryable: false,
      };
    }
    if (this.statusState() === 'offline') {
      return {
        kind: 'offline',
        title: this.checkingState() ? 'Checking your connection' : 'No internet connection',
        detail: this.checkingState()
          ? 'Confirming that CozyCraft services are reachable.'
          : 'Live data cannot load. Reconnect, then try again.',
        icon: 'cloud-offline-outline',
        retryable: true,
      };
    }
    if (this.statusState() === 'unstable') {
      return {
        kind: 'unstable',
        title: this.checkingState() ? 'Rechecking connection' : 'Connection is unstable',
        detail: this.checkingState()
          ? 'Testing whether live synchronization has recovered.'
          : 'Sign-in and live updates may take longer than usual.',
        icon: 'warning-outline',
        retryable: true,
      };
    }
    return null;
  });

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('online', this.handleOnline);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.networkInformation?.addEventListener('change', this.handleConnectionInformationChange);

    window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.checkNow();
    }, ConnectivityService.PROBE_INTERVAL_MS);

    if (!navigator.onLine) {
      this.handleOffline();
      return;
    }
    void this.checkNow(true);
  }

  retry(): Promise<void> {
    // A native WebView can keep navigator.onLine=false briefly after Wi-Fi is
    // usable again. Treat an explicit retry as a fresh verification attempt;
    // the HTTPS health response is the authoritative recovery signal.
    this.consecutiveFailures = 0;
    return this.checkNow(true);
  }

  checkNow(force = false): Promise<void> {
    if (this.activeProbe) return this.activeProbe;
    if (!navigator.onLine && (!force || !this.healthUrl())) {
      this.consecutiveFailures = 2;
      this.applyStatus('offline');
      return Promise.resolve();
    }
    if (!force && Date.now() - this.lastProbeAt < ConnectivityService.PROBE_INTERVAL_MS) {
      this.refreshFromConnectionInformation();
      return Promise.resolve();
    }

    const probe = this.performProbe();
    this.activeProbe = probe;
    return probe.finally(() => {
      if (this.activeProbe === probe) this.activeProbe = null;
    });
  }

  private readonly handleOffline = (): void => {
    this.cancelFollowUpProbe();
    this.consecutiveFailures = 2;
    this.checkingState.set(false);
    this.applyStatus('offline');
    this.followUpTimer = setTimeout(() => {
      this.followUpTimer = null;
      void this.checkNow(true);
    }, ConnectivityService.OFFLINE_VERIFICATION_DELAY_MS);
  };

  private readonly handleOnline = (): void => {
    void this.checkNow(true);
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void this.checkNow(true);
  };

  private readonly handleConnectionInformationChange = (): void => {
    if (!navigator.onLine) {
      this.handleOffline();
      return;
    }
    this.refreshFromConnectionInformation();
    void this.checkNow(true);
  };

  private async performProbe(): Promise<void> {
    this.cancelFollowUpProbe();
    this.checkingState.set(true);
    this.lastProbeAt = Date.now();

    if (!this.healthUrl()) {
      this.consecutiveFailures = 0;
      this.applyStatus(this.hasWeakConnectionInformation() ? 'unstable' : 'online');
      this.checkingState.set(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), ConnectivityService.PROBE_TIMEOUT_MS);
    const startedAt = performance.now();
    try {
      // Supabase Auth health is a zero-row HEAD request. It verifies the same
      // route used by sign-in without querying store tables or downloading a
      // response body, so connectivity monitoring does not create DB egress.
      await fetch(this.healthUrl(), {
        method: 'HEAD',
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      // A completed request proves the service is reachable even when
      // WKWebView has not refreshed navigator.onLine yet.
      this.cancelFollowUpProbe();
      const elapsed = performance.now() - startedAt;
      this.consecutiveFailures = 0;
      this.applyStatus(elapsed >= ConnectivityService.SLOW_PROBE_MS || this.hasWeakConnectionInformation()
        ? 'unstable'
        : 'online');
    } catch {
      this.consecutiveFailures += 1;
      this.applyStatus(this.consecutiveFailures >= 2 ? 'offline' : 'unstable');
      if (this.consecutiveFailures < 2) {
        this.followUpTimer = setTimeout(() => {
          this.followUpTimer = null;
          void this.checkNow(true);
        }, ConnectivityService.SECOND_PROBE_DELAY_MS);
      }
    } finally {
      window.clearTimeout(timeout);
      this.checkingState.set(false);
    }
  }

  private applyStatus(next: ConnectivityStatus): void {
    const previous = this.statusState();
    this.statusState.set(next);

    const recovered = next === 'online' && (previous === 'offline' || previous === 'unstable');
    if (!recovered) {
      if (next !== 'online') this.hideRestoredState();
      return;
    }

    this.hideRestoredState();
    this.restoredState.set(true);
    this.restoredTimer = setTimeout(() => {
      this.restoredTimer = null;
      this.restoredState.set(false);
    }, ConnectivityService.RESTORED_VISIBILITY_MS);
  }

  private refreshFromConnectionInformation(): void {
    if (this.statusState() === 'offline') return;
    if (this.hasWeakConnectionInformation()) {
      this.applyStatus('unstable');
      return;
    }
    if (!this.checkingState() && this.consecutiveFailures === 0) this.applyStatus('online');
  }

  private hasWeakConnectionInformation(): boolean {
    const information = this.networkInformation;
    if (!information) return false;
    const effectiveType = information.effectiveType?.toLocaleLowerCase();
    return effectiveType === 'slow-2g'
      || effectiveType === '2g'
      || Number(information.rtt ?? 0) >= 1_200
      || Number(information.downlink ?? Number.POSITIVE_INFINITY) <= .5;
  }

  private healthUrl(): string {
    const base = environment.supabaseUrl.trim().replace(/\/+$/, '');
    return /^https:\/\//i.test(base) ? `${base}/auth/v1/health` : '';
  }

  private readNetworkInformation(): NetworkInformationLike | null {
    const current = navigator as NavigatorWithConnection;
    return current.connection ?? current.mozConnection ?? current.webkitConnection ?? null;
  }

  private hideRestoredState(): void {
    if (this.restoredTimer) clearTimeout(this.restoredTimer);
    this.restoredTimer = null;
    this.restoredState.set(false);
  }

  private cancelFollowUpProbe(): void {
    if (this.followUpTimer) clearTimeout(this.followUpTimer);
    this.followUpTimer = null;
  }
}
