import { Injectable, signal } from '@angular/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment.generated';

const mobileStoragePrefix = 'cozycraft_admin_';
let secureStoragePreparation: Promise<void> | null = null;

const prepareSecureStorage = () => {
  if (secureStoragePreparation) return secureStoragePreparation;
  secureStoragePreparation = (async () => {
    // The plugin's options are process-wide. Apply them in order so the first
    // auth read cannot race the key prefix/access configuration.
    await SecureStorage.setKeyPrefix(mobileStoragePrefix);
    if (Capacitor.getPlatform() === 'ios') {
      await SecureStorage.setSynchronize(false);
      await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenPasscodeSetThisDeviceOnly);
    }
  })();
  return secureStoragePreparation;
};

const normalizeLegacySecureString = async (key: string, value: string) => {
  // One development build wrote Supabase's already-serialized string through
  // the JSON-oriented `set` API. Repair that value silently and permanently.
  if (!value.startsWith('"')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'string') return value;
    await SecureStorage.setItem(key, parsed);
    return parsed;
  } catch {
    return value;
  }
};

const nativeAuthStorage = {
  async getItem(key: string) {
    await prepareSecureStorage();
    const protectedValue = await SecureStorage.getItem(key);
    if (protectedValue !== null) return normalizeLegacySecureString(key, protectedValue);

    // One-time migration for builds that previously used the WebView store.
    const legacyValue = localStorage.getItem(key);
    if (legacyValue !== null) {
      await SecureStorage.setItem(key, legacyValue);
      localStorage.removeItem(key);
    }
    return legacyValue;
  },
  async setItem(key: string, value: string) {
    await prepareSecureStorage();
    // Supabase supplies an opaque serialized string, so use the StorageLike
    // API. Using `set` would JSON-encode it a second time.
    await SecureStorage.setItem(key, value);
    localStorage.removeItem(key);
  },
  async removeItem(key: string) {
    await prepareSecureStorage();
    await SecureStorage.removeItem(key);
    localStorage.removeItem(key);
  },
};

@Injectable({ providedIn: 'root' })
export class SupabaseAdminService {
  readonly configured = signal(Boolean(environment.supabaseUrl && environment.supabasePublishableKey));

  readonly client: SupabaseClient = createClient(
    environment.supabaseUrl || 'https://configuration-required.supabase.co',
    environment.supabasePublishableKey || 'configuration-required',
    {
      global: {
        headers: {
          'x-cozycraft-platform': 'mobile',
        },
      },
      auth: {
        storageKey: 'cozycraft-admin-mobile-auth',
        storage: Capacitor.isNativePlatform() ? nativeAuthStorage : localStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 12,
        },
      },
    },
  );

  /**
   * Invoke a protected Edge Function from web or either native shell.
   *
   * Native WebViews enforce browser CORS even though the request originates
   * from an installed app. Some existing CozyCraft functions intentionally
   * allow only storefront origins, so native requests use Capacitor's HTTP
   * bridge while retaining the same publishable key and user JWT checks.
   */
  async invokeAuthenticatedFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
    if (!this.configured()) throw new Error('This build is missing its Supabase connection settings.');

    if (!Capacitor.isNativePlatform()) {
      const { data, error } = await this.client.functions.invoke(name, { body });
      if (!error) return data as T;
      const context = (error as { context?: Response }).context;
      const payload = context instanceof Response
        ? await context.clone().json().catch(() => null) as { error?: string; message?: string } | null
        : null;
      throw new Error(payload?.error ?? payload?.message ?? error.message ?? 'The secure service could not complete the request.');
    }

    const sessionResult = await this.client.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session?.access_token) {
      throw new Error('Your admin session expired. Sign in again.');
    }

    let accessToken = sessionResult.data.session.access_token;
    const expiresAt = sessionResult.data.session.expires_at ?? 0;
    if (expiresAt && expiresAt * 1000 < Date.now() + 60_000) {
      const refreshed = await this.client.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session?.access_token) {
        throw new Error('Your admin session expired. Sign in again.');
      }
      accessToken = refreshed.data.session.access_token;
    }

    try {
      const response = await CapacitorHttp.post({
        url: `${environment.supabaseUrl.replace(/\/$/, '')}/functions/v1/${encodeURIComponent(name)}`,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: environment.supabasePublishableKey,
          'Content-Type': 'application/json',
          'x-client-info': 'cozycraft-admin-mobile/1.0',
          'x-cozycraft-platform': 'mobile',
        },
        data: body,
        connectTimeout: 15_000,
        readTimeout: 30_000,
      });
      const payload = this.parseFunctionPayload(response.data);
      if (response.status < 200 || response.status >= 300) {
        const message = payload && typeof payload === 'object'
          ? String((payload as { error?: unknown; message?: unknown }).error
            ?? (payload as { message?: unknown }).message
            ?? '')
          : '';
        throw new Error(message || `The secure service returned status ${response.status}.`);
      }
      return payload as T;
    } catch (error: unknown) {
      if (error instanceof Error && !/failed to (send|connect)|network|offline/i.test(error.message)) throw error;
      throw new Error('The secure service could not be reached. Check your connection and try again.');
    }
  }

  private parseFunctionPayload(value: unknown) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value) as unknown; } catch { return value; }
  }
}
