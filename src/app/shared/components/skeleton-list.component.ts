import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'cc-skeleton-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="skeleton-list" aria-label="Loading records" role="status">
      @for (item of items(); track item) {
        <div class="skeleton-card">
          <span class="skeleton avatar"></span>
          <span class="lines"><span class="skeleton line wide"></span><span class="skeleton line"></span></span>
        </div>
      }
    </div>
  `,
  styles: [`
    .skeleton-list { display: grid; gap: 10px; }
    .skeleton-card { display: flex; align-items: center; gap: 13px; min-height: 78px; border: 1px solid var(--cc-border); border-radius: 18px; background: var(--cc-surface); padding: 13px; }
    .skeleton { display: block; overflow: hidden; position: relative; border-radius: 10px; background: var(--cc-muted); }
    .skeleton::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgb(255 255 255 / .68), transparent); animation: shimmer 1.35s infinite; }
    .avatar { width: 48px; height: 48px; border-radius: 14px; flex: 0 0 auto; }
    .lines { display: grid; flex: 1; gap: 9px; }
    .line { width: 57%; height: 10px; }
    .line.wide { width: 82%; height: 12px; }
    @keyframes shimmer { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skeleton::after { animation: none; } }
  `],
})
export class SkeletonListComponent {
  readonly count = input(5);
  readonly items = () => Array.from({ length: this.count() }, (_, index) => index);
}
