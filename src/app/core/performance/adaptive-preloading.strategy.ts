import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { appPerformanceProfile } from './performance-profile';

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

@Injectable({ providedIn: 'root' })
export class AdaptivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data?.['preload'] || appPerformanceProfile.constrained) return of(null);

    const delay = Math.max(400, Number(route.data['preloadDelay'] ?? 1_200));
    return new Observable((subscriber) => {
      const idleWindow = window as IdleWindow;
      let source: Subscription | null = null;
      let idleHandle: number | null = null;
      let fallbackHandle: number | null = null;
      let cancelled = false;

      const begin = () => {
        if (cancelled) return;
        source = load().pipe(catchError(() => of(null))).subscribe(subscriber);
      };
      const scheduleIdle = () => {
        if (cancelled) return;
        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(begin, { timeout: 4_000 });
        } else {
          fallbackHandle = window.setTimeout(begin, 220);
        }
      };
      const delayHandle = window.setTimeout(scheduleIdle, delay);

      return () => {
        cancelled = true;
        window.clearTimeout(delayHandle);
        if (fallbackHandle !== null) window.clearTimeout(fallbackHandle);
        if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
        source?.unsubscribe();
      };
    });
  }
}
