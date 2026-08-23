import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ActionSheetController,
  AlertController,
  IonIcon,
  IonInput,
  IonSpinner,
} from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { AdminRole, TeamMember } from '../../core/models/admin.models';
import { initials, shortDate } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { CozyToastService } from '../../shared/components/toast.service';

type TeamFilter = 'all' | 'active' | 'administrators' | 'suspended';
type TeamMutation = 'role' | 'status';

interface PendingMemberAction {
  memberId: string;
  kind: TeamMutation;
}

@Component({
  selector: 'cc-team-page',
  standalone: true,
  imports: [ReactiveFormsModule, IonIcon, IonInput, IonSpinner, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './team.page.html',
  styleUrl: './team.page.scss',
})
export class TeamPage {
  protected readonly data = inject(AdminDataService);
  protected readonly auth = inject(AdminAuthService);
  private readonly actions = inject(AdminActionsService);
  private readonly alerts = inject(AlertController);
  private readonly actionSheets = inject(ActionSheetController);
  private readonly toast = inject(CozyToastService);

  protected readonly initials = initials;
  protected readonly shortDate = shortDate;
  protected readonly roles: readonly AdminRole[] = ['staff', 'admin', 'superadmin'];
  protected readonly filters: ReadonlyArray<{ value: TeamFilter; label: string }> = [
    { value: 'all', label: 'Everyone' },
    { value: 'active', label: 'Active' },
    { value: 'administrators', label: 'Admins' },
    { value: 'suspended', label: 'Suspended' },
  ];

  protected readonly query = signal('');
  protected readonly filter = signal<TeamFilter>('all');
  protected readonly inviteOpen = signal(false);
  protected readonly guideOpen = signal(false);
  protected readonly inviteWorking = signal(false);
  protected readonly pendingAction = signal<PendingMemberAction | null>(null);

  protected readonly inviteForm = new FormGroup({
    fullName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(100)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    role: new FormControl<AdminRole>('staff', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected readonly activeCount = computed(() => this.data.team().filter((member) => member.staff_active).length);
  protected readonly adminCount = computed(() => this.data.team().filter((member) => (
    member.staff_active && (member.role === 'admin' || member.role === 'superadmin')
  )).length);
  protected readonly suspendedCount = computed(() => this.data.team().filter((member) => !member.staff_active).length);
  protected readonly memberMutationWorking = computed(() => Boolean(this.pendingAction()));
  protected readonly visibleMembers = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('en');
    const currentFilter = this.filter();
    const roleRank: Record<AdminRole, number> = { superadmin: 0, admin: 1, staff: 2 };
    return this.data.team()
      .filter((member) => {
        if (currentFilter === 'active') return member.staff_active;
        if (currentFilter === 'administrators') return member.role === 'admin' || member.role === 'superadmin';
        if (currentFilter === 'suspended') return !member.staff_active;
        return true;
      })
      .filter((member) => !query || `${member.full_name} ${member.email} ${member.phone} ${member.role}`
        .toLocaleLowerCase('en')
        .includes(query))
      .sort((left, right) => {
        if (left.id === this.auth.userId()) return -1;
        if (right.id === this.auth.userId()) return 1;
        if (left.staff_active !== right.staff_active) return left.staff_active ? -1 : 1;
        const roleDifference = roleRank[left.role] - roleRank[right.role];
        if (roleDifference) return roleDifference;
        return this.displayName(left).localeCompare(this.displayName(right), 'en');
      });
  });

  protected setQuery(value: string | null | undefined) {
    this.query.set(value ?? '');
  }

  protected filterCount(filter: TeamFilter) {
    if (filter === 'active') return this.activeCount();
    if (filter === 'administrators') return this.data.team().filter((member) => (
      member.role === 'admin' || member.role === 'superadmin'
    )).length;
    if (filter === 'suspended') return this.suspendedCount();
    return this.data.team().length;
  }

  protected toggleInvite() {
    if (this.inviteWorking()) return;
    this.inviteOpen.update((open) => !open);
  }

  protected toggleGuide() {
    this.guideOpen.update((open) => !open);
  }

  protected setInviteRole(role: AdminRole) {
    this.inviteForm.controls.role.setValue(role);
    this.inviteForm.controls.role.markAsTouched();
  }

  protected async invite() {
    if (this.inviteForm.invalid || this.inviteWorking() || this.memberMutationWorking()) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const value = this.inviteForm.getRawValue();
    const fullName = value.fullName.trim();
    if (fullName.length < 2) {
      this.inviteForm.controls.fullName.setErrors({ trimmedLength: true });
      this.inviteForm.controls.fullName.markAsTouched();
      return;
    }
    this.inviteWorking.set(true);
    try {
      const result = await this.actions.manageTeamMember('invite', {
        fullName,
        email: value.email.trim().toLocaleLowerCase('en'),
        role: value.role,
      });
      if (result.error) {
        await this.toast.show(result.error, 'danger');
        return;
      }
      this.inviteForm.reset({ fullName: '', email: '', role: 'staff' });
      this.inviteOpen.set(false);
      await this.toast.show(result.data?.message ?? 'Secure invitation sent.', 'success');
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.inviteWorking.set(false);
    }
  }

  protected async openRoleMenu(member: TeamMember) {
    if (!this.canManage(member)) return;
    const sheet = await this.actionSheets.create({
      header: `Role for ${this.displayName(member)}`,
      subHeader: 'Choose an access level to review before applying.',
      buttons: [
        ...this.roles.map((role) => ({
          text: `${this.roleLabel(role)}${member.role === role ? ' · Current' : ''}`,
          icon: this.roleIcon(role),
          cssClass: member.role === role ? 'cc-current-role' : undefined,
          handler: () => {
            if (member.role !== role) void this.confirmRoleChange(member, role);
          },
        })),
        { text: 'Cancel', icon: 'close-outline', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  protected async confirmStatusChange(member: TeamMember) {
    if (!this.canManage(member)) return;
    const active = !member.staff_active;
    const alert = await this.alerts.create({
      header: active ? 'Restore workspace access?' : 'Suspend workspace access?',
      message: active
        ? `${this.displayName(member)} will be able to sign in and use their assigned tools again.`
        : `${this.displayName(member)} will lose workspace access, including any active administrative session.`,
      buttons: [
        { text: 'Keep current access', role: 'cancel' },
        {
          text: active ? 'Restore access' : 'Suspend access',
          role: active ? undefined : 'destructive',
          handler: () => void this.runMemberMutation(member.id, 'status', active),
        },
      ],
    });
    await alert.present();
  }

  protected displayName(member: TeamMember) {
    return member.full_name || member.email || 'Team member';
  }

  protected roleLabel(role: AdminRole) {
    return ({ staff: 'Staff', admin: 'Administrator', superadmin: 'Super Administrator' })[role];
  }

  protected roleShortLabel(role: AdminRole) {
    return role === 'superadmin' ? 'Superadmin' : this.roleLabel(role);
  }

  protected roleDescription(role: AdminRole) {
    return ({
      staff: 'Catalog, inventory, fulfillment, reviews, notifications, and customer care.',
      admin: 'Staff tools plus customers, payments, reports, activity, cancellations, and refunds.',
      superadmin: 'Complete workspace access including team roles, security, and global store settings.',
    })[role];
  }

  protected roleCapabilities(role: AdminRole) {
    return ({
      staff: ['Catalog & stock', 'Order fulfillment', 'Reviews & inbox'],
      admin: ['All staff tools', 'Payments & customers', 'Reports & refunds'],
      superadmin: ['All admin tools', 'Team access', 'Security & settings'],
    })[role];
  }

  protected roleIcon(role: AdminRole) {
    if (role === 'superadmin') return 'key-outline';
    if (role === 'admin') return 'shield-checkmark-outline';
    return 'person-outline';
  }

  protected canManage(member: TeamMember) {
    return member.id !== this.auth.userId()
      && !this.memberMutationWorking()
      && !this.inviteWorking();
  }

  protected isPending(member: TeamMember, kind: TeamMutation) {
    const pending = this.pendingAction();
    return pending?.memberId === member.id && pending.kind === kind;
  }

  protected hideAvatar(event: Event) {
    (event.target as HTMLImageElement).hidden = true;
  }

  private async confirmRoleChange(member: TeamMember, role: AdminRole) {
    const latest = this.data.team().find((candidate) => candidate.id === member.id);
    if (!latest || latest.role === role || !this.canManage(latest)) return;
    const alert = await this.alerts.create({
      header: `Change ${this.displayName(latest)}’s role?`,
      message: role === 'superadmin'
        ? 'This grants complete store, financial, team, and security control. Confirm only for a trusted administrator.'
        : `Their workspace will change from ${this.roleLabel(latest.role)} to ${this.roleLabel(role)} access.`,
      buttons: [
        { text: 'Keep current role', role: 'cancel' },
        { text: 'Change role', handler: () => void this.runMemberMutation(latest.id, 'role', role) },
      ],
    });
    await alert.present();
  }

  private async runMemberMutation(memberId: string, kind: TeamMutation, value: AdminRole | boolean) {
    if (this.memberMutationWorking() || this.inviteWorking()) return;
    this.pendingAction.set({ memberId, kind });
    try {
      const result = kind === 'role'
        ? await this.actions.manageTeamMember('update-role', { userId: memberId, role: value as AdminRole })
        : await this.actions.manageTeamMember('set-status', { userId: memberId, active: value as boolean });
      await this.toast.show(
        result.error ?? result.data?.message ?? (kind === 'role' ? 'Team role updated.' : 'Team access updated.'),
        result.error ? 'danger' : 'success',
      );
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.pendingAction.set(null);
    }
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'The team access change could not be completed. Please try again.';
  }
}
