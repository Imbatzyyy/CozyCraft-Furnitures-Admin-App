import { Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';

@Injectable({ providedIn: 'root' })
export class CozyToastService {
  constructor(private readonly controller: ToastController) {}

  async show(message: string, tone: 'success' | 'danger' | 'neutral' = 'neutral') {
    const toast = await this.controller.create({
      message,
      duration: tone === 'danger' ? 6500 : 3800,
      position: 'top',
      color: tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'dark',
      cssClass: 'cc-toast',
      buttons: [{ icon: 'close', role: 'cancel', htmlAttributes: { 'aria-label': 'Dismiss message' } }],
    });
    await toast.present();
  }
}
