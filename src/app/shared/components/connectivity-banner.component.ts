import { ChangeDetectionStrategy, Component, effect, inject, OnDestroy } from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { ConnectivityService } from '../../core/native/connectivity.service';

@Component({
  selector: 'cc-connectivity-banner',
  standalone: true,
  imports: [IonIcon, IonSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (connection.banner(); as banner) {
      <aside
        class="connection-banner"
        [class.connection-banner--offline]="banner.kind === 'offline'"
        [class.connection-banner--unstable]="banner.kind === 'unstable'"
        [class.connection-banner--restored]="banner.kind === 'restored'"
        [attr.role]="banner.kind === 'restored' ? 'status' : 'alert'"
        [attr.aria-live]="banner.kind === 'restored' ? 'polite' : 'assertive'"
      >
        <span class="connection-banner__mark" aria-hidden="true">
          @if (connection.checking()) { <ion-spinner name="crescent"></ion-spinner> }
          @else { <ion-icon [name]="banner.icon"></ion-icon> }
        </span>
        <span class="connection-banner__copy"><b>{{ banner.title }}</b><small>{{ banner.detail }}</small></span>
        @if (banner.retryable) {
          <button type="button" (click)="connection.retry()" [disabled]="connection.checking()">
            {{ connection.checking() ? 'Checking' : 'Retry' }}
          </button>
        }
      </aside>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      z-index: 2147483600;
      top: max(7px, env(safe-area-inset-top));
      right: 0;
      left: 0;
      display: block;
      pointer-events: none;
    }

    .connection-banner {
      display: grid;
      width: min(calc(100% - 20px), 510px);
      min-height: 56px;
      grid-template-columns: 36px minmax(0, 1fr) auto;
      align-items: center;
      gap: 9px;
      margin: 0 auto;
      border: 1px solid rgb(255 255 255 / .13);
      border-radius: 18px;
      padding: 7px 8px 7px 9px;
      color: #fffaf4;
      box-shadow: 0 16px 38px rgb(31 24 19 / .22), inset 0 1px 0 rgb(255 255 255 / .08);
      pointer-events: auto;
      -webkit-backdrop-filter: blur(18px) saturate(1.15);
      backdrop-filter: blur(18px) saturate(1.15);
      animation: cc-connection-enter .24s cubic-bezier(.2, .8, .2, 1) both;
    }

    .connection-banner--offline { background: rgb(69 43 37 / .96); }
    .connection-banner--unstable { background: rgb(111 78 50 / .95); }
    .connection-banner--restored { grid-template-columns: 36px minmax(0, 1fr); background: rgb(63 88 61 / .95); }

    .connection-banner__mark {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      border-radius: 12px;
      background: rgb(255 255 255 / .1);
      font-size: 18px;
    }

    .connection-banner__mark ion-spinner { width: 17px; height: 17px; }
    .connection-banner__copy { display: grid; min-width: 0; gap: 2px; }
    .connection-banner__copy b { overflow: hidden; font-size: 11px; font-weight: 800; letter-spacing: .01em; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    .connection-banner__copy small {
      display: -webkit-box;
      overflow: hidden;
      color: rgb(255 250 244 / .73);
      font-size: 9px;
      font-weight: 550;
      line-height: 1.3;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .connection-banner button {
      min-width: 58px;
      min-height: 40px;
      border: 1px solid rgb(255 255 255 / .14);
      border-radius: 12px;
      background: rgb(255 255 255 / .1);
      padding: 0 10px;
      color: inherit;
      font-size: 9px;
      font-weight: 800;
    }

    .connection-banner button:active { background: rgb(255 255 255 / .18); transform: scale(.97); }
    .connection-banner button:disabled { opacity: .65; }

    @keyframes cc-connection-enter {
      from { opacity: 0; transform: translateY(-14px) scale(.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @media (max-width: 359px) {
      .connection-banner { width: calc(100% - 14px); grid-template-columns: 34px minmax(0, 1fr) auto; gap: 7px; padding-right: 6px; }
      .connection-banner__mark { width: 34px; height: 34px; }
      .connection-banner button { min-width: 52px; padding: 0 7px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .connection-banner { animation: none; }
    }
  `],
})
export class ConnectivityBannerComponent implements OnDestroy {
  readonly connection = inject(ConnectivityService);
  private readonly visibilityEffect = effect(() => {
    document.documentElement.classList.toggle('cc-connectivity-visible', Boolean(this.connection.banner()));
  });

  ngOnDestroy(): void {
    this.visibilityEffect.destroy();
    document.documentElement.classList.remove('cc-connectivity-visible');
  }
}
