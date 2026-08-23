import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonInput, IonSpinner } from '@ionic/angular/standalone';
import { AdminAuthService, TotpEnrollment } from '../../core/auth/admin-auth.service';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { safeAdminReturnUrl } from '../../core/utils/admin-permissions';

@Component({
  selector: 'cc-mfa-page',
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonContent, IonIcon, IonInput, IonSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-content [fullscreen]="true" class="auth-content">
      <main class="mfa-page">
        <section class="mfa-card">
          <div class="mfa-emblem"><ion-icon [name]="enroll() ? 'qr-code-outline' : 'shield-checkmark-outline'"></ion-icon></div>
          <p class="cc-eyebrow">{{ enroll() ? 'SECURE SETUP' : 'IDENTITY CHECK' }}</p>
          <h1>{{ enroll() ? 'Protect this account.' : 'One last detail.' }}</h1>
          @if (enroll()) {
            <p>Scan this code with your authenticator app, then enter the six-digit code it generates.</p>
            @if (enrollment()) {
              <div class="mfa-qr"><img [src]="enrollment()!.qrCode" alt="Authenticator enrollment QR code" /></div>
              <details><summary>Can’t scan?</summary><code>{{ enrollment()!.secret }}</code></details>
            } @else if (loading()) {
              <ion-spinner name="crescent"></ion-spinner>
            }
          } @else {
            <p>Enter the six-digit code from your authenticator. This keeps customer and payment operations protected.</p>
          }

          <label class="mfa-code">
            <span>Authenticator code</span>
            <ion-input
              [formControl]="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="000000"
              (keyup.enter)="verify()"
            ></ion-input>
          </label>
          @if (error()) { <div class="cc-notice cc-notice--danger" role="alert"><ion-icon name="alert-circle-outline"></ion-icon><span>{{ error() }}</span></div> }
          <ion-button expand="block" class="cc-primary-button" [disabled]="code.invalid || loading()" (click)="verify()">
            @if (loading()) { <ion-spinner name="crescent"></ion-spinner> }
            @else { Verify secure access }
          </ion-button>
          <button class="mfa-back" type="button" (click)="signOut()"><ion-icon name="arrow-back-outline"></ion-icon> Use another account</button>
        </section>
      </main>
    </ion-content>
  `,
  styleUrl: './auth.scss',
})
export class MfaPage implements OnInit {
  readonly enrollment = signal<TotpEnrollment | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly code = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{6}$/)] });

  constructor(
    readonly auth: AdminAuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly native: NativePlatformService,
  ) {}

  readonly enroll = () => !this.auth.hasVerifiedMfa();

  ngOnInit() {
    if (this.enroll()) void this.prepareEnrollment();
  }

  private async prepareEnrollment() {
    this.loading.set(true);
    const result = await this.auth.beginTotpEnrollment();
    this.loading.set(false);
    this.enrollment.set(result.enrollment);
    if (result.error) this.error.set(result.error);
  }

  async verify() {
    if (this.code.invalid || this.loading()) return;
    this.loading.set(true);
    const error = this.enrollment()
      ? await this.auth.verifyTotpEnrollment(this.enrollment()!.id, this.code.value)
      : await this.auth.verifyMfa(this.code.value);
    this.loading.set(false);
    if (error) {
      this.error.set(error);
      this.code.setValue('');
      return;
    }
    const returnUrl = safeAdminReturnUrl(this.auth.role(), this.route.snapshot.queryParamMap.get('returnUrl'));
    await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
  }

  async signOut() {
    await this.native.unregisterPushNotifications();
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }
}
