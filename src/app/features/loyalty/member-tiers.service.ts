import { Injectable, signal } from '@angular/core';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';

export type LoyaltyTier = 'member' | 'plus' | 'premium' | 'elite';
export type LoyaltySort = 'points' | 'spend' | 'recent';

export interface LoyaltyMember {
  user_id: string;
  points_balance: number;
  lifetime_eligible_spend: number;
  tier: LoyaltyTier;
  tier_valid_until: string | null;
  last_activity_at: string | null;
  updated_at: string;
  full_name: string;
  username: string;
  email: string;
  avatar_url: string | null;
}

export interface LoyaltyTransaction {
  id: string;
  kind: string;
  points: number;
  description: string;
  created_at: string;
  expires_at: string | null;
}

export interface LoyaltyRedemption {
  id: string;
  points_cost: number;
  discount_amount: number;
  status: 'available' | 'applied' | 'used' | 'cancelled' | 'expired';
  code: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface LoyaltyPageRequest {
  page: number;
  pageSize: number;
  tier: 'all' | LoyaltyTier;
  sort: LoyaltySort;
  query: string;
}

interface LoyaltyAccountRow {
  user_id: string;
  points_balance: number | string;
  lifetime_eligible_spend: number | string;
  tier: LoyaltyTier;
  tier_valid_until: string | null;
  last_activity_at: string | null;
  updated_at: string;
}

interface LoyaltyProfileRow {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
}

@Injectable({ providedIn: 'root' })
export class MemberTiersService {
  private readonly client = this.connection.client;
  private readonly avatarCache = new Map<string, { url: string; expiresAt: number }>();
  private lastRequestKey = '';
  private lastLoadedAt = 0;

