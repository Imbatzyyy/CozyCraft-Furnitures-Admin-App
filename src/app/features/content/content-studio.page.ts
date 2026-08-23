import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AlertController, IonIcon, IonSpinner, IonToggle } from '@ionic/angular/standalone';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { dateTime, money, titleCase } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { CozyToastService } from '../../shared/components/toast.service';
import {
  ContentPageRecord,
  ContentStudioService,
  EmailTemplateRecord,
  HomepageBannerRecord,
  NewsletterCampaign,
  NewsletterDraft,
  NewsletterWorkspace,
} from './content-studio.service';

type ContentView = 'pages' | 'homepage' | 'newsletters' | 'templates' | 'logs';

const blankNewsletter = (): NewsletterDraft => ({
  internal_name: '',
  subject: '',
  preheader: '',
  heading: '',
  body: '',
  cta_label: 'Explore the collection',
  cta_path: '/new-arrivals',
  product_ids: [],
});

@Component({
  selector: 'cc-content-studio-page',
  standalone: true,
  imports: [IonIcon, IonSpinner, IonToggle, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './content-studio.page.html',
  styleUrl: './content-studio.page.scss',
})
export class ContentStudioPage {
  protected readonly service = inject(ContentStudioService);
  private readonly toast = inject(CozyToastService);
  private readonly native = inject(NativePlatformService);
  private readonly alerts = inject(AlertController);
  private readonly loaded = new Set<ContentView>();

  protected readonly money = money;
  protected readonly dateTime = dateTime;
  protected readonly titleCase = titleCase;
  protected readonly variableTokens = '{{order_number}}, {{status}}, {{refund_status}}, and {{ticket_number}}';
  protected readonly views: ReadonlyArray<{ id: ContentView; label: string; icon: string }> = [
    { id: 'pages', label: 'Pages', icon: 'document-text-outline' },
    { id: 'homepage', label: 'Homepage', icon: 'images-outline' },
    { id: 'newsletters', label: 'Newsletters', icon: 'mail-outline' },
    { id: 'templates', label: 'Email templates', icon: 'code-slash-outline' },
    { id: 'logs', label: 'Email log', icon: 'time-outline' },
  ];
  protected readonly view = signal<ContentView>('pages');
  protected readonly loading = signal(false);
  protected readonly busy = signal('');
  protected readonly pages = signal<ContentPageRecord[]>([]);
  protected readonly banners = signal<HomepageBannerRecord[]>([]);
  protected readonly templates = signal<EmailTemplateRecord[]>([]);
  protected readonly logs = signal<Awaited<ReturnType<ContentStudioService['loadLogs']>>['rows']>([]);
  protected readonly logsTotal = signal(0);
  protected readonly logsPage = signal(0);
  protected readonly logsPageSize = 15;
  protected readonly newsletter = signal<NewsletterWorkspace | null>(null);
  protected readonly newsletterDraft = signal<NewsletterDraft>(this.restoreNewsletterDraft());
  protected readonly testEmail = signal('');
  protected readonly scheduledAt = signal('');
  protected readonly logsPages = computed(() => Math.max(1, Math.ceil(this.logsTotal() / this.logsPageSize)));
  protected readonly selectedProducts = computed(() => {
    const ids = new Set(this.newsletterDraft().product_ids);
    return this.newsletter()?.products.filter((product) => ids.has(product.id)) ?? [];
  });
  protected readonly heroMeta = computed(() => ({
    pages: ['PUBLIC INFORMATION', this.pages().length],
    homepage: ['HOMEPAGE CAMPAIGNS', this.banners().length],
    newsletters: ['EDITORIAL DELIVERY', this.newsletter()?.campaigns.length ?? 0],
    templates: ['TRANSACTIONAL MESSAGES', this.templates().length],
    logs: ['DELIVERY ATTEMPTS', this.logsTotal()],
  })[this.view()] as [string, number]);

  constructor() {
    void this.ensureView('pages');
  }

  protected inputValue(event: Event) {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
  }

  protected numberValue(event: Event) {
    const value = Number(this.inputValue(event));
    return Number.isFinite(value) ? value : 0;
  }

  protected selectView(view: ContentView) {
    if (view === this.view()) return;
    this.view.set(view);
    void this.native.tap();
    void this.ensureView(view);
  }

  protected refresh() {
    this.loaded.delete(this.view());
    void this.ensureView(this.view(), true);
  }

  protected updatePage(index: number, patch: Partial<ContentPageRecord>) {
    this.pages.update((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  protected async savePage(page: ContentPageRecord) {
    await this.run(`page-${page.slug}`, async () => {
      const saved = await this.service.savePage(page);
      this.pages.update((items) => items.map((item) => item.slug === saved.slug ? saved : item));
      return `${saved.title} synchronized with the public storefront.`;
    });
  }

  protected addBanner() {
    const id = globalThis.crypto?.randomUUID?.() ?? `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.banners.update((items) => [...items, {
      id,
      eyebrow: '',
      title: '',
      subtitle: '',
      image_url: '',
      cta_label: 'Shop collection',
      cta_path: '/new-arrivals',
      active: true,
      starts_at: null,
      ends_at: null,
      sort_order: Math.max(100, ...items.map((item) => item.sort_order + 10)),
      updated_at: new Date().toISOString(),
    }]);
    requestAnimationFrame(() => document.getElementById(`banner-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    void this.native.tap();
  }

  protected updateBanner(index: number, patch: Partial<HomepageBannerRecord>) {
    this.banners.update((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  protected async saveBanner(banner: HomepageBannerRecord) {
    await this.run(`banner-${banner.id}`, async () => {
      const saved = await this.service.saveBanner(banner);
      this.banners.update((items) => items.map((item) => item.id === saved.id ? saved : item));
      return 'Homepage campaign saved and synchronized.';
    });
  }

  protected async removeBanner(banner: HomepageBannerRecord) {
    const alert = await this.alerts.create({
      header: 'Remove homepage campaign?',
      message: banner.title || 'This unfinished banner will be removed.',
      buttons: [{ text: 'Keep', role: 'cancel' }, { text: 'Remove', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    await this.run(`banner-${banner.id}`, async () => {
      await this.service.removeBanner(banner.id);
      this.banners.update((items) => items.filter((item) => item.id !== banner.id));
      return 'Homepage campaign removed.';
    });
  }

  protected updateTemplate(index: number, patch: Partial<EmailTemplateRecord>) {
    this.templates.update((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  protected async saveTemplate(template: EmailTemplateRecord) {
    await this.run(`template-${template.event_type}`, async () => {
      const saved = await this.service.saveTemplate(template);
      this.templates.update((items) => items.map((item) => item.event_type === saved.event_type ? saved : item));
      return 'Transactional email template saved.';
    });
  }

  protected async goToLogPage(value: number) {
    const next = Math.max(0, Math.min(this.logsPages() - 1, value));
    if (next === this.logsPage() || this.loading()) return;
    this.logsPage.set(next);
    this.loaded.delete('logs');
    await this.ensureView('logs', true);
  }

  protected updateNewsletter(patch: Partial<NewsletterDraft>) {
    this.newsletterDraft.update((draft) => ({ ...draft, ...patch }));
    this.persistNewsletterDraft();
  }

  protected toggleNewsletterProduct(id: string) {
    const selected = this.newsletterDraft().product_ids;
    if (!selected.includes(id) && selected.length >= 4) {
      void this.toast.show('Choose no more than four featured products.', 'neutral');
      return;
    }
    this.updateNewsletter({ product_ids: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] });
    void this.native.tap();
  }

  protected newNewsletter() {
    this.newsletterDraft.set(blankNewsletter());
    this.scheduledAt.set('');
    this.persistNewsletterDraft();
    void this.native.tap();
  }

  protected editCampaign(campaign: NewsletterCampaign) {
    this.newsletterDraft.set({
      id: campaign.id,
      internal_name: campaign.internal_name,
      subject: campaign.subject,
      preheader: campaign.preheader,
      heading: campaign.heading,
      body: campaign.body,
      cta_label: campaign.cta_label,
      cta_path: campaign.cta_path,
      product_ids: [...campaign.product_ids],
    });
    this.persistNewsletterDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void this.native.tap();
  }

  protected async saveNewsletter() {
    return this.saveNewsletterInternal(true);
  }

  protected async sendTest() {
    const campaignId = await this.ensureNewsletterSaved();
    if (!campaignId) return;
    await this.run('newsletter-test', async () => {
      const result = await this.service.sendNewsletterTest(campaignId, this.testEmail().trim());
      return result.message;
    });
  }

  protected async scheduleNewsletter(sendNow: boolean) {
    const campaignId = await this.ensureNewsletterSaved();
    if (!campaignId) return;
    const when = sendNow ? new Date().toISOString() : this.localToIso(this.scheduledAt());
    if (!when) {
      await this.toast.show('Choose a Philippine delivery date and time.', 'danger');
      return;
    }
    const alert = await this.alerts.create({
      header: sendNow ? 'Send newsletter now?' : 'Schedule newsletter?',
      message: sendNow
        ? 'The saved campaign will be queued for every active subscriber.'
        : `Delivery is scheduled for ${dateTime(when)}.`,
      buttons: [{ text: 'Not yet', role: 'cancel' }, { text: sendNow ? 'Send now' : 'Schedule', role: 'confirm' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;
    await this.run('newsletter-schedule', async () => {
      const result = await this.service.scheduleNewsletterCampaign(campaignId, when);
      this.newsletterDraft.set(blankNewsletter());
      this.scheduledAt.set('');
      this.clearNewsletterDraft();
      await this.loadNewsletter(true);
      return result.message;
    });
  }

  protected async cancelCampaign(campaign: NewsletterCampaign) {
    const alert = await this.alerts.create({
      header: 'Cancel newsletter campaign?',
      message: `${campaign.internal_name} will no longer be eligible for delivery.`,
      buttons: [{ text: 'Keep campaign', role: 'cancel' }, { text: 'Cancel campaign', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    await this.run(`campaign-${campaign.id}`, async () => {
      const result = await this.service.cancelNewsletterCampaign(campaign.id);
      await this.loadNewsletter(true);
      return result.message;
    });
  }

  protected isCampaignEditable(campaign: NewsletterCampaign) {
    return campaign.status === 'draft' || campaign.status === 'failed';
  }

  protected isCampaignCancellable(campaign: NewsletterCampaign) {
    return ['draft', 'scheduled', 'failed'].includes(campaign.status);
  }

  protected localDateTime(value: string | null) {
    if (!value) return '';
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Manila',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(value)).replace(' ', 'T');
  }

  protected hideImage(event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (image) image.hidden = true;
  }

  private async ensureView(view: ContentView, force = false) {
    if (!force && this.loaded.has(view)) return;
    this.loading.set(true);
    try {
      if (view === 'pages') this.pages.set(await this.service.loadPages());
      else if (view === 'homepage') this.banners.set(await this.service.loadBanners());
      else if (view === 'templates') this.templates.set(await this.service.loadTemplates());
      else if (view === 'logs') {
        const result = await this.service.loadLogs(this.logsPage(), this.logsPageSize);
        this.logs.set(result.rows);
        this.logsTotal.set(result.total);
      } else await this.loadNewsletter(force);
      this.loaded.add(view);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadNewsletter(_force = false) {
    const workspace = await this.service.loadNewsletterWorkspace();
    this.newsletter.set(workspace);
    if (!this.testEmail()) this.testEmail.set(workspace.adminEmail);
    this.loaded.add('newsletters');
  }

  private async saveNewsletterInternal(showToast: boolean) {
    if (this.busy()) return null;
    this.busy.set('newsletter-save');
    try {
      const result = await this.service.saveNewsletterCampaign(this.newsletterDraft());
      this.newsletterDraft.update((draft) => ({ ...draft, id: result.campaign.id }));
      this.persistNewsletterDraft();
      await this.loadNewsletter(true);
      if (showToast) await Promise.all([this.native.success(), this.toast.show('Newsletter draft saved securely.', 'success')]);
      return result.campaign;
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
      await this.native.warning();
      return null;
    } finally {
      this.busy.set('');
    }
  }

  private async ensureNewsletterSaved() {
    // Test, schedule, and send operations must use the latest editor state rather
    // than a previously persisted campaign revision.
    return (await this.saveNewsletterInternal(false))?.id ?? null;
  }

  private async run(key: string, work: () => Promise<string>) {
    if (this.busy()) return;
    this.busy.set(key);
    try {
      const message = await work();
      await Promise.all([this.native.success(), this.toast.show(message, 'success')]);
    } catch (error: unknown) {
      await this.native.warning();
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.busy.set('');
    }
  }

  protected localToIso(value: string) {
    if (!value) return null;
    const date = new Date(`${value}:00+08:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private restoreNewsletterDraft(): NewsletterDraft {
    try {
      const value = JSON.parse(localStorage.getItem('cozycraft:admin-mobile:newsletter-draft:v1') ?? 'null') as Partial<NewsletterDraft> | null;
      if (!value || typeof value.subject !== 'string' || typeof value.body !== 'string' || !Array.isArray(value.product_ids)) return blankNewsletter();
      return { ...blankNewsletter(), ...value, product_ids: value.product_ids.filter((id): id is string => typeof id === 'string').slice(0, 4) };
    } catch {
      return blankNewsletter();
    }
  }

  private persistNewsletterDraft() {
    try {
      localStorage.setItem('cozycraft:admin-mobile:newsletter-draft:v1', JSON.stringify(this.newsletterDraft()));
    } catch {
      // A hardened WebView may disable local drafts. The protected database save still works.
    }
  }

  private clearNewsletterDraft() {
    try { localStorage.removeItem('cozycraft:admin-mobile:newsletter-draft:v1'); } catch { /* no-op */ }
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'The publishing studio could not complete that request.';
  }
}
