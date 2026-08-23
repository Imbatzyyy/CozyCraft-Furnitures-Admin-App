import { AdminRole, OrderStatus, ReturnStatus } from '../models/admin.models';

export const isAdminRole = (role: string | null | undefined): role is AdminRole =>
  role === 'staff' || role === 'admin' || role === 'superadmin';

export const canManageFinancials = (role: AdminRole | null | undefined) =>
  role === 'admin' || role === 'superadmin';

export const canManageWorkspace = (role: AdminRole | null | undefined) => role === 'superadmin';

const staffRoutes = new Set([
  '/app/dashboard',
  '/app/orders',
  '/app/products',
  '/app/categories',
  '/app/inventory',
  '/app/reviews',
  '/app/support',
  '/app/notifications',
  '/app/more',
]);

const administratorRoutes = new Set([
  ...staffRoutes,
  '/app/payments',
  '/app/customers',
  '/app/member-tiers',
  '/app/experience',
  '/app/content',
  '/app/reports',
  '/app/activity',
]);

export const canAccessRoute = (role: AdminRole | null | undefined, url: string) => {
  const normalized = `/${url.split('?')[0].split('/').filter(Boolean).slice(0, 2).join('/')}`;
  if (role === 'superadmin') return true;
  return (role === 'admin' ? administratorRoutes : staffRoutes).has(normalized);
};

export const safeAdminReturnUrl = (role: AdminRole | null | undefined, value: string | null | undefined) => {
  if (!value || !/^\/app(?:\/|$)/.test(value) || /[\\\r\n]/.test(value) || value.includes('://')) return '/app/dashboard';
  return canAccessRoute(role, value) ? value : '/app/dashboard';
};

const fulfillmentTransitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const allowedFulfillmentStatuses = (current: OrderStatus) => [current, ...fulfillmentTransitions[current]];

const returnTransitions: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['item_received', 'rejected'],
  rejected: ['closed'],
  item_received: ['refund_processing', 'closed'],
  refund_processing: [],
  refunded: ['closed'],
  closed: [],
};

export const allowedReturnStatuses = (current: ReturnStatus) => [current, ...returnTransitions[current]];