  readonly members = signal<LoyaltyMember[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly transactionLoading = signal(false);
  readonly redemptionLoading = signal(false);
  readonly transactions = signal<LoyaltyTransaction[]>([]);
  readonly transactionTotal = signal(0);
  readonly redemptions = signal<LoyaltyRedemption[]>([]);
  readonly redemptionTotal = signal(0);

  private activeHistoryUserId: string | null = null;
  private transactionSequence = 0;
  private redemptionSequence = 0;

  constructor(private readonly connection: SupabaseAdminService) {}

  async loadPage(request: LoyaltyPageRequest, force = false) {
    const normalized = { ...request, query: request.query.trim() };
    const requestKey = JSON.stringify(normalized);
    if (!force && requestKey === this.lastRequestKey && Date.now() - this.lastLoadedAt < 30_000) return;

    this.loading.set(true);
    try {
      let matchingIds: string[] | null = null;
      if (normalized.query) {
        const safeTerm = normalized.query.replace(/[%_,()."']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!safeTerm) {
          this.members.set([]);
          this.total.set(0);
          return;
        }
        const pattern = `%${safeTerm}%`;
        const { data: matches, error: profileError } = await this.client
          .from('profiles')
          .select('id')
          .eq('role', 'customer')
          .or(`full_name.ilike.${pattern},username.ilike.${pattern},email.ilike.${pattern}`)
          .limit(120);
        if (profileError) throw profileError;
        matchingIds = (matches ?? []).map((item) => String(item.id));
        if (!matchingIds.length) {
          this.members.set([]);
          this.total.set(0);
          this.lastRequestKey = requestKey;
          this.lastLoadedAt = Date.now();
          return;
        }
      }

      const orderColumn = normalized.sort === 'points'
        ? 'points_balance'
        : normalized.sort === 'spend'
          ? 'lifetime_eligible_spend'
          : 'updated_at';
      const first = Math.max(0, normalized.page) * normalized.pageSize;
      let accountsQuery = this.client
        .from('mobile_loyalty_accounts')
        .select('user_id,points_balance,lifetime_eligible_spend,tier,tier_valid_until,last_activity_at,updated_at', { count: 'exact' })
        .order(orderColumn, { ascending: false })
        .range(first, first + normalized.pageSize - 1);
      if (normalized.tier !== 'all') accountsQuery = accountsQuery.eq('tier', normalized.tier);
      if (matchingIds) accountsQuery = accountsQuery.in('user_id', matchingIds);

      const { data: accountData, error: accountError, count } = await accountsQuery;
      if (accountError) throw accountError;
      const accounts = (accountData ?? []) as LoyaltyAccountRow[];
      const ids = accounts.map((item) => item.user_id);
      const profiles = ids.length
        ? await this.loadProfiles(ids)
        : [];
      const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

      this.members.set(accounts.map((account) => {
        const profile = profileById.get(account.user_id);
        return {
          ...account,
          points_balance: Number(account.points_balance),
          lifetime_eligible_spend: Number(account.lifetime_eligible_spend),
          full_name: profile?.full_name?.trim() || profile?.username?.trim() || 'CozyCraft member',
          username: profile?.username?.trim() || 'member',
          email: profile?.email?.trim() || 'No email recorded',
          avatar_url: profile?.avatar_url ?? null,
        };
      }));
      this.total.set(count ?? accounts.length);
      this.lastRequestKey = requestKey;
      this.lastLoadedAt = Date.now();
    } finally {
      this.loading.set(false);
    }
  }

  async loadMemberHistory(userId: string, transactionPageSize: number, redemptionPageSize: number) {
    this.activeHistoryUserId = userId;
    this.transactionSequence += 1;
    this.redemptionSequence += 1;
    this.detailLoading.set(true);
    this.transactions.set([]);
    this.transactionTotal.set(0);
    this.redemptions.set([]);
    this.redemptionTotal.set(0);
    try {
      await Promise.all([
        this.loadTransactionPage(userId, 0, transactionPageSize),
        this.loadRedemptionPage(userId, 0, redemptionPageSize),
      ]);
    } finally {
      if (this.activeHistoryUserId === userId) this.detailLoading.set(false);
    }
  }

  async loadTransactionPage(userId: string, page: number, pageSize: number) {
    const sequence = ++this.transactionSequence;
    this.transactionLoading.set(true);
    try {
      const first = Math.max(0, page) * pageSize;
      const { data, error, count } = await this.client
        .from('mobile_loyalty_transactions')
        .select('id,kind,points,description,created_at,expires_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(first, first + pageSize - 1);
      if (error) throw error;
      if (sequence !== this.transactionSequence || this.activeHistoryUserId !== userId) return;
      this.transactions.set((data ?? []).map((row) => ({
        ...row,
        points: Number(row.points),
      })) as LoyaltyTransaction[]);
      this.transactionTotal.set(count ?? data?.length ?? 0);
    } finally {
      if (sequence === this.transactionSequence) this.transactionLoading.set(false);
    }
  }

  async loadRedemptionPage(userId: string, page: number, pageSize: number) {
    const sequence = ++this.redemptionSequence;
    this.redemptionLoading.set(true);
    try {
      const first = Math.max(0, page) * pageSize;
      const { data, error, count } = await this.client
        .from('mobile_loyalty_redemptions')
        .select('id,points_cost,discount_amount,status,code,created_at,expires_at,used_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(first, first + pageSize - 1);
      if (error) throw error;
      if (sequence !== this.redemptionSequence || this.activeHistoryUserId !== userId) return;
      this.redemptions.set((data ?? []).map((row) => ({
        ...row,
        points_cost: Number(row.points_cost),
        discount_amount: Number(row.discount_amount),
      })) as LoyaltyRedemption[]);
      this.redemptionTotal.set(count ?? data?.length ?? 0);
    } finally {
      if (sequence === this.redemptionSequence) this.redemptionLoading.set(false);
    }
  }

  clearMemberHistory() {
    this.activeHistoryUserId = null;
    this.transactionSequence += 1;
    this.redemptionSequence += 1;
    this.detailLoading.set(false);
    this.transactionLoading.set(false);
    this.redemptionLoading.set(false);
    this.transactions.set([]);
    this.transactionTotal.set(0);
    this.redemptions.set([]);
    this.redemptionTotal.set(0);
  }

  private async loadProfiles(ids: string[]) {
    const { data, error } = await this.client
      .from('profiles')
      .select('id,full_name,username,email,avatar_url')
      .in('id', ids);
    if (error) throw error;
    return this.withSignedAvatars((data ?? []) as LoyaltyProfileRow[]);
  }

  private async withSignedAvatars(profiles: LoyaltyProfileRow[]) {
    const paths = Array.from(new Set(profiles
      .map((profile) => this.avatarObjectPath(profile.avatar_url))
      .filter((path): path is string => Boolean(path))));
    const now = Date.now();
    const uncached = paths.filter((path) => !this.avatarCache.get(path) || this.avatarCache.get(path)!.expiresAt < now + 60_000);
    if (uncached.length) {
      const { data } = await this.client.storage.from('avatars').createSignedUrls(uncached, 60 * 60);
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) this.avatarCache.set(item.path, { url: item.signedUrl, expiresAt: now + 3_540_000 });
      }
    }
    return profiles.map((profile) => {
      const path = this.avatarObjectPath(profile.avatar_url);
      return { ...profile, avatar_url: path ? this.avatarCache.get(path)?.url ?? null : profile.avatar_url };
    });
  }

  private avatarObjectPath(value: string | null) {
    if (!value) return null;
    const marker = '/storage/v1/object/public/avatars/';
    const index = value.indexOf(marker);
    if (index >= 0) return decodeURIComponent(value.slice(index + marker.length).split('?')[0]);
    return /^https?:\/\//i.test(value) ? null : value;
  }
}
