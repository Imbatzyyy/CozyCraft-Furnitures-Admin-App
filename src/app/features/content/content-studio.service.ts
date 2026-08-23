import { Injectable } from '@angular/core';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';

export interface ContentPageRecord {
  slug: string;
  eyebrow: string;
  title: string;
  summary: string;
  body: string;
  published: boolean;
  updated_at: string;
}

export interface HomepageBannerRecord {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  image_url: string;
  cta_label: string;
  cta_path: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  updated_at: string;
}

export interface EmailTemplateRecord {
  event_type: string;
  subject_template: string;
  heading: string;
  body_template: string;
  enabled: boolean;
  updated_at: string;
}

export interface EmailDeliveryLog {
  id: number;
  event_type: string;
  recipient: string;
  entity_type: string;
  entity_id: string | null;
  status: string;
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface NewsletterProductChoice {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  price: number;
  image_url: string;
}

export interface NewsletterCampaign {
  id: string;
  internal_name: string;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  cta_label: string;
  cta_path: string;
  product_ids: string[];
  product_snapshot: NewsletterProductChoice[];
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';
  scheduled_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewsletterDraft = Pick<NewsletterCampaign,
  'internal_name' | 'subject' | 'preheader' | 'heading' | 'body' | 'cta_label' | 'cta_path' | 'product_ids'
> & { id?: string };

export interface NewsletterWorkspace {
  counts: Record<'active' | 'pending' | 'unsubscribed' | 'bounced', number>;
  campaigns: NewsletterCampaign[];
  products: NewsletterProductChoice[];
  adminEmail: string;
}

@Injectable({ providedIn: 'root' })
export class ContentStudioService {
  private readonly client = this.connection.client;

  constructor(private readonly connection: SupabaseAdminService) {}

  async loadPages() {
    const { data, error } = await this.client
      .from('content_pages')
      .select('slug,eyebrow,title,summary,body,published,updated_at')
      .order('slug')
      .limit(30);
    if (error) throw error;
    return (data ?? []) as ContentPageRecord[];
  }

  async savePage(page: ContentPageRecord) {
    const { updated_at: _updatedAt, ...payload } = page;
    const { data, error } = await this.client
      .from('content_pages')
      .upsert(payload)
      .select('slug,eyebrow,title,summary,body,published,updated_at')
      .single();
    if (error) throw error;
    return data as ContentPageRecord;
  }

  async loadBanners() {
    const { data, error } = await this.client
      .from('homepage_banners')
      .select('id,eyebrow,title,subtitle,image_url,cta_label,cta_path,active,starts_at,ends_at,sort_order,updated_at')
      .order('sort_order')
      .limit(40);
    if (error) throw error;
    return (data ?? []).map((row) => ({ ...row, sort_order: Number(row.sort_order) })) as HomepageBannerRecord[];
  }

  async saveBanner(banner: HomepageBannerRecord) {
    const validation = this.validateBanner(banner);
    if (validation) throw new Error(validation);
    const { updated_at: _updatedAt, ...payload } = banner;
    const { data, error } = await this.client
      .from('homepage_banners')
      .upsert(payload)
      .select('id,eyebrow,title,subtitle,image_url,cta_label,cta_path,active,starts_at,ends_at,sort_order,updated_at')
      .single();
    if (error) throw error;
    return { ...data, sort_order: Number(data.sort_order) } as HomepageBannerRecord;
  }

  async removeBanner(id: string) {
    const { error } = await this.client.from('homepage_banners').delete().eq('id', id);
    if (error) throw error;
  }

  async loadTemplates() {
    const { data, error } = await this.client
      .from('email_templates')
      .select('event_type,subject_template,heading,body_template,enabled,updated_at')
      .order('event_type')
      .limit(30);
    if (error) throw error;
    return (data ?? []) as EmailTemplateRecord[];
  }

  async saveTemplate(template: EmailTemplateRecord) {
    if (!template.subject_template.trim() || !template.heading.trim() || !template.body_template.trim()) {
      throw new Error('Subject, heading, and message are required.');
    }
    const { updated_at: _updatedAt, ...payload } = template;
    const { data, error } = await this.client
      .from('email_templates')
      .upsert(payload)
      .select('event_type,subject_template,heading,body_template,enabled,updated_at')
      .single();
    if (error) throw error;
    return data as EmailTemplateRecord;
  }

  async loadLogs(page: number, pageSize: number) {
    const first = Math.max(0, page) * pageSize;
    const { data, error, count } = await this.client
      .from('email_delivery_logs')
      .select('id,event_type,recipient,entity_type,entity_id,status,provider_message_id,error_message,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(first, first + pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []).map((row) => ({ ...row, id: Number(row.id) })) as EmailDeliveryLog[], total: count ?? 0 };
  }

  loadNewsletterWorkspace() {
    return this.invokeNewsletter<NewsletterWorkspace>({ action: 'overview' });
  }

  saveNewsletterCampaign(campaign: NewsletterDraft) {
    const validation = this.validateNewsletter(campaign);
    if (validation) return Promise.reject(new Error(validation));
    return this.invokeNewsletter<{ campaign: NewsletterCampaign }>({ action: 'save', campaign });
  }

  sendNewsletterTest(campaignId: string, email: string) {
    return this.invokeNewsletter<{ message: string }>({ action: 'test', campaignId, email });
  }

  scheduleNewsletterCampaign(campaignId: string, scheduledAt: string) {
    return this.invokeNewsletter<{ message: string }>({ action: 'schedule', campaignId, scheduledAt });
  }

  cancelNewsletterCampaign(campaignId: string) {
    return this.invokeNewsletter<{ message: string }>({ action: 'cancel', campaignId });
  }

  private validateBanner(banner: HomepageBannerRecord) {
    if (!banner.title.trim()) return 'Give the homepage banner a headline.';
    if (!/^https:\/\//i.test(banner.image_url.trim())) return 'Use a secure HTTPS banner image.';
    if (!/^(\/|https:\/\/)/i.test(banner.cta_path.trim()) || banner.cta_path.startsWith('//')) return 'Use a safe internal or HTTPS action path.';
    if (banner.starts_at && banner.ends_at && Date.parse(banner.ends_at) <= Date.parse(banner.starts_at)) return 'The campaign end must be later than its start.';
    return null;
  }

  private validateNewsletter(draft: NewsletterDraft) {
    if (!draft.internal_name.trim()) return 'Add an internal campaign name.';
    if (!draft.subject.trim() || draft.subject.trim().length > 120) return 'Add a subject of 120 characters or fewer.';
    if (!draft.heading.trim() || !draft.body.trim()) return 'Add the customer-facing heading and message.';
    if (!draft.cta_path.startsWith('/') || draft.cta_path.startsWith('//')) return 'The action must use a safe CozyCraft path beginning with /.';
    if (draft.product_ids.length > 4) return 'Choose no more than four featured products.';
    return null;
  }

  private async invokeNewsletter<T>(body: Record<string, unknown>): Promise<T> {
    return this.connection.invokeAuthenticatedFunction<T>('newsletter-admin', body);
  }
}
