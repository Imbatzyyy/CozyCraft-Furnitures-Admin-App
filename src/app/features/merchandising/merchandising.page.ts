import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AlertController, IonIcon, IonSpinner, IonToggle } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { money, shortDate } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { CozyToastService } from '../../shared/components/toast.service';
import { DeliveryServiceArea, MerchandisingService } from './merchandising.service';

type ExperienceView = 'delivery' | 'language' | 'insights';

interface AlertDemand {
  productId: string;
  name: string;
  category: string;
  image: string | null;
  total: number;
  stock: number;
  price: number;
}

interface SearchDemand {
  query: string;
  count: number;
  zero: number;
  latest: string;
  collection: string;
}

@Component({
  selector: 'cc-merchandising-page',
  standalone: true,
  imports: [IonIcon, IonSpinner, IonToggle, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page experience-page">
      <section class="experience-hero">
        <div class="experience-hero__top"><p class="cc-eyebrow">CUSTOMER EXPERIENCE</p><button type="button" (click)="refresh()" [disabled]="service.loading()"><ion-icon name="refresh-outline" [class.is-spinning]="service.loading()"></ion-icon></button></div>
        <div class="experience-hero__copy"><h1>Shape how<br><em>customers discover.</em></h1><p>Delivery promises and search language, connected to real customer intent.</p></div>
        <div class="experience-metrics">
          <span><ion-icon name="location-outline"></ion-icon><b>{{ activeAreaCount() }}</b><small>active areas</small></span>
          <span><ion-icon name="search-outline"></ion-icon><b>{{ searchDemand().length }}</b><small>search terms</small></span>
          <span><ion-icon name="notifications-outline"></ion-icon><b>{{ service.alerts().length }}</b><small>product alerts</small></span>
        </div>
      </section>

      <nav class="experience-tabs" aria-label="Merchandising sections">
        <button type="button" [class.is-active]="view() === 'delivery'" (click)="selectView('delivery')"><ion-icon name="map-outline"></ion-icon><span>Delivery</span></button>
        <button type="button" [class.is-active]="view() === 'language'" (click)="selectView('language')"><ion-icon name="sparkles-outline"></ion-icon><span>Search language</span></button>
        <button type="button" [class.is-active]="view() === 'insights'" (click)="selectView('insights')"><ion-icon name="analytics-outline"></ion-icon><span>Intent</span></button>
      </nav>

      @if (service.loading() && service.areas().length === 0) {
        <section class="experience-loading"><ion-spinner name="crescent"></ion-spinner><span>Loading experience controls…</span></section>
      } @else if (view() === 'delivery') {
        <header class="section-heading"><div><p>DELIVERY PROMISES</p><h2>{{ service.areas().length }} service area{{ service.areas().length === 1 ? '' : 's' }}</h2></div><span>Changes reach the storefront after its short configuration cache.</span></header>
        @if (service.areas().length === 0) {
          <cc-empty-state icon="map-outline" title="No delivery areas configured" message="Add service areas through the protected database configuration before managing their promises here." />
        } @else {
          <section class="area-list">
            @for (area of service.areas(); track area.id) {
              <article class="area-card" [class.is-inactive]="!area.active">
                <header><div><span class="area-code">{{ area.area_code }}</span><h2>{{ area.name }}</h2></div><label><span>{{ area.active ? 'Active' : 'Hidden' }}</span><ion-toggle [checked]="area.active" (ionChange)="patchArea(area.id, { active: $event.detail.checked })" [attr.aria-label]="'Toggle ' + area.name"></ion-toggle></label></header>
                <div class="area-grid">
                  <label class="wide"><span>Area name</span><input [value]="area.name" maxlength="100" (input)="patchArea(area.id, { name: inputValue($event) })" /></label>
                  <label class="wide"><span>Description</span><textarea rows="2" maxlength="300" [value]="area.description" (input)="patchArea(area.id, { description: inputValue($event) })"></textarea></label>
                  <label><span>Delivery fee</span><div class="number-field"><i>₱</i><input type="number" inputmode="decimal" min="0" [value]="area.delivery_fee" (input)="patchArea(area.id, { delivery_fee: numberValue($event) })" /></div></label>
                  <label><span>Free from</span><div class="number-field"><i>₱</i><input type="number" inputmode="decimal" min="0" [value]="area.free_delivery_minimum ?? ''" placeholder="None" (input)="patchArea(area.id, { free_delivery_minimum: nullableNumberValue($event) })" /></div></label>
                  <label><span>Minimum days</span><input type="number" inputmode="numeric" min="0" max="60" [value]="area.lead_time_min_days" (input)="patchArea(area.id, { lead_time_min_days: integerValue($event) })" /></label>
                  <label><span>Maximum days</span><input type="number" inputmode="numeric" min="0" max="90" [value]="area.lead_time_max_days" (input)="patchArea(area.id, { lead_time_max_days: integerValue($event) })" /></label>
                </div>
                <footer><label class="assembly"><ion-icon name="construct-outline"></ion-icon><span><b>Assembly available</b><small>Show this service in the delivery promise.</small></span><ion-toggle [checked]="area.assembly_available" (ionChange)="patchArea(area.id, { assembly_available: $event.detail.checked })" [attr.aria-label]="'Assembly for ' + area.name"></ion-toggle></label><button type="button" (click)="saveArea(area)" [disabled]="busyId() === area.id">@if (busyId() === area.id) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="checkmark-outline"></ion-icon> } Save area</button></footer>
              </article>
            }
          </section>
        }
      } @else if (view() === 'language') {
        <section class="language-compose">
          <div><p class="cc-eyebrow">SEARCH LANGUAGE</p><h2>Help familiar words find the right furniture.</h2><p>One catalog term can understand up to twenty customer alternatives.</p></div>
          <label><span>Catalog term</span><input [value]="newTerm()" maxlength="80" placeholder="e.g. ottoman" (input)="newTerm.set(inputValue($event))" /></label>
          <label><span>Alternative words</span><textarea rows="3" [value]="newSynonyms()" placeholder="footstool, pouf, low seat" (input)="newSynonyms.set(inputValue($event))"></textarea><small>Separate each word or phrase with a comma.</small></label>
          <button type="button" (click)="addSynonym()" [disabled]="adding()">@if (adding()) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="add-outline"></ion-icon> } Add search language</button>
        </section>
        <header class="section-heading"><div><p>ACTIVE DICTIONARY</p><h2>{{ service.synonyms().length }} catalog term{{ service.synonyms().length === 1 ? '' : 's' }}</h2></div></header>
        @if (service.synonyms().length === 0) {
          <cc-empty-state icon="sparkles-outline" title="No search synonyms yet" message="Add the first customer-friendly term above." />
        } @else {
          <section class="synonym-list">
            @for (entry of service.synonyms(); track entry.id) {
              <article><span><ion-icon name="sparkles-outline"></ion-icon></span><div><b>{{ entry.term }}</b><p>{{ entry.synonyms.join(' · ') }}</p></div><button type="button" (click)="removeSynonym(entry.id, entry.term)" [disabled]="busySynonym() === entry.id" [attr.aria-label]="'Remove ' + entry.term">@if (busySynonym() === entry.id) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="trash-outline"></ion-icon> }</button></article>
            }
          </section>
        }
      } @else {
        <section class="insight-intro"><div><p class="cc-eyebrow">30-DAY INTENT</p><h2>Priorities backed by customer behavior.</h2></div><p>Only bounded recent events are loaded. No continuous polling is used.</p></section>
        <section class="insight-grid">
          <article class="insight-card">
            <header><span><ion-icon name="notifications-outline"></ion-icon></span><div><p>PRODUCT WATCHLIST</p><h2>Customers are waiting</h2></div></header>
            @if (alertDemand().length === 0) { <p class="insight-empty">No active stock or price alerts yet.</p> }
            @for (item of alertDemand(); track item.productId) {
              <div class="alert-row"><span class="product-thumb">@if (item.image) { <img [src]="item.image" alt="" loading="lazy" decoding="async" /> } @else { <ion-icon name="cube-outline"></ion-icon> }</span><div><b>{{ item.name }}</b><small>{{ item.category }}</small></div><span><b>{{ item.total }}</b><small>{{ item.stock }} stock · {{ item.price }} price</small></span></div>
            }
          </article>
          <article class="insight-card">
            <header><span><ion-icon name="search-outline"></ion-icon></span><div><p>SEARCH OPPORTUNITIES</p><h2>Language customers use</h2></div></header>
            @if (searchDemand().length === 0) { <p class="insight-empty">Search insights will appear after signed-in customers search.</p> }
            @for (item of searchDemand(); track item.query) {
              <div class="search-row"><div><b>“{{ item.query }}”</b><small>{{ item.collection || 'All collections' }} · {{ shortDate(item.latest) }}</small></div><span [class.has-zero]="item.zero > 0"><b>{{ item.zero }}</b><small>zero-result</small></span><span><b>{{ item.count }}</b><small>searches</small></span></div>
            }
          </article>
        </section>
      }
    </main>
  `,
  styleUrl: './merchandising.page.scss',
})
export class MerchandisingPage {
  protected readonly service = inject(MerchandisingService);
  protected readonly data = inject(AdminDataService);
  private readonly toast = inject(CozyToastService);
  private readonly native = inject(NativePlatformService);
  private readonly alerts = inject(AlertController);

  protected readonly money = money;
  protected readonly shortDate = shortDate;
  protected readonly view = signal<ExperienceView>('delivery');
  protected readonly newTerm = signal('');
  protected readonly newSynonyms = signal('');
  protected readonly busyId = signal<number | null>(null);
  protected readonly busySynonym = signal<number | null>(null);
  protected readonly adding = signal(false);
  protected readonly activeAreaCount = computed(() => this.service.areas().filter((area) => area.active).length);
  protected readonly alertDemand = computed<AlertDemand[]>(() => {
    const products = new Map(this.data.products().map((product) => [product.id, product]));
    const grouped = new Map<string, { stock: number; price: number }>();
    for (const alert of this.service.alerts()) {
      const current = grouped.get(alert.product_id) ?? { stock: 0, price: 0 };
      if (alert.alert_type === 'back_in_stock') current.stock += 1;
      else current.price += 1;
      grouped.set(alert.product_id, current);
    }
    return [...grouped.entries()].map(([productId, counts]) => {
      const product = products.get(productId);
      return {
        productId,
        name: product?.name ?? 'Unavailable product',
        category: product?.subcategory || product?.category || 'Catalog item',
        image: product?.images?.[product.main_image_index] ?? product?.images?.[0] ?? null,
        total: counts.stock + counts.price,
        ...counts,
      };
    }).sort((left, right) => right.total - left.total).slice(0, 12);
  });
  protected readonly searchDemand = computed<SearchDemand[]>(() => {
    const grouped = new Map<string, SearchDemand>();
    for (const event of this.service.searches()) {
      const current = grouped.get(event.normalized_query) ?? {
        query: event.normalized_query,
        count: 0,
        zero: 0,
        latest: event.created_at,
        collection: event.collection ?? '',
      };
      current.count += 1;
      if (event.result_count === 0) current.zero += 1;
      if (Date.parse(event.created_at) > Date.parse(current.latest)) current.latest = event.created_at;
      if (!current.collection && event.collection) current.collection = event.collection;
      grouped.set(event.normalized_query, current);
    }
    return [...grouped.values()].sort((left, right) => right.zero - left.zero || right.count - left.count).slice(0, 15);
  });

  constructor() {
    void this.load();
  }

  protected inputValue(event: Event) {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
  }

  protected numberValue(event: Event) {
    const value = Number(this.inputValue(event));
    return Number.isFinite(value) ? value : 0;
  }

  protected nullableNumberValue(event: Event) {
    const value = this.inputValue(event).trim();
    return value === '' ? null : this.numberValue(event);
  }

  protected integerValue(event: Event) {
    return Math.max(0, Math.round(this.numberValue(event)));
  }

  protected patchArea(id: number, patch: Partial<DeliveryServiceArea>) {
    this.service.updateAreaDraft(id, patch);
  }

  protected selectView(view: ExperienceView) {
    this.view.set(view);
    void this.native.tap();
  }

  protected refresh() {
    void this.load(true);
  }

  protected async saveArea(area: DeliveryServiceArea) {
    if (this.busyId() !== null) return;
    this.busyId.set(area.id);
    try {
      const error = await this.service.saveArea(area);
      if (error) {
        await this.toast.show(error, 'danger');
        await this.native.warning();
        return;
      }
      await Promise.all([this.native.success(), this.toast.show(`${area.name} delivery promise saved.`, 'success')]);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.busyId.set(null);
    }
  }

  protected async addSynonym() {
    if (this.adding()) return;
    this.adding.set(true);
    try {
      const error = await this.service.addSynonym(this.newTerm(), this.newSynonyms().split(','));
      if (error) {
        await this.toast.show(error, 'danger');
        return;
      }
      const term = this.newTerm().trim();
      this.newTerm.set('');
      this.newSynonyms.set('');
      await Promise.all([this.native.success(), this.toast.show(`${term} added to customer search language.`, 'success')]);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.adding.set(false);
    }
  }

  protected async removeSynonym(id: number, term: string) {
    if (this.busySynonym() !== null) return;
    const alert = await this.alerts.create({
      header: `Remove “${term}”?`,
      message: 'Customers will stop matching the alternative words saved under this term.',
      buttons: [{ text: 'Keep', role: 'cancel' }, { text: 'Remove', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    this.busySynonym.set(id);
    try {
      const error = await this.service.removeSynonym(id);
      await this.toast.show(error ?? `${term} removed from search language.`, error ? 'danger' : 'success');
      if (!error) await this.native.success();
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.busySynonym.set(null);
    }
  }

  private async load(force = false) {
    try {
      await this.service.load(force);
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
    }
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'Experience controls could not be updated.';
  }
}
