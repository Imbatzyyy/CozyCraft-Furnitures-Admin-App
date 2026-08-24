export type AdminRole = 'staff' | 'admin' | 'superadmin';
export type AnyRole = 'customer' | AdminRole;
export type ProductStatus = 'draft' | 'active' | 'inactive';
export type OrderStatus = 'pending' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type SupportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'item_received' | 'refund_processing' | 'refunded' | 'closed';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  username?: string;
  gender?: string;
  date_of_birth?: string | null;
  role: AnyRole;
  staff_active: boolean;
  created_at: string;
  addresses?: Address[];
  orders?: CustomerOrderSummary[];
  support_tickets?: CustomerTicketSummary[];
  address_count?: number;
  order_count?: number;
  support_ticket_count?: number;
}

export type TeamMember = Profile & { role: AdminRole };

export interface Address {
  id: string;
  user_id: string;
  label: string;
  recipient_name: string;
  mobile: string;
  email: string;
  address_line: string;
  barangay: string;
  city: string;
  province: string;
  postal_code: string;
  delivery_note: string;
  is_primary: boolean;
}

export interface CustomerOrderSummary {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total: number;
  created_at: string;
}

export interface CustomerTicketSummary {
  id: string;
  ticket_number: string;
  status: SupportStatus;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  price: number;
  stock_quantity: number;
  status: ProductStatus;
  color: string;
  material: string;
  dimensions: string;
  description: string;
  images: string[];
  main_image_index: number;
  rating: number;
  review_count: number;
  created_at: string;
  updated_at?: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  active: boolean;
  created_at?: string;
}

export interface OrderItem {
  id: number;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  image_url: string | null;
}

export interface OrderStatusHistory {
  id: number;
  order_id: string;
  status: OrderStatus;
  changed_at: string;
  changed_by: string | null;
}

