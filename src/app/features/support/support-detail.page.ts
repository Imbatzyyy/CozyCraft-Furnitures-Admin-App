import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { SupportStatus, SupportTicket } from '../../core/models/admin.models';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { dateTime, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';
import { CozyToastService } from '../../shared/components/toast.service';

interface AssigneeOption {
  id: string;
  label: string;
  detail: string;
}

@Component({
  selector: 'cc-support-detail-page',
  standalone: true,
  imports: [
    IonIcon,
    IonSpinner,
    EmptyStateComponent,
    SkeletonListComponent,
    StatusPillComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <main class="cc-page ticket-page">
        <button class="back-link" type="button" (click)="backToInbox()">
          <ion-icon name="arrow-back-outline" />
          Support inbox
        </button>

        @if (data.loading() && !ticket()) {
          <section class="detail-loading">
            <cc-skeleton-list [count]="4" />
          </section>
        } @else if (!ticket()) {
          <cc-empty-state
            icon="alert-circle-outline"
            title="Conversation not found"
            message="This support ticket may have been removed, or your role may no longer have access to it."
          >
            <button class="empty-action" type="button" (click)="backToInbox()">Return to inbox</button>
          </cc-empty-state>
        } @else if (ticket(); as active) {
          <header class="ticket-heading">
            <div class="ticket-heading__copy">
              <p class="eyebrow">{{ active.ticket_number }} · {{ categoryLabel(active.category) }}</p>
              <h1>{{ active.subject }}</h1>
              <p>
                From <strong>{{ customerName(active) }}</strong>
                <span aria-hidden="true">·</span>
                {{ formattedDate(active.created_at) }}
              </p>
            </div>
            <div class="ticket-heading__status">
              <cc-status-pill [value]="active.status" />
              <cc-status-pill [value]="active.priority" />
            </div>
          </header>

          <div class="detail-layout">
            <section class="conversation-panel" aria-label="Support conversation">
              <header class="panel-heading">
                <div>
                  <span>Conversation</span>
                  <strong>Customer correspondence</strong>
                </div>
                <span class="privacy-label"><ion-icon name="lock-closed-outline" /> Staff only</span>
              </header>

              <div class="conversation-stream">
                <article class="message-row message-row--customer">
                  <span class="message-avatar">{{ customerInitials(active) }}</span>
                  <div>
                    <span class="message-meta">{{ customerName(active) }} · {{ formattedDate(active.created_at) }}</span>
                    <p>{{ active.message }}</p>
                  </div>
                </article>

                @if (active.attachment_paths.length > 0) {
                  <section class="attachments" aria-label="Private customer attachments">
                    <header>
                      <span><ion-icon name="attach-outline" /> Customer attachments</span>
                      <small>Signed access · expires in 5 minutes</small>
                    </header>
                    <div>
                      @for (path of active.attachment_paths; track path; let index = $index) {
                        <button type="button" [disabled]="attachmentBusy() === path" (click)="openAttachment(path)">
                          <span class="file-icon"><ion-icon [name]="attachmentIcon(path)" /></span>
                          <span class="file-copy">
                            <strong>{{ attachmentName(path, index) }}</strong>
                            <small>Private file {{ index + 1 }}</small>
                          </span>
                          @if (attachmentBusy() === path) {
                            <ion-spinner name="crescent" />
                          } @else {
                            <ion-icon class="external-icon" name="open-outline" />
                          }
                        </button>
                      }
                    </div>
                  </section>
                }

                @if (active.admin_reply) {
                  <article class="message-row message-row--admin">
                    <span class="message-avatar"><ion-icon name="leaf-outline" /></span>
                    <div>
                      <span class="message-meta">CozyCraft Care · latest response</span>
                      <p>{{ active.admin_reply }}</p>
                    </div>
                  </article>
                } @else {
                  <div class="awaiting-reply">
                    <ion-icon name="time-outline" />
                    <span><strong>Awaiting a staff response</strong><small>Reply below when you have reviewed the concern.</small></span>
                  </div>
                }
              </div>

              <section class="reply-composer" aria-label="Reply to customer">
                <div class="composer-heading">
                  <span>
                    <small>Customer reply</small>
                    <strong>{{ active.admin_reply ? 'Update the latest response' : 'Write a helpful response' }}</strong>
                  </span>
                  <span class="character-count">{{ reply().length }} / 2000</span>
                </div>
                <textarea
                  rows="5"
                  maxlength="2000"
                  [value]="reply()"
                  (input)="updateReply($event)"
                  placeholder="Share a clear resolution or next step…"
                  aria-label="Support reply"
                ></textarea>
                <footer>
                  <span><ion-icon name="information-circle-outline" /> The customer receives an in-app support update.</span>
                  <button type="button" [disabled]="!canSendReply()" (click)="sendReply(active)">
                    @if (sendingReply()) { <ion-spinner name="crescent" /> }
                    @else { <ion-icon name="send-outline" /> }
                    {{ sendingReply() ? 'Sending…' : 'Send reply' }}
                  </button>
                </footer>
              </section>
            </section>

            <aside class="workflow-panel" aria-label="Ticket workflow">
              <header class="panel-heading">
                <div>
                  <span>Workflow</span>
                  <strong>Ownership & resolution</strong>
                </div>
                <ion-icon name="options-outline" />
              </header>

              <div class="workflow-fields">
                <label>
                  <span>Concern status</span>
                  <span class="select-shell">
                    <select [value]="status()" (change)="updateStatus($event)">
                      @for (option of statusOptions; track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                    <ion-icon name="chevron-down-outline" />
                  </span>
                </label>

                <label>
                  <span>Priority</span>
                  <span class="select-shell">
                    <select [value]="priority()" (change)="updatePriority($event)">
                      @for (option of priorityOptions; track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                    <ion-icon name="chevron-down-outline" />
                  </span>
                </label>

                <label>
                  <span>Assigned owner</span>
                  <span class="select-shell">
                    <select [value]="assignedTo()" (change)="updateAssignee($event)">
                      <option value="">Unassigned</option>
                      @for (option of assigneeOptions(); track option.id) {
                        <option [value]="option.id">{{ option.label }} · {{ option.detail }}</option>
                      }
                    </select>
                    <ion-icon name="chevron-down-outline" />
                  </span>
                </label>

                @if (auth.userId() && assignedTo() !== auth.userId()) {
                  <button class="assign-self" type="button" (click)="assignToMe()">
                    <ion-icon name="person-add-outline" /> Assign to me
                  </button>
                }
              </div>

              <button class="save-workflow" type="button" [disabled]="!canSaveWorkflow()" (click)="saveWorkflow(active)">
                @if (savingWorkflow()) { <ion-spinner name="crescent" /> }
                @else { <ion-icon name="checkmark-outline" /> }
                {{ savingWorkflow() ? 'Saving…' : 'Save workflow' }}
              </button>

              <dl class="ticket-facts">
                <div>
                  <dt>Customer</dt>
                  <dd>{{ customerName(active) }}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{{ active.profiles?.email || 'Not provided' }}</dd>
                </div>
                <div>
                  <dt>Related order</dt>
                  <dd>
                    @if (active.order_id) {
                      <button type="button" (click)="openOrder(active.order_id)">
                        View order <ion-icon name="arrow-forward-outline" />
                      </button>
                    } @else {
                      Not linked
                    }
                  </dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{{ formattedDate(active.updated_at) }}</dd>
                </div>
              </dl>

              @if (teamIsRestricted()) {
                <p class="team-note">
                  <ion-icon name="shield-outline" />
                  Staff privacy is active. You can leave this unassigned or assign it to yourself.
                </p>
              }
            </aside>
          </div>
        }
      </main>
  `,
  styles: [`
    :host { display: block; min-height: 100%; }
    .ticket-page { width: min(100%, 1100px); }
    button, select, textarea { font: inherit; }
    .back-link { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; border: 0; background: transparent; color: var(--cc-ink-soft, #736c63); padding: 0 4px; font-size: 11px; font-weight: 750; }
    .back-link ion-icon { font-size: 15px; }
    .detail-loading { margin-top: 16px; }
    .empty-action { min-height: 40px; border: 0; border-radius: 12px; background: var(--cc-ink, #292622); color: #fff; padding: 0 15px; font-size: 11px; font-weight: 800; }
    .ticket-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin: 12px 0 18px; }
    .ticket-heading__copy { min-width: 0; }
    .eyebrow { margin: 0 0 7px; color: var(--cc-accent, #9b674c); font-size: 10px; font-weight: 850; letter-spacing: .15em; text-transform: uppercase; }
    h1 { overflow: hidden; margin: 0; color: var(--cc-ink, #292622); font: 600 clamp(27px, 7vw, 40px)/1.04 var(--cc-font-display, Georgia, serif); letter-spacing: -.03em; text-overflow: ellipsis; }
    .ticket-heading__copy > p:last-child { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 9px 0 0; color: var(--cc-ink-soft, #736c63); font-size: 11px; }
    .ticket-heading__copy > p:last-child strong { color: var(--cc-ink, #292622); }
    .ticket-heading__status { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; gap: 5px; }
    .detail-layout { display: grid; gap: 12px; }
    .conversation-panel, .workflow-panel { overflow: hidden; border: 1px solid var(--cc-border, #ded7cd); border-radius: 21px; background: var(--cc-surface, #fffdf9); box-shadow: 0 13px 32px rgb(47 40 34 / .04); }
    .panel-heading { display: flex; min-height: 59px; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--cc-border, #ded7cd); padding: 11px 14px; }
    .panel-heading > div { display: grid; gap: 2px; }
    .panel-heading > div span { color: var(--cc-ink-soft, #736c63); font-size: 10px; font-weight: 850; letter-spacing: .14em; text-transform: uppercase; }
    .panel-heading > div strong { color: var(--cc-ink, #292622); font-size: 12px; }
    .panel-heading > ion-icon { color: var(--cc-ink-soft, #736c63); font-size: 17px; }
    .privacy-label { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; background: var(--cc-muted, #eee8df); color: var(--cc-ink-soft, #736c63); padding: 6px 8px; font-size: 10px; font-weight: 750; }
    .privacy-label ion-icon { font-size: 11px; }
    .conversation-stream { display: grid; min-height: 270px; align-content: start; gap: 16px; padding: 16px 14px 20px; }
    .message-row { display: flex; max-width: min(92%, 640px); align-items: flex-start; gap: 8px; }
    .message-avatar { display: grid; width: 31px; height: 31px; flex: 0 0 auto; place-items: center; border-radius: 11px; background: #e8ded1; color: #735a47; font-size: 10px; font-weight: 850; }
    .message-row > div { min-width: 0; }
    .message-meta { display: block; margin: 0 1px 5px; color: var(--cc-ink-soft, #736c63); font-size: 10px; }
    .message-row p { margin: 0; border-radius: 4px 16px 16px; background: var(--cc-muted, #eee8df); color: var(--cc-ink, #292622); padding: 11px 12px; font-size: 11px; line-height: 1.65; white-space: pre-wrap; }
    .message-row--admin { justify-self: end; flex-direction: row-reverse; }
    .message-row--admin .message-avatar { background: #2c2925; color: #d7b28e; font-size: 14px; }
    .message-row--admin .message-meta { text-align: right; }
    .message-row--admin p { border-radius: 16px 4px 16px 16px; background: #2c2925; color: #fff; }
    .attachments { display: grid; max-width: min(92%, 640px); gap: 8px; margin-left: 39px; }
    .attachments > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .attachments > header span { display: inline-flex; align-items: center; gap: 4px; color: var(--cc-ink, #292622); font-size: 10px; font-weight: 800; }
    .attachments > header small { color: var(--cc-ink-soft, #736c63); font-size: 10px; }
    .attachments > div { display: grid; gap: 6px; }
    .attachments button { display: grid; min-height: 54px; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; border: 1px solid var(--cc-border, #ded7cd); border-radius: 13px; background: var(--cc-surface, #fffdf9); color: inherit; padding: 8px 10px; text-align: left; }
    .attachments button:disabled { opacity: .58; }
    .file-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: #eee6dc; color: #90674d; font-size: 16px; }
    .file-copy { display: grid; min-width: 0; gap: 2px; }
    .file-copy strong { overflow: hidden; color: var(--cc-ink, #292622); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .file-copy small { color: var(--cc-ink-soft, #736c63); font-size: 10px; }
    .attachments button > ion-spinner { width: 15px; height: 15px; }
    .external-icon { color: var(--cc-ink-soft, #736c63); font-size: 14px; }
    .awaiting-reply { display: flex; justify-self: center; align-items: center; gap: 8px; border: 1px dashed var(--cc-border, #ded7cd); border-radius: 14px; background: color-mix(in srgb, var(--cc-muted, #eee8df) 48%, transparent); padding: 10px 13px; color: var(--cc-ink-soft, #736c63); }
    .awaiting-reply > ion-icon { font-size: 16px; }
    .awaiting-reply > span { display: grid; gap: 2px; }
    .awaiting-reply strong { color: var(--cc-ink, #292622); font-size: 10px; }
    .awaiting-reply small { font-size: 10px; }
    .reply-composer { border-top: 1px solid var(--cc-border, #ded7cd); background: #f3eee7; padding: 13px 14px; }
    .composer-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .composer-heading > span:first-child { display: grid; gap: 2px; }
    .composer-heading small { color: var(--cc-ink-soft, #736c63); font-size: 10px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
    .composer-heading strong { color: var(--cc-ink, #292622); font-size: 11px; }
    .character-count { color: var(--cc-ink-soft, #736c63); font-size: 10px; }
    .reply-composer textarea { display: block; width: 100%; resize: vertical; border: 1px solid var(--cc-border, #ded7cd); border-radius: 14px; outline: 0; background: var(--cc-surface, #fffdf9); color: var(--cc-ink, #292622); padding: 11px 12px; font-size: 16px; line-height: 1.55; box-sizing: border-box; }
    .reply-composer textarea:focus { border-color: color-mix(in srgb, var(--cc-accent, #9b674c) 60%, var(--cc-border, #ded7cd)); box-shadow: 0 0 0 3px rgb(155 103 76 / .08); }
    .reply-composer textarea::placeholder { color: color-mix(in srgb, var(--cc-ink-soft, #736c63) 65%, transparent); }
    .reply-composer > footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
    .reply-composer > footer > span { display: inline-flex; align-items: center; gap: 4px; color: var(--cc-ink-soft, #736c63); font-size: 10px; line-height: 1.35; }
    .reply-composer > footer > span ion-icon { flex: 0 0 auto; font-size: 12px; }
    .reply-composer > footer button { display: inline-flex; min-height: 44px; flex: 0 0 auto; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 11px; background: #2c2925; color: #fff; padding: 0 13px; font-size: 11px; font-weight: 800; }
    .reply-composer > footer button:disabled { opacity: .42; }
    .reply-composer > footer button ion-spinner { width: 13px; height: 13px; }
    .workflow-fields { display: grid; gap: 11px; padding: 14px; }
    .workflow-fields label { display: grid; gap: 6px; }
    .workflow-fields label > span:first-child { color: var(--cc-ink-soft, #736c63); font-size: 10px; font-weight: 850; letter-spacing: .11em; text-transform: uppercase; }
    .select-shell { position: relative; display: block; }
    .select-shell select { width: 100%; height: 48px; appearance: none; border: 1px solid var(--cc-border, #ded7cd); border-radius: 12px; outline: 0; background: var(--cc-surface, #fffdf9); color: var(--cc-ink, #292622); padding: 0 34px 0 11px; font-size: 16px; }
    .select-shell > ion-icon { position: absolute; top: 50%; right: 11px; transform: translateY(-50%); color: var(--cc-ink-soft, #736c63); font-size: 12px; pointer-events: none; }
    .assign-self { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--cc-border, #ded7cd); border-radius: 10px; background: var(--cc-muted, #eee8df); color: var(--cc-ink, #292622); font-size: 10px; font-weight: 800; }
    .assign-self ion-icon { font-size: 13px; }
    .save-workflow { display: flex; width: calc(100% - 28px); min-height: 48px; align-items: center; justify-content: center; gap: 6px; margin: 0 14px; border: 0; border-radius: 12px; background: #2c2925; color: #fff; font-size: 11px; font-weight: 800; }
    .save-workflow:disabled { opacity: .4; }
    .save-workflow ion-spinner { width: 13px; height: 13px; }
    .ticket-facts { display: grid; gap: 0; margin: 14px 0 0; border-top: 1px solid var(--cc-border, #ded7cd); }
    .ticket-facts > div { display: grid; grid-template-columns: 94px minmax(0, 1fr); gap: 10px; border-bottom: 1px solid color-mix(in srgb, var(--cc-border, #ded7cd) 70%, transparent); padding: 10px 14px; }
    .ticket-facts dt { color: var(--cc-ink-soft, #736c63); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .ticket-facts dd { overflow: hidden; margin: 0; color: var(--cc-ink, #292622); font-size: 10px; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
    .ticket-facts dd button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--cc-accent, #9b674c); padding: 0; font-size: 10px; font-weight: 800; }
    .ticket-facts dd button ion-icon { font-size: 12px; }
    .team-note { display: flex; align-items: flex-start; gap: 7px; margin: 12px 14px 14px; border-radius: 12px; background: #edf0ea; color: #66705f; padding: 9px 10px; font-size: 10px; line-height: 1.5; }
    .team-note ion-icon { flex: 0 0 auto; margin-top: 1px; font-size: 12px; }
    @media (min-width: 820px) {
      .detail-layout { grid-template-columns: minmax(0, 1fr) 292px; align-items: start; }
      .workflow-panel { position: sticky; top: 14px; }
      .conversation-stream { min-height: 360px; padding: 20px 18px 24px; }
      .reply-composer { padding: 15px 18px; }
    }
    @media (max-width: 480px) {
      .ticket-heading { align-items: flex-start; }
      .ticket-heading__status { padding-top: 3px; }
      .ticket-heading__status cc-status-pill:last-child { display: none; }
      .attachments { max-width: 100%; margin-left: 0; }
      .attachments > header { align-items: flex-start; flex-direction: column; gap: 2px; }
      .reply-composer > footer > span { max-width: 175px; }
    }
  `],
})
export class SupportDetailPage {
  protected readonly data = inject(AdminDataService);
  protected readonly auth = inject(AdminAuthService);
  private readonly actions = inject(AdminActionsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(CozyToastService);
  private readonly native = inject(NativePlatformService);

  private readonly ticketId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id'))),
    { initialValue: this.route.snapshot.paramMap.get('id') },
  );

  protected readonly status = signal<SupportStatus>('open');
  protected readonly priority = signal<SupportTicket['priority']>('normal');
  protected readonly assignedTo = signal('');
  protected readonly reply = signal('');
  protected readonly savingWorkflow = signal(false);
  protected readonly sendingReply = signal(false);
  protected readonly attachmentBusy = signal<string | null>(null);
  private hydratedTicketVersion = '';

  protected readonly statusOptions: ReadonlyArray<{ value: SupportStatus; label: string }> = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
  ];
  protected readonly priorityOptions: ReadonlyArray<{ value: SupportTicket['priority']; label: string }> = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  protected readonly ticket = computed(() => {
    const id = this.ticketId();
    return id ? this.data.tickets().find((ticket) => ticket.id === id) ?? null : null;
  });

  protected readonly assigneeOptions = computed<AssigneeOption[]>(() => {
    const choices = new Map<string, AssigneeOption>();
    const profile = this.auth.profile();
    if (profile && this.auth.userId()) {
      choices.set(profile.id, {
        id: profile.id,
        label: profile.full_name?.trim() || profile.email?.trim() || 'Current staff member',
        detail: `${titleCase(profile.role)} · you`,
      });
    }
    for (const member of this.data.team()) {
      choices.set(member.id, {
        id: member.id,
        label: member.full_name?.trim() || member.email?.trim() || 'Team member',
        detail: titleCase(member.role),
      });
    }
    const existingOwner = this.ticket()?.assigned_to;
    if (existingOwner && !choices.has(existingOwner)) {
      choices.set(existingOwner, {
        id: existingOwner,
        label: 'Current owner',
        detail: 'team details restricted',
      });
    }
    return [...choices.values()];
  });

  protected readonly teamIsRestricted = computed(() =>
    this.auth.role() !== 'superadmin' && this.data.team().length === 0,
  );

  protected readonly workflowChanged = computed(() => {
    const ticket = this.ticket();
    return Boolean(ticket && (
      this.status() !== ticket.status
      || this.priority() !== ticket.priority
      || this.assignedTo() !== (ticket.assigned_to ?? '')
    ));
  });

  protected readonly canSaveWorkflow = computed(() => this.workflowChanged() && !this.savingWorkflow());
  protected readonly canSendReply = computed(() => this.reply().trim().length >= 2 && !this.sendingReply());

  constructor() {
    effect(() => {
      const ticket = this.ticket();
      if (!ticket) return;
      const version = `${ticket.id}:${ticket.updated_at}`;
      if (version === this.hydratedTicketVersion) return;
      this.hydratedTicketVersion = version;
      this.status.set(ticket.status);
      this.priority.set(ticket.priority);
      this.assignedTo.set(ticket.assigned_to ?? '');
    });

    void this.data.start().catch((error: unknown) => void this.toast.show(this.errorMessage(error), 'danger'));
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

  protected formattedDate(value: string) {
    return dateTime(value);
  }

  protected updateReply(event: Event) {
    this.reply.set((event.target as HTMLTextAreaElement).value);
  }

  protected updateStatus(event: Event) {
    this.status.set((event.target as HTMLSelectElement).value as SupportStatus);
  }

  protected updatePriority(event: Event) {
    this.priority.set((event.target as HTMLSelectElement).value as SupportTicket['priority']);
  }

  protected updateAssignee(event: Event) {
    this.assignedTo.set((event.target as HTMLSelectElement).value);
  }

  protected assignToMe() {
    const userId = this.auth.userId();
    if (userId) this.assignedTo.set(userId);
    void this.native.tap();
  }

  protected attachmentIcon(path: string) {
    return path.toLocaleLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'image-outline';
  }

  protected attachmentName(path: string, index: number) {
    const encodedName = path.split('/').pop();
    if (!encodedName) return `Attachment ${index + 1}`;
    try {
      return decodeURIComponent(encodedName);
    } catch {
      return encodedName;
    }
  }

  protected async saveWorkflow(ticket: SupportTicket) {
    if (!this.canSaveWorkflow()) return;
    this.savingWorkflow.set(true);
    try {
      const result = await this.actions.updateTicketWorkflow(
        ticket.id,
        this.status(),
        this.priority(),
        this.assignedTo() || null,
      );
      if (result.error) {
        await this.toast.show(result.error, 'danger');
        return;
      }
      await Promise.all([
        this.native.success(),
        this.toast.show(`Workflow saved for ${ticket.ticket_number}.`, 'success'),
      ]);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.savingWorkflow.set(false);
    }
  }

  protected async sendReply(ticket: SupportTicket) {
    const response = this.reply().trim();
    if (response.length < 2 || this.sendingReply()) return;
    this.sendingReply.set(true);
    try {
      const result = await this.actions.replyToTicket(ticket, response, this.status());
      if (result.error) {
        await this.toast.show(result.error, 'danger');
        return;
      }
      this.reply.set('');
      await Promise.all([
        this.native.success(),
        this.toast.show(`Reply sent for ${ticket.ticket_number}.`, 'success'),
      ]);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.sendingReply.set(false);
    }
  }

  protected async openAttachment(path: string) {
    if (this.attachmentBusy()) return;
    this.attachmentBusy.set(path);
    try {
      const result = await this.actions.privateFileUrl('support-attachments', path);
      if (result.error || !result.url) {
        await this.toast.show(result.error || 'A secure link could not be created for this attachment.', 'danger');
        return;
      }
      await this.native.tap();
      await this.native.openExternalUrl(result.url);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.attachmentBusy.set(null);
    }
  }

  protected async openOrder(orderId: string) {
    await this.native.tap();
    await this.router.navigate(['/app/orders', orderId]);
  }

  protected async backToInbox() {
    await this.native.tap();
    await this.router.navigate(['/app/support']);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'This support conversation could not be updated. Please try again.';
  }
}
