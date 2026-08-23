import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Product } from '../../core/models/admin.models';
import { money } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';
import { CozyToastService } from '../../shared/components/toast.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { CatalogActionsService } from './catalog-actions.service';

type ProductView = 'compact' | 'gallery';
type ProductFilter = 'all' | 'active' | 'draft' | 'stock';

@Component({
  selector: 'cc-products-page',
  standalone: true,
  imports: [
    RouterLink,
    IonIcon,
    EmptyStateComponent,
    SkeletonListComponent,
    StatusPillComponent,
    ImgFallbackDirective,
  ],
  templateUrl: './products.page.html',
  styleUrls: ['./catalog.shared.scss', './products.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsPage {
  private readonly pageSize = 18;
  readonly data = inject(AdminDataService);
  private readonly actions = inject(CatalogActionsService);
  private readonly toast = inject(CozyToastService);
  private readonly router = inject(Router);

  readonly products = this.data.products;
  readonly loading = this.data.loading;
  readonly query = signal('');
  readonly category = signal('all');
  readonly filter = signal<ProductFilter>('all');
  readonly view = signal<ProductView>('compact');
  readonly changing = signal<Set<string>>(new Set());
  readonly syncing = signal(false);
  readonly visibleLimit = signal(this.pageSize);

  readonly filters = [
    { value: 'active', label: 'Published', icon: 'eye-outline' },
    { value: 'draft', label: 'Drafts', icon: 'create-outline' },
    { value: 'stock', label: 'Stock alerts', icon: 'alert-circle-outline' },
  ] as const;

  readonly categoryOptions = computed(() => {
    const names = new Set([
      ...this.data.categories().map((item) => item.name),
      ...this.products().map((item) => item.category),
    ]);
    return [...names].filter(Boolean).sort((left, right) => left.localeCompare(right));
  });

  readonly visibleProducts = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('en');
    const category = this.category();
    const filter = this.filter();
    const threshold = this.data.settings().low_stock_threshold;
    return this.products().filter((product) => {
      const matchesCategory = category === 'all' || product.category === category;
      const matchesFilter = filter === 'all'
        || product.status === filter
        || (filter === 'stock' && product.stock_quantity <= threshold);
      const haystack = `${product.name} ${product.id} ${product.category} ${product.subcategory} ${product.material}`
        .toLocaleLowerCase('en');
      return matchesCategory && matchesFilter && (!query || haystack.includes(query));
    });
  });

  readonly summary = computed(() => {
    const threshold = this.data.settings().low_stock_threshold;
    const counts = { total: 0, active: 0, draft: 0, stock: 0 };
    for (const product of this.products()) {
      counts.total += 1;
      if (product.status === 'active') counts.active += 1;
      if (product.status === 'draft') counts.draft += 1;
      if (product.stock_quantity <= threshold) counts.stock += 1;
    }
    return counts;
  });
  readonly displayedProducts = computed(() => this.visibleProducts().slice(0, this.visibleLimit()));
  readonly remainingProducts = computed(() => Math.max(0, this.visibleProducts().length - this.displayedProducts().length));

  constructor() {
    void this.data.start();
  }

  readonly money = money;

  updateQuery(value: string) {
    this.query.set(value);
    this.resetVisibleLimit();
  }

  clearQuery() {
    this.updateQuery('');
  }

  updateCategory(value: string) {
    this.category.set(value || 'all');
    this.resetVisibleLimit();
  }

  selectFilter(value: ProductFilter) {
    this.filter.set(value);
    this.resetVisibleLimit();
  }

  selectView(value: ProductView) {
    this.view.set(value);
    this.resetVisibleLimit();
  }

  filterCount(value: Exclude<ProductFilter, 'all'>) {
    return this.summary()[value];
  }

  showMore() {
    this.visibleLimit.update((limit) => limit + this.pageSize);
  }

  async syncProducts() {
    if (this.syncing()) return;
    this.syncing.set(true);
    try {
      await this.data.loadProducts();
      await this.toast.show('Product catalog is up to date.', 'success');
    } catch (error) {
      await this.toast.show(this.errorMessage(error), 'danger');
    } finally {
      this.syncing.set(false);
    }
  }

  async toggleStatus(product: Product) {
    if (this.changing().has(product.id)) return;
    this.changing.update((ids) => new Set(ids).add(product.id));
    const nextStatus = product.status === 'active' ? 'inactive' : 'active';
    const result = await this.actions.updateProductStatus(product.id, nextStatus);
    this.changing.update((ids) => {
      const next = new Set(ids);
      next.delete(product.id);
      return next;
    });
    await this.toast.show(
      result.error ?? `${product.name} is now ${nextStatus === 'active' ? 'live in' : 'hidden from'} the storefront.`,
      result.error ? 'danger' : 'success',
    );
  }

  openProduct(product: Product) {
    void this.router.navigate(['/app/products', product.id]);
  }

  primaryImage(product: Product) {
    return product.images[product.main_image_index] || product.images[0] || '';
  }

  stockState(product: Product) {
    if (product.stock_quantity === 0) return 'out of stock';
    if (product.stock_quantity <= this.data.settings().low_stock_threshold) return 'low stock';
    return 'in stock';
  }

  private resetVisibleLimit() {
    this.visibleLimit.set(this.pageSize);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'Products could not be refreshed.';
  }
}
