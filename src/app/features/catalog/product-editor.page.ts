import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonIcon } from '@ionic/angular/standalone';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Product, ProductStatus } from '../../core/models/admin.models';
import { CozyToastService } from '../../shared/components/toast.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { CatalogActionsService, ProductMutation } from './catalog-actions.service';

interface MaterialSpec {
  type: string;
  description: string;
}

interface DimensionSpec {
  label: string;
  value: string;
  unit: string;
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const parseArray = (value: string): unknown[] | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const legacyLines = (value: string) => value
  .split(/\n|•/)
  .map((line) => line.replace(/^[-–—]\s*/, '').trim())
  .filter(Boolean);

function parseMaterials(value: string): MaterialSpec[] {
  const source = clean(value);
  if (!source) return [{ type: '', description: '' }];
  const parsed = parseArray(source);
  if (parsed) {
    const rows = parsed.flatMap((item): MaterialSpec[] => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const row = { type: clean(record['type']), description: clean(record['description']) };
      return row.type || row.description ? [row] : [];
    });
    return rows.length ? rows : [{ type: '', description: '' }];
  }
  return legacyLines(source).map((line) => {
    const match = line.match(/^([^:–—]+?)\s*(?::|–|—)\s*(.+)$/);
    return match ? { type: match[1]?.trim() ?? '', description: match[2]?.trim() ?? '' } : { type: line, description: '' };
  });
}

function parseDimensions(value: string): DimensionSpec[] {
  const source = clean(value);
  if (!source) return [{ label: '', value: '', unit: 'cm' }];
  const parsed = parseArray(source);
  if (parsed) {
    const rows = parsed.flatMap((item): DimensionSpec[] => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const row = { label: clean(record['label']), value: clean(record['value']), unit: clean(record['unit']) };
      return row.label || row.value ? [row] : [];
    });
    return rows.length ? rows : [{ label: '', value: '', unit: 'cm' }];
  }
  return legacyLines(source).map((line) => {
    const match = line.match(/^([^:–—]+?)\s*(?::|–|—)\s*(.+?)\s*(mm|cm|m|in|ft)?$/i);
    return match
      ? { label: match[1]?.trim() ?? '', value: match[2]?.trim() ?? '', unit: match[3] ?? 'cm' }
      : { label: 'Overall', value: line, unit: '' };
  });
}

const serializeMaterials = (rows: MaterialSpec[]) => JSON.stringify(rows
  .map((row) => ({ type: clean(row.type), description: clean(row.description) }))
  .filter((row) => row.type || row.description));

const serializeDimensions = (rows: DimensionSpec[]) => JSON.stringify(rows
  .map((row) => ({ label: clean(row.label), value: clean(row.value), unit: clean(row.unit) }))
  .filter((row) => row.label || row.value));

