import { bootstrapApplication } from '@angular/platform-browser';
import { Capacitor } from '@capacitor/core';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { registerAppIcons } from './app/core/icons/app-icons';
import { applyPerformanceProfile } from './app/core/performance/performance-profile';

// Register the curated application glyphs instead of importing the complete
// Ionicons catalog, which forced low-memory phones to parse icons for pages
// they may never open.
registerAppIcons();
applyPerformanceProfile();

// Mark every native iOS WebView before Angular renders. Some WKWebView user
// agents do not expose the marketing OS version consistently, so the stable
// platform class controls the glass-capable navigation treatment. Keep the
// major-version class as useful progressive-enhancement metadata.
const nativePlatform = Capacitor.getPlatform();

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('cc-native-app');
}

if (nativePlatform === 'ios') {
  document.documentElement.classList.add('cc-ios-glass');
  const iosVersion = navigator.userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)[._]/i);
  if (Number(iosVersion?.[1] ?? 0) >= 26) document.documentElement.classList.add('cc-ios-26');
}

// Ionic intentionally renders the shared design in iOS mode on every device,
// so its `.ios` class cannot tell our layout which native inset model is in
// use. Android already reduces the WebView's visible viewport above both the
// three-button navigation bar and the gesture-navigation area. This explicit
// class lets the floating pill use that adjusted viewport without applying
// the iPhone home-indicator inset a second time.
if (nativePlatform === 'android') {
  document.documentElement.classList.add('cc-android-native');
}

bootstrapApplication(AppComponent, appConfig).catch((error) => console.error(error));
