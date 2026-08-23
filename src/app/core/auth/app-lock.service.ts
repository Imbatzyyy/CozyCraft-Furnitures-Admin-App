import { computed, Injectable, signal } from '@angular/core';
import {
  AndroidBiometryStrength,
  BiometricAuth,
  BiometryError,
  BiometryErrorType,
  BiometryType,
  CheckBiometryResult,
} from '@aparajita/capacitor-biometric-auth';
import {
  KeychainAccess,
  SecureStorage,
} from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';
import { AdminAuthService } from './admin-auth.service';
import { SupabaseAdminService } from './supabase-admin.service';

type LockPhase = 'idle' | 'checking' | 'setup' | 'locked' | 'unlocked' | 'error';

interface PinStatusPayload {
  configured?: boolean;
  pin_version?: number;
  failed_attempts?: number;
  locked_until?: string | null;
}

interface PinVerificationPayload extends PinStatusPayload {
  verified?: boolean;
  attempts_remaining?: number;
}

interface DeviceBiometricBinding extends Record<string, unknown> {
  userId: string;
  pinVersion: number;
  enabledAt: string;
}

export interface PinActionResult {
  ok: boolean;
  message: string;
  lockedUntil?: string | null;
  attemptsRemaining?: number;
}

@Injectable({ providedIn: 'root' })
export class AppLockService {
  private readonly client = this.connection.client;
  private readonly phaseState = signal<LockPhase>('idle');
  private readonly configuredState = signal(false);
  private readonly unlockedState = signal(false);
  private readonly pinVersionState = signal(0);
  private readonly lockedUntilState = signal<string | null>(null);
  private readonly attemptsRemainingState = signal<number | null>(null);
  private readonly errorState = signal('');
  private readonly biometricInfoState = signal<CheckBiometryResult | null>(null);
  private readonly biometricEnabledState = signal(false);
  private readonly biometricBusyState = signal(false);
  private preparedUserId = '';
  private preparation: Promise<void> | null = null;
  private storagePrepared = false;
  private unlockRevision = 0;

  readonly phase = this.phaseState.asReadonly();
  readonly configured = this.configuredState.asReadonly();
  readonly unlocked = this.unlockedState.asReadonly();
  readonly lockedUntil = this.lockedUntilState.asReadonly();
  readonly attemptsRemaining = this.attemptsRemainingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly biometricEnabled = this.biometricEnabledState.asReadonly();
  readonly biometricBusy = this.biometricBusyState.asReadonly();
  readonly biometricAvailable = computed(() => Boolean(
    Capacitor.isNativePlatform()
    && (Capacitor.getPlatform() === 'ios'
      ? this.biometricInfoState()?.isAvailable
      : this.biometricInfoState()?.strongBiometryIsAvailable),
  ));
  readonly biometricLabel = computed(() => {
    if (Capacitor.getPlatform() === 'android') return 'Fingerprint';
    return this.biometricInfoState()?.biometryType === BiometryType.touchId ? 'Touch ID' : 'Face ID';
  });
  readonly needsSetup = computed(() => this.phaseState() === 'setup');
  readonly needsUnlock = computed(() => this.configuredState() && !this.unlockedState());

  constructor(
    private readonly auth: AdminAuthService,
    private readonly connection: SupabaseAdminService,
  ) {
    this.auth.registerSessionEndHook(async () => this.resetInMemory());
  }

  async ensureForCurrentSession(force = false): Promise<void> {
    await this.auth.ensureInitialized();
    const userId = this.auth.userId();
    if (!userId || !this.auth.signedIn()) {
      this.resetInMemory();
      return;
    }
    if (!force && this.preparedUserId === userId && this.phaseState() !== 'idle') return;
    if (!force && this.preparation) return this.preparation;

    this.preparation = this.prepare(userId).finally(() => { this.preparation = null; });
    return this.preparation;
  }

