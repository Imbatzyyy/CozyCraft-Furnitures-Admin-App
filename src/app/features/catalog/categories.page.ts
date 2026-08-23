import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  AlertController,
  IonIcon,
  IonToggle,
} from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Category, Product } from '../../core/models/admin.models';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { CozyToastService } from '../../shared/components/toast.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { CatalogActionsService } from './catalog-actions.service';

type CategoryFilter = 'all' | 'live' | 'hidden';

interface CategoryRow {
  category: Category;
  products: number;
  published: number;
  subcategories: string[];
  image: string;
}

@Component({
  selector: 'cc-categories-page',
  standalone: true,
  imports: [
    IonIcon,
    IonToggle,
    EmptyStateComponent,
    SkeletonListComponent,
    ImgFallbackDirective,
  ],
  templateUrl: './categories.page.html',
  styleUrls: ['./catalog.shared.scss', './categories.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesPage {
  readonly data = inject(AdminDataService);
  private readonly actions = inject(CatalogActionsService);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(CozyToastService);

  readonly loading = this.data.loading;
  readonly products = this.data.products;
  readonly previewOrder = signal<Category[] | null>(null);
  readonly categories = computed(() => this.previewOrder() ?? this.data.categories());
  readonly busy = signal<Set<number>>(new Set());
  readonly reordering = signal(false);
  readonly query = signal('');
  readonly filter = signal<CategoryFilter>('all');

  readonly rows = computed<CategoryRow[]>(() => {
    const productsByCategory = new Map<string, Product[]>();
    for (const product of this.products()) {
      const products = productsByCategory.get(product.category) ?? [];
      products.push(product);
      productsByCategory.set(product.category, products);
    }

    return this.categories().map((category) => {
      const products = productsByCategory.get(category.name) ?? [];
      const subcategories = [...new Set(products.map((product) => product.subcategory).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
      const imageProduct = products.find((product) => product.images.length > 0);
      return {
        category,
        products: products.length,
        published: products.filter((product) => product.status === 'active').length,
        subcategories,
        image: imageProduct
          ? imageProduct.images[imageProduct.main_image_index] || imageProduct.images[0] || ''
          : '',
      };
    });
  });

  readonly summary = computed(() => {
    const counts = { all: 0, live: 0, hidden: 0, products: 0, groups: 0 };
    for (const row of this.rows()) {
      counts.all += 1;
      counts[row.category.active ? 'live' : 'hidden'] += 1;
      counts.products += row.products;
      counts.groups += row.subcategories.length;
    }
    return counts;
  });

  readonly visibleRows = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('en');
    const filter = this.filter();
    return this.rows().filter((row) => {
      const matchesFilter = filter === 'all'
        || (filter === 'live' && row.category.active)
        || (filter === 'hidden' && !row.category.active);
      const haystack = `${row.category.name} ${row.category.slug} ${row.subcategories.join(' ')}`
        .toLocaleLowerCase('en');
      return matchesFilter && (!query || haystack.includes(query));
    });
  });

  constructor() {
    void this.data.start();
  }

  updateQuery(value: string) {
    this.query.set(value);
  }

  clearQuery() {
    this.query.set('');
  }

  selectFilter(filter: CategoryFilter) {
    this.filter.set(filter);
  }

  filterCount(filter: CategoryFilter) {
    return this.summary()[filter];
  }

  async createCategory() {
    const name = await this.promptForName('New category', '', 'Create a customer browse room.');
    if (!name) return;
    const result = await this.actions.createCategory(name);
    await this.toast.show(
      result.error ?? `${result.data?.name ?? name} was added to the collection map.`,
      result.error ? 'danger' : 'success',
    );
  }

  async renameCategory(category: Category) {
    const name = await this.promptForName('Rename category', category.name, 'Assigned products will move to the new name too.');
    if (!name || name === category.name) return;
    this.setBusy(category.id, true);
    const result = await this.actions.renameCategory(category, name);
    this.setBusy(category.id, false);
    await this.toast.show(
      result.error ?? `${category.name} is now ${name}. Assigned products were updated.`,
      result.error ? 'danger' : 'success',
    );
  }

  async toggleCategory(category: Category, event: Event) {
    if (this.busy().has(category.id)) return;
    const active = Boolean((event as CustomEvent<{ checked?: boolean }>).detail.checked);
    if (active === category.active) return;
    this.setBusy(category.id, true);
    const result = await this.actions.setCategoryActive(category, active);
    this.setBusy(category.id, false);
    await this.toast.show(
      result.error ?? `${category.name} is now ${active ? 'visible in' : 'hidden from'} the customer browse menu.`,
      result.error ? 'danger' : 'success',
    );
  }

  async move(category: Category, direction: -1 | 1) {
    if (this.reordering()) return;
    const current = [...this.categories()];
    const index = current.findIndex((item) => item.id === category.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    [current[index], current[nextIndex]] = [current[nextIndex]!, current[index]!];
    this.previewOrder.set(current);
    this.reordering.set(true);
    const result = await this.actions.reorderCategories(current);
    this.previewOrder.set(null);
    this.reordering.set(false);
    await this.toast.show(
      result.error ?? 'Collection order saved and synced.',
      result.error ? 'danger' : 'success',
    );
  }

  canMove(category: Category, direction: -1 | 1) {
    const index = this.categories().findIndex((item) => item.id === category.id);
    const nextIndex = index + direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < this.categories().length;
  }

  private async promptForName(header: string, value: string, message: string) {
    const alert = await this.alerts.create({
      header,
      message,
      cssClass: 'cc-alert',
      inputs: [{ name: 'name', type: 'text', value, placeholder: 'Category name', attributes: { maxlength: 80 } }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: value ? 'Save name' : 'Create category', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss<{ values?: { name?: string } }>();
    if (result.role !== 'confirm') return null;
    const data = result.data as { values?: { name?: string }; name?: string } | undefined;
    return (data?.values?.name ?? data?.name ?? '').trim() || null;
  }

  private setBusy(id: number, active: boolean) {
    this.busy.update((ids) => {
      const next = new Set(ids);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }

}
