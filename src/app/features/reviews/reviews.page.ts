import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonIcon, IonModal, IonSpinner } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { Review } from '../../core/models/admin.models';
import { dateTime } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonListComponent } from '../../shared/components/skeleton-list.component';
import { StatusPillComponent } from '../../shared/components/status-pill.component';
import { CozyToastService } from '../../shared/components/toast.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';

type ReviewFilter = 'all' | 'pending' | 'published' | 'photos';

interface ReviewGallery {
  reviewId: string;
  index: number;
}

@Component({
  selector: 'cc-reviews-page',
  standalone: true,
  imports: [IonIcon, IonModal, IonSpinner, EmptyStateComponent, SkeletonListComponent, StatusPillComponent, ImgFallbackDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="cc-page reviews-page">
      <section class="review-desk" aria-labelledby="reviews-heading">
        <div class="review-desk__topline">
          <p class="eyebrow">Review desk</p>
          <span class="live-chip"><i></i> Live</span>
        </div>
        <div class="review-desk__intro">
          <div>
            <h1 id="reviews-heading">Customer voice,<br><em>clearly sorted.</em></h1>
            <p>See what matters, inspect customer photos, and publish with one decision.</p>
          </div>
          <div class="score" aria-label="Average customer rating">
            <span><ion-icon name="star" /> Average</span>
            <strong>{{ averageRating().toFixed(1) }}</strong>
            <small>out of 5</small>
          </div>
        </div>
        <div class="review-desk__footer">
          <div class="reviewer-stack" aria-label="Recent reviewers with profile photos">
            @for (review of avatarReviews().slice(0, 4); track review.id) {
              <span class="stack-avatar" [attr.title]="reviewerName(review)">
                <b>{{ reviewerInitials(review) }}</b>
                <img [src]="review.profiles!.avatar_url!" [alt]="reviewerName(review) + ' profile photo'" referrerpolicy="no-referrer" loading="lazy" decoding="async" (error)="hideAvatar($event)" />
              </span>
            }
            @if (avatarReviews().length === 0) {
              <span class="stack-avatar stack-avatar--empty"><ion-icon name="people-outline" /></span>
            }
          </div>
          <div class="desk-metrics">
            <span><strong>{{ pendingCount() }}</strong> to review</span>
            <span><strong>{{ publishedCount() }}</strong> live</span>
            <span><strong>{{ photoCount() }}</strong> with photos</span>
          </div>
        </div>
      </section>

      <nav class="filter-rail" aria-label="Review filters">
        <button type="button" [class.is-active]="filter() === 'all'" [attr.aria-pressed]="filter() === 'all'" (click)="setFilter('all')"><ion-icon name="albums-outline" /><span>All</span><b>{{ data.reviews().length }}</b></button>
        <button type="button" [class.is-active]="filter() === 'pending'" [attr.aria-pressed]="filter() === 'pending'" (click)="setFilter('pending')"><ion-icon name="time-outline" /><span>Pending</span><b>{{ pendingCount() }}</b></button>
        <button type="button" [class.is-active]="filter() === 'published'" [attr.aria-pressed]="filter() === 'published'" (click)="setFilter('published')"><ion-icon name="checkmark-circle-outline" /><span>Published</span><b>{{ publishedCount() }}</b></button>
        <button type="button" [class.is-active]="filter() === 'photos'" [attr.aria-pressed]="filter() === 'photos'" (click)="setFilter('photos')"><ion-icon name="images-outline" /><span>Photos</span><b>{{ photoCount() }}</b></button>
      </nav>

      <header class="queue-heading">
        <div><p>{{ activeFilterLabel() }}</p><strong>{{ visibleReviews().length }} {{ visibleReviews().length === 1 ? 'review' : 'reviews' }}</strong></div>
        <span><i></i> Synced now</span>
      </header>

      @if (data.loading() && data.reviews().length === 0) {
        <cc-skeleton-list [count]="4" />
      } @else if (visibleReviews().length === 0) {
        <cc-empty-state
          icon="star-outline"
          [title]="data.reviews().length ? 'Nothing in this view' : 'Your review queue is quiet'"
          [message]="data.reviews().length ? 'Try another filter to continue moderating customer feedback.' : 'New ratings, written feedback, and customer photos will arrive here automatically.'"
        />
      } @else {
        <section class="review-list" aria-label="Review moderation queue">
          @for (review of visibleReviews(); track review.id) {
            <article class="review-card" [class.review-card--focused]="focusedReviewId() === review.id" [attr.id]="'review-' + review.id">
              <div class="review-card__body">
                <header class="reviewer-row">
                  <span class="reviewer-avatar">
                    <b>{{ reviewerInitials(review) }}</b>
                    @if (review.profiles?.avatar_url; as avatarUrl) {
                      <img [src]="avatarUrl" [alt]="reviewerName(review) + ' profile photo'" referrerpolicy="no-referrer" loading="lazy" decoding="async" (error)="hideAvatar($event)" />
                    }
                  </span>
                  <span class="reviewer-copy"><strong>{{ reviewerName(review) }}</strong><small>{{ formattedDate(review.created_at) }}</small></span>
                  <cc-status-pill [value]="review.approved ? 'published' : 'pending'" />
                </header>
                <div class="rating-line">
                  <span class="stars" [attr.aria-label]="review.rating + ' out of 5 stars'">
                    @for (star of starSlots; track star) { <ion-icon [name]="star < normalizedRating(review.rating) ? 'star' : 'star-outline'" /> }
                  </span>
                  <strong>{{ normalizedRating(review.rating) }}.0</strong>
                </div>
                <h2>{{ review.title.trim() || 'Customer feedback' }}</h2>
                <p class="review-copy">“{{ review.body.trim() || 'No written feedback provided.' }}”</p>
                <div class="product-chip"><ion-icon name="cube-outline" /><span>{{ review.products?.name || 'CozyCraft product' }}</span></div>
              </div>

              @if (review.image_urls.length > 0) {
                <div class="photo-preview">
                  @for (url of review.image_urls.slice(0, 2); track url; let index = $index) {
                    <button type="button" (click)="openGallery(review, index)" [attr.aria-label]="'Open customer photo ' + (index + 1) + ' from ' + reviewerName(review)">
                      <img ccImgFallback [src]="url" [alt]="(review.products?.name || 'Product') + ' customer review photo ' + (index + 1)" loading="lazy" decoding="async" />
                      <span><ion-icon name="expand-outline" /></span>
                      @if (index === 1 && review.image_urls.length > 2) { <b>+{{ review.image_urls.length - 2 }}</b> }
                    </button>
                  }
                  <div class="photo-preview__caption"><span><ion-icon name="images-outline" /> Customer photos</span><strong>{{ review.image_urls.length }}</strong></div>
                </div>
              }

              <footer class="review-actions">
                <span class="visibility-note"><ion-icon [name]="review.approved ? 'eye-outline' : 'eye-off-outline'" />{{ review.approved ? 'Visible in shop' : 'Hidden from shop' }}</span>
                @if (review.approved) {
                  <button type="button" class="secondary-action" [disabled]="isBusy(review.id)" (click)="moderate(review, false)">
                    @if (isBusy(review.id)) { <ion-spinner name="crescent" /> } @else { <ion-icon name="eye-off-outline" /> } Hide
                  </button>
                } @else {
                  <button type="button" class="primary-action" [disabled]="isBusy(review.id)" (click)="moderate(review, true)">
                    @if (isBusy(review.id)) { <ion-spinner name="crescent" /> } @else { <ion-icon name="checkmark-outline" /> } Publish
                  </button>
                }
              </footer>
            </article>
          }
        </section>
      }
    </main>

    <ion-modal class="photo-modal" [isOpen]="gallery() !== null" [backdropDismiss]="true" (ionModalDidDismiss)="closeGallery()">
      <ng-template>
        @if (galleryReview(); as review) {
          <section class="gallery-shell" role="dialog" aria-label="Customer review photo viewer">
            <header>
              <div class="gallery-reviewer">
                <span class="gallery-avatar"><b>{{ reviewerInitials(review) }}</b>@if (review.profiles?.avatar_url; as avatarUrl) { <img [src]="avatarUrl" alt="" referrerpolicy="no-referrer" (error)="hideAvatar($event)" /> }</span>
                <span><strong>{{ reviewerName(review) }}</strong><small>{{ review.products?.name || 'Product review' }} · {{ galleryNumber() }}/{{ review.image_urls.length }}</small></span>
              </div>
              <button type="button" (click)="closeGallery()" aria-label="Close photo viewer"><ion-icon name="close-outline" /></button>
            </header>
            <div class="gallery-stage">
              @if (galleryUrl(); as imageUrl) { <img ccImgFallback [src]="imageUrl" [alt]="(review.products?.name || 'Product') + ' review photo ' + galleryNumber()" /> }
              @if (review.image_urls.length > 1) {
                <button class="gallery-nav gallery-nav--previous" type="button" (click)="previousPhoto()" aria-label="Previous photo"><ion-icon name="chevron-back-outline" /></button>
                <button class="gallery-nav gallery-nav--next" type="button" (click)="nextPhoto()" aria-label="Next photo"><ion-icon name="chevron-forward-outline" /></button>
              }
            </div>
            <footer>
              <p>{{ review.body.trim() || 'No written feedback provided.' }}</p>
              @if (!review.approved) {
                <button type="button" [disabled]="isBusy(review.id)" (click)="approveFromGallery(review)">@if (isBusy(review.id)) { <ion-spinner name="crescent" /> } @else { <ion-icon name="checkmark-outline" /> } Publish review</button>
              }
            </footer>
          </section>
        }
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './reviews.page.scss',
})
export class ReviewsPage {
  protected readonly data = inject(AdminDataService);
  private readonly actions = inject(AdminActionsService);
  private readonly toast = inject(CozyToastService);
  private readonly native = inject(NativePlatformService);
  private readonly route = inject(ActivatedRoute);
  private lastFocusedReviewId = '';

  protected readonly starSlots = [0, 1, 2, 3, 4] as const;
  protected readonly filter = signal<ReviewFilter>('all');
  protected readonly gallery = signal<ReviewGallery | null>(null);
  private readonly busyIds = signal<ReadonlySet<string>>(new Set());
  protected readonly focusedReviewId = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('review'))), { initialValue: null });
  protected readonly pendingCount = computed(() => this.data.reviews().filter((review) => !review.approved).length);
  protected readonly publishedCount = computed(() => this.data.reviews().filter((review) => review.approved).length);
  protected readonly photoCount = computed(() => this.data.reviews().filter((review) => review.image_urls.length > 0).length);
  protected readonly avatarReviews = computed(() => this.data.reviews().filter((review) => Boolean(review.profiles?.avatar_url)));
  protected readonly averageRating = computed(() => {
    const reviews = this.data.reviews();
    return reviews.length ? reviews.reduce((sum, review) => sum + this.normalizedRating(review.rating), 0) / reviews.length : 0;
  });
  protected readonly visibleReviews = computed(() => {
    const filter = this.filter();
    return this.data.reviews().filter((review) => {
      if (filter === 'pending') return !review.approved;
      if (filter === 'published') return review.approved;
      if (filter === 'photos') return review.image_urls.length > 0;
      return true;
    });
  });
  protected readonly activeFilterLabel = computed(() => ({
    all: 'Complete queue',
    pending: 'Needs your decision',
    published: 'Live on storefront',
    photos: 'Customer photo reviews',
  })[this.filter()]);
  protected readonly galleryReview = computed(() => {
    const gallery = this.gallery();
    return gallery ? this.data.reviews().find((review) => review.id === gallery.reviewId) ?? null : null;
  });
  protected readonly galleryUrl = computed(() => {
    const gallery = this.gallery();
    const review = this.galleryReview();
    return gallery && review ? review.image_urls[gallery.index] ?? null : null;
  });
  protected readonly galleryNumber = computed(() => (this.gallery()?.index ?? 0) + 1);

  constructor() {
    void this.data.start().catch((error: unknown) => void this.toast.show(this.errorMessage(error), 'danger'));
    effect(() => {
      const reviewId = this.focusedReviewId();
      if (!reviewId || this.lastFocusedReviewId === reviewId
        || !this.data.reviews().some((review) => review.id === reviewId)) return;
      this.lastFocusedReviewId = reviewId;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.getElementById(`review-${reviewId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
    });
  }

  protected setFilter(filter: ReviewFilter) {
    if (this.filter() === filter) return;
    this.filter.set(filter);
    void this.native.tap();
  }

  protected reviewerName(review: Review) {
    return review.reviewer_display_name?.trim() || review.profiles?.full_name?.trim() || review.profiles?.email?.trim() || 'CozyCraft customer';
  }

  protected reviewerInitials(review: Review) {
    return this.reviewerName(review).split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
  }

  protected hideAvatar(event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (image) image.hidden = true;
  }

  protected normalizedRating(rating: number) {
    return Math.min(5, Math.max(0, Math.round(Number(rating) || 0)));
  }

  protected formattedDate(value: string) {
    return dateTime(value);
  }

  protected isBusy(id: string) {
    return this.busyIds().has(id);
  }

  protected async moderate(review: Review, approved: boolean): Promise<boolean> {
    if (this.isBusy(review.id)) return false;
    this.setBusy(review.id, true);
    try {
      const result = await this.actions.moderateReview(review.id, approved);
      if (result.error) {
        await this.toast.show(result.error, 'danger');
        return false;
      }
      await Promise.all([
        this.native.success(),
        this.toast.show(approved ? 'Review published to the product page.' : 'Review hidden from the customer storefront.', 'success'),
      ]);
      return true;
    } catch (error: unknown) {
      await this.toast.show(this.errorMessage(error), 'danger');
      return false;
    } finally {
      this.setBusy(review.id, false);
    }
  }

  protected openGallery(review: Review, index: number) {
    this.gallery.set({ reviewId: review.id, index });
    void this.native.tap();
  }

  protected closeGallery() {
    this.gallery.set(null);
  }

  protected previousPhoto() {
    const current = this.gallery();
    const review = this.galleryReview();
    if (!current || !review?.image_urls.length) return;
    this.gallery.set({ ...current, index: (current.index - 1 + review.image_urls.length) % review.image_urls.length });
    void this.native.tap();
  }

  protected nextPhoto() {
    const current = this.gallery();
    const review = this.galleryReview();
    if (!current || !review?.image_urls.length) return;
    this.gallery.set({ ...current, index: (current.index + 1) % review.image_urls.length });
    void this.native.tap();
  }

  protected async approveFromGallery(review: Review) {
    if (await this.moderate(review, true)) this.closeGallery();
  }

  private setBusy(id: string, busy: boolean) {
    const next = new Set(this.busyIds());
    if (busy) next.add(id);
    else next.delete(id);
    this.busyIds.set(next);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return 'The review queue could not be updated. Please try again.';
  }
}
