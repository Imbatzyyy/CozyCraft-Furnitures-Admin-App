import { computed, Injectable, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { AdminRole, AdminSecuritySettings, Profile } from '../models/admin.models';
import { defaultAdminSecuritySettings, normalizeSecuritySettings } from '../models/defaults';
import { isAdminRole } from '../utils/admin-permissions';
import { SupabaseAdminService } from './supabase-admin.service';

export type SignInResult =
  | { ok: true; destination: '/app/dashboard' | '/auth/mfa' | '/auth/mfa-enroll' }
  | { ok: false; message: string };

export interface TotpEnrollment {
  id: string;
  qrCode: string;
  secret: string;
  uri: string;
}

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private static readonly INACTIVITY_LIMIT_MS = 7 * 24 * 60 * 60 * 1_000;
  private static readonly ACTIVITY_PERSIST_INTERVAL_MS = 60_000;
  private static readonly ACTIVITY_STORAGE_PREFIX = 'cozycraft-admin-last-active:';
  private readonly supabase = this.connection.client;
  private initialization: Promise<void> | null = null;
  private readonly sessionState = signal<Session | null>(null);
  private readonly profileState = signal<Profile | null>(null);
  private readonly securityState = signal<AdminSecuritySettings>(defaultAdminSecuritySettings);
  private readonly readyState = signal(false);
  private readonly busyState = signal(false);
  private readonly errorState = signal('');
  private readonly mfaRequiredState = signal(false);
  private readonly hasMfaState = signal(false);
  private readonly mfaSatisfiedState = signal(false);
  private readonly sessionEndHooks = new Set<() => Promise<void>>();
  private sessionEndPromise: Promise<void> | null = null;
  private sessionGeneration = 0;
  private pendingSignedOutError = '';
  private sessionApplication: { key: string; promise: Promise<void> } | null = null;
  private interactiveSignIn = false;
  private activityUserId = '';
  private lastActivityAt = 0;
  private lastPersistedActivityAt = 0;
  private inactivityEndPromise: Promise<boolean> | null = null;

  readonly session = this.sessionState.asReadonly();
  readonly profile = this.profileState.asReadonly();
  readonly security = this.securityState.asReadonly();
  readonly ready = this.readyState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly mfaRequired = this.mfaRequiredState.asReadonly();
  readonly hasVerifiedMfa = this.hasMfaState.asReadonly();
  readonly mfaSatisfied = this.mfaSatisfiedState.asReadonly();
  readonly configured = this.connection.configured.asReadonly();
  readonly user = computed(() => this.sessionState()?.user ?? null);
  readonly userId = computed(() => this.sessionState()?.user.id ?? null);
  readonly role = computed<AdminRole | null>(() => {
    const role = this.profileState()?.role;
    return isAdminRole(role) ? role : null;
  });
  readonly signedIn = computed(() => Boolean(this.sessionState() && this.role()));
  readonly displayName = computed(() => {
    const profile = this.profileState();
    return profile?.full_name?.trim() || profile?.email?.split('@')[0] || 'Administrator';
  });

  constructor(private readonly connection: SupabaseAdminService) {
    this.supabase.auth.onAuthStateChange((_event, session) => {
      // A credential sign-in is always fresh activity. Mark it before the
      // queued session application so an old timestamp from this account on
      // the same device cannot reject the newly authenticated session.
      if (this.interactiveSignIn && session) this.rememberActivityForUser(session.user.id, true);
      queueMicrotask(() => void this.applySession(session));
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initialize();
    return this.initialization;
  }

  async revalidateAccess(): Promise<boolean> {
    const session = this.sessionState();
    if (!session) return false;
    await this.applySession(session, true);
    return this.sessionState()?.access_token === session.access_token && this.signedIn();
  }

  /**
   * Records meaningful administrator activity without writing on every tap.
   * If the persisted rolling window has already elapsed, activity cannot
   * revive the session; it starts the secure local sign-out instead.
   */
  recordActivity(forcePersist = false) {
    const session = this.sessionState();
    if (!session) return;
    if (this.sessionIsInactive(session.user.id)) {
      void this.endInactiveSession(session);
      return;
    }
    this.rememberActivityForUser(session.user.id, forcePersist);
  }

  /** Returns true when a session was ended for seven days of inactivity. */
  async enforceInactivityTimeout(): Promise<boolean> {
    const session = this.sessionState();
    if (!session || !this.sessionIsInactive(session.user.id)) return false;
    return this.endInactiveSession(session);
  }

  registerSessionEndHook(hook: () => Promise<void>) {
    this.sessionEndHooks.add(hook);
    return () => this.sessionEndHooks.delete(hook);
  }

  private async initialize() {
    if (!this.connection.configured()) {
      this.errorState.set('This build is missing its Supabase URL or publishable key.');
      this.readyState.set(true);
      return;
    }
    const { data, error } = await this.supabase.auth.getSession();
    await this.applySession(data.session);
    if (error) this.errorState.set(error.message);
    this.readyState.set(true);
  }

  private applySession(session: Session | null, force = false): Promise<void> {
    const key = session?.access_token ?? 'signed-out';
    if (!force && this.sessionApplication?.key === key) return this.sessionApplication.promise;
    const promise = this.applySessionInternal(session);
    const application = { key, promise };
    this.sessionApplication = application;
    void promise.finally(() => {
      if (this.sessionApplication === application) this.sessionApplication = null;
    });
    return promise;
  }

  private async applySessionInternal(session: Session | null) {
    const generation = ++this.sessionGeneration;
    if (!session && this.sessionState()) await this.runSessionEndHooks();
    if (generation !== this.sessionGeneration) return;

    // Supabase can restore and refresh its local token indefinitely. The
    // mobile workspace has its own rolling inactivity boundary, checked
    // before profile, policy, MFA, or workspace data is requested.
    if (session && this.sessionIsInactive(session.user.id)) {
      await this.endInactiveSession(session);
      return;
    }

    const previousUserId = this.sessionState()?.user.id ?? null;
    if (!session) {
      this.sessionState.set(null);
      this.clearAccessState();
      this.errorState.set(this.pendingSignedOutError);
      this.pendingSignedOutError = '';
      this.readyState.set(true);
      return;
    }

    if (previousUserId !== session.user.id) this.clearAccessState();
    this.sessionState.set(session);
    this.errorState.set('');
    this.pendingSignedOutError = '';

    const [profileResult, securityResult] = await Promise.all([
      this.supabase
        .from('profiles')
        .select('id,full_name,email,phone,avatar_url,role,staff_active,created_at')
        .eq('id', session.user.id)
        .single(),
      this.supabase
        .from('admin_security_settings')
        .select('*')
        .eq('id', true)
        .maybeSingle(),
    ]);
    if (!this.validationIsCurrent(generation, session)) return;

    if (profileResult.error || !profileResult.data) {
      const existing = this.profileState();
      if (existing?.id === session.user.id && isAdminRole(existing.role) && existing.staff_active) {
        this.errorState.set('CozyCraft could not revalidate your staff access. Your verified workspace remains open; check the connection and retry.');
        this.readyState.set(true);
        return;
      }
      await this.endRejectedSession(generation, session, 'CozyCraft could not verify this account’s staff access. Check the connection and sign in again.');
      return;
    }

    const profile = profileResult.data as Profile;
    if (!isAdminRole(profile.role)) {
      await this.endRejectedSession(generation, session, 'Customer accounts cannot use the administrator workspace.');
      return;
    }
    if (!profile.staff_active) {
      await this.endRejectedSession(generation, session, 'This administrator account is suspended. Contact a super administrator.');
      return;
    }

    if (!this.validationIsCurrent(generation, session)) return;
    this.profileState.set(profile);
    const security = securityResult.error
      ? defaultAdminSecuritySettings
      : normalizeSecuritySettings(securityResult.data as Partial<AdminSecuritySettings> | null);
    this.securityState.set(security);
    await this.refreshMfaState(generation, session);
    if (this.validationIsCurrent(generation, session)) {
      this.errorState.set(securityResult.error
        ? 'Security policy could not be refreshed, so the strict MFA policy is being used until reconnect.'
        : '');
      this.readyState.set(true);
    }
  }

  async refreshMfaState(generation = this.sessionGeneration, session = this.sessionState()) {
    if (!session) return;
    const [assurance, factors] = await Promise.all([
      this.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      this.supabase.auth.mfa.listFactors(),
    ]);
    if (!this.validationIsCurrent(generation, session)) return;
    const verifiedTotp = factors.data?.totp?.filter((factor) => factor.status === 'verified') ?? [];
    const required = this.securityState().require_admin_mfa;
    this.hasMfaState.set(verifiedTotp.length > 0);
    this.mfaRequiredState.set(required);
    this.mfaSatisfiedState.set(!required || assurance.data?.currentLevel === 'aal2');
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    if (!this.connection.configured()) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }
    this.busyState.set(true);
    this.errorState.set('');
    this.pendingSignedOutError = '';
    this.interactiveSignIn = true;
    let response: Awaited<ReturnType<typeof this.supabase.auth.signInWithPassword>>;
    try {
      response = await this.supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (response.data.session) this.rememberActivityForUser(response.data.session.user.id, true);
    } catch {
      const message = 'CozyCraft could not reach the secure sign-in service. Check your connection and try again.';
      this.busyState.set(false);
      this.errorState.set(message);
      return { ok: false, message };
    } finally {
      this.interactiveSignIn = false;
    }
    const { data, error } = response;
    if (error || !data.session) {
      const message = error?.message || 'Administrator sign in failed.';
      this.busyState.set(false);
      this.errorState.set(message);
      return { ok: false, message };
    }
    await this.applySession(data.session);
    this.busyState.set(false);
    if (this.sessionState()?.user.id !== data.session.user.id || this.profileState()?.id !== data.session.user.id) {
      return { ok: false, message: this.errorState() || 'This account does not have active administrator access.' };
    }
    if (this.mfaRequiredState() && !this.mfaSatisfiedState()) {
      return { ok: true, destination: this.hasMfaState() ? '/auth/mfa' : '/auth/mfa-enroll' };
    }
    return { ok: true, destination: '/app/dashboard' };
  }

  async verifyMfa(code: string): Promise<string | null> {
    const factors = await this.supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp?.find((item) => item.status === 'verified');
    if (!factor) return 'No verified authenticator is attached to this account.';
    const challenge = await this.supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error || !challenge.data) return challenge.error?.message || 'Unable to start MFA verification.';
    const verified = await this.supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    if (verified.error) return verified.error.message;
    const current = await this.supabase.auth.getSession();
    if (current.error || !current.data.session) return current.error?.message || 'The upgraded MFA session could not be loaded.';
    await this.applySession(current.data.session, true);
    return this.mfaSatisfiedState() ? null : 'The verification code was not accepted.';
  }

  async beginTotpEnrollment(): Promise<{ enrollment: TotpEnrollment | null; error: string | null }> {
    const factors = await this.supabase.auth.mfa.listFactors();
    if (factors.error) return { enrollment: null, error: factors.error.message };
    for (const factor of factors.data.all.filter((item) => item.factor_type === 'totp' && item.status === 'unverified')) {
      const removed = await this.supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) return { enrollment: null, error: removed.error.message };
    }

    const result = await this.supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'CozyCraft Admin mobile',
    });
    if (result.error || !result.data) {
      return { enrollment: null, error: result.error?.message || 'Unable to prepare authenticator setup.' };
    }
    return {
      enrollment: {
        id: result.data.id,
        qrCode: result.data.totp.qr_code,
        secret: result.data.totp.secret,
        uri: result.data.totp.uri,
      },
      error: null,
    };
  }

  async verifyTotpEnrollment(factorId: string, code: string): Promise<string | null> {
    const challenge = await this.supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) return challenge.error?.message || 'Unable to verify this authenticator.';
    const result = await this.supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    if (result.error) return result.error.message;
    const current = await this.supabase.auth.getSession();
    if (current.error || !current.data.session) return current.error?.message || 'The enrolled MFA session could not be loaded.';
    await this.applySession(current.data.session, true);
    return this.mfaSatisfiedState() ? null : 'The authenticator was enrolled, but its upgraded session could not be verified.';
  }

  async resetPassword(email: string): Promise<string | null> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: 'https://www.cozycraftfurnitures.com/reset-password',
    });
    return error?.message ?? null;
  }

  async signOut() {
    this.busyState.set(true);
    const userId = this.sessionState()?.user.id ?? '';
    await this.runSessionEndHooks();
    ++this.sessionGeneration;
    this.pendingSignedOutError = '';
    this.sessionState.set(null);
    this.clearAccessState();
    this.errorState.set('');
    if (userId) this.clearStoredActivity(userId);
    await this.supabase.auth.signOut({ scope: 'local' });
    this.readyState.set(true);
    this.busyState.set(false);
  }

  private validationIsCurrent(generation: number, session: Session) {
    return generation === this.sessionGeneration
      && this.sessionState()?.user.id === session.user.id
      && this.sessionState()?.access_token === session.access_token;
  }

  private async endRejectedSession(generation: number, session: Session, message: string) {
    await this.runSessionEndHooks();
    if (!this.validationIsCurrent(generation, session)) return;
    ++this.sessionGeneration;
    this.pendingSignedOutError = message;
    this.sessionState.set(null);
    this.clearAccessState();
    this.errorState.set(message);
    this.readyState.set(true);
    this.clearStoredActivity(session.user.id);
    await this.supabase.auth.signOut({ scope: 'local' });
  }

  private sessionIsInactive(userId: string, now = Date.now()) {
    const lastActiveAt = this.readActivityForUser(userId);
    if (!lastActiveAt) {
      // Existing installations have no timestamp until this version runs.
      // Begin their rolling window now instead of unexpectedly signing out a
      // currently valid administrator during the upgrade.
      this.rememberActivityForUser(userId, true, now);
      return false;
    }
    // A device-clock correction into the future must not create an unlimited
    // session. Reset the marker to the corrected current time.
    if (lastActiveAt > now + 5 * 60_000) {
      this.rememberActivityForUser(userId, true, now);
      return false;
    }
    return now - lastActiveAt >= AdminAuthService.INACTIVITY_LIMIT_MS;
  }

  private rememberActivityForUser(userId: string, forcePersist = false, now = Date.now()) {
    if (!userId) return;
    if (this.activityUserId !== userId) {
      this.activityUserId = userId;
      this.lastActivityAt = 0;
      this.lastPersistedActivityAt = 0;
    }
    this.lastActivityAt = now;
    if (!forcePersist
      && now - this.lastPersistedActivityAt < AdminAuthService.ACTIVITY_PERSIST_INTERVAL_MS) return;
    localStorage.setItem(this.activityStorageKey(userId), String(now));
    this.lastPersistedActivityAt = now;
  }

  private readActivityForUser(userId: string) {
    if (this.activityUserId === userId && this.lastActivityAt > 0) return this.lastActivityAt;
    const stored = Number(localStorage.getItem(this.activityStorageKey(userId)) ?? 0);
    this.activityUserId = userId;
    this.lastActivityAt = Number.isFinite(stored) && stored > 0 ? stored : 0;
    this.lastPersistedActivityAt = this.lastActivityAt;
    return this.lastActivityAt;
  }

  private clearStoredActivity(userId: string) {
    localStorage.removeItem(this.activityStorageKey(userId));
    if (this.activityUserId !== userId) return;
    this.activityUserId = '';
    this.lastActivityAt = 0;
    this.lastPersistedActivityAt = 0;
  }

  private activityStorageKey(userId: string) {
    return `${AdminAuthService.ACTIVITY_STORAGE_PREFIX}${userId}`;
  }

  private endInactiveSession(session: Session): Promise<boolean> {
    if (this.inactivityEndPromise) return this.inactivityEndPromise;
    const expiration = this.endInactiveSessionInternal(session)
      .finally(() => {
        if (this.inactivityEndPromise === expiration) this.inactivityEndPromise = null;
      });
    this.inactivityEndPromise = expiration;
    return expiration;
  }

  private async endInactiveSessionInternal(session: Session) {
    const userId = session.user.id;
    const currentUserId = this.sessionState()?.user.id;
    if (currentUserId && currentUserId !== userId) return false;

    // Expose the user id while end hooks run so this device can revoke its
    // push token for the correct administrator before local auth is cleared.
    if (!currentUserId) this.sessionState.set(session);
    await this.runSessionEndHooks();
    if (this.sessionState()?.user.id !== userId) return false;

    ++this.sessionGeneration;
    const message = 'Your session ended after seven days without activity. Sign in again to continue securely.';
    this.pendingSignedOutError = message;
    this.sessionState.set(null);
    this.clearAccessState();
    this.errorState.set(message);
    this.readyState.set(true);
    this.clearStoredActivity(userId);
    await this.supabase.auth.signOut({ scope: 'local' });
    return true;
  }

  private clearAccessState() {
    this.profileState.set(null);
    this.securityState.set(defaultAdminSecuritySettings);
    this.mfaRequiredState.set(false);
    this.hasMfaState.set(false);
    this.mfaSatisfiedState.set(false);
  }

  private runSessionEndHooks() {
    if (this.sessionEndPromise) return this.sessionEndPromise;
    this.sessionEndPromise = Promise.allSettled([...this.sessionEndHooks].map((hook) => hook()))
      .then(() => undefined)
      .finally(() => { this.sessionEndPromise = null; });
    return this.sessionEndPromise;
  }
}
