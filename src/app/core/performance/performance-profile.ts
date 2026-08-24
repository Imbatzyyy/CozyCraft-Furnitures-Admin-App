import { Capacitor } from '@capacitor/core';

interface NavigatorPerformanceHints extends Navigator {
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
}

const navigatorHints = navigator as NavigatorPerformanceHints;
const platform = Capacitor.getPlatform();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
const memory = Number(navigatorHints.deviceMemory ?? 0);
const cores = Number(navigatorHints.hardwareConcurrency ?? 0);
const connectionType = navigatorHints.connection?.effectiveType ?? '';
const saveData = Boolean(navigatorHints.connection?.saveData);
const iphoneShortEdge = Math.min(window.screen.width, window.screen.height);
const iphoneLongEdge = Math.max(window.screen.width, window.screen.height);
// Safari/WKWebView does not expose deviceMemory. Older iPhones are therefore
// recognized from their coarse display class instead: compact screens through
// 844pt, plus the 2x 414×896 class used by iPhone XR/11. Newer 3x displays keep
// the complete premium rendering path.
const legacyIphoneDisplay = platform === 'ios'
  && iphoneShortEdge <= 430
  && (iphoneLongEdge <= 844 || window.devicePixelRatio <= 2);

/**
 * A conservative, browser-safe device profile. No unique device identifier is
 * collected or persisted; the profile only selects a lighter local rendering
 * path for devices that advertise limited CPU, memory, data, or accessibility
 * preferences.
 */
export const appPerformanceProfile = Object.freeze({
  constrained: reducedMotion
    || reducedTransparency
    || saveData
    || (memory > 0 && memory <= 4)
    || (cores > 0 && cores <= 4)
    || ['slow-2g', '2g'].includes(connectionType)
    || legacyIphoneDisplay,
  reducedMotion,
  reducedTransparency,
  saveData,
});

export function applyPerformanceProfile() {
  const root = document.documentElement;
  root.classList.toggle('cc-performance-lite', appPerformanceProfile.constrained);
  root.classList.toggle('cc-performance-standard', !appPerformanceProfile.constrained);
  root.dataset['performance'] = appPerformanceProfile.constrained ? 'lite' : 'standard';
}
