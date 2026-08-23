import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { SupportStatus, SupportTicket } from '../../core/models/admin.models';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { timeAgo, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { CozyToastService } from '../../shared/components/toast.service';

type InboxScope = 'all' | 'active' | 'attention' | SupportStatus;

@Component({
  selector: 'cc-support-inbox-page',
  standalone: true,
  imports: [IonIcon, EmptyStateComponent, SkeletonListComponent],
  templateUrl: './support-inbox.page.html',
  styleUrl: './support-inbox.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportInboxPage {
  private readonly pageSize = 18;
  protected readonly data = inject(AdminDataService);
  private readonly auth = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(CozyToastService);
  private readonly native = inject(NativePlatformService);

  protected readonly query = signal('');
  protected readonly scope = signal<InboxScope>('all');
  protected readonly visibleLimit = signal(this.pageSize);
  protected readonly scopeOptions: ReadonlyArray<{ value: InboxScope; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
  ];

  protected readonly summary = computed(() => {
    const counts = {
      all: 0,
      active: 0,
      attention: 0,
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
    };

    for (const ticket of this.data.tickets()) {
      counts.all += 1;
      counts[ticket.status] += 1;
      if (this.isActive(ticket)) counts.active += 1;
      if (this.needsAttention(ticket)) counts.attention += 1;
    }

    return counts;
  });

  protected readonly filteredTickets = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const scope = this.scope();
    const priorityWeight: Record<SupportTicket['priority'], number> = {
      urgent: 4,
      high: 3,
      normal: 2,
      low: 1,
    };

    return this.data.tickets()
      .filter((ticket) => this.matchesScope(ticket, scope))
      .filter((ticket) => !query || [
        ticket.ticket_number,
        ticket.subject,
        ticket.message,
        ticket.profiles?.full_name,
        ticket.profiles?.email,
        ticket.category,
        this.assigneeLabel(ticket),
      ].some((value) => value?.toLocaleLowerCase().includes(query)))
      .sort((left, right) => {
        const leftActive = Number(this.isActive(left));
        const rightActive = Number(this.isActive(right));
        return rightActive - leftActive
          || priorityWeight[right.priority] - priorityWeight[left.priority]
          || Date.parse(right.updated_at || right.created_at) - Date.parse(left.updated_at || left.created_at);
      });
  });

  protected readonly displayedTickets = computed(() => this.filteredTickets().slice(0, this.visibleLimit()));
  protected readonly remainingTickets = computed(() => Math.max(0, this.filteredTickets().length - this.displayedTickets().length));
  protected readonly scopeLabel = computed(() => {
    if (this.scope() === 'active') return 'Active queue';
    if (this.scope() === 'attention') return 'Needs attention';
    return this.scopeOptions.find((option) => option.value === this.scope())?.label ?? 'All';
  });

  constructor() {
    void this.data.start().catch((error: unknown) => void this.toast.show(this.errorMessage(error), 'danger'));
  }

  protected updateQuery(value: string) {
    this.query.set(value);
    this.resetVisibleLimit();
  }

  protected clearQuery() {
    this.updateQuery('');
  }

  protected selectScope(scope: InboxScope) {
    this.scope.set(scope);
    this.resetVisibleLimit();
  }

  protected showMore() {
    this.visibleLimit.update((limit) => limit + this.pageSize);
  }

  protected scopeCount(scope: InboxScope) {
    return this.summary()[scope];
  }

  protected customerName(ticket: SupportTicket) {
    return ticket.profiles?.full_name?.trim() || ticket.profiles?.email?.trim() || 'CozyCraft customer';
  }

  protected customerInitials(ticket: SupportTicket) {
    return this.customerName(ticket)
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase();
  }

  protected categoryLabel(category: SupportTicket['category']) {
    return titleCase(category);
  }

  protected assigneeLabel(ticket: SupportTicket) {
    if (!ticket.assigned_to) return 'Unassigned';
    if (ticket.assigned_to === this.auth.userId()) return 'Assigned to you';
    const member = this.data.team().find((candidate) => candidate.id === ticket.assigned_to);
    return member?.full_name?.trim() || member?.email?.trim() || 'Assigned staff';
  }

  protected relativeTime(value: string) {
    return timeAgo(value);
  }

  protected statusLabel(status: SupportStatus) {
    return titleCase(status);
  }

  protected priorityLabel(priority: SupportTicket['priority']) {
    return `${titleCase(priority)} priority`;
  }

  protected openTicket(ticket: SupportTicket) {
    void this.native.tap();
    void this.router.navigate(['/app/support', ticket.id]);
  }

  private isActive(ticket: SupportTicket) {
    return ticket.status === 'open' || ticket.status === 'in_progress';
  }

  private needsAttention(ticket: SupportTicket) {
    return this.isActive(ticket) && (ticket.priority === 'high' || ticket.priority === 'urgent');
  }

  private matchesScope(ticket: SupportTicket, scope: InboxScope) {
    if (scope === 'all') return true;
    if (scope === 'active') return this.isActive(ticket);
    if (scope === 'attention') return this.needsAttention(ticket);
    return ticket.status === scope;
  }

  private resetVisibleLimit() {
    this.visibleLimit.set(this.pageSize);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'The support inbox could not be refreshed. Please try again.';
  }
}
