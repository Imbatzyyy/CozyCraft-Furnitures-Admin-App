import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { AdminNotification } from '../../core/models/admin.models';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { canAccessRoute } from '../../core/utils/admin-permissions';
import { timeAgo } from '../../core/utils/format';
import { adminNotificationDestination } from '../../core/utils/notification-destination';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { CozyToastService } from '../../shared/components/toast.service';

type NotificationFilter = 'all' | 'unread';

@Component({
  selector: 'cc-notifications-page',
  standalone: true,
  imports: [IonIcon, IonSpinner, EmptyStateComponent, SkeletonListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications.page.html',
  styleUrl: './notifications.page.scss',
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

  protected setFilter(filter: NotificationFilter) {
    if (this.filter() === filter) return;
    this.filter.set(filter);
    void this.native.tap();
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
      review: 'review queue',
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
      await Promise.all([
        this.native.success(),
        this.toast.show('Every notification is now marked as read.', 'success'),
      ]);
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
      await this.data.dismissNotifications(read.map((notification) => notification.id));
      await this.native.tap();
      await this.toast.show(
        `${read.length} viewed notification${read.length === 1 ? '' : 's'} dismissed.`,
        'success',
      );
    } catch (error: unknown) {
      await this.data.loadNotifications().catch(() => undefined);
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.clearingViewed.set(false);
    }
  }

  protected async loadEarlier() {
    if (this.data.notificationLoadingMore() || !this.data.notificationHasMore()) return;
    try {
      await this.data.loadMoreNotifications();
      await this.native.tap();
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    }
  }

  private mobileDestination(notification: AdminNotification) {
    const destination = adminNotificationDestination(notification);
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
