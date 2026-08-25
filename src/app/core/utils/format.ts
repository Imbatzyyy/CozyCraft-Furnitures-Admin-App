import { Order, PaymentTransaction } from '../models/admin.models';

/**
 * Converts database timestamps without allowing a browser-specific parser
 * failure to interrupt an Angular render. PostgreSQL normally returns ISO
 * timestamps, but older WKWebView versions can reject otherwise valid values
 * containing a space separator, long fractional seconds, or a short timezone
 * offset. Keep the original parse first, then normalize only as a fallback.
 */
export const parseTimestamp = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const source = value.trim();
  if (!source) return null;

  const direct = new Date(source);
  if (Number.isFinite(direct.getTime())) return direct;

  const normalized = source
    .replace(/^(\d{4}-\d{2}-\d{2})\s+(?=\d{2}:\d{2})/, '$1T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    .replace(/([+-]\d{2})$/, '$1:00');
  const fallback = new Date(normalized);
  return Number.isFinite(fallback.getTime()) ? fallback : null;
};

export const formatPht = (
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = '—',
) => {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return fallback;
  try {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      ...options,
    }).format(timestamp);
  } catch {
    return fallback;
  }
};

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

export const dateTime = (value: string | null | undefined) => formatPht(value, {
  dateStyle: 'medium',
  timeStyle: 'short',
}, 'Not recorded');

export const shortDate = (value: string | null | undefined) => formatPht(value, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export const timeAgo = (value: string | null | undefined) => {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return 'Just now';
  const difference = Date.now() - timestamp.getTime();
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
    return priority
      || (parseTimestamp(right.updated_at)?.getTime() ?? 0)
      - (parseTimestamp(left.updated_at)?.getTime() ?? 0);
  })[0];

export const settledOrder = (order: Pick<Order, 'payment_status' | 'status'>) =>
  order.payment_status === 'paid' && order.status !== 'cancelled';
