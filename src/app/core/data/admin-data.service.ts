import { computed, Injectable, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { AdminAuthService } from '../auth/admin-auth.service';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { NativePlatformService } from '../native/native-platform.service';
import {
  ActivityLog,
  Address,
  AdminNotification,
  AdminSecuritySettings,
  Category,
  ClientErrorEvent,
  DashboardMetrics,
  InventoryMovement,
  Order,
  Product,
  Profile,
  ReturnRequest,
  Review,
  StoreSettings,
  SupportTicket,
  TeamMember,
  WorkspaceSearchResult,
} from '../models/admin.models';
import {
  defaultAdminSecuritySettings,
  defaultStoreSettings,
  normalizeSecuritySettings,
  normalizeStoreSettings,
} from '../models/defaults';
import { isAdminRole } from '../utils/admin-permissions';
import { settledOrder } from '../utils/format';
import { adminNotificationDestination } from '../utils/notification-destination';

const orderGraphSelect = [
  'id',
  'order_number',
  'user_id',
  'status',
  'payment_method',
  'payment_status',
  'cancellation_reason',
  'cancellation_requested_at',
  'cancellation_status',
  'cancellation_reviewed_at',
  'cancellation_reviewed_by',
  'cancellation_decision_note',
  'refund_status',
  'provider_refund_id',
  'refunded_at',
  'refund_email_sent_at',
  'refund_email_id',
  'refund_email_error',
  'subtotal',
  'delivery_fee',
  'total',
  'shipping_address',
  'created_at',
  'order_items(id,product_id,product_name,unit_price,quantity,image_url)',
  'order_status_history(id,order_id,status,changed_at,changed_by)',
  'payment_transactions(id,order_id,provider,provider_session_id,provider_payment_id,status,amount,currency,livemode,failure_reason,paid_at,created_at,updated_at)',
  'profiles!orders_user_id_fkey(full_name,email,phone)',
].join(',');

type RefreshTarget =
  | 'orders'
  | 'products'
  | 'categories'
  | 'customers'
  | 'tickets'
  | 'reviews'
  | 'returns'
  | 'inventory'
  | 'notifications'
  | 'settings'
  | 'team'
  | 'activity';

type ActivityLoadMode = 'replace' | 'append' | 'refresh';

const ACTIVITY_LOG_PAGE_SIZE = 72;
const CLIENT_ERROR_PAGE_SIZE = 16;
const ACTIVITY_REFRESH_PAGE_SIZE = 24;
const CLIENT_ERROR_REFRESH_PAGE_SIZE = 8;

@Injectable({ providedIn: 'root' })
export class AdminDataService {
  private readonly client = this.connection.client;
  private channel: RealtimeChannel | null = null;
  private startPromise: Promise<void> | null = null;
  private workspaceGeneration = 0;
  private refreshSequence = 0;
  private snapshotGeneration = 0;
  private completedSnapshotGeneration = 0;
  private readonly reconcileAfterSnapshot = new Set<number>();
  private readonly requestSequences = new Map<RefreshTarget, number>();
  private accessRevalidation: Promise<void> | null = null;
  private readonly refreshTimers = new Map<RefreshTarget, ReturnType<typeof setTimeout>>();
  private readonly avatarSignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

  private readonly productsState = signal<Product[]>([]);
  private readonly categoriesState = signal<Category[]>([]);
  private readonly ordersState = signal<Order[]>([]);
  private readonly customersState = signal<Profile[]>([]);
  private readonly ticketsState = signal<SupportTicket[]>([]);
  private readonly reviewsState = signal<Review[]>([]);
  private readonly returnsState = signal<ReturnRequest[]>([]);
  private readonly movementsState = signal<InventoryMovement[]>([]);
  private readonly notificationsState = signal<AdminNotification[]>([]);
  private readonly activityState = signal<ActivityLog[]>([]);
  private readonly clientErrorsState = signal<ClientErrorEvent[]>([]);
  private readonly activityLoadingState = signal(false);
  private readonly activityHasMoreState = signal(false);
  private readonly activityRangeDaysState = signal<number | null>(30);
  private activityLogsHaveMore = true;
  private clientErrorsHaveMore = true;
  private readonly teamState = signal<TeamMember[]>([]);
  private readonly settingsState = signal<StoreSettings>(defaultStoreSettings);
  private readonly securityState = signal<AdminSecuritySettings>(defaultAdminSecuritySettings);
  private readonly loadingState = signal(false);
  private readonly initializedState = signal(false);
  private readonly refreshingState = signal(false);
  private readonly realtimeState = signal<'connecting' | 'live' | 'offline' | 'error'>('connecting');
  private readonly lastSyncState = signal<Date | null>(null);
  private readonly errorState = signal('');

  readonly products = this.productsState.asReadonly();
  readonly categories = this.categoriesState.asReadonly();
  readonly orders = this.ordersState.asReadonly();
  readonly customers = this.customersState.asReadonly();
  readonly tickets = this.ticketsState.asReadonly();
  readonly reviews = this.reviewsState.asReadonly();
  readonly returnRequests = this.returnsState.asReadonly();
  readonly inventoryMovements = this.movementsState.asReadonly();
  readonly notifications = this.notificationsState.asReadonly();
  readonly activity = this.activityState.asReadonly();
  readonly clientErrors = this.clientErrorsState.asReadonly();
  readonly activityLoading = this.activityLoadingState.asReadonly();
  readonly activityHasMore = this.activityHasMoreState.asReadonly();
  readonly activityRangeDays = this.activityRangeDaysState.asReadonly();
  readonly team = this.teamState.asReadonly();
  readonly settings = this.settingsState.asReadonly();
  readonly security = this.securityState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly initialized = this.initializedState.asReadonly();
  readonly refreshing = this.refreshingState.asReadonly();
  readonly realtimeStatus = this.realtimeState.asReadonly();
  readonly lastSync = this.lastSyncState.asReadonly();
  readonly error = this.errorState.asReadonly();

  readonly unreadNotifications = computed(() => this.notificationsState().filter((item) => !item.read_at).length);
  readonly urgentTickets = computed(() => this.ticketsState().filter((item) =>
    ['open', 'in_progress'].includes(item.status) && ['high', 'urgent'].includes(item.priority)).length);
  readonly lowStockProducts = computed(() => {
    const threshold = this.settingsState().low_stock_threshold;
    return this.productsState().filter((product) => product.stock_quantity <= threshold);
  });
  readonly dashboardMetrics = computed<DashboardMetrics>(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const settled = this.ordersState().filter(settledOrder);
    return {
      settledRevenue: settled.reduce((total, order) => total + Number(order.total), 0),
      monthRevenue: settled
        .filter((order) => new Date(order.created_at) >= monthStart)
        .reduce((total, order) => total + Number(order.total), 0),
      pendingOrders: this.ordersState().filter((order) => order.status === 'pending').length,
      fulfillmentQueue: this.ordersState().filter((order) => ['pending', 'processing', 'packed', 'shipped'].includes(order.status)).length,
      lowStock: this.lowStockProducts().length,
      openSupport: this.ticketsState().filter((ticket) => ['open', 'in_progress'].includes(ticket.status)).length,
      pendingReviews: this.reviewsState().filter((review) => !review.approved).length,
      customers: this.customersState().length,
    };
  });
  readonly revenueSeries = computed(() => {
    const now = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const start = new Date(now.getFullYear(), now.getMonth() - (6 - index), 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return {
        label: start.toLocaleDateString('en-PH', { month: 'short' }),
        value: this.ordersState()
          .filter((order) => settledOrder(order) && new Date(order.created_at) >= start && new Date(order.created_at) < end)
          .reduce((sum, order) => sum + Number(order.total), 0),
      };
    });
  });
  readonly searchIndex = computed<WorkspaceSearchResult[]>(() => [
    ...this.productsState().map((product) => ({
      id: `product-${product.id}`,
      kind: 'product' as const,
      title: product.name,
      detail: `${product.category} · ${product.stock_quantity} in stock`,
      route: `/app/products/${product.id}`,
      icon: 'cube-outline',
      keywords: `${product.id} ${product.category} ${product.subcategory} ${product.status} ${product.color} ${product.material} ${product.description}`,
    })),
    ...this.ordersState().map((order) => ({
      id: `order-${order.id}`,
      kind: 'order' as const,
      title: `Order ${order.order_number}`,
      detail: `${order.shipping_address.name || order.profiles?.full_name || 'Customer'} · ${order.status}`,
      route: `/app/orders/${order.id}`,
      icon: 'receipt-outline',
      keywords: `${order.id} ${order.order_number} ${order.payment_method} ${order.payment_status} ${order.shipping_address.email ?? ''} ${order.shipping_address.mobile ?? ''} ${order.profiles?.email ?? ''} ${order.profiles?.phone ?? ''} ${order.order_items.map((item) => item.product_name).join(' ')}`,
    })),
    ...this.customersState().map((customer) => ({
      id: `customer-${customer.id}`,
      kind: 'customer' as const,
      title: customer.full_name || customer.username || 'Customer',
      detail: customer.email || customer.phone || 'Customer account',
      route: `/app/customers/${customer.id}`,
      icon: 'person-outline',
      keywords: `${customer.id} ${customer.username ?? ''} ${customer.email ?? ''} ${customer.phone ?? ''}`,
    })),
    ...this.ticketsState().map((ticket) => ({
      id: `ticket-${ticket.id}`,
      kind: 'ticket' as const,
      title: `${ticket.ticket_number} · ${ticket.subject}`,
      detail: `${ticket.profiles?.full_name || ticket.profiles?.email || 'Customer'} · ${ticket.status}`,
      route: `/app/support/${ticket.id}`,
      icon: 'chatbubble-outline',
      keywords: `${ticket.ticket_number} ${ticket.message} ${ticket.category} ${ticket.priority} ${ticket.profiles?.email ?? ''} ${ticket.order_id ?? ''}`,
    })),
    ...this.reviewsState().map((review) => ({
      id: `review-${review.id}`,
      kind: 'review' as const,
      title: review.title || `${review.rating}-star review`,
      detail: `${review.profiles?.full_name || review.reviewer_display_name || 'Customer'} · ${review.products?.name || 'Product review'}`,
      route: `/app/reviews?review=${encodeURIComponent(review.id)}`,
      icon: 'star-outline',
      keywords: `${review.id} ${review.body} ${review.rating} star ${review.approved ? 'published approved' : 'pending hidden'} ${review.profiles?.email ?? ''} ${review.products?.name ?? ''}`,
    })),
    ...this.notificationsState().map((notification) => ({
      id: `notification-${notification.id}`,
      kind: 'notification' as const,
      title: notification.title,
      detail: notification.message,
      route: adminNotificationDestination(notification),
      icon: 'notifications-outline',
      keywords: `${notification.id} ${notification.kind} ${notification.entity_type} ${notification.entity_id ?? ''} ${notification.read_at ? 'read' : 'unread'}`,
    })),
  ]);

  constructor(
    private readonly connection: SupabaseAdminService,
    private readonly auth: AdminAuthService,
    private readonly native: NativePlatformService,
  ) {}

  async start() {
    if (this.startPromise) return this.startPromise;
    const generation = ++this.workspaceGeneration;
    this.startPromise = this.initializeWorkspace(generation);
    return this.startPromise;
  }

  private async initializeWorkspace(generation: number) {
    if (!this.generationIsActive(generation)) return;
    this.loadingState.set(true);
    this.errorState.set('');
    await this.connectRealtime(generation);
    if (!this.generationIsActive(generation)) return;
    this.snapshotGeneration = generation;
    await this.refreshAll(false, generation);
    if (!this.generationIsActive(generation)) return;
    this.completedSnapshotGeneration = generation;
    if (this.reconcileAfterSnapshot.delete(generation)) await this.refreshAll(false, generation);
    if (this.generationIsActive(generation)) {
      this.initializedState.set(true);
      this.loadingState.set(false);
    }
  }

  async refreshAll(showRefresh = true, generation = this.workspaceGeneration) {
    if (!this.generationIsActive(generation)) return;
    const refreshSequence = ++this.refreshSequence;
    if (showRefresh) this.refreshingState.set(true);
    const role = this.auth.role();
    const tasks: Array<Promise<void>> = [
      this.loadProducts(generation),
      this.loadCategories(generation),
      this.loadOrders(generation),
      this.loadTickets(generation),
      this.loadReviews(generation),
      this.loadReturns(generation),
      this.loadInventory(generation),
      this.loadNotifications(generation),
      this.loadSettings(generation),
    ];
    if (role === 'admin' || role === 'superadmin') {
      tasks.push(this.loadCustomers(generation), this.loadActivity(30, generation));
    }
    if (role === 'superadmin') tasks.push(this.loadTeam(generation));
    const results = await Promise.allSettled(tasks);
    if (!this.generationIsActive(generation) || refreshSequence !== this.refreshSequence) return;
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) {
      this.errorState.set(`${failures.length} workspace section${failures.length === 1 ? '' : 's'} could not synchronize. Pull to retry. ${this.errorMessage(failures[0].reason)}`);
    } else {
      this.errorState.set('');
      this.lastSyncState.set(new Date());
    }
    this.refreshingState.set(false);
  }

  async loadProducts(generation = this.workspaceGeneration) {
    const request = this.beginRequest('products', generation);
    const rows = await this.pagedRows((from, to) => this.client
      .from('products')
      .select('id,name,category,subcategory,price,stock_quantity,status,color,material,dimensions,description,images,main_image_index,rating,review_count,created_at,updated_at')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)) as unknown as Product[];
    if (!this.requestIsCurrent('products', request, generation)) return;
    this.productsState.set(rows.map((row) => ({
      ...row,
      price: Number(row.price),
      rating: Number(row.rating),
      images: Array.isArray(row.images) ? row.images : [],
    })));
  }

  async loadCategories(generation = this.workspaceGeneration) {
    const request = this.beginRequest('categories', generation);
    const { data, error } = await this.client
      .from('categories')
      .select('id,name,slug,sort_order,active,created_at')
      .order('sort_order')
      .order('name');
    if (error) throw error;
    if (!this.requestIsCurrent('categories', request, generation)) return;
    this.categoriesState.set((data ?? []) as Category[]);
  }

  async loadOrders(generation = this.workspaceGeneration) {
    const request = this.beginRequest('orders', generation);
    const rows = await this.pagedRows((from, to) => this.client
      .from('orders')
      .select(orderGraphSelect)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)) as unknown as Order[];
    if (!this.requestIsCurrent('orders', request, generation)) return;
    this.ordersState.set(rows.map((row) => ({
      ...row,
      profiles: this.singleRelation(row.profiles),
      order_items: row.order_items ?? [],
      order_status_history: row.order_status_history ?? [],
      payment_transactions: row.payment_transactions ?? [],
      subtotal: Number(row.subtotal),
      delivery_fee: Number(row.delivery_fee),
      total: Number(row.total),
    })));
  }

  async loadCustomers(generation = this.workspaceGeneration) {
    const request = this.beginRequest('customers', generation);
    try {
      const directory = await this.pagedRows((from, to) => this.client
        .rpc('admin_customer_directory')
        .range(from, to));
      const rows = directory as unknown as Array<Profile & {
        primary_address: Partial<Address> | null;
      }>;
      if (!this.requestIsCurrent('customers', request, generation)) return;
      const customers = rows.map(({ primary_address: primaryAddress, ...customer }) => ({
        ...customer,
        addresses: primaryAddress ? [{
          id: String(primaryAddress.id ?? `primary-${customer.id}`),
          user_id: customer.id,
          label: String(primaryAddress.label ?? 'Primary'),
          recipient_name: String(primaryAddress.recipient_name ?? customer.full_name ?? 'Customer'),
          mobile: String(primaryAddress.mobile ?? customer.phone ?? ''),
          email: String(primaryAddress.email ?? customer.email ?? ''),
          address_line: String(primaryAddress.address_line ?? ''),
          barangay: String(primaryAddress.barangay ?? ''),
          city: String(primaryAddress.city ?? ''),
          province: String(primaryAddress.province ?? ''),
          postal_code: String(primaryAddress.postal_code ?? ''),
          delivery_note: String(primaryAddress.delivery_note ?? ''),
          is_primary: true,
        }] : [],
      }));
      const protectedCustomers = await this.withSignedAvatarUrls(customers);
      if (this.requestIsCurrent('customers', request, generation)) this.customersState.set(protectedCustomers);
      return;
    } catch {
      if (!this.requestIsCurrent('customers', request, generation)) return;
      // Use the RLS-respecting compatibility query until the directory RPC is deployed.
    }

    // Compatibility fallback while the native hardening migration is being
    // deployed. Existing RLS may omit saved addresses, but never bypasses it.
    const data = await this.pagedRows((from, to) => this.client
      .from('profiles')
      .select('id,full_name,email,phone,avatar_url,username,gender,date_of_birth,role,staff_active,created_at,addresses!addresses_user_id_fkey(id,user_id,label,recipient_name,mobile,email,address_line,barangay,city,province,postal_code,delivery_note,is_primary)')
      .eq('role', 'customer')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to));
    const protectedCustomers = await this.withSignedAvatarUrls(data as unknown as Profile[]);
    if (this.requestIsCurrent('customers', request, generation)) this.customersState.set(protectedCustomers);
  }

  async loadTickets(generation = this.workspaceGeneration) {
    const request = this.beginRequest('tickets', generation);
    const [ticketRows, labelRows] = await Promise.all([
      this.pagedRows((from, to) => this.client
        .from('support_tickets')
        .select('id,ticket_number,user_id,order_id,subject,message,status,category,priority,assigned_to,attachment_paths,admin_reply,created_at,updated_at,profiles!support_tickets_user_id_fkey(full_name,email)')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to)),
      this.pagedRows((from, to) => this.client.rpc('staff_customer_labels').range(from, to)).catch(() => []),
    ]);
    const labels = new Map((labelRows as unknown as Array<{ id: string; full_name: string; email: string | null }>)
      .map((profile) => [profile.id, profile]));
    if (!this.requestIsCurrent('tickets', request, generation)) return;
    this.ticketsState.set((ticketRows as unknown as SupportTicket[]).map((row) => ({
      ...row,
      attachment_paths: Array.isArray(row.attachment_paths) ? row.attachment_paths : [],
      profiles: this.singleRelation(row.profiles) ?? labels.get(row.user_id) ?? null,
    })));
  }

  async loadReviews(generation = this.workspaceGeneration) {
    const request = this.beginRequest('reviews', generation);
    const rows = await this.pagedRows((from, to) => this.client
      .from('reviews')
      .select('id,rating,title,body,approved,image_urls,reviewer_display_name,created_at,profiles!reviews_user_id_fkey(full_name,email,avatar_url),products!reviews_product_id_fkey(name)')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)) as unknown as Review[];
    if (!this.requestIsCurrent('reviews', request, generation)) return;
    const normalizedReviews = rows.map((row) => ({
      ...row,
      image_urls: Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : [],
      profiles: this.singleRelation(row.profiles),
      products: this.singleRelation(row.products),
    })) as unknown as Review[];
    const reviewerProfiles = normalizedReviews
      .map((review) => review.profiles)
      .filter((profile): profile is NonNullable<Review['profiles']> => Boolean(profile));
    const signedProfiles = await this.withSignedAvatarUrls(reviewerProfiles);
    if (!this.requestIsCurrent('reviews', request, generation)) return;
    let profileIndex = 0;
    this.reviewsState.set(normalizedReviews.map((review) => review.profiles
      ? { ...review, profiles: signedProfiles[profileIndex++] }
      : review));
  }

  async loadReturns(generation = this.workspaceGeneration) {
    const request = this.beginRequest('returns', generation);
    const rows = await this.pagedRows((from, to) => this.client
      .from('return_requests')
      .select('id,order_id,user_id,return_number,reason,details,status,admin_note,evidence_paths,reviewed_at,created_at,updated_at')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)) as unknown as ReturnRequest[];
    if (!this.requestIsCurrent('returns', request, generation)) return;
    this.returnsState.set(rows.map((row) => ({
      ...row,
      evidence_paths: Array.isArray(row.evidence_paths) ? row.evidence_paths : [],
    })) as ReturnRequest[]);
  }

  async loadInventory(generation = this.workspaceGeneration) {
    const request = this.beginRequest('inventory', generation);
    const { data, error } = await this.client
      .from('inventory_movements')
      .select('id,product_id,previous_quantity,new_quantity,quantity_delta,reason,created_at')
      .order('created_at', { ascending: false })
      .limit(24);
    if (error) throw error;
    if (!this.requestIsCurrent('inventory', request, generation)) return;
    this.movementsState.set((data ?? []) as InventoryMovement[]);
  }

  applyInventoryQuantity(productId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0) return;
    this.productsState.update((products) => products.map((product) => (
      product.id === productId ? { ...product, stock_quantity: quantity } : product
    )));
  }

  async loadNotifications(generation = this.workspaceGeneration) {
    const request = this.beginRequest('notifications', generation);
    const userId = this.auth.userId();
    if (!userId) return;
    const rows = await this.pagedRows((from, to) => this.client
      .from('admin_notifications')
      .select('id,kind,title,message,entity_type,entity_id,route,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to));
    const ids = rows.map((row) => row.id);
    const readRows: Array<{ notification_id: number; read_at: string | null; dismissed_at: string | null }> = [];
    for (let index = 0; index < ids.length; index += 500) {
      const { data, error } = await this.client
        .from('admin_notification_reads')
        .select('notification_id,read_at,dismissed_at')
        .eq('user_id', userId)
        .in('notification_id', ids.slice(index, index + 500));
      if (error) throw error;
      readRows.push(...(data ?? []));
    }
    if (!this.requestIsCurrent('notifications', request, generation) || this.auth.userId() !== userId) return;
    const readMap = new Map(readRows.map((row) => [row.notification_id, row]));
    this.notificationsState.set(rows
      .map((row) => ({
        ...row,
        read_at: readMap.get(row.id)?.read_at ?? null,
        dismissed_at: readMap.get(row.id)?.dismissed_at ?? null,
      }))
      .filter((row) => !row.dismissed_at) as AdminNotification[]);
  }

  async loadSettings(generation = this.workspaceGeneration) {
    const request = this.beginRequest('settings', generation);
    const [storeResult, securityResult, recipientResult] = await Promise.all([
      this.client.from('store_settings').select('*').eq('id', true).single(),
      this.client.from('admin_security_settings').select('*').eq('id', true).single(),
      this.auth.role() === 'superadmin'
        ? this.client.from('admin_report_recipients').select('recipients').eq('id', true).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (storeResult.error) throw storeResult.error;
    if (securityResult.error) throw securityResult.error;
    if (!this.requestIsCurrent('settings', request, generation)) return;
    const settings = normalizeStoreSettings(storeResult.data as Partial<StoreSettings>);
    if (!recipientResult.error && recipientResult.data?.recipients) {
      settings.report_settings = { ...settings.report_settings, recipients: recipientResult.data.recipients as string[] };
    }
    this.settingsState.set(settings);
    this.securityState.set(normalizeSecuritySettings(securityResult.data as Partial<AdminSecuritySettings>));
  }

  /**
   * Reflect a successful atomic settings save immediately. Realtime remains the
   * authority and will perform one coalesced reconciliation, but the UI does not
   * need a second eager read just to display its own committed values.
   */
  applySettingsSnapshot(
    store: StoreSettings,
    security: AdminSecuritySettings,
    updatedAt: string | null = null,
  ) {
    const nextStore = normalizeStoreSettings({
      ...store,
      updated_at: updatedAt ?? store.updated_at,
    });
    const nextSecurity = normalizeSecuritySettings({
      ...security,
      updated_at: updatedAt ?? security.updated_at,
      updated_by: this.auth.userId() ?? security.updated_by,
    });
    this.settingsState.set(nextStore);
    this.securityState.set(nextSecurity);
  }

  async loadTeam(generation = this.workspaceGeneration) {
    const request = this.beginRequest('team', generation);
    const { data, error } = await this.client
      .from('profiles')
      .select('id,full_name,email,phone,avatar_url,role,staff_active,created_at')
      .in('role', ['staff', 'admin', 'superadmin'])
      .order('created_at');
    if (error) throw error;
    if (!this.requestIsCurrent('team', request, generation)) return;
    const members = await this.withSignedAvatarUrls((data ?? []) as TeamMember[]);
    if (!this.requestIsCurrent('team', request, generation)) return;
    this.teamState.set(members);
  }

  applyTeamMemberPatch(memberId: string, patch: Partial<Pick<TeamMember, 'role' | 'staff_active'>>) {
    this.teamState.update((members) => members.map((member) => (
      member.id === memberId ? { ...member, ...patch } : member
    )));
  }

  async loadActivity(
    days: number | null = 30,
    generation = this.workspaceGeneration,
    mode: ActivityLoadMode = 'replace',
  ) {
    // A live event can arrive while the administrator changes the period or
    // requests an older page. The active request already includes that event
    // window, so do not let a background head refresh supersede it.
    if (mode !== 'replace' && this.activityLoadingState()) return;
    const request = this.beginRequest('activity', generation);
    if (request < 0) return;
    this.activityLoadingState.set(true);

    const replacing = mode === 'replace' || this.activityRangeDaysState() !== days;
    const activityLimit = mode === 'refresh' ? ACTIVITY_REFRESH_PAGE_SIZE : ACTIVITY_LOG_PAGE_SIZE;
    const errorLimit = mode === 'refresh' ? CLIENT_ERROR_REFRESH_PAGE_SIZE : CLIENT_ERROR_PAGE_SIZE;

    const since = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
    const activityCursor = mode === 'append' ? this.activityState().at(-1) ?? null : null;
    const errorCursor = mode === 'append' ? this.clientErrorsState().at(-1) ?? null : null;

    let activityQuery = this.client
      .from('activity_logs')
      .select('id,action,entity_type,entity_id,details,created_at,platform,actor_role,profiles!activity_logs_actor_id_fkey(full_name,email,role)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(activityLimit);
    let errorQuery = this.client
      .from('client_error_events')
      .select('id,message,path,context,created_at,profiles!client_error_events_user_id_fkey(full_name,email,role)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(errorLimit);

    if (since) {
      activityQuery = activityQuery.gte('created_at', since);
      errorQuery = errorQuery.gte('created_at', since);
    }
    if (activityCursor) {
      activityQuery = activityQuery.or(`created_at.lt.${activityCursor.created_at},and(created_at.eq.${activityCursor.created_at},id.lt.${activityCursor.id})`);
    }
    if (errorCursor) {
      errorQuery = errorQuery.or(`created_at.lt.${errorCursor.created_at},and(created_at.eq.${errorCursor.created_at},id.lt.${errorCursor.id})`);
    }

    const [activityResult, errorResult] = await Promise.all([
      mode === 'append' && !this.activityLogsHaveMore
        ? Promise.resolve({ data: [], error: null })
        : activityQuery,
      mode === 'append' && !this.clientErrorsHaveMore
        ? Promise.resolve({ data: [], error: null })
        : errorQuery,
    ]);
    if (activityResult.error) {
      if (this.requestIsCurrent('activity', request, generation)) this.activityLoadingState.set(false);
      throw activityResult.error;
    }
    if (errorResult.error) {
      if (this.requestIsCurrent('activity', request, generation)) this.activityLoadingState.set(false);
      throw errorResult.error;
    }
    if (!this.requestIsCurrent('activity', request, generation)) return;

    const activityRows = (activityResult.data ?? []).map((row) => ({
      ...row,
      profiles: this.singleRelation(row.profiles),
    })) as unknown as ActivityLog[];
    const errorRows = (errorResult.data ?? []).map((row) => ({
      ...row,
      stack: null,
      user_agent: null,
      profiles: this.singleRelation(row.profiles),
    })) as unknown as ClientErrorEvent[];

    if (replacing) {
      this.activityRangeDaysState.set(days);
      this.activityLogsHaveMore = true;
      this.clientErrorsHaveMore = true;
    }

    if (mode === 'append') {
      this.activityState.set(this.mergeActivityRows(this.activityState(), activityRows));
      this.clientErrorsState.set(this.mergeActivityRows(this.clientErrorsState(), errorRows));
    } else if (mode === 'refresh' && !replacing) {
      this.activityState.set(this.mergeActivityRows(activityRows, this.activityState()));
      this.clientErrorsState.set(this.mergeActivityRows(errorRows, this.clientErrorsState()));
    } else {
      this.activityState.set(activityRows);
      this.clientErrorsState.set(errorRows);
    }

    if (mode !== 'refresh' || replacing) {
      if (mode !== 'append' || this.activityLogsHaveMore) {
        this.activityLogsHaveMore = activityRows.length === ACTIVITY_LOG_PAGE_SIZE;
      }
      if (mode !== 'append' || this.clientErrorsHaveMore) {
        this.clientErrorsHaveMore = errorRows.length === CLIENT_ERROR_PAGE_SIZE;
      }
    }
    this.activityHasMoreState.set(this.activityLogsHaveMore || this.clientErrorsHaveMore);
    this.activityLoadingState.set(false);
  }

  loadMoreActivity() {
    return this.loadActivity(this.activityRangeDaysState(), this.workspaceGeneration, 'append');
  }

  refreshActivity() {
    return this.loadActivity(this.activityRangeDaysState(), this.workspaceGeneration, 'refresh');
  }

  async markNotificationRead(notificationId: number, read = true) {
    const userId = this.auth.userId();
    if (!userId) return;
    const { error } = await this.client.from('admin_notification_reads').upsert({
      notification_id: notificationId,
      user_id: userId,
      read_at: read ? new Date().toISOString() : null,
      dismissed_at: null,
    }, { onConflict: 'notification_id,user_id' });
    if (error) throw error;
    this.notificationsState.update((items) => items.map((item) =>
      item.id === notificationId ? { ...item, read_at: read ? new Date().toISOString() : null } : item));
  }

  async markAllNotificationsRead() {
    const userId = this.auth.userId();
    if (!userId) return;
    const { error } = await this.client.rpc('mark_all_admin_notifications_read');
    if (error) throw error;
    const readAt = new Date().toISOString();
    if (this.auth.userId() === userId) {
      this.notificationsState.update((items) => items.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    }
  }

  async dismissNotification(notificationId: number) {
    const userId = this.auth.userId();
    if (!userId) return;
    const { error } = await this.client.from('admin_notification_reads').upsert({
      notification_id: notificationId,
      user_id: userId,
      read_at: new Date().toISOString(),
      dismissed_at: new Date().toISOString(),
    }, { onConflict: 'notification_id,user_id' });
    if (error) throw error;
    this.notificationsState.update((items) => items.filter((item) => item.id !== notificationId));
  }

  private connectRealtime(generation: number): Promise<boolean> {
    if (this.channel || !this.auth.userId() || !this.generationIsActive(generation)) {
      return Promise.resolve(this.realtimeState() === 'live');
    }
    this.realtimeState.set('connecting');
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (connected: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve(connected);
      };
      const timeout = setTimeout(() => finish(false), 4_000);
      this.channel = this.client
      .channel(`cozycraft-admin-mobile-${this.auth.userId()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        this.scheduleRefresh('orders', generation);
        if (this.auth.role() !== 'staff') this.scheduleRefresh('customers', generation);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => this.scheduleRefresh('orders', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_status_history' }, () => this.scheduleRefresh('orders', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => this.scheduleRefresh('orders', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => this.scheduleRefresh('products', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => this.scheduleRefresh('categories', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, () => this.scheduleRefresh('inventory', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        this.scheduleRefresh('tickets', generation);
        if (this.auth.role() !== 'staff') this.scheduleRefresh('customers', generation);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'addresses' }, () => {
        if (this.auth.role() !== 'staff') this.scheduleRefresh('customers', generation);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => this.scheduleRefresh('reviews', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'return_requests' }, () => this.scheduleRefresh('returns', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        this.handleProfileChange(payload, generation);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_notifications' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const notification = payload.new as Partial<AdminNotification>;
          const validKind = ['order', 'review', 'support', 'inventory', 'report', 'system']
            .includes(String(notification.kind));
          if (typeof notification.id === 'number' && validKind
            && typeof notification.title === 'string' && typeof notification.message === 'string') {
            void this.native.presentLocalAdminNotification({
              id: notification.id,
              kind: notification.kind as AdminNotification['kind'],
              title: notification.title,
              message: notification.message,
              entity_type: typeof notification.entity_type === 'string' ? notification.entity_type : '',
              entity_id: typeof notification.entity_id === 'string' ? notification.entity_id : null,
              route: typeof notification.route === 'string' ? notification.route : '/app/notifications',
            });
          }
        }
        this.scheduleRefresh('notifications', generation);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_notification_reads' }, () => this.scheduleRefresh('notifications', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, () => this.scheduleRefresh('settings', generation))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_security_settings' }, () => {
        this.scheduleRefresh('settings', generation);
        void this.auth.revalidateAccess();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, () => {
        if (this.auth.role() !== 'staff') this.scheduleRefresh('activity', generation);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_error_events' }, () => {
        if (this.auth.role() !== 'staff') this.scheduleRefresh('activity', generation);
      })
      .subscribe((status) => {
        if (!this.generationIsActive(generation)) {
          finish(false);
          return;
        }
        if (status === 'SUBSCRIBED') {
          this.realtimeState.set('live');
          if (this.snapshotGeneration === generation) {
            if (this.completedSnapshotGeneration === generation) void this.refreshAll(false, generation);
            else this.reconcileAfterSnapshot.add(generation);
          }
          finish(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.realtimeState.set('error');
          finish(false);
        } else if (status === 'CLOSED') {
          this.realtimeState.set('offline');
          finish(false);
        }
      });
    });
  }

  private scheduleRefresh(target: RefreshTarget, generation = this.workspaceGeneration) {
    if (!this.generationIsActive(generation)) return;
    const current = this.refreshTimers.get(target);
    if (current) clearTimeout(current);
    this.refreshTimers.set(target, setTimeout(() => {
      this.refreshTimers.delete(target);
      if (!this.generationIsActive(generation)) return;
      void this.refreshTarget(target, generation).catch((error: unknown) => {
        if (this.generationIsActive(generation)) this.errorState.set(this.errorMessage(error));
      });
    }, 220));
  }

  private refreshTarget(target: RefreshTarget, generation: number) {
    const actions: Record<RefreshTarget, () => Promise<void>> = {
      orders: () => this.loadOrders(generation),
      products: () => this.loadProducts(generation),
      categories: () => this.loadCategories(generation),
      customers: () => this.loadCustomers(generation),
      tickets: () => this.loadTickets(generation),
      reviews: () => this.loadReviews(generation),
      returns: () => this.loadReturns(generation),
      // Every inventory movement is generated by the corresponding product
      // update, which already schedules the products target. Reload only the
      // compact ledger here so one stock change does not fetch products twice.
      inventory: () => this.loadInventory(generation),
      notifications: () => this.loadNotifications(generation),
      settings: () => this.loadSettings(generation),
      team: () => this.loadTeam(generation),
      activity: () => this.loadActivity(this.activityRangeDaysState(), generation, 'refresh'),
    };
    return actions[target]();
  }

  async stop() {
    ++this.workspaceGeneration;
    ++this.refreshSequence;
    const channel = this.channel;
    this.channel = null;
    this.startPromise = null;
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.requestSequences.clear();
    this.snapshotGeneration = 0;
    this.completedSnapshotGeneration = 0;
    this.reconcileAfterSnapshot.clear();
    this.realtimeState.set('offline');
    this.clearWorkspace();
    if (channel) await this.client.removeChannel(channel);
  }

  private clearWorkspace() {
    this.productsState.set([]);
    this.categoriesState.set([]);
    this.ordersState.set([]);
    this.customersState.set([]);
    this.ticketsState.set([]);
    this.reviewsState.set([]);
    this.returnsState.set([]);
    this.movementsState.set([]);
    this.notificationsState.set([]);
    this.activityState.set([]);
    this.clientErrorsState.set([]);
    this.activityLoadingState.set(false);
    this.activityHasMoreState.set(false);
    this.activityRangeDaysState.set(30);
    this.activityLogsHaveMore = true;
    this.clientErrorsHaveMore = true;
    this.teamState.set([]);
    this.avatarSignedUrlCache.clear();
    this.settingsState.set(defaultStoreSettings);
    this.securityState.set(defaultAdminSecuritySettings);
    this.loadingState.set(false);
    this.initializedState.set(false);
    this.refreshingState.set(false);
    this.errorState.set('');
    this.lastSyncState.set(null);
  }

  private singleRelation<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  private mergeActivityRows<T extends { id: number; created_at: string }>(first: T[], second: T[]) {
    const rows = new Map<number, T>();
    for (const row of [...first, ...second]) rows.set(row.id, row);
    return [...rows.values()].sort((left, right) => {
      const createdDifference = Date.parse(right.created_at) - Date.parse(left.created_at);
      return createdDifference || right.id - left.id;
    });
  }

  private avatarObjectPath(value: string | null | undefined) {
    if (!value) return null;
    const marker = '/storage/v1/object/public/avatars/';
    const markerIndex = value.indexOf(marker);
    if (markerIndex >= 0) return decodeURIComponent(value.slice(markerIndex + marker.length).split('?')[0]);
    return /^https?:\/\//i.test(value) ? null : value;
  }

  private async withSignedAvatarUrls<T extends { avatar_url: string | null }>(items: T[]): Promise<T[]> {
    const paths = Array.from(new Set(items
      .map((item) => this.avatarObjectPath(item.avatar_url))
      .filter((path): path is string => Boolean(path))));
    if (paths.length === 0) return items;

    const now = Date.now();
    const uncachedPaths = paths.filter((path) => {
      const cached = this.avatarSignedUrlCache.get(path);
      return !cached || cached.expiresAt <= now + 60_000;
    });
    if (uncachedPaths.length) {
      const { data, error } = await this.client.storage.from('avatars').createSignedUrls(uncachedPaths, 60 * 60);
      if (!error && data) {
        for (const item of data) {
          if (item.path && item.signedUrl) {
            this.avatarSignedUrlCache.set(item.path, {
              url: item.signedUrl,
              expiresAt: now + 60 * 60 * 1_000,
            });
          }
        }
      }
    }

    return items.map((item) => {
      const path = this.avatarObjectPath(item.avatar_url);
      return { ...item, avatar_url: path ? this.avatarSignedUrlCache.get(path)?.url ?? null : item.avatar_url };
    });
  }

  private generationIsActive(generation: number) {
    return generation === this.workspaceGeneration && this.auth.signedIn();
  }

  private beginRequest(target: RefreshTarget, generation: number) {
    if (!this.generationIsActive(generation)) return -1;
    const sequence = (this.requestSequences.get(target) ?? 0) + 1;
    this.requestSequences.set(target, sequence);
    return sequence;
  }

  private requestIsCurrent(target: RefreshTarget, sequence: number, generation: number) {
    return sequence >= 0
      && this.generationIsActive(generation)
      && this.requestSequences.get(target) === sequence;
  }

  private revalidateAndReconcile(generation: number) {
    if (this.accessRevalidation) return this.accessRevalidation;
    this.accessRevalidation = (async () => {
      const previousRole = this.auth.role();
      const allowed = await this.auth.revalidateAccess();
      if (!this.generationIsActive(generation) || !allowed) return;
      if (previousRole !== this.auth.role()) {
        await this.stop();
        if (this.auth.signedIn()) await this.start();
        return;
      }
      if (this.auth.role() === 'superadmin') this.scheduleRefresh('team', generation);
    })().finally(() => { this.accessRevalidation = null; });
    return this.accessRevalidation;
  }

  private handleProfileChange(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    generation: number,
  ) {
    if (!this.generationIsActive(generation)) return;
    const next = payload.new ?? {};
    const previous = payload.old ?? {};
    const id = typeof next['id'] === 'string'
      ? next['id']
      : typeof previous['id'] === 'string'
        ? previous['id']
        : null;

    // Only the signed-in administrator's own profile can alter the current
    // authorization boundary. Other profile changes can refresh their small,
    // relevant collection without revalidating the session or loading both
    // the customer and team directories.
    if (!id || id === this.auth.userId()) {
      void this.revalidateAndReconcile(generation);
      return;
    }

    const nextRole = typeof next['role'] === 'string' ? next['role'] : null;
    const knownCustomer = this.customersState().some((profile) => profile.id === id);
    const knownTeamMember = this.teamState().some((profile) => profile.id === id);

    if (this.auth.role() !== 'staff' && (knownCustomer || nextRole === 'customer')) {
      this.scheduleRefresh('customers', generation);
    }
    if (this.auth.role() === 'superadmin' && (knownTeamMember || isAdminRole(nextRole))) {
      this.scheduleRefresh('team', generation);
    }
  }

  private async pagedRows<T>(
    request: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const rows: T[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const result = await request(from, from + pageSize - 1);
      if (result.error) throw result.error;
      const page = result.data ?? [];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'CozyCraft could not refresh part of the workspace.';
  }
}
