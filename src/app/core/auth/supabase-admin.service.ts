import { Injectable, signal } from '@angular/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';
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
}
