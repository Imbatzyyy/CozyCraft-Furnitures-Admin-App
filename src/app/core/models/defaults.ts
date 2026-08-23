import { AdminSecuritySettings, StoreSettings } from './admin.models';

export const defaultStoreSettings: StoreSettings = {
  id: true,
  store_name: 'CozyCraft Furnitures',
  store_description: 'Designed for a slower, warmer life at home.',
  contact_email: 'hello@cozycraftfurnitures.com',
  support_phone: '',
  business_address: '',
  delivery_area: 'Metro Manila',
  low_stock_threshold: 8,
  inventory_alerts: true,
  weekly_report_enabled: false,
  social_links: { facebook: '', instagram: '', tiktok: '' },
  announcement_enabled: false,
  announcement_text: '',
  announcement_link: '',
  maintenance_mode: false,
  checkout_settings: {
    standard_delivery_fee: 0,
    free_delivery_minimum: 0,
    minimum_order_amount: 0,
    maximum_order_amount: 0,
    cod_enabled: true,
    card_enabled: true,
    gcash_enabled: true,
    cod_maximum_order: 0,
  },
  fulfillment_settings: {
    estimated_delivery_days_min: 5,
    estimated_delivery_days_max: 7,
    cancellation_window_hours: 24,
    return_window_days: 7,
    order_number_prefix: 'CC',
    stock_reservation_minutes: 15,
    out_of_stock_behavior: 'show_unavailable',
    auto_archive_discontinued: false,
  },
  review_settings: {
    approval_required: false,
    verified_purchases_only: true,
    minimum_length: 5,
    maximum_length: 2000,
    photos_enabled: false,
  },
  account_settings: {
    username_required: true,
    google_auth_enabled: true,
    email_verification_required: true,
    password_minimum_length: 8,
    customer_mfa_available: true,
  },
  email_event_settings: {
    account_confirmation: true,
    order_confirmation: true,
    payment_received: true,
    fulfillment_updates: true,
    delivered: true,
    cancelled_refunded: true,
    support_replies: true,
  },
  report_settings: {
    timezone: 'Asia/Manila',
    frequency: 'weekly',
    default_range: 'This month',
    recipients: [],
    data_retention_days: 90,
  },
  updated_at: null,
};

export const defaultAdminSecuritySettings: AdminSecuritySettings = {
  id: true,
  require_admin_mfa: true,
  session_timeout_minutes: 480,
  maximum_failed_logins: 5,
  lockout_minutes: 15,
  security_alerts_enabled: true,
  notification_email: '',
  integration_status: {
    supabase: true,
    paymongo: true,
    resend: true,
    google_oauth: true,
    chatbot: true,
  },
  updated_at: null,
  updated_by: null,
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const normalizeStoreSettings = (source: Partial<StoreSettings> | null | undefined): StoreSettings => {
  const value = source ?? {};
  return {
    ...defaultStoreSettings,
    ...value,
    social_links: { ...defaultStoreSettings.social_links, ...objectValue(value.social_links) } as Record<string, string>,
    checkout_settings: { ...defaultStoreSettings.checkout_settings, ...objectValue(value.checkout_settings) },
    fulfillment_settings: { ...defaultStoreSettings.fulfillment_settings, ...objectValue(value.fulfillment_settings) },
    review_settings: { ...defaultStoreSettings.review_settings, ...objectValue(value.review_settings) },
    account_settings: { ...defaultStoreSettings.account_settings, ...objectValue(value.account_settings) },
    email_event_settings: { ...defaultStoreSettings.email_event_settings, ...objectValue(value.email_event_settings) },
    report_settings: { ...defaultStoreSettings.report_settings, ...objectValue(value.report_settings) },
  } as StoreSettings;
};

export const normalizeSecuritySettings = (
  source: Partial<AdminSecuritySettings> | null | undefined,
): AdminSecuritySettings => ({
  ...defaultAdminSecuritySettings,
  ...(source ?? {}),
  integration_status: {
    ...defaultAdminSecuritySettings.integration_status,
    ...objectValue(source?.integration_status),
  } as Record<string, boolean>,
});
