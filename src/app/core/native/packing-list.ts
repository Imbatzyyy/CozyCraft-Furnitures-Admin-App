import type { Order } from '../models/admin.models';
import { dateTime, titleCase } from '../utils/format';
import type { PremiumReport } from './export.service';

/** Fulfillment checklist only: stored order snapshots, no catalog or billing reads. */
export function packingListReport(order: Order, now = new Date()): PremiumReport {
  if (order.status === 'cancelled') throw new Error('Cancelled orders cannot be packed.');
  if (order.cancellation_status === 'pending') throw new Error('Review the cancellation request before packing this order.');
  if (!order.order_items?.length) throw new Error('Order items are unavailable. Refresh and try again.');
  const shipping = order.shipping_address ?? {};
  const address = [shipping.line, shipping.barangay, shipping.city, shipping.province, shipping.postal].filter(Boolean).join(', ');
  return {
    filename: `CozyCraft-Packing-${order.order_number}.pdf`,
    title: 'Packing list', subtitle: 'Fulfillment checklist - not an invoice or proof of payment.',
    period: order.order_number, generatedAt: dateTime(now.toISOString()) + ' PHT',
    kpis: [
      { label: 'Fulfillment', value: titleCase(order.status), detail: 'Status at export' },
      { label: 'Payment', value: titleCase(order.payment_method), detail: order.payment_method === 'cod' && order.payment_status === 'pending' ? 'Collect on delivery' : titleCase(order.payment_status) },
      { label: 'Line items', value: String(order.order_items.length), detail: 'Verify every item below' },
      { label: 'Units', value: String(order.order_items.reduce((sum, item) => sum + item.quantity, 0)), detail: 'Total units to check' },
    ],
    columns: [{ label: 'Item / delivery details', weight: 4 }, { label: 'SKU / reference', weight: 2 }, { label: 'Qty', weight: .6, align: 'right' }, { label: 'Checked', weight: .7 }],
    rows: [
      ['Deliver to: ' + (shipping.name || order.profiles?.full_name || 'Customer'), '', '', ''],
      ['Address: ' + (address || 'Not supplied - verify before dispatch'), '', '', ''],
      ['Contact: ' + (shipping.mobile || order.profiles?.phone || 'Not supplied'), shipping.email || order.profiles?.email || '', '', ''],
      ['Delivery note: ' + (shipping.note || 'No delivery note'), '', '', ''],
      ['Placed: ' + dateTime(order.created_at) + ' PHT', order.id, '', ''],
      ...order.order_items.map((item, index) => [`${index + 1}. ${item.product_name}`, item.product_id || 'Not recorded', item.quantity, '[  ]']),
      ['Packed by: ____________________', 'Date: __________________', '', ''],
      ['Checked / released by: ____________________', 'Date: __________________', '', ''],
    ],
    note: 'Verify quantity, condition and delivery details before dispatch.',
  };
}
