import { Order } from '../models/admin.models';
import { parseTimestamp } from './format';

export const orderViews = [
  ['all', 'All workflows'], ['needs_fulfillment', 'Ready to fulfill'], ['awaiting_payment', 'Awaiting payment'],
  ['cancellation_requests', 'Cancellation requests'], ['returns', 'Returns'], ['refund_attention', 'Refund attention'], ['overdue', 'Over 48 hours'],
] as const;
export type OrderView = (typeof orderViews)[number][0];
export type OrderRange = 'all' | 'today' | 'last_7_days' | 'last_30_days';
export type OrderSort = 'newest' | 'oldest' | 'highest_total' | 'longest_waiting';

export function orderMatchesView(order: Order, view: OrderView, returnIds: ReadonlySet<string>, now = Date.now()) {
  switch (view) {
    case 'needs_fulfillment': return !['delivered', 'cancelled'].includes(order.status)
      && order.cancellation_status !== 'pending' && (order.payment_method.toLowerCase() === 'cod' || order.payment_status === 'paid');
    case 'awaiting_payment': return order.status === 'pending' && order.payment_method.toLowerCase() !== 'cod' && order.payment_status === 'pending';
    case 'cancellation_requests': return order.cancellation_status === 'pending';
    case 'returns': return returnIds.has(order.id);
    case 'refund_attention': return order.refund_status === 'failed';
    case 'overdue': return ['pending', 'processing', 'packed'].includes(order.status) && (parseTimestamp(order.created_at)?.getTime() ?? now) < now - 172_800_000;
    default: return true;
  }
}

const manilaDay = (timestamp: number) => Math.floor((timestamp + 28_800_000) / 86_400_000);
export function orderMatchesRange(createdAt: string, range: OrderRange, now = Date.now()) {
  if (range === 'all') return true;
  const timestamp = parseTimestamp(createdAt)?.getTime();
  if (timestamp === undefined) return false;
  const days = manilaDay(now) - manilaDay(timestamp);
  return days >= 0 && days < (range === 'today' ? 1 : range === 'last_7_days' ? 7 : 30);
}

export function orderSearchText(order: Order) {
  return [order.id, order.order_number, order.payment_method, order.payment_status, ...Object.values(order.shipping_address),
    order.profiles?.full_name, order.profiles?.email, order.profiles?.phone, ...order.order_items.map((item) => item.product_name)]
    .filter(Boolean).join(' ').toLocaleLowerCase();
}
