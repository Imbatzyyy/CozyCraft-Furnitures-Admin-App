import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

@Component({
  selector: 'cc-pagination',
  standalone: true,
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pages() > 1) {
      <nav [attr.aria-label]="label()">
        <p aria-live="polite">{{ start() }}–{{ end() }} <span>of {{ total() }}</span></p>
        <div>
          <button type="button" [disabled]="page() <= 1 || busy()" (click)="move(page() - 1)" aria-label="Previous page"><ion-icon name="chevron-back-outline" aria-hidden="true" /></button>
          <span aria-current="page">{{ page() }} / {{ pages() }}</span>
          <button type="button" [disabled]="page() >= pages() || busy()" (click)="move(page() + 1)" aria-label="Next page"><ion-icon name="chevron-forward-outline" aria-hidden="true" /></button>
        </div>
      </nav>
    }
  `,
  styles: `
    :host { display:block; }
    nav { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-top:14px; padding:12px 4px; border-top:1px solid var(--cc-border, #dedad2); }
    p { margin:0; font-size:12px; font-weight:700; } p span { color:var(--cc-muted, #77736b); font-weight:400; }
    div { display:flex; align-items:center; gap:12px; } div span { font-size:12px; min-width:48px; text-align:center; }
    button { display:grid; place-items:center; width:44px; height:44px; border:1px solid var(--cc-border, #dedad2); border-radius:14px; background:var(--cc-ink, #24221f); color:#fff; touch-action:manipulation; }
    button:disabled { background:transparent; color:#77736b; opacity:.45; } ion-icon { font-size:20px; }
    button:focus-visible { outline:3px solid #b49a7d; outline-offset:3px; }
  `,
})
export class PaginationComponent {
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  readonly page = input(1);
  readonly total = input(0);
  readonly pageSize = input(8);
  readonly busy = input(false);
  readonly label = input('Result pages');
  readonly pageChange = output<number>();
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly start = computed(() => (this.page() - 1) * this.pageSize() + 1);
  readonly end = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  move(page: number) {
    if (this.busy() || page < 1 || page > this.pages()) return;
    this.pageChange.emit(page);
    requestAnimationFrame(() => {
      const anchor = this.element.nativeElement.closest('main')?.querySelector<HTMLElement>('[data-page-list]');
      if (anchor) {
        anchor.tabIndex = -1;
        anchor.focus({ preventScroll: true });
        anchor.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    });
  }
}
