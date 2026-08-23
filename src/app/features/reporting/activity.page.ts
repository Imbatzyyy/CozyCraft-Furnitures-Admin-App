import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { IonIcon, IonSearchbar, IonSegment, IonSegmentButton, IonLabel } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { ActivityLog, ClientErrorEvent } from '../../core/models/admin.models';
import { dateTime, initials, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

type TimelineItem = { id: string; kind: 'activity' | 'error'; created_at: string; title: string; detail: string; platform: string; actor: string; role: string; entity: string };

@Component({
  selector: 'cc-activity-page',
  standalone: true,
  imports: [IonIcon, IonSearchbar, IonSegment, IonSegmentButton, IonLabel, EmptyStateComponent, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page activity-page">
      <header class="cc-page-heading"><div><p class="cc-eyebrow">AUDIT & HEALTH</p><h1>Workspace activity</h1><p>A traceable view of people, systems, and mobile actions.</p></div><button type="button" (click)="data.loadActivity()"><ion-icon name="refresh-outline"></ion-icon></button></header>
      <section class="activity-summary"><div><strong>{{ data.activity().length }}</strong><span>audited actions</span></div><div><strong>{{ mobileActions() }}</strong><span>mobile actions</span></div><div><strong>{{ data.clientErrors().length }}</strong><span>app errors</span></div></section>
      <div class="activity-tools"><ion-searchbar mode="ios" placeholder="Actor, action, entity…" [debounce]="150" (ionInput)="query.set($any($event).detail.value ?? '')"></ion-searchbar><ion-segment [value]="scope()" (ionChange)="scope.set($any($event).detail.value)"><ion-segment-button value="all"><ion-label>All</ion-label></ion-segment-button><ion-segment-button value="mobile"><ion-label>Mobile</ion-label></ion-segment-button><ion-segment-button value="auth"><ion-label>Auth</ion-label></ion-segment-button><ion-segment-button value="errors"><ion-label>Errors</ion-label></ion-segment-button></ion-segment></div>
      @if (visible().length) { <section class="timeline">@for (item of visible(); track item.id) { <article class="timeline-item"><span class="timeline-marker" [class.is-error]="item.kind === 'error'"><ion-icon [name]="item.kind === 'error' ? 'bug-outline' : iconFor(item.entity)"></ion-icon></span><div class="timeline-copy"><div><b>{{ item.title }}</b><cc-status-pill [value]="item.platform"></cc-status-pill></div><p>{{ item.detail }}</p><span>{{ item.actor }} · {{ titleCase(item.role) }}</span></div><time>{{ dateTime(item.created_at) }}</time></article> }</section> } @else { <cc-empty-state icon="pulse-outline" title="No matching activity" message="Try another actor, entity, platform, or scope."></cc-empty-state> }
    </main>
  `,
  styleUrl: './activity.page.scss',
})
export class ActivityPage {
  readonly dateTime = dateTime; readonly titleCase = titleCase; readonly query = signal(''); readonly scope = signal<'all' | 'mobile' | 'auth' | 'errors'>('all');
  readonly mobileActions = computed(() => this.data.activity().filter((item) => item.platform === 'mobile').length);
  readonly timeline = computed<TimelineItem[]>(() => [...this.data.activity().map((item) => this.activityItem(item)), ...this.data.clientErrors().map((item) => this.errorItem(item))].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
  readonly visible = computed(() => { const query = this.query().trim().toLocaleLowerCase(); const scope = this.scope(); return this.timeline().filter((item) => (scope === 'all' || (scope === 'mobile' && item.platform === 'mobile') || (scope === 'auth' && (item.entity === 'authentication' || item.title.includes('auth'))) || (scope === 'errors' && item.kind === 'error')) && (!query || `${item.title} ${item.detail} ${item.actor} ${item.role} ${item.platform} ${item.entity}`.toLocaleLowerCase().includes(query))).slice(0, 250); });
  constructor(readonly data: AdminDataService) {}
  private activityItem(item: ActivityLog): TimelineItem { return { id: `a-${item.id}`, kind: 'activity', created_at: item.created_at, title: titleCase(item.action), detail: [item.entity_type, item.entity_id, this.detailString(item.details)].filter(Boolean).join(' · '), platform: item.platform, actor: item.profiles?.full_name || item.profiles?.email || 'System actor', role: item.actor_role || item.profiles?.role || 'system', entity: item.entity_type }; }
  private errorItem(item: ClientErrorEvent): TimelineItem { return { id: `e-${item.id}`, kind: 'error', created_at: item.created_at, title: 'Application error', detail: `${item.message} · ${item.path}`, platform: 'system', actor: item.profiles?.full_name || item.profiles?.email || 'Application', role: item.profiles?.role || 'system', entity: 'client_error' }; }
  private detailString(value: Record<string, unknown>) { return Object.entries(value ?? {}).slice(0, 3).map(([key, entry]) => `${titleCase(key)}: ${String(entry)}`).join(' · '); }
  iconFor(entity: string) { if (entity.includes('order') || entity.includes('payment')) return 'receipt-outline'; if (entity.includes('product') || entity.includes('inventory')) return 'cube-outline'; if (entity.includes('support')) return 'chatbubble-outline'; if (entity.includes('profile')) return 'person-outline'; if (entity.includes('review')) return 'star-outline'; if (entity.includes('auth')) return 'key-outline'; return 'pulse-outline'; }
}