  private async prepare(userId: string) {
    const revisionAtStart = this.unlockRevision;
    const unlockedAtStart = this.unlockedState();
    const pinVersionAtStart = this.pinVersionState();
    if (!unlockedAtStart) this.phaseState.set('checking');
    this.errorState.set('');
    await this.refreshBiometry();

    const { data, error } = await this.client.rpc('admin_mobile_pin_status');
    // A PIN or biometric verification may finish while a slower resume refresh
    // is still in flight. Never let that older response undo the newer unlock.
    if (revisionAtStart !== this.unlockRevision && this.unlockedState()) return;
    if (error) {
      if (unlockedAtStart) {
        this.phaseState.set('unlocked');
        return;
      }
      this.preparedUserId = userId;
      this.phaseState.set('error');
      this.errorState.set('Mobile PIN security could not be loaded. Check the connection and try again.');
      return;
    }

    const status = this.asPayload(data);
    const configured = status.configured === true;
    const serverPinVersion = this.numberValue(status.pin_version);
    const deviceBindingEnabled = await this.readDeviceBinding(userId, serverPinVersion);
    if (revisionAtStart !== this.unlockRevision && this.unlockedState()) return;

    this.preparedUserId = userId;
    this.configuredState.set(configured);
    this.pinVersionState.set(serverPinVersion);
    this.lockedUntilState.set(this.stringOrNull(status.locked_until));
    this.attemptsRemainingState.set(null);
    this.biometricEnabledState.set(deviceBindingEnabled);

    const preserveUnlock = unlockedAtStart
      && configured
      && pinVersionAtStart === serverPinVersion;
    this.unlockedState.set(preserveUnlock);
    this.phaseState.set(configured ? (preserveUnlock ? 'unlocked' : 'locked') : 'setup');
  }

  async createPin(pin: string): Promise<PinActionResult> {
    const validation = this.validatePin(pin);
    if (validation) return { ok: false, message: validation };
    const { data, error } = await this.client.rpc('admin_mobile_set_pin', { p_pin: pin });
    if (error) {
      if (/already configured/i.test(error.message)) {
        // Another signed-in device may have completed setup while this screen
        // was open. Refresh once and move this device to the existing-PIN flow.
        await this.ensureForCurrentSession(true);
        return { ok: false, message: 'This account PIN was created on another device. Enter that same PIN to continue.' };
      }
      return { ok: false, message: this.friendlyRpcError(error.message, 'The PIN could not be created.') };
    }

    const result = this.asPayload(data);
    this.configuredState.set(true);
    this.pinVersionState.set(this.numberValue(result.pin_version, 1));
    this.lockedUntilState.set(null);
    this.attemptsRemainingState.set(null);
    this.markUnlocked();
    return { ok: true, message: 'Your six-digit PIN is ready.' };
  }

  async verifyPin(pin: string): Promise<PinActionResult> {
    if (!/^\d{6}$/.test(pin)) return { ok: false, message: 'Enter all six digits.' };
    const { data, error } = await this.client.rpc('admin_mobile_verify_pin', { p_pin: pin });
    if (error) return { ok: false, message: this.friendlyRpcError(error.message, 'The PIN could not be verified.') };

    const result = this.asPayload(data) as PinVerificationPayload;
    const lockedUntil = this.stringOrNull(result.locked_until);
    this.lockedUntilState.set(lockedUntil);
    this.attemptsRemainingState.set(typeof result.attempts_remaining === 'number' ? result.attempts_remaining : null);
    if (result.verified !== true) {
      return {
        ok: false,
        message: lockedUntil
          ? `Too many attempts. Try again ${this.relativeUnlockTime(lockedUntil)}.`
          : `That PIN is not correct.${typeof result.attempts_remaining === 'number' ? ` ${result.attempts_remaining} attempts remain.` : ''}`,
        lockedUntil,
        attemptsRemaining: result.attempts_remaining,
      };
    }

    const serverVersion = this.numberValue(result.pin_version, this.pinVersionState());
    if (serverVersion !== this.pinVersionState()) {
      this.pinVersionState.set(serverVersion);
      await this.disableBiometrics();
    }
    this.lockedUntilState.set(null);
    this.attemptsRemainingState.set(null);
    this.markUnlocked();
    return { ok: true, message: 'Secure access verified.' };
  }