@Component({
  selector: 'cc-product-editor-page',
  standalone: true,
  imports: [FormsModule, IonIcon, ImgFallbackDirective],
  templateUrl: './product-editor.page.html',
  styleUrls: ['./catalog.shared.scss', './product-editor.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductEditorPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(AdminDataService);
  private readonly actions = inject(CatalogActionsService);
  private readonly alertController = inject(AlertController);
  private readonly toast = inject(CozyToastService);
  private readonly uploadedThisSession = new Set<string>();
  private originalImages: string[] = [];
  private originalProduct: Product | null = null;
  private committed = false;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly uploading = signal(false);
  readonly notFound = signal(false);
  readonly isNew = signal(true);
  readonly error = signal('');
  readonly imageSlots = [0, 1, 2, 3];
  readonly statuses: Array<{ value: ProductStatus; label: string; detail: string }> = [
    { value: 'active', label: 'Active', detail: 'Visible to customers' },
    { value: 'draft', label: 'Draft', detail: 'Admin workspace only' },
    { value: 'inactive', label: 'Inactive', detail: 'Hidden from storefront' },
  ];

  draft: ProductMutation = this.emptyProduct();
  materials: MaterialSpec[] = [{ type: '', description: '' }];
  dimensions: DimensionSpec[] = [{ label: '', value: '', unit: 'cm' }];

  get categories() {
    return this.data.categories();
  }

  async ngOnInit() {
    try {
      await this.data.start();
      const productId = this.route.snapshot.paramMap.get('id');
      if (!productId || productId === 'new') {
        this.isNew.set(true);
        this.draft = this.emptyProduct(this.categories[0]?.name ?? '');
        return;
      }

      this.isNew.set(false);
      let product = this.data.products().find((item) => item.id === productId);
      if (!product) {
        await this.data.loadProducts();
        product = this.data.products().find((item) => item.id === productId);
      }
      if (!product) {
        this.notFound.set(true);
        return;
      }
      this.originalProduct = product;
      this.originalImages = [...product.images];
      this.draft = {
        id: product.id,
        name: product.name,
        category: product.category,
        subcategory: product.subcategory,
        price: product.price,
        stock_quantity: product.stock_quantity,
        status: product.status,
        color: product.color,
        material: product.material,
        dimensions: product.dimensions,
        description: product.description,
        images: [...product.images],
        main_image_index: product.main_image_index,
      };
      this.materials = parseMaterials(product.material);
      this.dimensions = parseDimensions(product.dimensions);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy() {
    if (!this.committed && this.uploadedThisSession.size) {
      void this.actions.removeProductImages([...this.uploadedThisSession]);
    }
  }

  subcategorySuggestions() {
    const options = new Set(this.data.products()
      .filter((product) => product.category === this.draft.category)
      .map((product) => product.subcategory)
      .filter(Boolean));
    return [...options].sort((left, right) => left.localeCompare(right));
  }

  selectStatus(status: ProductStatus) {
    this.draft.status = status;
  }

  addMaterial() {
    this.materials = [...this.materials, { type: '', description: '' }];
  }

  removeMaterial(index: number) {
    if (this.materials.length === 1) return;
    this.materials = this.materials.filter((_, itemIndex) => itemIndex !== index);
  }

  addDimension() {
    this.dimensions = [...this.dimensions, { label: '', value: '', unit: 'cm' }];
  }

  removeDimension(index: number) {
    if (this.dimensions.length === 1) return;
    this.dimensions = this.dimensions.filter((_, itemIndex) => itemIndex !== index);
  }

  setMainImage(index: number) {
    if (this.draft.images[index]) this.draft.main_image_index = index;
  }

  async removeImage(index: number) {
    const url = this.draft.images[index];
    if (!url) return;
    if (this.uploadedThisSession.has(url)) {
      await this.actions.removeProductImages([url]);
      this.uploadedThisSession.delete(url);
    }
    this.draft.images = this.draft.images.filter((_, itemIndex) => itemIndex !== index);
    if (index === this.draft.main_image_index) this.draft.main_image_index = 0;
    else if (index < this.draft.main_image_index) this.draft.main_image_index -= 1;
    this.error.set('');
  }

  async onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    const slots = 4 - this.draft.images.length;
    if (slots <= 0) {
      this.error.set('The four-photo limit is already reached. Remove a photo first.');
      return;
    }
    const selected = files.slice(0, slots);
    this.uploading.set(true);
    this.error.set('');
    try {
      const result = await this.actions.uploadProductImages(selected);
      result.urls.forEach((url) => this.uploadedThisSession.add(url));
      this.draft.images = [...this.draft.images, ...result.urls].slice(0, 4);
      const messages = [...result.errors];
      if (files.length > slots) messages.unshift(`Only ${slots} more photo${slots === 1 ? '' : 's'} could be added.`);
      if (messages.length) this.error.set(messages.join(' '));
    } finally {
      this.uploading.set(false);
    }
  }

  async save() {
    if (this.saving()) return;
    this.error.set('');
    const validationError = this.validate();
    if (validationError) {
      this.error.set(validationError);
      return;
    }

    const duplicate = this.data.products().find((product) =>
      product.id !== this.draft.id
      && this.identity(product.name) === this.identity(this.draft.name)
      && this.identity(product.category) === this.identity(this.draft.category)
      && this.identity(product.subcategory) === this.identity(this.draft.subcategory));
    if (duplicate) {
      this.error.set(`${duplicate.name} already exists in ${duplicate.category} → ${duplicate.subcategory}.`);
      return;
    }

    this.saving.set(true);
    this.draft.material = serializeMaterials(this.materials);
    this.draft.dimensions = serializeDimensions(this.dimensions);
    if (this.isNew()) {
      this.draft.id = this.actions.createProductId(this.draft.name, this.draft.category, this.draft.subcategory);
    }
    const result = await this.actions.saveProduct(this.draft, this.isNew());
    if (result.error) {
      this.error.set(result.error);
      this.saving.set(false);
      return;
    }

    const removedOriginalImages = this.originalImages.filter((url) => !this.draft.images.includes(url));
    const cleanup = await this.actions.removeProductImages(removedOriginalImages);
    this.uploadedThisSession.clear();
    this.committed = true;
    this.saving.set(false);
    await this.toast.show(
      cleanup.error
        ? `${this.draft.name} was saved. One or more replaced image files could not be cleaned up.`
        : `${this.draft.name} ${this.isNew() ? 'was added to' : 'was updated in'} the catalog.`,
      cleanup.error ? 'neutral' : 'success',
    );
    await this.router.navigate(['/app/products'], { replaceUrl: true });
  }

  async confirmDelete() {
    if (!this.originalProduct || this.deleting()) return;
    const alert = await this.alertController.create({
      header: 'Delete product?',
      subHeader: this.originalProduct.name,
      message: 'This permanently removes the product from the catalog. Existing order snapshots remain in order history.',
      cssClass: 'cc-alert',
      buttons: [
        { text: 'Keep product', role: 'cancel' },
        { text: 'Delete permanently', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;

    this.deleting.set(true);
    const result = await this.actions.deleteProduct(this.originalProduct);
    if (result.error) {
      this.deleting.set(false);
      await this.toast.show(result.error, 'danger');
      return;
    }
    if (this.uploadedThisSession.size) await this.actions.removeProductImages([...this.uploadedThisSession]);
    this.uploadedThisSession.clear();
    this.committed = true;
    await this.toast.show(
      result.data?.storageWarning
        ? `${this.originalProduct.name} was deleted, but some image cleanup needs attention.`
        : `${this.originalProduct.name} was deleted.`,
      result.data?.storageWarning ? 'neutral' : 'success',
    );
    await this.router.navigate(['/app/products'], { replaceUrl: true });
  }

  async cancel() {
    if (this.uploadedThisSession.size) await this.actions.removeProductImages([...this.uploadedThisSession]);
    this.uploadedThisSession.clear();
    this.committed = true;
    await this.router.navigate(['/app/products']);
  }

  private emptyProduct(category = ''): ProductMutation {
    return {
      id: '',
      name: '',
      category,
      subcategory: '',
      price: 0,
      stock_quantity: 0,
      status: 'active',
      color: '',
      material: '[]',
      dimensions: '[]',
      description: '',
      images: [],
      main_image_index: 0,
    };
  }

  private validate() {
    if (!this.draft.name.trim()) return 'Enter a product name.';
    if (!this.draft.category.trim()) return 'Choose a room category.';
    if (!this.draft.subcategory.trim()) return 'Enter a product subcategory.';
    if (this.draft.description.trim().length < 10) return 'Write a product description of at least 10 characters.';
    if (!Number.isFinite(Number(this.draft.price)) || Number(this.draft.price) < 0) return 'Enter a valid non-negative price.';
    if (!Number.isInteger(Number(this.draft.stock_quantity)) || Number(this.draft.stock_quantity) < 0) return 'Stock must be a non-negative whole number.';
    if (this.draft.images.length !== 4) return `Exactly four product images are required. Add ${4 - this.draft.images.length} more.`;
    return null;
  }

  private identity(value: string) {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'The product editor could not be loaded.';
  }
}
