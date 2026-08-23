import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { IonIcon, IonModal, IonSearchbar, IonSelect, IonSelectOption, IonSpinner } from '@ionic/angular/standalone';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { dateTime, initials, money, shortDate, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { CozyToastService } from '../../shared/components/toast.service';
import {
  LoyaltyMember,
  LoyaltySort,
  LoyaltyTier,
  MemberTiersService,
} from './member-tiers.service';

type TierFilter = 'all' | LoyaltyTier;

const tierMinimums: Record<LoyaltyTier, number> = {
  member: 0,
  plus: 15_000,
  premium: 50_000,
  elite: 120_000,
};
const tierOrder: LoyaltyTier[] = ['member', 'plus', 'premium', 'elite'];

@Component({
  selector: 'cc-member-tiers-page',
  standalone: true,
  imports: [IonIcon, IonModal, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, EmptyStateComponent, SkeletonListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page loyalty-page">
      <section class="loyalty-hero">
        <div class="loyalty-hero__top"><p class="cc-eyebrow">HOME CIRCLE</p><span><i></i> Live rewards</span></div>
        <div class="loyalty-hero__body">
          <div><h1>Member<br><em>tiers.</em></h1><p>Points, progress, and reward activity—without the desktop density.</p></div>
          <span class="loyalty-hero__mark"><ion-icon name="ribbon-outline"></ion-icon></span>
        </div>
        <div class="loyalty-hero__metrics">
          <span><small>ENROLLED</small><b>{{ service.total() }}</b></span>
          <span><small>ON THIS PAGE</small><b>{{ service.members().length }}</b></span>
          <span><small>VISIBLE POINTS</small><b>{{ visiblePoints().toLocaleString('en-PH') }}</b></span>
        </div>
      </section>

      <section class="loyalty-controls">
        <ion-searchbar
          aria-label="Search members"
          placeholder="Search member, username, or email"
          [debounce]="350"
          [value]="query()"
          (ionInput)="setQuery(valueFrom($event))"
        ></ion-searchbar>
        <div class="control-row">
          <ion-select aria-label="Tier filter" interface="popover" [value]="tier()" (ionChange)="setTier($event.detail.value)">
            <ion-select-option value="all">All tiers</ion-select-option>
            @for (item of tierOrder; track item) { <ion-select-option [value]="item">{{ titleCase(item) }}</ion-select-option> }
          </ion-select>
          <ion-select aria-label="Sort members" interface="popover" [value]="sort()" (ionChange)="setSort($event.detail.value)">
            <ion-select-option value="points">Highest points</ion-select-option>
            <ion-select-option value="spend">Highest spend</ion-select-option>
            <ion-select-option value="recent">Recently active</ion-select-option>
          </ion-select>
          <button type="button" (click)="refresh()" [disabled]="service.loading()" aria-label="Refresh member tiers">
            <ion-icon name="refresh-outline" [class.is-spinning]="service.loading()"></ion-icon>
          </button>
        </div>
      </section>

      <nav class="tier-rail" aria-label="Quick tier filters">
        @for (item of tierOrder; track item) {
          <button type="button" [class.is-active]="tier() === item" (click)="setTier(tier() === item ? 'all' : item)">
            <i [class]="'tier-dot tier-dot--' + item"></i>{{ titleCase(item) }}
          </button>
        }
      </nav>

      <header class="list-heading">
        <div><p>{{ tier() === 'all' ? 'ALL MEMBERS' : titleCase(tier()) + ' TIER' }}</p><strong>{{ service.total() }} result{{ service.total() === 1 ? '' : 's' }}</strong></div>
        <span>Page {{ page() + 1 }} of {{ totalPages() }}</span>
      </header>

      @if (service.loading() && service.members().length === 0) {
        <cc-skeleton-list [count]="5" />
      } @else if (service.members().length === 0) {
        <cc-empty-state icon="ribbon-outline" title="No members in this view" message="Try a different tier or search term. Loyalty accounts appear here after customer registration." />
      } @else {
        <section class="member-list" aria-label="Loyalty members">
          @for (member of service.members(); track member.user_id) {
            <button type="button" class="member-card" (click)="openMember(member)">
              <span class="member-avatar"><b>{{ initials(member.full_name) }}</b>@if (member.avatar_url) { <img [src]="member.avatar_url" [alt]="member.full_name + ' profile photo'" loading="lazy" (error)="hideImage($event)" /> }</span>
              <span class="member-copy"><strong>{{ member.full_name }}</strong><small>{{ member.email }}</small><span><i [class]="'tier-dot tier-dot--' + member.tier"></i>{{ titleCase(member.tier) }} · {{ member.points_balance.toLocaleString('en-PH') }} pts</span></span>
              <span class="member-value"><b>{{ money(member.lifetime_eligible_spend) }}</b><small>{{ member.last_activity_at ? 'Active ' + shortDate(member.last_activity_at) : 'No activity yet' }}</small><ion-icon name="chevron-forward-outline"></ion-icon></span>
            </button>
          }
        </section>
      }

      @if (service.total() > pageSize) {
        <nav class="pagination" aria-label="Member pages">
          <button type="button" (click)="goToPage(page() - 1)" [disabled]="page() === 0 || service.loading()"><ion-icon name="chevron-back-outline"></ion-icon> Previous</button>
          <span>{{ page() + 1 }} / {{ totalPages() }}</span>
          <button type="button" (click)="goToPage(page() + 1)" [disabled]="page() + 1 >= totalPages() || service.loading()">Next <ion-icon name="chevron-forward-outline"></ion-icon></button>
        </nav>
      }
    </main>

    <ion-modal class="member-modal" [isOpen]="selected() !== null" [breakpoints]="[0, 0.78, 1]" [initialBreakpoint]="0.78" (ionModalDidDismiss)="closeMember()">
      <ng-template>
        @if (selected(); as member) {
          <section class="member-sheet">
            <header class="sheet-header">
              <span class="member-avatar member-avatar--large"><b>{{ initials(member.full_name) }}</b>@if (member.avatar_url) { <img [src]="member.avatar_url" alt="" (error)="hideImage($event)" /> }</span>
              <span><small>SELECTED MEMBER</small><h2>{{ member.full_name }}</h2><p>&#64;{{ member.username }} · {{ member.email }}</p></span>
              <button type="button" (click)="closeMember()" aria-label="Close member details"><ion-icon name="close-outline"></ion-icon></button>
            </header>

            <div class="tier-summary">
              <span><small>CURRENT TIER</small><b><i [class]="'tier-dot tier-dot--' + member.tier"></i>{{ titleCase(member.tier) }}</b></span>
              <span><small>AVAILABLE</small><b>{{ member.points_balance.toLocaleString('en-PH') }} pts</b></span>
              <span><small>ELIGIBLE SPEND</small><b>{{ money(member.lifetime_eligible_spend) }}</b></span>
            </div>

            <section class="progress-card">
              <div><span><small>TIER PROGRESS</small><b>{{ tierProgress(member).nextTier ? titleCase(tierProgress(member).nextTier!) + ' is next' : 'Highest tier reached' }}</b></span><strong>{{ tierProgress(member).percent }}%</strong></div>
              <span class="progress-track"><i [style.width.%]="tierProgress(member).percent"></i></span>
              <p>{{ tierProgress(member).nextTier ? money(tierProgress(member).remaining) + ' more eligible spend to advance.' : 'This member has reached CozyCraft’s highest Home Circle tier.' }}</p>
            </section>

            @if (service.detailLoading()) {
              <div class="sheet-loading"><ion-spinner name="crescent"></ion-spinner><span>Loading protected reward history…</span></div>
            } @else {
              <section class="history-block">
                <header><div><small>POINT HISTORY</small><h3>Recent activity</h3></div><span>{{ service.transactions().length }}</span></header>
                @if (service.transactions().length === 0) { <p class="empty-copy">No point activity recorded yet.</p> }
                @for (transaction of service.transactions(); track transaction.id) {
                  <article class="history-row">
                    <span [class.is-positive]="transaction.points > 0"><ion-icon [name]="transaction.points > 0 ? 'arrow-up-outline' : 'arrow-down-outline'"></ion-icon></span>
                    <div><b>{{ transaction.description }}</b><small>{{ dateTime(transaction.created_at) }} · {{ titleCase(transaction.kind) }}</small></div>
                    <strong [class.is-positive]="transaction.points > 0">{{ transaction.points > 0 ? '+' : '' }}{{ transaction.points }}</strong>
                  </article>
                }
              </section>

              <section class="history-block">
                <header><div><small>REWARDS</small><h3>Redemption codes</h3></div><span>{{ service.redemptions().length }}</span></header>
                @if (service.redemptions().length === 0) { <p class="empty-copy">No rewards redeemed by this member.</p> }
                @for (reward of service.redemptions(); track reward.id) {
                  <article class="reward-row">
                    <div><b>{{ reward.code }}</b><small>{{ reward.points_cost }} pts · {{ money(reward.discount_amount) }}</small></div>
                    <span [class]="'reward-status reward-status--' + reward.status">{{ titleCase(reward.status) }}</span>
                    <small>Expires {{ shortDate(reward.expires_at) }}</small>
                  </article>
                }
              </section>
            }
          </section>
        }
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './member-tiers.page.scss',
})
export class MemberTiersPage implements OnDestroy {
  protected readonly service = inject(MemberTiersService);
  private readonly toast = inject(CozyToastService);
  private readonly native = inject(NativePlatformService);

  protected readonly tierOrder = tierOrder;
  protected readonly titleCase = titleCase;
  protected readonly initials = initials;
  protected readonly money = money;
  protected readonly shortDate = shortDate;
  protected readonly dateTime = dateTime;
  protected readonly pageSize = 12;
  protected readonly page = signal(0);
  protected readonly tier = signal<TierFilter>('all');
  protected readonly sort = signal<LoyaltySort>('points');
  protected readonly query = signal('');
  protected readonly selected = signal<LoyaltyMember | null>(null);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.service.total() / this.pageSize)));
  protected readonly visiblePoints = computed(() => this.service.members().reduce((sum, item) => sum + item.points_balance, 0));
  private loadSequence = 0;

  constructor() {
    void this.load();
  }

  ngOnDestroy() {
    this.loadSequence += 1;
  }

  protected valueFrom(event: Event) {
    return String((event as CustomEvent<{ value?: string | null }>).detail?.value ?? '');
  }

  protected setQuery(value: string) {
    const next = value.trimStart().slice(0, 80);
    if (next === this.query()) return;
    this.query.set(next);
    this.page.set(0);
    void this.load(true);
  }

  protected setTier(value: TierFilter) {
    if (!['all', ...tierOrder].includes(value)) return;
    this.tier.set(value);
    this.page.set(0);
    void this.native.tap();
    void this.load(true);
  }

  protected setSort(value: LoyaltySort) {
    if (!['points', 'spend', 'recent'].includes(value)) return;
    this.sort.set(value);
    this.page.set(0);
    void this.load(true);
  }

  protected goToPage(value: number) {
    const next = Math.min(this.totalPages() - 1, Math.max(0, value));
    if (next === this.page()) return;
    this.page.set(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void this.load(true);
  }

  protected refresh() {
    void this.load(true);
  }

  protected async openMember(member: LoyaltyMember) {
    this.selected.set(member);
    await this.native.tap();
    try {
      await this.service.loadMemberHistory(member.user_id);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error, 'Reward history could not be loaded.'), 'danger');
    }
  }

  protected closeMember() {
    this.selected.set(null);
  }

  protected tierProgress(member: LoyaltyMember) {
    const index = tierOrder.indexOf(member.tier);
    if (index === tierOrder.length - 1) return { percent: 100, nextTier: null as LoyaltyTier | null, remaining: 0 };
    const nextTier = tierOrder[index + 1]!;
    const start = tierMinimums[member.tier];
    const end = tierMinimums[nextTier];
    const percent = Math.round(Math.min(100, Math.max(0, ((member.lifetime_eligible_spend - start) / (end - start)) * 100)));
    return { percent, nextTier, remaining: Math.max(0, end - member.lifetime_eligible_spend) };
  }

  protected hideImage(event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (image) image.hidden = true;
  }

  private async load(force = false) {
    const sequence = ++this.loadSequence;
    try {
      await this.service.loadPage({
        page: this.page(),
        pageSize: this.pageSize,
        tier: this.tier(),
        sort: this.sort(),
        query: this.query(),
      }, force);
    } catch (error: unknown) {
      if (sequence === this.loadSequence) await this.toast.show(this.errorMessage(error, 'Member tiers could not be loaded.'), 'danger');
    }
  }

  private errorMessage(error: unknown, fallback: string) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return fallback;
  }
}
