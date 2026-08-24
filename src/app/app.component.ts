import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { AdminAuthService } from './core/auth/admin-auth.service';
import { ConnectivityService } from './core/native/connectivity.service';
import { NativePlatformService } from './core/native/native-platform.service';
import { ConnectivityBannerComponent } from './shared/components/connectivity-banner.component';

@Component({
  selector: 'cc-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet, ConnectivityBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-app>
      <cc-connectivity-banner></cc-connectivity-banner>
      @if (!auth.ready()) {
        <section class="app-bootstrap" role="status" aria-live="polite" aria-label="Opening CozyCraft Admin">
          <span class="app-bootstrap__mark" aria-hidden="true"><i></i></span>
          <div class="app-bootstrap__copy">
            <b>COZYCRAFT ADMIN</b>
            <span>Securing your workspace</span>
          </div>
          <span class="app-bootstrap__track" aria-hidden="true"><i></i></span>
        </section>
      }
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `,
  styles: [`
    :host { display: block; min-height: 100%; }

    .app-bootstrap {
      position: fixed;
      z-index: 2147483000;
      inset: 0;
      display: grid;
      grid-template-rows: 1fr auto auto 1fr;
      justify-items: center;
      align-items: end;
      gap: 17px;
      overflow: hidden;
      background:
        radial-gradient(circle at 78% 16%, rgb(188 166 139 / .2), transparent 28%),
        #f7f5f0;
      color: #211e1b;
      padding:
        max(22px, env(safe-area-inset-top))
        28px
        max(22px, env(safe-area-inset-bottom));
    }

    .app-bootstrap::before,
    .app-bootstrap::after {
      position: absolute;
      width: 58vw;
      max-width: 310px;
      aspect-ratio: 1;
      border: 1px solid rgb(76 66 56 / .08);
      border-radius: 50%;
      content: '';
      pointer-events: none;
    }

    .app-bootstrap::before { top: -22vw; right: -24vw; }
    .app-bootstrap::after { top: -12vw; right: -34vw; }

    .app-bootstrap__mark {
      position: relative;
      align-self: end;
      display: grid;
      width: 68px;
      height: 68px;
      place-items: center;
      border-radius: 24px;
      background: #211e1b;
      box-shadow: 0 18px 42px rgb(43 35 28 / .18);
      animation: cc-bootstrap-breathe 1.8s ease-in-out infinite;
    }

    .app-bootstrap__mark::before,
    .app-bootstrap__mark::after,
    .app-bootstrap__mark i::before,
    .app-bootstrap__mark i::after {
      position: absolute;
      width: 16px;
      height: 16px;
      border: 2px solid #f7f5f0;
      border-radius: 5px;
      content: '';
    }

    .app-bootstrap__mark::before { top: 16px; left: 16px; }
    .app-bootstrap__mark::after { top: 16px; right: 16px; }
    .app-bootstrap__mark i::before { bottom: 16px; left: 16px; }
    .app-bootstrap__mark i::after { right: 16px; bottom: 16px; }

    .app-bootstrap__copy {
      display: grid;
      gap: 7px;
      text-align: center;
    }

    .app-bootstrap__copy b {
      font: 750 12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: .22em;
    }

    .app-bootstrap__copy span {
      color: #827a71;
      font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .app-bootstrap__track {
      position: relative;
      align-self: start;
      width: min(150px, 46vw);
      height: 3px;
      overflow: hidden;
      border-radius: 999px;
      background: rgb(33 30 27 / .09);
    }

    .app-bootstrap__track i {
      position: absolute;
      inset: 0 auto 0 0;
      width: 46%;
      border-radius: inherit;
      background: linear-gradient(90deg, #9e8266, #211e1b);
      animation: cc-bootstrap-progress 1.15s cubic-bezier(.65, 0, .35, 1) infinite;
    }

    @keyframes cc-bootstrap-breathe {
      0%, 100% { transform: scale(.96); box-shadow: 0 14px 34px rgb(43 35 28 / .14); }
      50% { transform: scale(1); box-shadow: 0 20px 48px rgb(43 35 28 / .22); }
    }

    @keyframes cc-bootstrap-progress {
      0% { transform: translateX(-115%); }
      55% { transform: translateX(75%); }
      100% { transform: translateX(235%); }
    }

    @media (prefers-reduced-motion: reduce) {
      .app-bootstrap__mark,
      .app-bootstrap__track i { animation: none; }
      .app-bootstrap__track i { width: 62%; }
    }
  `],
})
export class AppComponent {
  readonly auth = inject(AdminAuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly native = inject(NativePlatformService);

  constructor() {
    this.connectivity.initialize();
    void this.auth.ensureInitialized();
    void this.native.initialize();
  }
}
