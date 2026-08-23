import type { AdminNotification } from '../models/admin.models';

export type NotificationDestinationInput = Partial<Pick<AdminNotification,
  'kind' | 'entity_type' | 'entity_id' | 'route'>> & {
    destination?: unknown;
  };

const allowedDestination = /^\/app\/(dashboard|orders|products|categories|inventory|payments|customers|reviews|support|reports|activity|notifications|team|settings|more)(?:[/?#]|$)/;

const safeExplicitDestination = (value: unknown) => {
  if (typeof value !== 'string') return '';
  let destination = value.trim();
  if (!destination || destination.includes('://') || /[\\\r\n]/.test(destination)) return '';

  destination = destination
    .replace(/^\/admin\/activity-logs(?=\/?(?:[?#]|$))/, '/app/activity')
    .replace(/^\/admin(?=\/|$)/, '/app');

  return allowedDestination.test(destination) ? destination : '';
};

/**
 * Resolve a durable admin notification to the most specific safe mobile route.
 *
 * Entity metadata takes precedence over legacy web routes so older notification
 * rows such as `/admin/orders` still open the exact order on Android and iOS.
 */
export const adminNotificationDestination = (notification: NotificationDestinationInput) => {
  const entityType = typeof notification.entity_type === 'string'
    ? notification.entity_type.trim().toLocaleLowerCase('en')
    : '';
  const rawId = typeof notification.entity_id === 'string' ? notification.entity_id.trim() : '';
  const id = rawId ? encodeURIComponent(rawId) : '';

  if (id) {
    if (entityType === 'orders' || entityType === 'return_requests' || notification.kind === 'order') {
      return `/app/orders/${id}`;
    }
    if (entityType === 'reviews' || notification.kind === 'review') {
      return `/app/reviews?review=${id}`;
    }
    if (entityType === 'support_tickets' || notification.kind === 'support') {
      return `/app/support/${id}`;
    }
    if (entityType === 'products' && notification.kind === 'inventory') {
      return `/app/inventory?product=${id}`;
    }
    if (entityType === 'products') return `/app/products/${id}`;
    if (entityType === 'profiles' || entityType === 'customers') return `/app/customers/${id}`;
  }

  if (entityType === 'errors' || entityType === 'client_errors') return '/app/activity?scope=errors';

  const explicit = safeExplicitDestination(notification.destination)
    || safeExplicitDestination(notification.route);
  if (explicit) return explicit;

  switch (notification.kind) {
    case 'order': return '/app/orders';
    case 'review': return '/app/reviews';
    case 'support': return '/app/support';
    case 'inventory': return '/app/inventory';
    case 'report': return '/app/reports';
    case 'system': return '/app/activity';
    default: return '/app/notifications';
  }
};
