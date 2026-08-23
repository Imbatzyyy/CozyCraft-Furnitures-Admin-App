import { Injectable } from '@angular/core';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { Category, Product, ProductStatus } from '../../core/models/admin.models';

const PRODUCT_IMAGE_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ProductMutation = Pick<
  Product,
  | 'id'
  | 'name'
  | 'category'
  | 'subcategory'
  | 'price'
  | 'stock_quantity'
  | 'status'
  | 'color'
  | 'material'
  | 'dimensions'
  | 'description'
  | 'images'
  | 'main_image_index'
>;

export interface CatalogActionResult<T = undefined> {
  data?: T;
  error: string | null;
}

export interface ProductImageUploadResult {
  urls: string[];
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class CatalogActionsService {
  private readonly client = this.connection.client;

  constructor(
    private readonly connection: SupabaseAdminService,
    private readonly auth: AdminAuthService,
    private readonly workspace: AdminDataService,
  ) {}

  async saveProduct(product: ProductMutation, create: boolean): Promise<CatalogActionResult<Product>> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };

    const validationError = this.validateProduct(product);
    if (validationError) return { error: validationError };

    const payload = {
      name: product.name.trim(),
      category: product.category.trim(),
      subcategory: product.subcategory.trim(),
      price: Number(product.price),
      stock_quantity: Math.trunc(Number(product.stock_quantity)),
      status: product.status,
      color: product.color.trim(),
      material: product.material,
      dimensions: product.dimensions,
      description: product.description.trim(),
      images: product.images,
      main_image_index: product.main_image_index,
    };

    const request = create
      ? this.client.from('products').insert({ id: product.id, ...payload })
      : this.client.from('products').update(payload).eq('id', product.id);
    const { data, error } = await request
      .select('id,name,category,subcategory,price,stock_quantity,status,color,material,dimensions,description,images,main_image_index,rating,review_count,created_at,updated_at')
      .single();

