import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminNotification } from '../../core/models/admin.models';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { timeAgo } from '../../core/utils/format';
import { canAccessRoute } from '../../core/utils/admin-permissions';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { CozyToastService } from '../../shared/components/toast.service';

type NotificationFilter = 'all' | 'unread';

@Component({
  selector: 'cc-notifications-page',
  standalone: true,
  imports: [
    IonIcon,
    IonSpinner,
    EmptyStateComponent,
    SkeletonListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <main class="cc-page notification-page">
        <header class="page-heading">
          <div>
            <p class="eyebrow">Workspace pulse</p>
            <h1>Notifications</h1>
            <p class="page-intro">Orders, customer care, reviews, and stock signals in one quiet feed.</p>
          </div>
          <button
            class="mark-all"
            type="button"
            [disabled]="data.unreadNotifications() === 0 || markingAll()"
            (click)="markAllRead()"
          >
            @if (markingAll()) {
              <ion-spinner name="crescent" />
            } @else {
              <ion-icon name="checkmark-done-outline" />
            }
            <span>Mark all read</span>
          </button>
        </header>

        <section class="pulse-card" aria-label="Notification summary">
          <div class="pulse-card__orb"><ion-icon name="notifications-outline" /></div>
          <div class="pulse-card__copy">
            <span class="pulse-card__label">Needs attention</span>
            <strong>{{ data.unreadNotifications() }}</strong>
            <span>{{ data.unreadNotifications() === 1 ? 'unread update' : 'unread updates' }}</span>
          </div>
          <div class="pulse-card__live">
            <span class="live-dot" [class.live-dot--on]="data.realtimeStatus() === 'live'"></span>
            {{ data.realtimeStatus() === 'live' ? 'Live sync' : 'Syncing' }}
          </div>
        </section>

        <div class="feed-tools">
          <div class="filter-row" role="tablist" aria-label="Notification filters">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="filter() === 'all'"
              [class.filter-chip--active]="filter() === 'all'"
              (click)="filter.set('all')"
            >
              All <span>{{ data.notifications().length }}</span>
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="filter() === 'unread'"
              [class.filter-chip--active]="filter() === 'unread'"
              (click)="filter.set('unread')"
            >
              Unread <span>{{ data.unreadNotifications() }}</span>
            </button>
          </div>

          @if (readCount() > 0) {
            <button class="clear-viewed" type="button" [disabled]="clearingViewed()" (click)="clearViewed()">
              {{ clearingViewed() ? 'Clearing…' : 'Dismiss viewed' }}
            </button>
          }
        </div>

        @if (data.loading() && data.notifications().length === 0) {
          <cc-skeleton-list [count]="6" />
        } @else if (visibleNotifications().length === 0) {
          <cc-empty-state
            icon="checkmark-circle-outline"
            [title]="filter() === 'unread' ? 'Nothing needs your attention' : 'You’re all caught up'"
            [message]="filter() === 'unread'
              ? 'Every notification in your workspace has been reviewed.'
              : 'New customer and operations activity will appear here in realtime.'"
          />
        } @else {
          <section class="notification-feed" aria-label="Administrator notifications">
            @for (notification of visibleNotifications(); track notification.id) {
              <article class="notification-card" [class.notification-card--unread]="!notification.read_at">
                <button class="notification-card__main" type="button" (click)="openNotification(notification)">
                  <span class="kind-icon" [attr.data-kind]="notification.kind">
                    <ion-icon [name]="kindIcon(notification.kind)" />
                  </span>
                  <span class="notification-card__body">
                    <span class="notification-card__meta">
                      <span>{{ kindLabel(notification.kind) }}</span>
                      <span aria-hidden="true">·</span>
                      <time [attr.datetime]="notification.created_at">{{ relativeTime(notification.created_at) }}</time>
                    </span>
                    <strong>{{ notification.title }}</strong>
                    <span class="notification-card__message">{{ notification.message }}</span>
                    <span class="notification-card__link">
                      Open {{ destinationLabel(notification) }}
                      <ion-icon name="arrow-forward-outline" />
                    </span>
                  </span>
                  @if (!notification.read_at) {
                    <span class="unread-dot" aria-label="Unread"></span>
                  }
                </button>

                <div class="notification-card__actions">
                  <button
                    type="button"
                    [disabled]="isBusy(notification.id)"
                    (click)="toggleRead(notification)"
                    [attr.aria-label]="notification.read_at ? 'Mark notification unread' : 'Mark notification read'"
                  >
                    @if (isBusy(notification.id)) {
                      <ion-spinner name="crescent" />
                    } @else {
                      <ion-icon [name]="notification.read_at ? 'mail-unread-outline' : 'checkmark-outline'" />
                    }
                    <span>{{ notification.read_at ? 'Unread' : 'Read' }}</span>
                  </button>
                  <button
                    type="button"
                    class="dismiss-action"
                    [disabled]="isBusy(notification.id)"
                    (click)="dismiss(notification)"
                    aria-label="Dismiss notification"
                  >
                    <ion-icon name="close-outline" />
                    <span>Dismiss</span>
                  </button>
                </div>
              </article>
            }
          </section>
        }

        <p class="feed-note">
          <ion-icon name="shield-checkmark-outline" />
          Read and dismissed states are private to your administrator account.
        </p>
      </main>
  `,
  styles: [`
    :host { display: block; min-height: 100%; }
    .notification-page { width: min(100%, 960px); }
    button { font: inherit; }
    .page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
    .eyebrow { margin: 0 0 7px; color: var(--cc-accent, #9b674c); font-size: 11px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    h1 { margin: 0; color: var(--cc-ink, #292622); font: 600 clamp(29px, 8vw, 42px)/.98 var(--cc-font-display, Georgia, serif); letter-spacing: -.035em; }
    .page-intro { max-width: 520px; margin: 10px 0 0; color: var(--cc-ink-soft, #736c63); font-size: 12px; line-height: 1.55; }
    .mark-all { display: inline-flex; min-height: 44px; flex: 0 0 auto; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--cc-border, #ded7cd); border-radius: 13px; background: var(--cc-surface, #fffdf9); color: var(--cc-ink, #292622); padding: 0 13px; font-size: 12px; font-weight: 750; box-shadow: 0 8px 22px rgb(55 47 39 / .05); }
    .mark-all:disabled { opacity: .43; box-shadow: none; }
    .mark-all ion-icon { font-size: 16px; }
    .mark-all ion-spinner { width: 15px; height: 15px; }
    .pulse-card { position: relative; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; overflow: hidden; margin: 22px 0 16px; border-radius: 22px; background: #2c2925; color: #fffaf4; padding: 16px; box-shadow: 0 18px 40px rgb(42 35 29 / .15); }
    .pulse-card::after { position: absolute; width: 160px; height: 160px; right: -74px; top: -98px; border-radius: 50%; background: rgb(183 137 97 / .22); content: ''; }
    .pulse-card__orb { display: grid; width: 46px; height: 46px; place-items: center; border: 1px solid rgb(255 255 255 / .12); border-radius: 15px; background: rgb(255 255 255 / .08); color: #d8b491; font-size: 20px; }
    .pulse-card__copy { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 1px 7px; min-width: 0; }
    .pulse-card__copy strong { grid-row: 1 / 3; color: #fff; font: 600 31px/1 var(--cc-font-display, Georgia, serif); }
    .pulse-card__copy span { color: rgb(255 255 255 / .62); font-size: 11px; }
    .pulse-card__copy .pulse-card__label { color: #fff; font-size: 12px; font-weight: 750; }
    .pulse-card__live { z-index: 1; display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgb(255 255 255 / .1); border-radius: 999px; background: rgb(255 255 255 / .06); padding: 7px 9px; color: rgb(255 255 255 / .7); font-size: 11px; font-weight: 700; white-space: nowrap; }
    .live-dot { width: 6px; height: 6px; border-radius: 50%; background: #b78b70; }
    .live-dot--on { background: #a9c39d; box-shadow: 0 0 0 3px rgb(169 195 157 / .12); }
    .feed-tools { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .filter-row { display: inline-flex; gap: 4px; overflow-x: auto; border: 1px solid var(--cc-border, #ded7cd); border-radius: 14px; background: color-mix(in srgb, var(--cc-surface, #fffdf9) 80%, transparent); padding: 4px; scrollbar-width: none; }
    .filter-row::-webkit-scrollbar { display: none; }
    .filter-row button { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; border: 0; border-radius: 10px; background: transparent; color: var(--cc-ink-soft, #736c63); padding: 0 11px; font-size: 12px; font-weight: 750; white-space: nowrap; }
    .filter-row button span { display: grid; min-width: 20px; height: 20px; place-items: center; border-radius: 999px; background: var(--cc-muted, #eee8df); padding: 0 6px; font-size: 11px; }
    .filter-row .filter-chip--active { background: var(--cc-ink, #292622); color: #fff; box-shadow: 0 6px 14px rgb(42 38 34 / .15); }
    .filter-row .filter-chip--active span { background: rgb(255 255 255 / .12); }
    .clear-viewed { min-height: 44px; border: 0; background: transparent; color: var(--cc-ink-soft, #736c63); padding: 0 6px; font-size: 11px; font-weight: 750; text-decoration: underline; text-underline-offset: 4px; }
    .clear-viewed:disabled { opacity: .45; }
    .notification-feed { display: grid; gap: 9px; }
    .notification-card { overflow: hidden; border: 1px solid var(--cc-border, #ded7cd); border-radius: 18px; background: var(--cc-surface, #fffdf9); box-shadow: 0 9px 25px rgb(55 47 39 / .035); transition: border-color .18s ease, transform .18s ease; }
    .notification-card--unread { border-color: color-mix(in srgb, var(--cc-accent, #9b674c) 42%, var(--cc-border, #ded7cd)); background: color-mix(in srgb, var(--cc-surface, #fffdf9) 92%, #efe2d5); }
    .notification-card__main { display: grid; width: 100%; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 12px; border: 0; background: transparent; color: inherit; padding: 14px; text-align: left; }
    .notification-card__main:active { background: var(--cc-muted, #eee8df); }
    .kind-icon { display: grid; width: 41px; height: 41px; place-items: center; border-radius: 13px; background: #eee8df; color: #675f56; font-size: 18px; }
    .kind-icon[data-kind='order'] { background: #e8ede7; color: #5d7558; }
    .kind-icon[data-kind='review'] { background: #f0e6d7; color: #9a704d; }
    .kind-icon[data-kind='support'] { background: #e5ecec; color: #4d6f70; }
    .kind-icon[data-kind='inventory'] { background: #eee6e1; color: #8a604f; }
    .notification-card__body { display: block; min-width: 0; }
    .notification-card__meta { display: flex; align-items: center; gap: 5px; color: var(--cc-ink-soft, #736c63); font-size: 10px; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; }
    .notification-card__body > strong { display: block; overflow: hidden; margin-top: 5px; color: var(--cc-ink, #292622); font-size: 13px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .notification-card__message { display: -webkit-box; overflow: hidden; margin-top: 4px; color: var(--cc-ink-soft, #736c63); font-size: 12px; line-height: 1.48; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .notification-card__link { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; color: var(--cc-accent, #9b674c); font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
    .notification-card__link ion-icon { font-size: 12px; }
    .unread-dot { width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: var(--cc-accent, #9b674c); box-shadow: 0 0 0 4px rgb(155 103 76 / .1); }
    .notification-card__actions { display: flex; justify-content: flex-end; gap: 4px; border-top: 1px solid color-mix(in srgb, var(--cc-border, #ded7cd) 72%, transparent); padding: 5px 8px; }
    .notification-card__actions button { display: inline-flex; min-height: 44px; align-items: center; gap: 5px; border: 0; border-radius: 9px; background: transparent; color: var(--cc-ink-soft, #736c63); padding: 0 10px; font-size: 11px; font-weight: 750; }
    .notification-card__actions button:active { background: var(--cc-muted, #eee8df); }
    .notification-card__actions button:disabled { opacity: .45; }
    .notification-card__actions ion-icon { font-size: 14px; }
    .notification-card__actions ion-spinner { width: 13px; height: 13px; }
    .notification-card__actions .dismiss-action { color: #8c5947; }
    .feed-note { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 17px 8px 0; color: var(--cc-ink-soft, #736c63); font-size: 11px; line-height: 1.4; text-align: center; }
    .feed-note ion-icon { flex: 0 0 auto; font-size: 13px; }
    @media (min-width: 700px) {
      .notification-feed { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .notification-card { display: flex; flex-direction: column; }
      .notification-card__main { flex: 1; }
    }
    @media (max-width: 480px) {
      .page-heading { align-items: flex-start; }
      .page-intro { max-width: 245px; }
      .mark-all { width: 44px; padding: 0; }
      .mark-all span { display: none; }
      .pulse-card { grid-template-columns: auto 1fr; }
      .pulse-card__live { grid-column: 1 / -1; justify-self: start; margin-top: -2px; }
      .notification-card__actions button { min-width: 42px; justify-content: center; }
      .notification-card__actions button span { display: none; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .notification-card:active { transform: scale(.995); }
    }
  `],
})
export class NotificationsPage {
  protected readonly data = inject(AdminDataService);
  private readonly router = inject(Router);
  private readonly auth = inject(AdminAuthService);
  private readonly toast = inject(CozyToastService);
  private readonly native = inject(NativePlatformService);

  protected readonly filter = signal<NotificationFilter>('all');
  protected readonly markingAll = signal(false);
  protected readonly clearingViewed = signal(false);
  private readonly busyIds = signal<ReadonlySet<number>>(new Set());

  protected readonly visibleNotifications = computed(() => {
    const notifications = this.data.notifications();
    return this.filter() === 'unread'
      ? notifications.filter((notification) => !notification.read_at)
      : notifications;
  });

  protected readonly readCount = computed(() =>
    this.data.notifications().filter((notification) => Boolean(notification.read_at)).length,
  );

  constructor() {
    void this.data.start().catch((error: unknown) => void this.toast.show(this.errorMessage(error), 'danger'));
  }

  protected relativeTime(value: string) {
    return timeAgo(value);
  }

  protected kindIcon(kind: AdminNotification['kind']) {
    const icons: Record<AdminNotification['kind'], string> = {
      order: 'receipt-outline',
      review: 'star-outline',
      support: 'chatbubble-ellipses-outline',
      inventory: 'cube-outline',
      report: 'analytics-outline',
      system: 'shield-checkmark-outline',
    };
    return icons[kind];
  }

  protected kindLabel(kind: AdminNotification['kind']) {
    const labels: Record<AdminNotification['kind'], string> = {
      order: 'Order',
      review: 'Review',
      support: 'Customer care',
      inventory: 'Inventory',
      report: 'Report',
      system: 'System',
    };
    return labels[kind];
  }

  protected destinationLabel(notification: AdminNotification) {
    const labels: Record<AdminNotification['kind'], string> = {
      order: 'order',
      review: 'moderation queue',
      support: 'conversation',
      inventory: 'stock record',
      report: 'report',
      system: 'workspace',
    };
    return labels[notification.kind];
  }

  protected isBusy(id: number) {
    return this.busyIds().has(id);
  }

  protected async openNotification(notification: AdminNotification) {
    if (this.isBusy(notification.id)) return;
    this.setBusy(notification.id, true);
    try {
      if (!notification.read_at) {
        try {
          await this.data.markNotificationRead(notification.id);
        } catch (error: unknown) {
          await this.toast.show(`The alert could not be marked read. ${this.errorMessage(error)}`, 'danger');
        }
      }
      await this.native.tap();
      await this.router.navigateByUrl(this.mobileDestination(notification));
    } finally {
      this.setBusy(notification.id, false);
    }
  }

  protected async toggleRead(notification: AdminNotification) {
    if (this.isBusy(notification.id)) return;
    this.setBusy(notification.id, true);
    try {
      await this.data.markNotificationRead(notification.id, !notification.read_at);
      await this.native.tap();
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.setBusy(notification.id, false);
    }
  }

  protected async dismiss(notification: AdminNotification) {
    if (this.isBusy(notification.id)) return;
    this.setBusy(notification.id, true);
    try {
      await this.data.dismissNotification(notification.id);
      await this.native.tap();
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.setBusy(notification.id, false);
    }
  }

  protected async markAllRead() {
    if (this.markingAll() || this.data.unreadNotifications() === 0) return;
    this.markingAll.set(true);
    try {
      await this.data.markAllNotificationsRead();
      await Promise.all([this.native.success(), this.toast.show('Every notification is now marked as read.', 'success')]);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.markingAll.set(false);
    }
  }

  protected async clearViewed() {
    if (this.clearingViewed()) return;
    const read = this.data.notifications().filter((notification) => notification.read_at);
    if (read.length === 0) return;
    this.clearingViewed.set(true);
    try {
      await Promise.all(read.map((notification) => this.data.dismissNotification(notification.id)));
      await this.native.tap();
      await this.toast.show(`${read.length} viewed notification${read.length === 1 ? '' : 's'} dismissed.`, 'success');
    } catch (error: unknown) {
      await this.data.loadNotifications().catch(() => undefined);
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.clearingViewed.set(false);
    }
  }

  private mobileDestination(notification: AdminNotification) {
    const entityId = notification.entity_id ? encodeURIComponent(notification.entity_id) : '';
    const destination = (() => { switch (notification.kind) {
      case 'order':
        return entityId ? `/app/orders/${entityId}` : '/app/orders';
      case 'review':
        return entityId ? `/app/reviews?review=${entityId}` : '/app/reviews';
      case 'support':
        return entityId ? `/app/support/${entityId}` : '/app/support';
      case 'inventory':
        return entityId ? `/app/products/${entityId}` : '/app/inventory';
      case 'report':
        return '/app/reports';
      case 'system':
        return '/app/activity';
    } })();
    return canAccessRoute(this.auth.role(), destination) ? destination : '/app/more';
  }

  private setBusy(id: number, busy: boolean) {
    const next = new Set(this.busyIds());
    if (busy) next.add(id);
    else next.delete(id);
    this.busyIds.set(next);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'Notifications could not be updated. Please try again.';
  }
}
