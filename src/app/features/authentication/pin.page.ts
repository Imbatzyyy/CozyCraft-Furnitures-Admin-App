import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner, IonToggle } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AppLockService } from '../../core/auth/app-lock.service';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { safeAdminReturnUrl } from '../../core/utils/admin-permissions';
import { CozyToastService } from '../../shared/components/toast.service';

@Component({
  selector: 'cc-pin-page',
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonContent, IonIcon, IonSpinner, IonToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-content [fullscreen]="true" class="auth-content">
      <main class="pin-shell">
        <section class="pin-stage">
          <header class="auth-brand pin-brand">
            <img class="auth-brand__logo" src="assets/branding/cozycraft-wordmark.png" alt="CozyCraft Furniture" />
            <span class="auth-brand__access"><i></i> Protected</span>
          </header>

          <section class="pin-card" [class.pin-card--shake]="shake()">
            <div class="pin-card__topline">
              <span class="pin-emblem">
                <ion-icon [name]="setup() ? 'keypad-outline' : biometricIcon()"></ion-icon>
              </span>
              <span class="pin-step">{{ setup() ? 'FIRST-TIME SETUP' : 'PRIVATE SESSION' }}</span>
            </div>

            @if (lock.phase() === 'checking') {
              <div class="pin-loading" role="status">
                <ion-spinner name="crescent"></ion-spinner>
                <span><b>Preparing secure access</b><small>Checking this administrator account…</small></span>
              </div>
            } @else if (lock.phase() === 'error') {
              <div class="pin-state pin-state--error">
                <ion-icon name="cloud-offline-outline"></ion-icon>
                <h1>Security check unavailable.</h1>
                <p>{{ lock.error() }}</p>
                <ion-button expand="block" class="cc-primary-button" [disabled]="working()" (click)="retry()">
                  @if (working()) { <ion-spinner name="crescent"></ion-spinner> } @else { Try again }
                </ion-button>
                <button type="button" class="pin-text-action" (click)="signOut()">Use another account</button>
              </div>
            } @else {
              <div class="pin-copy">
                <p class="cc-eyebrow">{{ setup() ? 'YOUR ACCOUNT PIN' : 'WELCOME BACK' }}</p>
                <h1>{{ setup() ? 'Create your app PIN.' : 'Unlock your workspace.' }}</h1>
                <p>
                  @if (setup()) {
                    This six-digit PIN belongs to your admin account, so it stays the same when you sign in on another device.
                  } @else {
                    {{ lock.biometricEnabled() ? 'Use ' + lock.biometricLabel() + ' or enter' : 'Enter' }} the six-digit PIN for {{ auth.displayName() }}.
                  }
                </p>
              </div>

              @if (!setup() && lock.biometricEnabled() && lock.biometricAvailable()) {
                <button type="button" class="biometric-action" [disabled]="lock.biometricBusy() || working()" (click)="authenticateBiometric()">
                  <span><ion-icon [name]="biometricIcon()"></ion-icon></span>
                  <span><b>Continue with {{ lock.biometricLabel() }}</b><small>Protected by this device</small></span>
                  @if (lock.biometricBusy()) { <ion-spinner name="crescent"></ion-spinner> }
                  @else { <ion-icon name="arrow-forward-outline"></ion-icon> }
                </button>
                <div class="pin-divider"><i></i><span>or use your PIN</span><i></i></div>
              }

              <form class="pin-form" (submit)="handleSubmit($event)" novalidate>
                <label class="pin-field">
                  <span>{{ setup() ? 'New six-digit PIN' : 'Six-digit PIN' }}</span>
                  <div class="pin-digits" [class.pin-digits--invalid]="error() !== ''">
                    @for (slot of slots; track slot) {
                      <i [class.is-filled]="pin.value.length > slot" [class.is-active]="pin.value.length === slot && focused()">
                        @if (pin.value.length > slot) { <b></b> }
                      </i>
                    }
                    <input
                      #primaryPin
                      [formControl]="pin"
                      type="password"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      maxlength="6"
                      [attr.autocomplete]="setup() ? 'new-password' : 'current-password'"
                      [attr.aria-label]="setup() ? 'New six-digit PIN' : 'Six-digit PIN'"
                      (input)="normalize(pin)"
                      (focus)="focused.set(true)"
                      (blur)="focused.set(false)"
                    />
                  </div>
                </label>

                @if (setup()) {
                  <label class="pin-field">
                    <span>Confirm PIN</span>
                    <div class="pin-digits" [class.pin-digits--invalid]="confirmTouched() && pin.value !== confirmation.value">
                      @for (slot of slots; track slot) {
                        <i [class.is-filled]="confirmation.value.length > slot">
                          @if (confirmation.value.length > slot) { <b></b> }
                        </i>
                      }
                      <input
                        [formControl]="confirmation"
                        type="password"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        maxlength="6"
                        autocomplete="new-password"
                        aria-label="Confirm six-digit PIN"
                        (input)="normalize(confirmation); confirmTouched.set(true)"
                        (blur)="confirmTouched.set(true)"
                      />
                    </div>
                  </label>
                  <p class="pin-guidance"><ion-icon name="shield-checkmark-outline"></ion-icon> Avoid repeated or sequential numbers. Your PIN is stored only as a protected one-way hash.</p>
                }

                @if (lock.biometricAvailable() && (setup() || !lock.biometricEnabled())) {
                  <label class="biometric-option">
                    <span class="biometric-option__icon"><ion-icon [name]="biometricIcon()"></ion-icon></span>
                    <span><b>Use {{ lock.biometricLabel() }}</b><small>Enable only for this device after the PIN is verified.</small></span>
                    <ion-toggle
                      [checked]="enableBiometrics()"
                      [attr.aria-label]="'Enable ' + lock.biometricLabel() + ' on this device'"
                      (ionChange)="enableBiometrics.set($event.detail.checked)"
                    ></ion-toggle>
                  </label>
                } @else if (setup()) {
                  <aside class="biometric-unavailable">
                    <ion-icon name="phone-portrait-outline"></ion-icon>
                    <span><b>Biometrics can be added later</b><small>Enroll Face ID, Touch ID, or fingerprint in device settings first.</small></span>
                  </aside>
                }

                @if (error()) {
                  <div class="cc-notice cc-notice--danger pin-error" role="alert">
                    <ion-icon name="alert-circle-outline"></ion-icon><span>{{ error() }}</span>
                  </div>
                }

                <ion-button
                  type="submit"
                  expand="block"
                  class="cc-primary-button pin-submit"
                  [disabled]="working() || lock.biometricBusy() || pin.invalid || (setup() && confirmation.invalid)"
                >
                  @if (working()) { <ion-spinner name="crescent"></ion-spinner><span>{{ setup() ? 'Creating PIN…' : 'Verifying…' }}</span> }
                  @else {
                    <span>{{ setup() ? 'Create secure PIN' : 'Unlock workspace' }}</span>
                    <ion-icon slot="end" name="arrow-forward-outline"></ion-icon>
                  }
                </ion-button>
              </form>

              <footer class="pin-card__footer">
                <span><ion-icon name="lock-closed-outline"></ion-icon> Encrypted verification</span>
                <button type="button" (click)="signOut()">Use another account</button>
              </footer>
            }
          </section>

          <footer class="pin-stage__footer">
            <span><ion-icon name="shield-checkmark-outline"></ion-icon></span>
            <p><b>Private by design.</b><small>Biometric data never leaves this device. CozyCraft never receives your face or fingerprint.</small></p>
          </footer>
        </section>
      </main>
    </ion-content>
  `,
  styleUrl: './auth.scss',
})
export class PinPage implements AfterViewInit, OnDestroy {
  @ViewChild('primaryPin') private primaryPin?: ElementRef<HTMLInputElement>;

  readonly slots = [0, 1, 2, 3, 4, 5];
  readonly setup = signal(this.router.url.startsWith('/auth/pin-setup'));
  readonly working = signal(false);
  readonly focused = signal(false);
  readonly confirmTouched = signal(false);
  readonly enableBiometrics = signal(this.lock.biometricAvailable());
  readonly error = signal('');
  readonly shake = signal(false);
  readonly pin = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{6}$/)] });
  readonly confirmation = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{6}$/)] });

  constructor(
    readonly auth: AdminAuthService,
    readonly lock: AppLockService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly native: NativePlatformService,
    private readonly toast: CozyToastService,
  ) {}

  ngAfterViewInit() {
    if (!this.setup() && this.lock.biometricEnabled() && this.lock.biometricAvailable()) {
      setTimeout(() => void this.authenticateBiometric(), 220);
      return;
    }
    setTimeout(() => this.focusPin(), 120);
  }

  normalize(control: FormControl<string>) {
    const normalized = control.value.replace(/\D/g, '').slice(0, 6);
    if (normalized !== control.value) control.setValue(normalized, { emitEvent: false });
    this.error.set('');
  }

  handleSubmit(event: Event) {
    // This is a native form submit. Prevent the WebView from reloading the
    // current auth URL before the asynchronous PIN RPC can complete.
    event.preventDefault();
    void this.submit();
  }

  async submit() {
    if (this.working() || this.lock.biometricBusy()) return;
    if (this.pin.invalid || (this.setup() && this.confirmation.invalid)) {
      this.fail('Enter all six digits.');
      return;
    }
    if (this.setup() && this.pin.value !== this.confirmation.value) {
      this.confirmTouched.set(true);
      this.fail('The two PIN entries do not match.');
      this.confirmation.setValue('');
      return;
    }

    this.working.set(true);
    const result = this.setup()
      ? await this.lock.createPin(this.pin.value)
      : await this.lock.verifyPin(this.pin.value);
    if (!result.ok) {
      this.working.set(false);
      this.pin.setValue('');
      this.confirmation.setValue('');
      if (this.setup() && !this.lock.needsSetup()) {
        const returnUrl = safeAdminReturnUrl(this.auth.role(), this.route.snapshot.queryParamMap.get('returnUrl'));
        await this.router.navigate(['/auth/unlock'], { queryParams: { returnUrl }, replaceUrl: true });
        await this.toast.show(result.message, 'neutral');
        return;
      }
      this.fail(result.message);
      this.focusPin();
      return;
    }

    if (this.enableBiometrics() && this.lock.biometricAvailable() && !this.lock.biometricEnabled()) {
      const biometric = await this.lock.enableBiometrics();
      await this.toast.show(biometric.message, biometric.ok ? 'success' : 'neutral');
    }
    this.working.set(false);
    await this.native.success();
    await this.continueToWorkspace();
  }

  async authenticateBiometric() {
    if (this.working() || this.lock.biometricBusy()) return;
    this.error.set('');
    const result = await this.lock.authenticateWithBiometrics();
    if (!result.ok) {
      this.fail(result.message, false);
      this.focusPin();
      return;
    }
    await this.native.success();
    await this.continueToWorkspace();
  }

  async retry() {
    if (this.working()) return;
    this.working.set(true);
    await this.lock.ensureForCurrentSession(true);
    this.working.set(false);
    if (this.lock.needsSetup() !== this.setup()) {
      await this.router.navigateByUrl(this.lock.needsSetup() ? '/auth/pin-setup' : '/auth/unlock', { replaceUrl: true });
    }
  }

  async signOut() {
    if (this.working()) return;
    this.working.set(true);
    await this.native.unregisterPushNotifications();
    await this.auth.signOut();
    this.working.set(false);
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  biometricIcon() {
    return this.lock.biometricLabel() === 'Face ID' ? 'scan-outline' : 'finger-print-outline';
  }

  private async continueToWorkspace() {
    const returnUrl = safeAdminReturnUrl(this.auth.role(), this.route.snapshot.queryParamMap.get('returnUrl'));
    await this.native.releaseInputFocus();
    await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
  }

  private focusPin() {
    this.primaryPin?.nativeElement.focus({ preventScroll: true });
  }

  ngOnDestroy() {
    // Synchronous fallback for every route exit, including sign-out and guard
    // redirects that do not pass through continueToWorkspace().
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
  }

  private fail(message: string, animate = true) {
    this.error.set(message);
    void this.native.warning();
    if (!animate) return;
    this.shake.set(false);
    requestAnimationFrame(() => {
      this.shake.set(true);
      setTimeout(() => this.shake.set(false), 420);
    });
  }
}
