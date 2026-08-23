import { Injectable, signal } from '@angular/core';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';

export interface DeliveryServiceArea {
  id: number;
  area_code: string;
  name: string;
  description: string;
  delivery_fee: number;
  free_delivery_minimum: number | null;
  lead_time_min_days: number;
  lead_time_max_days: number;
  assembly_available: boolean;
  active: boolean;
  sort_order: number;
}

export interface SearchSynonym {
  id: number;
  term: string;
  synonyms: string[];
  active: boolean;
}

export interface ProductAlertInsight {
  product_id: string;
  alert_type: 'back_in_stock' | 'price_drop';
  target_price: number | null;
  created_at: string;
}

export interface SearchEventInsight {
  normalized_query: string;
  result_count: number;
  collection: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class MerchandisingService {
  private readonly client = this.connection.client;
  private loadedAt = 0;

  readonly areas = signal<DeliveryServiceArea[]>([]);
  readonly synonyms = signal<SearchSynonym[]>([]);
  readonly alerts = signal<ProductAlertInsight[]>([]);
  readonly searches = signal<SearchEventInsight[]>([]);
  readonly loading = signal(false);

  constructor(private readonly connection: SupabaseAdminService) {}

  async load(force = false) {
    if (!force && this.loadedAt && Date.now() - this.loadedAt < 45_000) return;
    this.loading.set(true);
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [areaResult, synonymResult, alertResult, searchResult] = await Promise.all([
        this.client
          .from('delivery_service_areas')
          .select('id,area_code,name,description,delivery_fee,free_delivery_minimum,lead_time_min_days,lead_time_max_days,assembly_available,active,sort_order')
          .order('sort_order')
          .limit(30),
        this.client
          .from('search_synonyms')
          .select('id,term,synonyms,active')
          .order('term')
          .limit(100),
        this.client
          .from('product_alerts')
          .select('product_id,alert_type,target_price,created_at')
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(240),
        this.client
          .from('search_events')
          .select('normalized_query,result_count,collection,created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(180),
      ]);
      const error = areaResult.error ?? synonymResult.error ?? alertResult.error ?? searchResult.error;
      if (error) throw error;
      this.areas.set((areaResult.data ?? []).map((row) => ({
        ...row,
        id: Number(row.id),
        delivery_fee: Number(row.delivery_fee),
        free_delivery_minimum: row.free_delivery_minimum === null ? null : Number(row.free_delivery_minimum),
        lead_time_min_days: Number(row.lead_time_min_days),
        lead_time_max_days: Number(row.lead_time_max_days),
        sort_order: Number(row.sort_order),
      })) as DeliveryServiceArea[]);
      this.synonyms.set((synonymResult.data ?? []).map((row) => ({ ...row, id: Number(row.id) })) as SearchSynonym[]);
      this.alerts.set((alertResult.data ?? []).map((row) => ({
        ...row,
        target_price: row.target_price === null ? null : Number(row.target_price),
      })) as ProductAlertInsight[]);
      this.searches.set((searchResult.data ?? []).map((row) => ({
        ...row,
        result_count: Number(row.result_count),
      })) as SearchEventInsight[]);
      this.loadedAt = Date.now();
    } finally {
      this.loading.set(false);
    }
  }

  updateAreaDraft(areaId: number, patch: Partial<DeliveryServiceArea>) {
    this.areas.update((items) => items.map((item) => item.id === areaId ? { ...item, ...patch } : item));
  }

  async saveArea(area: DeliveryServiceArea) {
    if (!area.name.trim()) return 'Give the delivery area a name.';
    if (area.delivery_fee < 0 || (area.free_delivery_minimum !== null && area.free_delivery_minimum < 0)) return 'Delivery amounts cannot be negative.';
    if (area.lead_time_min_days < 0 || area.lead_time_max_days < area.lead_time_min_days || area.lead_time_max_days > 90) return 'Check the delivery-day range.';
    const { data, error } = await this.client
      .from('delivery_service_areas')
      .update({
        name: area.name.trim(),
        description: area.description.trim(),
        delivery_fee: area.delivery_fee,
        free_delivery_minimum: area.free_delivery_minimum,
        lead_time_min_days: area.lead_time_min_days,
        lead_time_max_days: area.lead_time_max_days,
        assembly_available: area.assembly_available,
        active: area.active,
      })
      .eq('id', area.id)
      .select('id')
      .maybeSingle();
    if (error) return error.message;
    if (!data) return 'This delivery area is no longer available.';
    this.loadedAt = Date.now();
    return null;
  }

  async addSynonym(term: string, synonyms: string[]) {
    const cleanTerm = term.trim().slice(0, 80);
    const cleanSynonyms = Array.from(new Set(synonyms.map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 2))).slice(0, 20);
    if (cleanTerm.length < 2) return 'Enter a catalog term of at least two characters.';
    if (!cleanSynonyms.length) return 'Add at least one alternative search word.';
    const { data, error } = await this.client
      .from('search_synonyms')
      .insert({ term: cleanTerm, synonyms: cleanSynonyms, active: true })
      .select('id,term,synonyms,active')
      .single();
    if (error) return error.message;
    this.synonyms.update((items) => [...items, { ...data, id: Number(data.id) } as SearchSynonym].sort((left, right) => left.term.localeCompare(right.term)));
    return null;
  }

  async removeSynonym(id: number) {
    const { error } = await this.client.from('search_synonyms').delete().eq('id', id);
    if (error) return error.message;
    this.synonyms.update((items) => items.filter((item) => item.id !== id));
    return null;
  }
}