export interface PaymentTransaction {
  id: string;
  order_id: string;
  provider: 'paymongo';
  provider_session_id: string | null;
  provider_payment_id: string | null;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';
  amount: number;
  currency: 'PHP';
  livemode: boolean;
  failure_reason: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShippingAddress {
  label?: string;
  name?: string;
  mobile?: string;
  email?: string;
  line?: string;
  barangay?: string;
  city?: string;
  province?: string;
  postal?: string;
  note?: string;
  [key: string]: string | undefined;
}

export interface Order {
  id: string;
  order_number: string;
  user_id: string;
  status: OrderStatus;
  payment_method: 'cod' | 'card' | 'gcash' | string;
  payment_status: PaymentStatus;
  cancellation_reason: string | null;
  cancellation_requested_at: string | null;
  cancellation_status: 'pending' | 'approved' | 'rejected' | null;
  cancellation_reviewed_at: string | null;
  cancellation_reviewed_by: string | null;
  cancellation_decision_note: string | null;
  refund_status: 'processing' | 'succeeded' | 'failed' | 'demo_succeeded' | null;
  provider_refund_id: string | null;
  refunded_at: string | null;
  refund_email_sent_at: string | null;
  refund_email_id: string | null;
  refund_email_error: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  shipping_address: ShippingAddress;
  created_at: string;
  order_items: OrderItem[];
  order_status_history: OrderStatusHistory[];
  payment_transactions: PaymentTransaction[];
  profiles: Pick<Profile, 'full_name' | 'email' | 'phone'> | null;
}

export interface ReturnRequest {
  id: string;
  order_id: string;
  user_id?: string;
  return_number: string;
  reason: string;
  details: string;
  status: ReturnStatus;
  admin_note: string | null;
  evidence_paths: string[];
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface SupportTicket {
  id: string;
  ticket_number: string;
  user_id: string;
  order_id: string | null;
  subject: string;
  message: string;
  status: SupportStatus;
  category: 'order' | 'delivery' | 'payment' | 'product' | 'return' | 'account' | 'general';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_to: string | null;
  attachment_paths: string[];
  admin_reply: string | null;
  created_at: string;
  updated_at: string;
  profiles: Pick<Profile, 'full_name' | 'email'> | null;
}

export interface Review {
  id: string;
  rating: number;
  title: string;
  body: string;
  approved: boolean;
  image_urls: string[];
  reviewer_display_name: string | null;
  created_at: string;
  profiles: Pick<Profile, 'full_name' | 'email' | 'avatar_url'> | null;
  products: Pick<Product, 'name'> | null;
}

export interface InventoryMovement {
  id: number;
  product_id: string;
  previous_quantity: number;
  new_quantity: number;
  quantity_delta: number;
  reason: string;
  created_at: string;
}

export interface AdminNotification {
  id: number;
  kind: 'order' | 'review' | 'support' | 'inventory' | 'report' | 'system';
  title: string;
  message: string;
  entity_type: string;
  entity_id: string | null;
  route: string;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
}

export interface ActivityLog {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  platform: 'web' | 'mobile' | 'edge' | 'system';
  actor_role: string | null;
  profiles: Pick<Profile, 'full_name' | 'email' | 'role'> | null;
}

export interface ClientErrorEvent {
  id: number;
  message: string;
  stack: string | null;
  path: string;
  context: string;
  user_agent: string | null;
  created_at: string;
  profiles: Pick<Profile, 'full_name' | 'email' | 'role'> | null;
}

export interface CheckoutSettings {
  standard_delivery_fee: number;
  free_delivery_minimum: number;
  minimum_order_amount: number;
  maximum_order_amount: number;
  cod_enabled: boolean;
  card_enabled: boolean;
  gcash_enabled: boolean;
  cod_maximum_order: number;
}

export interface FulfillmentSettings {
  estimated_delivery_days_min: number;
  estimated_delivery_days_max: number;
  cancellation_window_hours: number;
  return_window_days: number;
  order_number_prefix: string;
  stock_reservation_minutes: number;
  out_of_stock_behavior: 'hide' | 'show_unavailable';
  auto_archive_discontinued: boolean;
}

export interface ReviewSettings {
  approval_required: boolean;
  verified_purchases_only: boolean;
  minimum_length: number;
  maximum_length: number;
  photos_enabled: boolean;
}

export interface AccountSettings {
  username_required: boolean;
  google_auth_enabled: boolean;
  email_verification_required: boolean;
  password_minimum_length: number;
  customer_mfa_available: boolean;
}

export interface EmailEventSettings {
  account_confirmation: boolean;
  order_confirmation: boolean;
  payment_received: boolean;
  fulfillment_updates: boolean;
  delivered: boolean;
  cancelled_refunded: boolean;
  support_replies: boolean;
}

export interface ReportSettings {
  timezone: string;
  frequency: 'weekly' | 'monthly';
  default_range: 'This week' | 'This month' | 'Quarter';
  recipients: string[];
  data_retention_days: number;
}

export interface StoreSettings {
  id: boolean;
  store_name: string;
  store_description: string;
  currency_code: 'PHP' | 'USD' | 'EUR' | 'SGD' | 'JPY';
  contact_email: string;
  support_phone: string;
  business_address: string;
  delivery_area: string;
  low_stock_threshold: number;
  inventory_alerts: boolean;
  weekly_report_enabled: boolean;
  social_links: Record<string, string>;
  announcement_enabled: boolean;
  announcement_text: string;
  announcement_link: string;
  maintenance_mode: boolean;
  checkout_settings: CheckoutSettings;
  fulfillment_settings: FulfillmentSettings;
  review_settings: ReviewSettings;
  account_settings: AccountSettings;
  email_event_settings: EmailEventSettings;
  report_settings: ReportSettings;
  updated_at: string | null;
}

export interface AdminSecuritySettings {
  id: boolean;
  require_admin_mfa: boolean;
  session_timeout_minutes: number;
  maximum_failed_logins: number;
  lockout_minutes: number;
  security_alerts_enabled: boolean;
  notification_email: string;
  integration_status: Record<string, boolean>;
  updated_at: string | null;
  updated_by: string | null;
}

export interface DashboardMetrics {
  settledRevenue: number;
  monthRevenue: number;
  pendingOrders: number;
  fulfillmentQueue: number;
  lowStock: number;
  openSupport: number;
  pendingReviews: number;
  customers: number;
}

export type WorkspaceSearchKind = 'page' | 'order' | 'product' | 'customer' | 'ticket' | 'review' | 'notification';

export interface WorkspaceSearchResult {
  id: string;
  kind: WorkspaceSearchKind;
  title: string;
  detail: string;
  route: string;
  icon: string;
  keywords: string;
}
