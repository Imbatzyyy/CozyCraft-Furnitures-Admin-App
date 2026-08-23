import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

@Component({
  selector: 'cc-empty-state',
  standalone: true,
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cc-empty" role="status">
      <span class="cc-empty__icon"><ion-icon [name]="icon()"></ion-icon></span>
      <h3>{{ title() }}</h3>
      <p>{{ message() }}</p>
      <ng-content></ng-content>
    </section>
  `,
  styles: [`
    .cc-empty { text-align: center; padding: 42px 22px; border: 1px dashed var(--cc-border); border-radius: 24px; background: color-mix(in srgb, var(--cc-surface) 80%, transparent); }
    .cc-empty__icon { display: grid; place-items: center; width: 50px; height: 50px; margin: 0 auto 16px; border-radius: 17px; background: var(--cc-muted); color: var(--cc-ink); font-size: 22px; }
    h3 { margin: 0; font: 600 23px/1.1 var(--cc-font-display); letter-spacing: -.025em; }
    p { max-width: 340px; margin: 10px auto 0; color: var(--cc-ink-soft); font-size: 13px; line-height: 1.6; }
    :host ::ng-deep button, :host ::ng-deep a { margin-top: 18px; }
  `],
})
export class EmptyStateComponent {
  readonly icon = input('leaf-outline');
  readonly title = input('Nothing here yet');
  readonly message = input('New records will appear here as soon as they arrive.');
}
