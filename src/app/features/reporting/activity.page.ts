import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonIcon, IonSearchbar, IonSpinner } from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { AdminDataService } from '../../core/data/admin-data.service';
import { ActivityLog, ClientErrorEvent } from '../../core/models/admin.models';
import { dateTime, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { CozyToastService } from '../../shared/components/toast.service';

type ActivityScope = 'all' | 'store' | 'catalog' | 'people' | 'security' | 'errors';
type ActivityChannel = 'all' | 'mobile' | 'web' | 'edge' | 'system';
type ActivityRole = 'all' | 'superadmin' | 'admin' | 'staff' | 'system';
type ActivityRange = '7' | '30' | '90' | 'all';

interface TimelineMetadata {
  label: string;
  value: string;
}

interface TimelineItem {
  id: string;
  kind: 'activity' | 'error';
  createdAt: string;
  title: string;
  summary: string;
  platform: string;
  actor: string;
  role: string;
  entity: string;
  entityId: string | null;
  metadata: TimelineMetadata[];
}

interface TimelineGroup {
  key: string;
  label: string;
  detail: string;
  items: TimelineItem[];
}

@Component({
  selector: 'cc-activity-page',
  standalone: true,
  imports: [IonIcon, IonSearchbar, IonSpinner, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity.page.html',
  styleUrl: './activity.page.scss',
})
export class ActivityPage {
  protected readonly data = inject(AdminDataService);
  private readonly toast = inject(CozyToastService);
  private readonly route = inject(ActivatedRoute);

  protected readonly scopeOptions: ReadonlyArray<{ value: ActivityScope; label: string; icon: string }> = [
    { value: 'all', label: 'All', icon: 'layers-outline' },
    { value: 'store', label: 'Store', icon: 'bag-handle-outline' },
    { value: 'catalog', label: 'Catalog', icon: 'cube-outline' },
    { value: 'people', label: 'People', icon: 'people-outline' },
    { value: 'security', label: 'Security', icon: 'shield-checkmark-outline' },
    { value: 'errors', label: 'Errors', icon: 'bug-outline' },
  ];
  protected readonly channelOptions: ReadonlyArray<{ value: ActivityChannel; label: string }> = [
    { value: 'all', label: 'Any channel' },
    { value: 'mobile', label: 'Mobile' },
    { value: 'web', label: 'Web' },
    { value: 'edge', label: 'Edge' },
    { value: 'system', label: 'System' },
  ];
  protected readonly roleOptions: ReadonlyArray<{ value: ActivityRole; label: string }> = [
    { value: 'all', label: 'Any actor' },
    { value: 'superadmin', label: 'Superadmin' },
    { value: 'admin', label: 'Admin' },
    { value: 'staff', label: 'Staff' },
    { value: 'system', label: 'System' },
  ];
  protected readonly rangeOptions: ReadonlyArray<{ value: ActivityRange; label: string }> = [
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: 'all', label: 'All time' },
  ];

  protected readonly query = signal('');
  protected readonly scope = signal<ActivityScope>('all');
  protected readonly channel = signal<ActivityChannel>('all');
  protected readonly role = signal<ActivityRole>('all');
  protected readonly range = signal<ActivityRange>(this.rangeFromDays(this.data.activityRangeDays()));
  protected readonly filtersOpen = signal(false);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly visibleLimit = signal(24);

  protected readonly timeline = computed<TimelineItem[]>(() => [
    ...this.data.activity().map((item) => this.activityItem(item)),
    ...this.data.clientErrors().map((item) => this.errorItem(item)),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)));

  protected readonly mobileCount = computed(() => this.timeline().filter((item) => item.platform === 'mobile').length);
  protected readonly errorCount = computed(() => this.timeline().filter((item) => item.kind === 'error').length);
  protected readonly actorCount = computed(() => new Set(this.timeline().map((item) => `${item.actor}|${item.role}`)).size);
  protected readonly scopeCounts = computed(() => Object.fromEntries(
    this.scopeOptions.map((option) => [option.value, this.timeline().filter((item) => this.matchesScope(item, option.value)).length]),
  ) as Record<ActivityScope, number>);
  protected readonly activeFilterCount = computed(() => Number(this.channel() !== 'all') + Number(this.role() !== 'all') + Number(this.range() !== '30'));

  protected readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const scope = this.scope();
    const channel = this.channel();
    const role = this.role();
    return this.timeline().filter((item) => {
      if (!this.matchesScope(item, scope)) return false;
      if (channel !== 'all' && item.platform !== channel) return false;
      if (role !== 'all' && item.role.toLocaleLowerCase() !== role) return false;
      if (!query) return true;
      const metadata = item.metadata.map((entry) => `${entry.label} ${entry.value}`).join(' ');
      return `${item.title} ${item.summary} ${item.actor} ${item.role} ${item.platform} ${item.entity} ${item.entityId ?? ''} ${metadata}`
        .toLocaleLowerCase()
        .includes(query);
    });
  });

  protected readonly visible = computed(() => this.filtered().slice(0, this.visibleLimit()));
  protected readonly groups = computed<TimelineGroup[]>(() => {
    const grouped = new Map<string, TimelineItem[]>();
    for (const item of this.visible()) {
      const key = this.dayKey(item.createdAt);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].map(([key, items]) => ({
      key,
      label: this.dayLabel(items[0].createdAt),
      detail: new Date(items[0].createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
      items,
    }));
  });

  protected readonly hasLocalMore = computed(() => this.filtered().length > this.visibleLimit());
  protected readonly canLoadMore = computed(() => this.hasLocalMore() || this.data.activityHasMore());
  protected readonly resultsLabel = computed(() => {
    const matched = this.filtered().length;
    const loaded = this.timeline().length;
    if (matched === loaded) return `${loaded} loaded record${loaded === 1 ? '' : 's'}`;
    return `${matched} of ${loaded} loaded records`;
  });
  protected readonly periodLabel = computed(() => ({
    '7': 'Past 7 days',
    '30': 'Past 30 days',
    '90': 'Past 90 days',
    all: 'All recorded history',
  })[this.range()]);

  constructor() {
    const requestedScope = this.route.snapshot.queryParamMap.get('scope');
    if (this.scopeOptions.some((option) => option.value === requestedScope)) {
      this.scope.set(requestedScope as ActivityScope);
    }
    void this.data.start().catch((error: unknown) => void this.toast.show(this.errorMessage(error), 'danger'));
  }

  protected setQuery(value: string | null | undefined) {
    this.query.set(value ?? '');
    this.resetVisibleWindow();
  }

  protected selectScope(value: ActivityScope) {
    this.scope.set(value);
    this.resetVisibleWindow();
  }

  protected selectChannel(value: ActivityChannel) {
    this.channel.set(value);
    this.resetVisibleWindow();
  }

  protected selectRole(value: ActivityRole) {
    this.role.set(value);
    this.resetVisibleWindow();
  }

  protected async selectRange(value: ActivityRange) {
    if (this.range() === value || this.data.activityLoading()) return;
    this.range.set(value);
    this.resetVisibleWindow();
    this.expandedId.set(null);
    try {
      await this.data.loadActivity(this.daysForRange(value));
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    }
  }

  protected resetFilters() {
    this.channel.set('all');
    this.role.set('all');
    if (this.range() !== '30') void this.selectRange('30');
    this.resetVisibleWindow();
  }

  protected toggleFilters() {
    this.filtersOpen.update((open) => !open);
  }

  protected toggleDetails(item: TimelineItem) {
    this.expandedId.update((id) => id === item.id ? null : item.id);
  }

  protected async refresh() {
    if (this.data.activityLoading()) return;
    try {
      await this.data.refreshActivity();
      await this.toast.show('Activity ledger is up to date.', 'success');
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    }
  }

  protected async loadOlder() {
    if (this.data.activityLoading()) return;
    if (this.hasLocalMore()) {
      this.visibleLimit.update((limit) => limit + 24);
      return;
    }
    try {
      await this.data.loadMoreActivity();
      this.visibleLimit.update((limit) => limit + 24);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    }
  }

  protected scopeCount(scope: ActivityScope) {
    return this.scopeCounts()[scope];
  }

  protected iconFor(item: TimelineItem) {
    if (item.kind === 'error') return 'bug-outline';
    const entity = item.entity.toLocaleLowerCase();
    if (/(order|payment|refund|return|delivery|fulfillment)/.test(entity)) return 'receipt-outline';
    if (/(product|inventory|category)/.test(entity)) return 'cube-outline';
    if (/(support|ticket|message)/.test(entity)) return 'chatbubble-ellipses-outline';
    if (/(profile|customer|team|staff)/.test(entity)) return 'person-outline';
    if (entity.includes('review')) return 'star-outline';
    if (/(auth|login|session|mfa|role|permission|security)/.test(entity)) return 'shield-checkmark-outline';
    return 'pulse-outline';
  }

  protected timeLabel(value: string) {
    return new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  }

  protected fullDate(value: string) {
    return dateTime(value);
  }

  protected title(value: string) {
    return titleCase(value);
  }

  private activityItem(item: ActivityLog): TimelineItem {
    const metadata = Object.entries(item.details ?? {}).map(([label, value]) => ({
      label: titleCase(label),
      value: this.metadataValue(value),
    }));
    return {
      id: `activity-${item.id}`,
      kind: 'activity',
      createdAt: item.created_at,
      title: titleCase(item.action),
      summary: [titleCase(item.entity_type), item.entity_id ? `#${item.entity_id}` : null].filter(Boolean).join(' · '),
      platform: item.platform || 'system',
      actor: item.profiles?.full_name || item.profiles?.email || 'System actor',
      role: item.actor_role || item.profiles?.role || 'system',
      entity: item.entity_type || 'system',
      entityId: item.entity_id,
      metadata,
    };
  }

  private errorItem(item: ClientErrorEvent): TimelineItem {
    const metadata = [
      item.path ? { label: 'Route', value: item.path } : null,
      item.context ? { label: 'Context', value: item.context } : null,
    ].filter((entry): entry is TimelineMetadata => Boolean(entry));
    return {
      id: `error-${item.id}`,
      kind: 'error',
      createdAt: item.created_at,
      title: 'Application error',
      summary: item.message || 'An unclassified client error was recorded.',
      platform: 'system',
      actor: item.profiles?.full_name || item.profiles?.email || 'Application runtime',
      role: item.profiles?.role || 'system',
      entity: 'client_error',
      entityId: String(item.id),
      metadata,
    };
  }

  private matchesScope(item: TimelineItem, scope: ActivityScope) {
    if (scope === 'all') return true;
    if (scope === 'errors') return item.kind === 'error';
    if (item.kind === 'error') return false;
    const entity = item.entity.toLocaleLowerCase();
    if (scope === 'store') return /(order|payment|refund|return|delivery|fulfillment)/.test(entity);
    if (scope === 'catalog') return /(product|inventory|category|review)/.test(entity);
    if (scope === 'people') return /(profile|customer|support|ticket|message|team|staff)/.test(entity);
    return /(auth|login|session|mfa|role|permission|security)/.test(entity);
  }

  private resetVisibleWindow() {
    this.visibleLimit.set(24);
    this.expandedId.set(null);
  }

  private dayKey(value: string) {
    const date = new Date(value);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  private dayLabel(value: string) {
    const date = new Date(value);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((start - target) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return date.toLocaleDateString('en-PH', { weekday: 'long' });
  }

  private metadataValue(value: unknown) {
    if (value === null || value === undefined || value === '') return 'Not supplied';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private daysForRange(value: ActivityRange) {
    return value === 'all' ? null : Number(value);
  }

  private rangeFromDays(value: number | null): ActivityRange {
    if (value === null) return 'all';
    if (value === 7 || value === 90) return String(value) as ActivityRange;
    return '30';
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'Activity could not be synchronized. Please try again.';
  }
}
