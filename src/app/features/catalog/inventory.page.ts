import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonIcon,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Product } from '../../core/models/admin.models';
import { dateTime } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';
import { CozyToastService } from '../../shared/components/toast.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { CatalogActionsService } from './catalog-actions.service';

type InventoryView = 'stock' | 'ledger';
type StockFilter = 'all' | 'low';
type AdjustmentDirection = -1 | 1;

interface PendingInventoryAdjustment {
  productId: string;
  direction: AdjustmentDirection;
}

@Component({
  selector: 'cc-inventory-page',
  standalone: true,
  imports: [
    RouterLink,
    IonIcon,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    EmptyStateComponent,
    SkeletonListComponent,
    StatusPillComponent,
    ImgFallbackDirective,
  ],
  templateUrl: './inventory.page.html',
  styleUrls: ['./catalog.shared.scss', './inventory.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryPage {
  private readonly data = inject(AdminDataService);
  private readonly actions = inject(CatalogActionsService);
  private readonly toast = inject(CozyToastService);

  readonly products = this.data.products;
  readonly movements = this.data.inventoryMovements;
  readonly loading = this.data.loading;
  readonly realtimeStatus = this.data.realtimeStatus;
  readonly query = signal('');
  readonly filter = signal<StockFilter>('all');
  readonly view = signal<InventoryView>('stock');
  readonly adjusting = signal<Set<string>>(new Set());
  readonly adjustment = signal<PendingInventoryAdjustment | null>(null);
  readonly adjustmentUnits = signal('1');
  readonly adjustmentReason = signal('');

  readonly threshold = computed(() => this.data.settings().low_stock_threshold);
  readonly lowStock = computed(() => this.products().filter((product) => product.stock_quantity <= this.threshold()));
  readonly warehouseTotal = computed(() => this.products().reduce((total, product) => total + product.stock_quantity, 0));
  readonly visibleProducts = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('en');
    return this.products()
      .filter((product) => this.filter() === 'all' || product.stock_quantity <= this.threshold())
      .filter((product) => !query || `${product.name} ${product.id} ${product.category} ${product.subcategory}`.toLocaleLowerCase('en').includes(query))
      .sort((left, right) => left.stock_quantity - right.stock_quantity || left.name.localeCompare(right.name));
  });
  readonly activeAdjustment = computed(() => {
    const adjustment = this.adjustment();
    if (!adjustment) return null;
    const product = this.products().find((item) => item.id === adjustment.productId);
    return product ? { ...adjustment, product } : null;
  });
  readonly parsedAdjustmentUnits = computed(() => Number(this.adjustmentUnits()));
  readonly adjustmentUnitsValid = computed(() => {
    const units = this.parsedAdjustmentUnits();
    return Number.isInteger(units) && units > 0;
  });
  readonly removalExceedsStock = computed(() => {
    const adjustment = this.activeAdjustment();
    return Boolean(
      adjustment
      && adjustment.direction < 0
      && this.adjustmentUnitsValid()
      && this.parsedAdjustmentUnits() > adjustment.product.stock_quantity,
    );
  });
  readonly resultingStock = computed(() => {
    const adjustment = this.activeAdjustment();
    if (!adjustment || !this.adjustmentUnitsValid() || this.removalExceedsStock()) return null;
    return adjustment.product.stock_quantity + adjustment.direction * this.parsedAdjustmentUnits();
  });
  readonly adjustmentReady = computed(() => (
    this.adjustmentUnitsValid()
    && !this.removalExceedsStock()
    && this.adjustmentReason().trim().length >= 3
  ));

  constructor() {
    void this.data.start();
  }

  readonly dateTime = dateTime;

  updateQuery(event: Event) {
    const value = (event as CustomEvent<{ value?: string | null }>).detail.value;
    this.query.set(value ?? '');
  }

  updateView(event: Event) {
    const value = (event as CustomEvent<{ value?: InventoryView }>).detail.value;
    if (value) this.view.set(value);
  }

  openAdjustment(product: Product, direction: AdjustmentDirection) {
    if (this.adjusting().has(product.id)) return;
    this.adjustment.set({ productId: product.id, direction });
    this.adjustmentUnits.set('1');
    this.adjustmentReason.set('');
  }

  closeAdjustment() {
    const adjustment = this.activeAdjustment();
    if (adjustment && this.adjusting().has(adjustment.product.id)) return;
    this.adjustment.set(null);
    this.adjustmentUnits.set('1');
    this.adjustmentReason.set('');
  }

  setAdjustmentDirection(direction: AdjustmentDirection) {
    const adjustment = this.adjustment();
    if (!adjustment) return;
    this.adjustment.set({ ...adjustment, direction });
  }

  updateAdjustmentUnits(event: Event) {
    const input = event.target as HTMLInputElement;
    const clean = input.value.replace(/\D/g, '').slice(0, 6);
    this.adjustmentUnits.set(clean);
    if (input.value !== clean) input.value = clean;
  }

  bumpAdjustmentUnits(change: number) {
    const current = this.adjustmentUnitsValid() ? this.parsedAdjustmentUnits() : 0;
    this.adjustmentUnits.set(String(Math.max(1, Math.min(999_999, current + change))));
  }

  updateAdjustmentReason(event: Event) {
    this.adjustmentReason.set((event.target as HTMLInputElement).value.slice(0, 180));
  }

  async submitAdjustment(event: Event) {
    event.preventDefault();
    const adjustment = this.activeAdjustment();
    if (!adjustment) return;
    const quantity = this.parsedAdjustmentUnits();
    const reason = this.adjustmentReason().trim();
    if (!quantity) {
      await this.toast.show('Enter a whole-number quantity of at least one.', 'danger');
      return;
    }
    if (reason.length < 3) {
      await this.toast.show('Add a reason of at least three characters.', 'danger');
      return;
    }
    if (adjustment.direction < 0 && quantity > adjustment.product.stock_quantity) {
      await this.toast.show(`Only ${adjustment.product.stock_quantity} units are currently available.`, 'danger');
      return;
    }

    this.setAdjusting(adjustment.product.id, true);
    const delta = adjustment.direction * quantity;
    const result = await this.actions.adjustInventory(adjustment.product.id, delta, reason);
    this.setAdjusting(adjustment.product.id, false);
    await this.toast.show(
      result.error ?? `${adjustment.product.name} now has ${result.data} units on hand.`,
      result.error ? 'danger' : 'success',
    );
    if (!result.error) this.closeAdjustment();
  }

  @HostListener('document:keydown.escape')
  closeAdjustmentFromKeyboard() {
    if (this.adjustment()) this.closeAdjustment();
  }

  productFor(id: string) {
    return this.products().find((product) => product.id === id);
  }

  primaryImage(product: Product) {
    return product.images[product.main_image_index] || product.images[0] || '';
  }

  stockState(product: Product) {
    if (product.stock_quantity === 0) return 'out of stock';
    if (product.stock_quantity <= this.threshold()) return 'low stock';
    return 'active';
  }

  movementValue(value: number) {
    return `${value > 0 ? '+' : ''}${value}`;
  }

  private setAdjusting(id: string, active: boolean) {
    this.adjusting.update((ids) => {
      const next = new Set(ids);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }

}
