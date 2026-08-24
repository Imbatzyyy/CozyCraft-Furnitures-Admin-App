import { ApplicationConfig, ErrorHandler } from '@angular/core';
import { provideAnimations, provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { RouteReuseStrategy } from '@angular/router';
import { appRoutes } from './app.routes';
import { AdaptivePreloadingStrategy } from './core/performance/adaptive-preloading.strategy';
import { appPerformanceProfile } from './core/performance/performance-profile';
import { CozyErrorHandler } from './core/utils/cozy-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: ErrorHandler, useClass: CozyErrorHandler },
    provideIonicAngular({
      mode: 'ios',
      animated: !appPerformanceProfile.constrained,
      rippleEffect: false,
      swipeBackEnabled: true,
    }),
    appPerformanceProfile.constrained ? provideNoopAnimations() : provideAnimations(),
    provideRouter(
      appRoutes,
      withPreloading(AdaptivePreloadingStrategy),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
  ],
};
