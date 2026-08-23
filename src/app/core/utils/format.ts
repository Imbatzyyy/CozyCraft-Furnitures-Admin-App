import { Order, PaymentTransaction } from '../models/admin.models';

export const money = (value: number | string | null | undefined, digits = 0) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));

export const compactMoney = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));

export const dateTime = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  : 'Not recorded';

export const shortDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value))
  : '—';

export const timeAgo = (value: string | null | undefined) => {
  if (!value) return 'Just now';
  const difference = Date.now() - Date.parse(value);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (difference < 60_000) return 'Just now';
  if (difference < 3_600_000) return formatter.format(-Math.round(difference / 60_000), 'minute');
  if (difference < 86_400_000) return formatter.format(-Math.round(difference / 3_600_000), 'hour');
  if (difference < 604_800_000) return formatter.format(-Math.round(difference / 86_400_000), 'day');
  return shortDate(value);
};

export const titleCase = (value: string | null | undefined) => (value ?? '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const initials = (value: string | null | undefined) => (value || 'CozyCraft')
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

export const currentPayment = (order: Order): PaymentTransaction | undefined =>
  [...(order.payment_transactions ?? [])].sort((left, right) => {
    const settled = new Set(['paid', 'refunded']);
    const priority = Number(settled.has(right.status)) - Number(settled.has(left.status));
    return priority || Date.parse(right.updated_at) - Date.parse(left.updated_at);
  })[0];

export const settledOrder = (order: Pick<Order, 'payment_status' | 'status'>) =>
  order.payment_status === 'paid' && order.status !== 'cancelled';
