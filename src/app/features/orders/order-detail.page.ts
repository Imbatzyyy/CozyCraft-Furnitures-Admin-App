import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertController, IonBackButton, IonButton, IonIcon, IonModal, IonSelect, IonSelectOption, IonTextarea } from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { OrderStatus, ReturnStatus } from '../../core/models/admin.models';
import { allowedFulfillmentStatuses, allowedReturnStatuses, canManageFinancials } from '../../core/utils/admin-permissions';
import { currentPayment, dateTime, money, titleCase } from '../../core/utils/format';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { CozyToastService } from '../../shared/components/toast.service';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';

@Component({
  selector: 'cc-order-detail-page',
  standalone: true,
  imports: [RouterLink, IonBackButton, IonButton, IonIcon, IonModal, IonSelect, IonSelectOption, IonTextarea, StatusPillComponent, SkeletonListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page order-detail-page">
      <div class="detail-back"><ion-back-button defaultHref="/app/orders" text="Orders"></ion-back-button></div>
      @if (!data.initialized() && !order()) {
        <cc-skeleton-list [count]="6" />
      } @else if (order(); as current) {
        <header class="order-detail-head">
          <div><p class="cc-eyebrow">ORDER {{ current.order_number }}</p><h1>{{ current.shipping_address.name || current.profiles?.full_name || 'Customer order' }}</h1><p>Placed {{ dateTime(current.created_at) }}</p></div>
          <cc-status-pill [value]="current.status"></cc-status-pill>
        </header>

        @if (current.cancellation_status) {
          <section class="cancellation-banner" [class.is-pending]="current.cancellation_status === 'pending'">
            <div><p class="cc-eyebrow">CANCELLATION {{ current.cancellation_status }}</p><h2>{{ current.cancellation_reason || 'No reason provided' }}</h2>@if (current.cancellation_decision_note) { <p>{{ current.cancellation_decision_note }}</p> }</div>
            @if (current.cancellation_status === 'pending' && financialAccess()) {
              <div class="cancellation-banner__actions"><button type="button" (click)="rejectCancellation(current.id, current.cancellation_reason || '')">Keep order</button><button type="button" class="is-danger" (click)="openCancellation(current.cancellation_reason || '')">Approve & cancel</button></div>
            }
          </section>
        }

        <section class="fulfillment-card cc-card">
          <div class="cc-section-head">
            <div>
              <p class="cc-eyebrow">DELIVERY PROGRESS</p>
              <h2>{{ nextLabel(current.status) }}</h2>
              @if (currentStatusHistory(); as latestChange) {
                <p class="fulfillment-last-change">
                  <ion-icon name="time-outline" aria-hidden="true"></ion-icon>
                  <span>Last changed</span>
                  <time [attr.datetime]="latestChange.changed_at">{{ dateTime(latestChange.changed_at) }}</time>
                  <em>PHT</em>
                </p>
              }
            </div>
            <span class="payment-chip"><ion-icon [name]="current.payment_status === 'paid' ? 'checkmark-circle-outline' : 'time-outline'"></ion-icon>{{ titleCase(current.payment_status) }}</span>
          </div>
          <ol class="fulfillment-track">
            @for (step of fulfillmentSteps; track step; let index = $index) {
              <li [class.is-complete]="stepComplete(current.status, step)" [class.is-current]="current.status === step">
                <span>@if (stepComplete(current.status, step)) { <ion-icon name="checkmark-outline"></ion-icon> } @else { {{ index + 1 }} }</span>
                <div>
                  <b>{{ titleCase(step) }}</b>
                  @if (historyFor(step); as history) {
                    <small>
                      <time [attr.datetime]="history.changed_at" [attr.title]="dateTime(history.changed_at)">
                        <span>{{ statusDay(history.changed_at) }}</span>
                        <span>{{ statusClock(history.changed_at) }}</span>
                      </time>
                    </small>
                  }
                </div>
              </li>
            }
          </ol>
          @if (!['delivered', 'cancelled'].includes(current.status)) {
            <div class="fulfillment-actions">
              <ion-select label="Move order to" labelPlacement="stacked" interface="action-sheet" [value]="current.status" [disabled]="current.cancellation_status === 'pending'" (ionChange)="changeStatus($any($event).detail.value)">
                @for (status of availableStatuses(); track status) { <ion-select-option [value]="status">{{ titleCase(status) }}</ion-select-option> }
              </ion-select>
              <ion-button class="cc-primary-button" [disabled]="current.cancellation_status === 'pending' || !nextStatus()" (click)="advance()">{{ nextStatus() ? nextLabel(current.status) : 'Completed' }}</ion-button>
            </div>
          }
        </section>

        <div class="order-detail-grid">
          <section class="cc-card detail-card">
            <div class="cc-section-head"><div><p class="cc-eyebrow">ORDERED PIECES</p><h2>{{ current.order_items.length }} line{{ current.order_items.length === 1 ? '' : 's' }}</h2></div></div>
            <div class="item-list">
              @for (item of current.order_items; track item.id) {
                <div class="order-item"><span class="order-item__image">@if (item.image_url) { <img [src]="item.image_url" [alt]="item.product_name" loading="lazy" decoding="async" /> } @else { <ion-icon name="cube-outline"></ion-icon> }</span><span><b>{{ item.product_name }}</b><small>{{ item.quantity }} × {{ money(item.unit_price) }}</small></span><strong>{{ money(item.unit_price * item.quantity) }}</strong></div>
              }
            </div>
            <dl class="order-totals"><div><dt>Merchandise</dt><dd>{{ money(current.subtotal) }}</dd></div><div><dt>Delivery</dt><dd>{{ current.delivery_fee ? money(current.delivery_fee) : 'Complimentary' }}</dd></div><div><dt>Total</dt><dd>{{ money(current.total) }}</dd></div></dl>
          </section>

          <section class="customer-card">
            <p class="cc-eyebrow">CUSTOMER & DELIVERY</p>
            <div class="customer-card__identity"><span>{{ customerInitials(current.shipping_address.name || current.profiles?.full_name) }}</span><div><h2>{{ current.shipping_address.name || current.profiles?.full_name || 'Customer' }}</h2><p>{{ current.profiles?.email || current.shipping_address.email || 'Email unavailable' }}</p></div></div>
            <dl><div><dt>Mobile</dt><dd>{{ current.shipping_address.mobile || current.profiles?.phone || 'Not provided' }}</dd></div><div><dt>Delivery address</dt><dd>{{ addressLine() || 'Not provided' }}</dd></div><div><dt>Account ID</dt><dd class="is-mono">{{ current.user_id }}</dd></div></dl>
            @if (financialAccess()) { <a [routerLink]="['/app/customers', current.user_id]">Open customer profile <ion-icon name="arrow-forward-outline"></ion-icon></a> }
          </section>

          <section class="cc-card detail-card payment-card">
            <div class="cc-section-head"><div><p class="cc-eyebrow">PAYMENT RECORD</p><h2>{{ current.payment_method.toUpperCase() }}</h2></div><cc-status-pill [value]="current.payment_status"></cc-status-pill></div>
            <dl><div><dt>Provider state</dt><dd>{{ current.payment_method === 'cod' ? 'Cash on delivery' : titleCase(payment()?.status || 'Awaiting provider') }}</dd></div>@if (payment()?.provider_payment_id) { <div><dt>Provider ID</dt><dd class="is-mono">{{ payment()!.provider_payment_id }}</dd></div> }@if (payment()?.failure_reason) { <div><dt>Provider note</dt><dd class="is-danger">{{ payment()!.failure_reason }}</dd></div> }</dl>
            @if (financialAccess() && current.payment_method === 'cod' && current.payment_status === 'pending' && current.status === 'delivered') { <ion-button fill="outline" color="dark" expand="block" [disabled]="working()" (click)="confirmCodPayment()"><ion-icon slot="start" name="cash-outline"></ion-icon>{{ working() ? 'Updating…' : 'Mark COD payment received' }}</ion-button> }
            @if (current.refund_status) { <div class="refund-note"><b>Refund {{ titleCase(current.refund_status) }}</b>@if (current.refunded_at) { <span>{{ dateTime(current.refunded_at) }}</span> }@if (financialAccess() && current.payment_status === 'refunded') { <button type="button" (click)="sendRefundEmail()">{{ current.refund_email_sent_at ? 'Resend' : 'Send' }} confirmation</button> }</div> }
          </section>
        </div>

        @if (returnRequest(); as request) {
          <section class="return-card cc-card">
            <div class="cc-section-head"><div><p class="cc-eyebrow">RETURN {{ request.return_number }}</p><h2>{{ request.reason }}</h2><p>{{ request.details }}</p></div><cc-status-pill [value]="request.status"></cc-status-pill></div>
            @if (request.evidence_paths.length) { <div class="evidence-list">@for (path of request.evidence_paths; track path; let index = $index) { <button type="button" (click)="openEvidence(path)"><ion-icon name="image-outline"></ion-icon> Evidence {{ index + 1 }}</button> }</div> }
            <label class="cc-field"><span>Customer-facing admin note</span><ion-textarea autoGrow="true" [value]="returnNote()" (ionInput)="returnNote.set($any($event).detail.value ?? '')" placeholder="Explain the next step with care"></ion-textarea></label>
            <div class="return-actions">
              <ion-select label="Return status" labelPlacement="stacked" interface="action-sheet" [value]="request.status" (ionChange)="updateReturn($any($event).detail.value)">@for (status of returnStatuses(); track status) { <ion-select-option [value]="status">{{ titleCase(status) }}</ion-select-option> }@if (financialAccess() && ['item_received', 'refund_processing'].includes(request.status)) { <ion-select-option value="refunded">Process protected refund…</ion-select-option> }</ion-select>
            </div>
          </section>
        }

        @if (financialAccess() && !['shipped', 'delivered', 'cancelled'].includes(current.status) && current.cancellation_status !== 'pending') {
          <button type="button" class="cancel-order-link" (click)="openCancellation('')">Cancel this order safely</button>
        }

        <ion-modal [isOpen]="cancellationOpen()" (didDismiss)="cancellationOpen.set(false)" [initialBreakpoint]="0.62" [breakpoints]="[0, 0.62, 1]">
          <ng-template><div class="action-sheet-form"><span class="action-sheet-form__icon"><ion-icon name="shield-outline"></ion-icon></span><p class="cc-eyebrow">PROTECTED ACTION</p><h2>Cancel {{ current.order_number }}?</h2><p>{{ current.payment_status === 'paid' && current.payment_method !== 'cod' ? 'The provider refund must succeed before the order and inventory are changed.' : 'Reserved inventory will be restored and the customer will be notified.' }}</p><label class="cc-field"><span>Cancellation reason</span><ion-textarea autoGrow="true" [value]="cancellationReason()" (ionInput)="cancellationReason.set($any($event).detail.value ?? '')" placeholder="Explain why this order must be cancelled"></ion-textarea></label><div class="action-sheet-form__buttons"><ion-button fill="outline" color="dark" (click)="cancellationOpen.set(false)">Keep order</ion-button><ion-button color="danger" [disabled]="cancellationReason().trim().length < 5 || working()" (click)="confirmCancellation()">{{ working() ? 'Processing…' : current.payment_status === 'paid' && current.payment_method !== 'cod' ? 'Cancel & refund' : 'Confirm cancellation' }}</ion-button></div></div></ng-template>
        </ion-modal>
      } @else {
        <section class="cc-card missing-order"><ion-icon name="receipt-outline"></ion-icon><h1>Order not found</h1><p>It may have been removed or your role no longer has access.</p><a routerLink="/app/orders">Return to orders</a></section>
      }
    </main>
  `,
  styleUrl: './orders.scss',
})
export class OrderDetailPage {
  readonly money = money;
  readonly dateTime = dateTime;
  readonly titleCase = titleCase;
  readonly fulfillmentSteps: OrderStatus[] = ['pending', 'processing', 'packed', 'shipped', 'delivered'];
  readonly orderId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly order = computed(() => this.data.orders().find((item) => item.id === this.orderId));
  readonly returnRequest = computed(() => this.data.returnRequests().find((item) => item.order_id === this.orderId));
  readonly payment = computed(() => this.order() ? currentPayment(this.order()!) : undefined);
  readonly financialAccess = computed(() => canManageFinancials(this.auth.role()));
  readonly availableStatuses = computed(() => this.order() ? allowedFulfillmentStatuses(this.order()!.status).filter((status) => status !== 'cancelled') : []);
  readonly currentStatusHistory = computed(() => {
    const current = this.order();
    return current ? this.latestHistoryFor(current.status) : undefined;
  });
  readonly nextStatus = computed<OrderStatus | null>(() => {
    const current = this.order()?.status;
    if (!current) return null;
    const index = this.fulfillmentSteps.indexOf(current);
    return index >= 0 && index < this.fulfillmentSteps.length - 1 ? this.fulfillmentSteps[index + 1] : null;
  });
  readonly returnStatuses = computed(() => this.returnRequest() ? allowedReturnStatuses(this.returnRequest()!.status).filter((status) => !['refund_processing', 'refunded'].includes(status)) : []);
  readonly cancellationOpen = signal(false);
  readonly cancellationReason = signal('');
  readonly returnNote = signal('');
  readonly working = signal(false);
  private returnNoteHydrated = false;

  constructor(
    readonly data: AdminDataService,
    readonly auth: AdminAuthService,
    private readonly actions: AdminActionsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly alerts: AlertController,
    private readonly toast: CozyToastService,
    private readonly native: NativePlatformService,
  ) {
    effect(() => {
      const request = this.returnRequest();
      if (request && !this.returnNoteHydrated) {
        this.returnNote.set(request.admin_note ?? '');
        this.returnNoteHydrated = true;
      }
    });
  }

  nextLabel(status: OrderStatus) {
    return ({ pending: 'Begin fulfillment', processing: 'Mark as packed', packed: 'Mark as shipped', shipped: 'Mark as delivered', delivered: 'Delivered with care', cancelled: 'Order cancelled' })[status];
  }
  historyFor(status: OrderStatus) { return this.latestHistoryFor(status); }
  statusDay(value: string) {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  }
  statusClock(value: string) {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  }
  stepComplete(current: OrderStatus, step: OrderStatus) { return current !== 'cancelled' && this.fulfillmentSteps.indexOf(step) <= this.fulfillmentSteps.indexOf(current); }
  customerInitials(value: string | null | undefined) { return (value || 'CC').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
  addressLine() { const address = this.order()?.shipping_address; return address ? [address.line, address.barangay, address.city, address.province, address.postal].filter(Boolean).join(', ') : ''; }

  private latestHistoryFor(status: OrderStatus) {
    return this.order()?.order_status_history
      ?.filter((item) => item.status === status)
      .sort((left, right) => Date.parse(right.changed_at) - Date.parse(left.changed_at))[0];
  }

  async changeStatus(status: OrderStatus) {
    const order = this.order();
    if (!order || status === order.status) return;
    const result = await this.actions.updateOrderStatus(order, status);
    await this.toast.show(result.error ?? `${order.order_number} is now ${titleCase(status)}.`, result.error ? 'danger' : 'success');
  }
  async advance() { const status = this.nextStatus(); if (status) await this.changeStatus(status); }
  openCancellation(reason: string) { this.cancellationReason.set(reason); this.cancellationOpen.set(true); }
  async confirmCancellation() {
    const order = this.order(); if (!order) return;
    this.working.set(true);
    const result = await this.actions.cancelOrder(order.id, this.cancellationReason());
    this.working.set(false);
    if (!result.error) this.cancellationOpen.set(false);
    await this.toast.show(result.error ?? `${order.order_number} was cancelled safely.`, result.error ? 'danger' : 'success');
  }
  async rejectCancellation(orderId: string, reason: string) {
    const alert = await this.alerts.create({ header: 'Keep this order moving?', message: 'The cancellation request will be rejected and the customer notified.', inputs: [{ name: 'note', type: 'textarea', placeholder: 'Optional decision note' }], buttons: [{ text: 'Back', role: 'cancel' }, { text: 'Reject request', handler: (values: { note?: string }) => void this.runReject(orderId, reason, values.note ?? '') }] });
    await alert.present();
  }
  private async runReject(orderId: string, reason: string, note: string) { const result = await this.actions.cancelOrder(orderId, reason, 'reject', note); await this.toast.show(result.error ?? 'Cancellation request rejected.', result.error ? 'danger' : 'success'); }
  async sendRefundEmail() { const order = this.order(); if (!order) return; const result = await this.actions.sendRefundEmail(order.id); await this.toast.show(result.error ?? 'Refund confirmation sent.', result.error ? 'danger' : 'success'); }
  async confirmCodPayment() {
    const order = this.order();
    if (!order || !this.financialAccess()) return;
    const alert = await this.alerts.create({
      header: 'Confirm cash received?',
      message: `This records ${money(order.total)} as settled for ${order.order_number}.`,
      buttons: [
        { text: 'Not yet', role: 'cancel' },
        { text: 'Mark received', handler: () => void this.markCodPayment(order.id) },
      ],
    });
    await alert.present();
  }
  private async markCodPayment(orderId: string) {
    this.working.set(true);
    const result = await this.actions.markCodPaymentReceived(orderId);
    this.working.set(false);
    await this.toast.show(result.error ?? 'Cash-on-delivery payment recorded.', result.error ? 'danger' : 'success');
  }
  async openEvidence(path: string) { const result = await this.actions.privateFileUrl('return-evidence', path); if (!result.url) { await this.toast.show(result.error ?? 'Evidence could not be opened.', 'danger'); return; } try { await this.native.openExternalUrl(result.url); } catch (error) { await this.toast.show(error instanceof Error ? error.message : 'Evidence could not be opened.', 'danger'); } }
  async updateReturn(status: ReturnStatus) {
    const request = this.returnRequest(); if (!request || status === request.status) return;
    if (status === 'refunded') {
      const alert = await this.alerts.create({ header: 'Process protected refund?', message: 'Continue only after the returned piece has been physically received and inspected.', buttons: [{ text: 'Not yet', role: 'cancel' }, { text: 'Process refund', role: 'destructive', handler: () => void this.runReturnRefund(request.id) }] });
      await alert.present(); return;
    }
    const result = await this.actions.updateReturn(request.id, status, this.returnNote());
    await this.toast.show(result.error ?? `Return moved to ${titleCase(status)}.`, result.error ? 'danger' : 'success');
  }
  private async runReturnRefund(id: string) { const result = await this.actions.processReturnRefund(id); await this.toast.show(result.error ?? 'Return refund completed and inventory restored.', result.error ? 'danger' : 'success'); }
}
