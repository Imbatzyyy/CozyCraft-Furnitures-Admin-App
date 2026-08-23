import { Directive, HostListener, input } from '@angular/core';

@Directive({ selector: 'img[ccImgFallback]', standalone: true })
export class ImgFallbackDirective {
  readonly fallback = input('assets/branding/cozycraft-logo.png');

  @HostListener('error', ['$event'])
  onError(event: Event) {
    const image = event.target as HTMLImageElement;
    if (image.dataset['fallbackApplied']) return;
    image.dataset['fallbackApplied'] = 'true';
    image.src = this.fallback();
    image.classList.add('cc-image-fallback');
  }
}
