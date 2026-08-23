import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cozycraft.admin',
  appName: 'CozyCraft Admin',
  webDir: 'www/browser',
  backgroundColor: '#f7f5f0',
  android: {
    backgroundColor: '#f7f5f0',
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#f7f5f0',
    // CSS owns safe-area spacing; UIKit must not apply a second inset.
    contentInset: 'never',
  },
  plugins: {
    Keyboard: {
      // Resizing the Ionic host keeps iOS hit-testing aligned after input closes.
      resize: 'ionic',
      style: 'light',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
  },
};

export default config;
