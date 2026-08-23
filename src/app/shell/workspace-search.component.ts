import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonIcon, IonInput, IonToolbar, ModalController } from '@ionic/angular/standalone';
import { AdminDataService } from '../core/data/admin-data.service';
import { WorkspaceSearchResult } from '../core/models/admin.models';

@Component({
  selector: 'cc-workspace-search',
  standalone: true,
  imports: [IonContent, IonHeader, IonIcon, IonInput, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header class="search-header"><ion-toolbar>
      <div class="search-field"><ion-icon name="search-outline"></ion-icon><ion-input [autofocus]="true" placeholder="Order, product, customer, ticket…" (ionInput)="query.set($any($event).detail.value ?? '')"></ion-input><button type="button" (click)="dismiss()">Cancel</button></div>
    </ion-toolbar></ion-header>
    <ion-content class="search-content">
      <div class="search-body">
        @if (!query().trim()) {
          <p class="search-hint"><ion-icon name="sparkles-outline"></ion-icon> Search the live operations workspace</p>
          <div class="search-shortcuts">
            @for (shortcut of shortcuts; track shortcut.route) {
              <button type="button" (click)="open(shortcut)"><ion-icon [name]="shortcut.icon"></ion-icon><span>{{ shortcut.title }}</span><ion-icon name="chevron-forward-outline"></ion-icon></button>
            }
          </div>
        } @else if (!results().length) {
          <div class="search-empty"><ion-icon name="search-outline"></ion-icon><h3>No matching records</h3><p>Try an order number, customer email, product name, or ticket subject.</p></div>
        } @else {
          <p class="search-count">{{ results().length }} best matches</p>
          <div class="search-results">
            @for (result of results(); track result.id) {
              <button type="button" (click)="open(result)"><span class="search-result__icon"><ion-icon [name]="result.icon"></ion-icon></span><span><b>{{ result.title }}</b><small>{{ result.detail }}</small></span><ion-icon name="arrow-forward-outline"></ion-icon></button>
            }
          </div>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    .search-header ion-toolbar { --background: var(--cc-surface); --border-color: var(--cc-border); padding: 7px 9px; }
    .search-field { display: grid; grid-template-columns: 25px 1fr auto; align-items: center; gap: 7px; min-height: 48px; border: 1px solid var(--cc-border); border-radius: 15px; background: var(--cc-canvas); padding: 0 8px 0 13px; }
    .search-field > ion-icon { color: var(--cc-ink-soft); font-size: 18px; }
    .search-field ion-input { --padding-start: 0; --padding-end: 0; font-size: 16px; }
    .search-field button { min-height: 38px; border: 0; background: transparent; color: var(--cc-ink-soft); font-size: 12px; font-weight: 750; }
    .search-content { --background: var(--cc-canvas); }
    .search-body { padding: 18px 14px calc(26px + env(safe-area-inset-bottom)); }
    .search-hint, .search-count { display: flex; align-items: center; gap: 8px; margin: 0 3px 14px; color: var(--cc-ink-soft); font-size: 12px; font-weight: 700; letter-spacing: .04em; }
    .search-shortcuts, .search-results { display: grid; gap: 8px; }
    .search-shortcuts button, .search-results button { display: grid; width: 100%; min-height: 58px; align-items: center; border: 1px solid var(--cc-border); border-radius: 17px; background: var(--cc-surface); padding: 10px 13px; color: var(--cc-ink); text-align: left; }
    .search-shortcuts button { grid-template-columns: 34px 1fr 20px; gap: 9px; font-size: 13px; font-weight: 750; }
    .search-shortcuts button > ion-icon:first-child { font-size: 19px; }
    .search-shortcuts button > ion-icon:last-child, .search-results button > ion-icon { color: var(--cc-ink-soft); font-size: 15px; }
    .search-results button { grid-template-columns: 42px 1fr 20px; gap: 11px; }
    .search-result__icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 13px; background: var(--cc-muted); font-size: 18px; }
    .search-results button > span:nth-child(2) { display: grid; gap: 5px; min-width: 0; }
    .search-results b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .search-results small { overflow: hidden; color: var(--cc-ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .search-empty { padding: 55px 25px; text-align: center; }
    .search-empty > ion-icon { display: block; margin: auto; color: var(--cc-accent-deep); font-size: 35px; }
    .search-empty h3 { margin: 16px 0 0; font: 600 25px/1.1 var(--cc-font-display); }
    .search-empty p { margin: 9px auto 0; max-width: 280px; color: var(--cc-ink-soft); font-size: 12px; line-height: 1.6; }
  `],
})
export class WorkspaceSearchComponent {
  readonly query = signal('');
  readonly shortcuts: WorkspaceSearchResult[] = [
    { id: 'orders', title: 'Orders', detail: 'Live fulfillment', route: '/app/orders', icon: 'receipt-outline', keywords: '' },
    { id: 'products', title: 'Products', detail: 'Catalog', route: '/app/products', icon: 'cube-outline', keywords: '' },
    { id: 'support', title: 'Support', detail: 'Customer care', route: '/app/support', icon: 'chatbubble-outline', keywords: '' },
    { id: 'inventory', title: 'Inventory', detail: 'Stock control', route: '/app/inventory', icon: 'file-tray-stacked-outline', keywords: '' },
  ];
  readonly results = computed(() => {
    const terms = this.query().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return this.data.searchIndex()
      .filter((item) => {
        const source = `${item.title} ${item.detail} ${item.keywords}`.toLocaleLowerCase();
        return terms.every((term) => source.includes(term));
      })
      .slice(0, 16);
  });

  constructor(
    readonly data: AdminDataService,
    private readonly modal: ModalController,
    private readonly router: Router,
  ) {}

  dismiss() { void this.modal.dismiss(); }
  async open(result: WorkspaceSearchResult) {
    await this.modal.dismiss();
    await this.router.navigateByUrl(result.route);
  }
}
