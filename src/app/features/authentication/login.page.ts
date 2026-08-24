import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonSpinner,
} from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { ConnectivityService } from '../../core/native/connectivity.service';
import { safeAdminReturnUrl } from '../../core/utils/admin-permissions';

@Component({
  selector: 'cc-login-page',
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonContent, IonIcon, IonInput, IonSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-content [fullscreen]="true" class="auth-content">
      <main class="auth-shell">
        <section class="auth-stage">
          <header class="auth-brand">
            <img class="auth-brand__logo" src="assets/branding/cozycraft-wordmark.png" alt="CozyCraft Furniture" />
            <span class="auth-brand__access"><i></i> Admin access</span>
          </header>

          <div class="auth-intro">
            <div class="auth-intro__eyebrow">
              <span><ion-icon name="lock-closed-outline"></ion-icon></span>
              <p><b>Private workspace</b><small>Approved staff only</small></p>
            </div>
            <h1>Welcome back.</h1>
            <p>Sign in to continue to CozyCraft operations.</p>
          </div>

          <form class="auth-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="auth-form__heading">
              <div>
                <p class="cc-eyebrow">SECURE SIGN IN</p>
                <h2>Your credentials</h2>
              </div>
              <span class="auth-form__shield" aria-hidden="true"><ion-icon name="shield-checkmark-outline"></ion-icon></span>
            </div>

            @if (!auth.configured()) {
              <div class="cc-notice cc-notice--warning">
                <ion-icon name="construct-outline"></ion-icon>
                <span>This build needs the Supabase URL and publishable key before it can connect.</span>
              </div>
            }

            @if (connectivity.offline()) {
              <div class="cc-notice cc-notice--danger auth-network-notice" role="alert">
                <ion-icon name="cloud-offline-outline"></ion-icon>
                <span><b>No internet connection</b><small>Sign-in needs a connection to verify your administrator account.</small></span>
                <button type="button" (click)="connectivity.retry()" [disabled]="connectivity.checking()">{{ connectivity.checking() ? 'Checking' : 'Retry' }}</button>
              </div>
            } @else if (connectivity.unstable()) {
              <div class="cc-notice cc-notice--warning auth-network-notice" role="status">
                <ion-icon name="warning-outline"></ion-icon>
                <span><b>Connection is unstable</b><small>You can continue, but secure verification may take longer.</small></span>
                <button type="button" (click)="connectivity.retry()" [disabled]="connectivity.checking()">{{ connectivity.checking() ? 'Checking' : 'Retry' }}</button>
              </div>
            }

            <label class="auth-field">
              <span>Work email</span>
              <div class="auth-input" [class.auth-input--invalid]="form.controls.email.invalid && (form.controls.email.dirty || form.controls.email.touched || submitted())">
                <ion-icon name="mail-outline" aria-hidden="true"></ion-icon>
                <ion-input
                  type="email"
                  inputmode="email"
                  enterkeyhint="next"
                  autocomplete="username"
                  autocapitalize="off"
                  [spellcheck]="false"
                  aria-label="Work email"
                  placeholder="name&#64;cozycraft.com"
                  formControlName="email"
                  [clearInput]="true"
                  (ionInput)="clearError()"
                ></ion-input>
              </div>
              @if (form.controls.email.invalid && (form.controls.email.dirty || form.controls.email.touched || submitted())) {
                <small class="auth-field__error" role="alert">Enter a valid work email address.</small>
              }
            </label>

            <label class="auth-field">
              <span>Password</span>
              <div class="auth-input auth-input--password" [class.auth-input--invalid]="form.controls.password.invalid && (form.controls.password.dirty || form.controls.password.touched || submitted())">
                <ion-icon name="key-outline" aria-hidden="true"></ion-icon>
                <ion-input
                  [type]="passwordVisible() ? 'text' : 'password'"
                  enterkeyhint="go"
                  autocomplete="current-password"
                  aria-label="Password"
                  placeholder="Enter your password"
                  formControlName="password"
                  (ionInput)="clearError()"
                ></ion-input>
                <button type="button" class="auth-password__toggle" (click)="passwordVisible.set(!passwordVisible())" [attr.aria-label]="passwordVisible() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="passwordVisible()">
                  <ion-icon [name]="passwordVisible() ? 'eye-off-outline' : 'eye-outline'"></ion-icon>
                </button>
              </div>
              @if (form.controls.password.invalid && (form.controls.password.dirty || form.controls.password.touched || submitted())) {
                <small class="auth-field__error" role="alert">Password must contain at least 8 characters.</small>
              }
            </label>

            <div class="auth-options">
              <span><ion-icon name="lock-closed-outline"></ion-icon> Encrypted sign in</span>
            </div>

            @if (error() || auth.error()) {
              <div class="cc-notice cc-notice--danger" role="alert">
                <ion-icon name="alert-circle-outline"></ion-icon><span>{{ error() || auth.error() }}</span>
              </div>
            }

            <ion-button type="submit" expand="block" class="cc-primary-button auth-submit" [disabled]="form.invalid || auth.busy() || !auth.configured() || connectivity.offline()">
              @if (auth.busy()) { <ion-spinner name="crescent"></ion-spinner><span>Verifying access…</span> }
              @else { <span>Continue securely</span><ion-icon slot="end" name="arrow-forward-outline"></ion-icon> }
            </ion-button>
          </form>
        </section>
      </main>
    </ion-content>
  `,
  styleUrl: './auth.scss',
})
export class LoginPage {
  readonly passwordVisible = signal(false);
  readonly submitted = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });

  constructor(
    readonly auth: AdminAuthService,
    readonly connectivity: ConnectivityService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {}

  async submit() {
    this.submitted.set(true);
    if (this.connectivity.offline()) {
      this.error.set('No internet connection. Reconnect before signing in.');
      await this.connectivity.retry();
      return;
    }
    if (this.form.invalid || this.auth.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    this.error.set('');
    const result = await this.auth.signIn(this.form.controls.email.value, this.form.controls.password.value);
    if (!result.ok) {
      this.error.set(result.message);
      return;
    }
    const returnUrl = safeAdminReturnUrl(this.auth.role(), this.route.snapshot.queryParamMap.get('returnUrl'));
    if (result.destination === '/app/dashboard') {
      await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
      return;
    }
    await this.router.navigate([result.destination], { queryParams: { returnUrl }, replaceUrl: true });
  }

  clearError() {
    if (this.error()) this.error.set('');
  }

}
