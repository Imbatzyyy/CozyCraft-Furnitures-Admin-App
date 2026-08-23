import { Injectable } from '@angular/core';
import { AdminAuthService } from '../auth/admin-auth.service';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import {
  AdminRole,
  AdminSecuritySettings,
  Order,
  OrderStatus,
  ReturnStatus,
  StoreSettings,
  SupportStatus,
  SupportTicket,
  TeamMember,
} from '../models/admin.models';
import { canManageFinancials } from '../utils/admin-permissions';
import { AdminDataService } from './admin-data.service';

export interface ActionResult<T = undefined> {
  data?: T;
  error: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminActionsService {
  private readonly client = this.connection.client;

  constructor(
    private readonly connection: SupabaseAdminService,
    private readonly auth: AdminAuthService,
    private readonly data: AdminDataService,
  ) {}

  async updateOrderStatus(order: Order, status: OrderStatus): Promise<ActionResult> {
    if (status === 'cancelled') return { error: 'Use the protected cancellation workflow.' };
    const payload: Record<string, string> = { status };
    const { data: updated, error } = await this.client.from('orders').update(payload).eq('id', order.id).eq('status', order.status).select('id').maybeSingle();
    if (!error && !updated) return { error: 'This order changed on another device. Refresh and try again.' };
    if (!error) await this.data.loadOrders();
    return { error: error?.message ?? null };
  }

  async markCodPaymentReceived(orderId: string): Promise<ActionResult> {
    if (!canManageFinancials(this.auth.role())) return { error: 'Administrator access is required.' };
    const { error } = await this.client.rpc('mark_cod_payment_received', { p_order_id: orderId });
    if (!error) await this.data.loadOrders();
    return { error: error?.message ?? null };
  }

  async cancelOrder(
    orderId: string,
    reason: string,
    action: 'approve' | 'reject' = 'approve',
    note = '',
  ): Promise<ActionResult<Record<string, unknown>>> {
    if (!canManageFinancials(this.auth.role())) return { error: 'Administrator access is required.' };
    if (reason.trim().length < 5) return { error: 'Provide a clear cancellation reason of at least five characters.' };
    const { data, error } = await this.client.functions.invoke('cancel-order', {
      body: { orderId, reason: reason.trim(), action, note: note.trim() },
    });
    const message = this.functionError(data, error, 'The cancellation workflow could not be completed.');
    if (message) await this.data.loadOrders().catch(() => undefined);
    else await Promise.all([this.data.loadOrders(), this.data.loadProducts(), this.data.loadInventory()]);
    return { data: data as Record<string, unknown> | undefined, error: message };
  }

  async updateReturn(returnId: string, status: ReturnStatus, note: string): Promise<ActionResult> {
    if (status === 'refunded') return { error: 'Use the protected refund action.' };
    const { data: updated, error } = await this.client
      .from('return_requests')
      .update({ status, admin_note: note.trim() || null, reviewed_at: new Date().toISOString() })
      .eq('id', returnId)
      .select('id')
      .maybeSingle();
    if (!error && !updated) return { error: 'This return changed on another device. Refresh and try again.' };
    if (!error) await this.data.loadReturns();
    return { error: error?.message ?? null };
  }

  async processReturnRefund(returnId: string): Promise<ActionResult<Record<string, unknown>>> {
    if (!canManageFinancials(this.auth.role())) return { error: 'Administrator access is required.' };
    const { data, error } = await this.client.functions.invoke('process-return-refund', {
      body: { returnId },
    });
    const message = this.functionError(data, error, 'The protected return refund could not be completed.');
    if (message) await this.data.loadReturns().catch(() => undefined);
    else await Promise.all([this.data.loadReturns(), this.data.loadOrders(), this.data.loadProducts(), this.data.loadInventory()]);
    return { data: data as Record<string, unknown> | undefined, error: message };
  }

  async sendRefundEmail(orderId: string): Promise<ActionResult<Record<string, unknown>>> {
    if (!canManageFinancials(this.auth.role())) return { error: 'Administrator access is required.' };
    const { data, error } = await this.client.functions.invoke('send-refund-email', { body: { orderId } });
    const message = this.functionError(data, error, 'The refund confirmation could not be sent.');
    if (!message) await this.data.loadOrders();
    return { data: data as Record<string, unknown> | undefined, error: message };
  }

  async replyToTicket(ticket: SupportTicket, reply: string, status: SupportStatus): Promise<ActionResult> {
    if (reply.trim().length < 2) return { error: 'Write a reply before sending.' };
    const { data: updated, error } = await this.client
      .from('support_tickets')
      .update({ admin_reply: reply.trim(), status: status === 'open' ? 'in_progress' : status })
      .eq('id', ticket.id)
      .select('id')
      .maybeSingle();
    if (!error && !updated) return { error: 'This conversation changed on another device. Refresh and try again.' };
    if (!error) await Promise.all([this.data.loadTickets(), this.data.loadCustomers()]);
    return { error: error?.message ?? null };
  }

  async updateTicketWorkflow(
    ticketId: string,
    status: SupportStatus,
    priority: SupportTicket['priority'],
    assignedTo: string | null,
  ): Promise<ActionResult> {
    const { data: updated, error } = await this.client
      .from('support_tickets')
      .update({ status, priority, assigned_to: assignedTo || null })
      .eq('id', ticketId)
      .select('id')
      .maybeSingle();
    if (!error && !updated) return { error: 'This conversation is no longer available.' };
    if (!error) await this.data.loadTickets();
    return { error: error?.message ?? null };
  }

  async moderateReview(reviewId: string, approved: boolean): Promise<ActionResult> {
    const { data: updated, error } = await this.client.from('reviews').update({ approved }).eq('id', reviewId).select('id').maybeSingle();
    if (!error && !updated) return { error: 'This review is no longer available.' };
    if (!error) await this.data.loadReviews();
    return { error: error?.message ?? null };
  }

  async privateFileUrl(bucket: 'support-attachments' | 'return-evidence' | 'avatars', path: string) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, 300);
    return { url: data?.signedUrl ?? null, error: error?.message ?? null };
  }

  async saveSettings(store: StoreSettings, security: AdminSecuritySettings): Promise<ActionResult> {
    if (this.auth.role() !== 'superadmin') return { error: 'Only a Super Administrator can change store settings.' };
    const { id: _storeId, updated_at: _storeUpdated, ...storeUpdate } = store;
    const { id: _securityId, updated_at: _securityUpdated, updated_by: _updatedBy, ...securityUpdate } = security;
    const { error } = await this.client.rpc('save_admin_workspace_settings', {
      p_store: storeUpdate,
      p_security: securityUpdate,
    });
    if (!error) {
      await Promise.all([this.data.loadSettings(), this.auth.revalidateAccess()]);
    }
    return { error: error?.message ?? null };
  }

  async manageTeamMember(
    action: 'invite' | 'update-role' | 'set-status',
    payload: { userId?: string; role?: AdminRole; active?: boolean; email?: string; fullName?: string },
  ): Promise<ActionResult<{ message?: string }>> {
    if (this.auth.role() !== 'superadmin') return { error: 'Only a Super Administrator can manage team access.' };
    const { data, error } = await this.client.functions.invoke('manage-team-member', {
      body: { action, ...payload },
    });
    const message = this.functionError(data, error, 'The team access change could not be completed.');
    if (!message) await this.data.loadTeam();
    return { data: data as { message?: string } | undefined, error: message };
  }

  async testConnection(): Promise<ActionResult> {
    const { error } = await this.client.from('store_settings').select('id').eq('id', true).single();
    return { error: error?.message ?? null };
  }

  private functionError(data: unknown, error: { message?: string } | null, fallback: string) {
    if (data && typeof data === 'object' && 'error' in data && data.error) return String(data.error);
    return error ? error.message || fallback : null;
  }
}
