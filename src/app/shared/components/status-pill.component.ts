import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'cc-status-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="cc-status" [attr.data-tone]="tone()"><span class="cc-status__dot"></span>{{ label() }}</span>`,
  styles: [`
    :host { display: inline-flex; max-width: 100%; }
    .cc-status {
      display: inline-flex;
      min-height: 25px;
      align-items: center;
      gap: 6px;
      border: 1px solid color-mix(in srgb, var(--cc-border) 80%, transparent);
      border-radius: 999px;
      background: var(--cc-muted);
      color: var(--cc-ink-soft);
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .055em;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .cc-status__dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
    .cc-status[data-tone="success"] { background: #e6eee2; color: #4f6949; border-color: #c8d7c2; }
    .cc-status[data-tone="warning"] { background: #f4ead9; color: #865f3d; border-color: #e8d2b2; }
    .cc-status[data-tone="danger"] { background: #f3e2dc; color: #914f3e; border-color: #e5c4b9; }
    .cc-status[data-tone="info"] { background: #e6ebea; color: #456664; border-color: #c8d6d4; }
    .cc-status[data-tone="dark"] { background: #292622; color: #f8f5ef; border-color: #292622; }
  `],
})
export class StatusPillComponent {
  readonly value = input.required<string>();
  readonly label = computed(() => this.value().replace(/[_-]+/g, ' '));
  readonly tone = computed(() => {
    const value = this.value().toLowerCase();
    if (['active', 'paid', 'delivered', 'published', 'approved', 'resolved', 'refunded', 'succeeded', 'live'].some((part) => value.includes(part))) return 'success';
    if (['pending', 'processing', 'packed', 'requested', 'low', 'in progress'].some((part) => value.includes(part))) return 'warning';
    if (['failed', 'cancelled', 'rejected', 'urgent', 'error', 'suspended', 'out of stock'].some((part) => value.includes(part))) return 'danger';
    if (['shipped', 'received', 'normal'].some((part) => value.includes(part))) return 'info';
    return 'neutral';
  });
}