  async authenticateWithBiometrics(): Promise<PinActionResult> {
    if (!this.biometricEnabledState()) return { ok: false, message: `${this.biometricLabel()} is not enabled on this device.` };
    if (!this.biometricAvailable()) {
      await this.disableBiometrics();
      return { ok: false, message: `${this.biometricLabel()} is no longer available. Use your six-digit PIN.` };
    }
    if (this.biometricBusyState()) return { ok: false, message: 'Biometric verification is already open.' };

    this.biometricBusyState.set(true);
    this.errorState.set('');
    try {
      await BiometricAuth.authenticate({
        reason: 'Unlock CozyCraft Admin',
        cancelTitle: 'Use PIN',
        allowDeviceCredential: false,
        iosFallbackTitle: 'Use 6-digit PIN',
        androidTitle: 'Unlock CozyCraft Admin',
        androidSubtitle: 'Confirm your fingerprint to continue',
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.strong,
      });
      this.markUnlocked();
      return { ok: true, message: `${this.biometricLabel()} verified.` };
    } catch (error) {
      const message = error instanceof BiometryError
        ? this.biometricFailureMessage(error.code)
        : `${this.biometricLabel()} was not completed. Enter your six-digit PIN.`;
      return { ok: false, message };
    } finally {
      this.biometricBusyState.set(false);
    }
  }

  async enableBiometrics(): Promise<PinActionResult> {
    await this.refreshBiometry();
    if (!this.biometricAvailable()) {
      return { ok: false, message: `${this.biometricLabel()} is not enrolled or available for apps on this device.` };
    }
    const verification = await this.authenticateForEnrollment();
    if (!verification.ok) return verification;

    const userId = this.auth.userId();
    if (!userId) return { ok: false, message: 'Your secure session is no longer available.' };
    try {
      await this.prepareSecureStorage();
      const binding: DeviceBiometricBinding = {
        userId,
        pinVersion: this.pinVersionState(),
        enabledAt: new Date().toISOString(),
      };
      await SecureStorage.set(
        this.bindingKey(userId),
        binding,
        true,
        false,
        KeychainAccess.whenPasscodeSetThisDeviceOnly,
      );
      this.biometricEnabledState.set(true);
      return { ok: true, message: `${this.biometricLabel()} is enabled on this device.` };
    } catch {
      return { ok: false, message: `${this.biometricLabel()} was verified, but this device could not save the protected setting.` };
    }
  }

  async disableBiometrics(): Promise<void> {
    const userId = this.auth.userId() || this.preparedUserId;
    if (userId) {
      await this.prepareSecureStorage().then(() => SecureStorage.remove(this.bindingKey(userId), false)).catch(() => undefined);
    }
    this.biometricEnabledState.set(false);
  }

  lock() {
    if (!this.auth.signedIn() || !this.configuredState() || this.biometricBusyState()) return;
    if (!this.unlockedState() && this.phaseState() === 'locked') return;
    ++this.unlockRevision;
    this.unlockedState.set(false);
    this.phaseState.set('locked');
  }

  private markUnlocked() {
    ++this.unlockRevision;
    this.unlockedState.set(true);
    this.phaseState.set('unlocked');
  }

  private async authenticateForEnrollment(): Promise<PinActionResult> {
    this.biometricBusyState.set(true);
    try {
      await BiometricAuth.authenticate({
        reason: `Enable ${this.biometricLabel()} for CozyCraft Admin`,
        cancelTitle: 'Not now',
        allowDeviceCredential: false,
        iosFallbackTitle: '',
        androidTitle: `Enable ${this.biometricLabel()}`,
        androidSubtitle: 'Confirm your identity for this device',
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.strong,
      });
      return { ok: true, message: `${this.biometricLabel()} verified.` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof BiometryError
          ? this.biometricFailureMessage(error.code, true)
          : `${this.biometricLabel()} enrollment was not completed.`,
      };
    } finally {
      this.biometricBusyState.set(false);
    }
  }

