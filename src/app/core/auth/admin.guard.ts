import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AdminAuthService } from './admin-auth.service';
import { AppLockService } from './app-lock.service';
import { canAccessRoute } from '../utils/admin-permissions';

export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AdminAuthService);
  const appLock = inject(AppLockService);
  const router = inject(Router);

  // Tab changes happen entirely inside an already verified workspace. Keep
  // their critical path synchronous so a tap can commit in the same frame.
  // Lock, MFA, role, and session signals are updated synchronously by their
  // services, so this does not weaken any of the checks below.
  if (auth.ready()
    && auth.signedIn()
    && (!auth.mfaRequired() || auth.mfaSatisfied())
    && appLock.unlocked()
    && canAccessRoute(auth.role(), state.url)) {
    return true;
  }

  return (async () => {
    await auth.ensureInitialized();
    if (!auth.signedIn()) return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
    if (auth.mfaRequired() && !auth.mfaSatisfied()) {
      return router.createUrlTree([auth.hasVerifiedMfa() ? '/auth/mfa' : '/auth/mfa-enroll'], { queryParams: { returnUrl: state.url } });
    }
    await appLock.ensureForCurrentSession();
    if (appLock.needsSetup()) return router.createUrlTree(['/auth/pin-setup'], { queryParams: { returnUrl: state.url } });
    if (!appLock.unlocked()) return router.createUrlTree(['/auth/unlock'], { queryParams: { returnUrl: state.url } });
    if (!canAccessRoute(auth.role(), state.url)) return router.createUrlTree(['/app/dashboard']);
    return true;
  })();
};

export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AdminAuthService);
  const appLock = inject(AppLockService);
  const router = inject(Router);
  await auth.ensureInitialized();
  if (!auth.signedIn()) return true;
  if (auth.mfaRequired() && !auth.mfaSatisfied()) {
    return router.createUrlTree([auth.hasVerifiedMfa() ? '/auth/mfa' : '/auth/mfa-enroll']);
  }
  await appLock.ensureForCurrentSession();
  if (appLock.needsSetup()) return router.createUrlTree(['/auth/pin-setup']);
  if (!appLock.unlocked()) return router.createUrlTree(['/auth/unlock']);
  return router.createUrlTree(['/app/dashboard']);
};

export const mfaGuard: CanActivateFn = async () => {
  const auth = inject(AdminAuthService);
  const router = inject(Router);
  await auth.ensureInitialized();
  if (!auth.signedIn()) return router.createUrlTree(['/auth/login']);
  if (!auth.mfaRequired() || auth.mfaSatisfied()) return router.createUrlTree(['/app/dashboard']);
  return true;
};

export const pinSetupGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AdminAuthService);
  const appLock = inject(AppLockService);
  const router = inject(Router);
  await auth.ensureInitialized();
  if (!auth.signedIn()) return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
  if (auth.mfaRequired() && !auth.mfaSatisfied()) {
    return router.createUrlTree([auth.hasVerifiedMfa() ? '/auth/mfa' : '/auth/mfa-enroll'], { queryParams: { returnUrl: state.url } });
  }
  await appLock.ensureForCurrentSession();
  if (appLock.needsSetup()) return true;
  if (!appLock.unlocked()) return router.createUrlTree(['/auth/unlock'], { queryParams: { returnUrl: state.url } });
  return router.createUrlTree(['/app/dashboard']);
};

export const appUnlockGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AdminAuthService);
  const appLock = inject(AppLockService);
  const router = inject(Router);
  await auth.ensureInitialized();
  if (!auth.signedIn()) return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
  if (auth.mfaRequired() && !auth.mfaSatisfied()) {
    return router.createUrlTree([auth.hasVerifiedMfa() ? '/auth/mfa' : '/auth/mfa-enroll'], { queryParams: { returnUrl: state.url } });
  }
  await appLock.ensureForCurrentSession();
  if (appLock.needsSetup()) return router.createUrlTree(['/auth/pin-setup'], { queryParams: { returnUrl: state.url } });
  return appLock.unlocked() ? router.createUrlTree(['/app/dashboard']) : true;
};