    if (error) return { error: this.catalogError(error.message) };
    await this.refreshWorkspace(this.workspace.loadProducts(), this.workspace.loadInventory());
    return {
      data: {
        ...data,
        price: Number(data.price),
        rating: Number(data.rating),
        images: Array.isArray(data.images) ? data.images : [],
      } as Product,
      error: null,
    };
  }

  async updateProductStatus(id: string, status: ProductStatus): Promise<CatalogActionResult> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };
    const { data: updated, error } = await this.client.from('products').update({ status }).eq('id', id).select('id').maybeSingle();
    if (!error && !updated) return { error: 'This product is no longer available.' };
    if (!error) await this.refreshWorkspace(this.workspace.loadProducts());
    return { error: error ? this.catalogError(error.message) : null };
  }

  async deleteProduct(product: Product): Promise<CatalogActionResult<{ storageWarning: string | null }>> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };
    const { data: deleted, error } = await this.client.from('products').delete().eq('id', product.id).select('id').maybeSingle();
    if (error) return { error: this.catalogError(error.message) };
    if (!deleted) return { error: 'This product was already removed or is no longer accessible.' };

    const cleanup = await this.removeProductImages(product.images);
    await this.refreshWorkspace(this.workspace.loadProducts(), this.workspace.loadInventory());
    return {
      data: { storageWarning: cleanup.error },
      error: null,
    };
  }

  async uploadProductImages(files: File[]): Promise<ProductImageUploadResult> {
    const accessError = this.staffAccessError();
    if (accessError) return { urls: [], errors: [accessError] };

    const urls: string[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        errors.push(`${file.name}: use a JPG, PNG, or WebP image.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(`${file.name}: the 10 MB image limit was exceeded.`);
        continue;
      }

      const extension = this.extensionFor(file.type);
      const safeBaseName = file.name
        .replace(/\.[^.]+$/, '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'product-photo';
      const owner = this.auth.userId() ?? 'staff';
      const path = `mobile/${owner}/${Date.now()}-${crypto.randomUUID()}-${safeBaseName}.${extension}`;
      const { error } = await this.client.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, {
        cacheControl: '31536000',
        contentType: file.type,
        upsert: false,
      });
      if (error) {
        errors.push(`${file.name}: ${error.message}`);
        continue;
      }
      urls.push(this.client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl);
    }
    return { urls, errors };
  }

  async removeProductImages(urls: string[]): Promise<CatalogActionResult> {
    const paths = urls
      .map((url) => this.productImagePath(url))
      .filter((path): path is string => Boolean(path));
    if (!paths.length) return { error: null };
    const { error } = await this.client.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths);
    return { error: error?.message ?? null };
  }

  async createCategory(name: string): Promise<CatalogActionResult<Category>> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };
    const cleanName = this.cleanCategoryName(name);
    if (!cleanName) return { error: 'Enter a category name.' };
    if (this.categoryNameExists(cleanName)) return { error: 'A category with that name already exists.' };

    const slug = await this.uniqueCategorySlug(cleanName);
    const nextOrder = Math.max(0, ...this.workspace.categories().map((item) => item.sort_order)) + 1;
    const { data, error } = await this.client
      .from('categories')
      .insert({ name: cleanName, slug, sort_order: nextOrder, active: true })
      .select('id,name,slug,sort_order,active,created_at')
      .single();
    if (error) return { error: this.catalogError(error.message) };
    await this.refreshWorkspace(this.workspace.loadCategories());
    return { data: data as Category, error: null };
  }

  async setCategoryActive(category: Category, active: boolean): Promise<CatalogActionResult> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };
    const { data: updated, error } = await this.client.from('categories').update({ active }).eq('id', category.id).select('id').maybeSingle();
    if (!error && !updated) return { error: 'This category is no longer available.' };
    if (!error) await this.refreshWorkspace(this.workspace.loadCategories());
    return { error: error ? this.catalogError(error.message) : null };
  }

  async renameCategory(category: Category, name: string): Promise<CatalogActionResult> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };
    const cleanName = this.cleanCategoryName(name);
    if (!cleanName) return { error: 'Enter a category name.' };
    if (cleanName === category.name) return { error: null };
    if (this.categoryNameExists(cleanName, category.id)) return { error: 'A category with that name already exists.' };

    const slug = await this.uniqueCategorySlug(cleanName, category.id);
    const categoryUpdate = await this.client
      .from('categories')
      .update({ name: cleanName, slug })
      .eq('id', category.id)
      .select('id')
      .maybeSingle();
    if (categoryUpdate.error) return { error: this.catalogError(categoryUpdate.error.message) };
    if (!categoryUpdate.data) return { error: 'This category is no longer available.' };

    const productUpdate = await this.client
      .from('products')
      .update({ category: cleanName })
      .eq('category', category.name);
    if (productUpdate.error) {
      await this.client
        .from('categories')
        .update({ name: category.name, slug: category.slug })
        .eq('id', category.id);
      await this.refreshWorkspace(this.workspace.loadCategories());
      return { error: `Products could not be reassigned, so the category rename was rolled back. ${productUpdate.error.message}` };
    }

    await this.refreshWorkspace(this.workspace.loadCategories(), this.workspace.loadProducts());
    return { error: null };
  }

  async reorderCategories(ordered: Category[]): Promise<CatalogActionResult> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };
    const original = new Map(this.workspace.categories().map((item) => [item.id, item.sort_order]));
    const completed: Category[] = [];
    for (const [index, category] of ordered.entries()) {
      const { data: updated, error } = await this.client
        .from('categories')
        .update({ sort_order: index + 1 })
        .eq('id', category.id)
        .select('id')
        .maybeSingle();
      if (error || !updated) {
        await Promise.all(completed.map((item) => this.client
          .from('categories')
          .update({ sort_order: original.get(item.id) ?? item.sort_order })
          .eq('id', item.id)));
        await this.refreshWorkspace(this.workspace.loadCategories());
        return { error: `The collection order could not be saved. ${error?.message ?? 'A category changed on another device.'}` };
      }
      completed.push(category);
    }
    await this.refreshWorkspace(this.workspace.loadCategories());
    return { error: null };
  }

  async adjustInventory(productId: string, delta: number, reason: string): Promise<CatalogActionResult<number>> {
    const accessError = this.staffAccessError();
    if (accessError) return { error: accessError };
    const cleanReason = reason.trim();
    if (!Number.isInteger(delta) || delta === 0) return { error: 'Enter a whole-number stock adjustment.' };
    if (cleanReason.length < 3) return { error: 'Add a reason of at least three characters.' };
    const { data, error } = await this.client.rpc('adjust_product_inventory', {
      p_product_id: productId,
      p_delta: delta,
      p_reason: cleanReason,
    });
    if (error) return { error: this.catalogError(error.message) };
    const quantity = Number(data);
    this.workspace.applyInventoryQuantity(productId, quantity);
    if (this.workspace.realtimeStatus() !== 'live') {
      await this.refreshWorkspace(this.workspace.loadProducts(), this.workspace.loadInventory());
    }
    return { data: quantity, error: null };
  }

  createProductId(name: string, category: string, subcategory: string) {
    return [name, category, subcategory, crypto.randomUUID().slice(0, 8)]
      .map((part) => this.slugify(part) || 'product')
      .join('-');
  }

  private validateProduct(product: ProductMutation) {
    if (!product.id.trim()) return 'A product identifier could not be generated.';
    if (!product.name.trim()) return 'Enter a product name.';
    if (!product.category.trim() || !product.subcategory.trim()) return 'Choose a category and enter a subcategory.';
    if (product.description.trim().length < 10) return 'Write a product description of at least 10 characters.';
    if (!Number.isFinite(Number(product.price)) || Number(product.price) < 0) return 'Enter a valid non-negative price.';
    if (!Number.isInteger(Number(product.stock_quantity)) || Number(product.stock_quantity) < 0) return 'Stock must be a non-negative whole number.';
    if (product.images.length !== 4) return 'Exactly four product images are required.';
    if (product.main_image_index < 0 || product.main_image_index >= product.images.length) return 'Choose a valid main product image.';
    return null;
  }

  private categoryNameExists(name: string, excludeId?: number) {
    const normalized = name.toLocaleLowerCase('en');
    return this.workspace.categories().some((category) =>
      category.id !== excludeId && category.name.trim().toLocaleLowerCase('en') === normalized);
  }

  private async uniqueCategorySlug(name: string, excludeId?: number) {
    const base = this.slugify(name) || 'collection';
    let candidate = base;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const { data } = await this.client.from('categories').select('id').eq('slug', candidate).maybeSingle();
      if (!data || Number(data.id) === excludeId) return candidate;
      candidate = `${base}-${suffix}`;
    }
    return `${base}-${crypto.randomUUID().slice(0, 8)}`;
  }

  private productImagePath(url: string) {
    try {
      const path = new URL(url).pathname;
      const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
      const index = path.indexOf(marker);
      return index >= 0 ? decodeURIComponent(path.slice(index + marker.length)) : null;
    } catch {
      return null;
    }
  }

  private extensionFor(type: string) {
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    return 'jpg';
  }

  private cleanCategoryName(value: string) {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  }

  private slugify(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private staffAccessError() {
    return this.auth.role() ? null : 'Administrator access is required.';
  }

  private async refreshWorkspace(...tasks: Array<Promise<void>>) {
    await Promise.allSettled(tasks);
  }

  private catalogError(message: string) {
    if (/duplicate key|already exists|unique constraint/i.test(message)) return 'That catalog record already exists.';
    if (/foreign key|violates.*constraint/i.test(message)) return 'This record is still used by another part of the store and cannot be removed.';
    return message;
  }
}