  private async refreshBiometry() {
    if (!Capacitor.isNativePlatform()) {
      this.biometricInfoState.set(null);
      this.biometricEnabledState.set(false);
      return;
    }
    try {
      this.biometricInfoState.set(await BiometricAuth.checkBiometry());
    } catch {
      this.biometricInfoState.set(null);
    }
  }

  private async readDeviceBinding(userId: string, pinVersion: number): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || !this.biometricAvailable()) {
      return false;
    }
    try {
      await this.prepareSecureStorage();
      const stored = await SecureStorage.get(this.bindingKey(userId), false, false);
      const binding = stored && typeof stored === 'object' && !Array.isArray(stored)
        ? stored as unknown as DeviceBiometricBinding
        : null;
      const enabled = Boolean(
        binding
        && binding.userId === userId
        && binding.pinVersion === pinVersion,
      );
      return enabled;
    } catch {
      return false;
    }
  }

  private async prepareSecureStorage() {
    if (this.storagePrepared) return;
    await SecureStorage.setKeyPrefix('cozycraft_admin_');
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenPasscodeSetThisDeviceOnly);
    this.storagePrepared = true;
  }

  private resetInMemory() {
    ++this.unlockRevision;
    this.preparedUserId = '';
    this.configuredState.set(false);
    this.unlockedState.set(false);
    this.pinVersionState.set(0);
    this.lockedUntilState.set(null);
    this.attemptsRemainingState.set(null);
    this.errorState.set('');
    this.biometricEnabledState.set(false);
    this.phaseState.set('idle');
  }

  private bindingKey(userId: string) {
    return `biometric_${userId}`;
  }

  private asPayload(value: unknown): PinStatusPayload {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as PinStatusPayload;
    return {};
  }

  private numberValue(value: unknown, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private stringOrNull(value: unknown) {
    return typeof value === 'string' && value ? value : null;
  }

  private validatePin(pin: string) {
    if (!/^\d{6}$/.test(pin)) return 'Your PIN must contain exactly six digits.';
    if (/^(\d)\1{5}$/.test(pin)) return 'Choose a stronger PIN instead of repeating one digit.';
    if (['012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321', '543210'].includes(pin)) {
      return 'Choose a stronger PIN instead of a simple number sequence.';
    }
    return '';
  }

  private relativeUnlockTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'later';
    return `at ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(date)}`;
  }

  private biometricFailureMessage(code: BiometryErrorType, enrollment = false) {
    switch (code) {
      case BiometryErrorType.userCancel:
      case BiometryErrorType.userFallback:
      case BiometryErrorType.appCancel:
      case BiometryErrorType.systemCancel:
        return enrollment
          ? `${this.biometricLabel()} was not enabled. You can turn it on later.`
          : `Use your six-digit PIN to unlock CozyCraft Admin.`;
      case BiometryErrorType.biometryLockout:
        return `${this.biometricLabel()} is temporarily locked. Use your six-digit PIN.`;
      case BiometryErrorType.biometryNotEnrolled:
      case BiometryErrorType.biometryNotAvailable:
        return `${this.biometricLabel()} is unavailable. Use your six-digit PIN.`;
      default:
        return `${this.biometricLabel()} did not recognize you. Use your six-digit PIN.`;
    }
  }

  private friendlyRpcError(message: string, fallback: string) {
    if (/stronger pin/i.test(message)) return 'Choose a stronger PIN that is not repeated or sequential.';
    if (/already configured/i.test(message)) return 'A PIN is already configured for this account.';
    if (/active staff/i.test(message)) return 'Your administrator access could not be verified.';
    return fallback;
  }
}
