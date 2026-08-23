import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertController,
  IonButton,
  IonIcon,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonToggle,
} from '@ionic/angular/standalone';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { AdminActionsService } from '../../core/data/admin-actions.service';
import { AdminDataService } from '../../core/data/admin-data.service';
import {
  AdminSecuritySettings,
  StoreSettings,
} from '../../core/models/admin.models';
import { NativePlatformService } from '../../core/native/native-platform.service';
import { CozyToastService } from '../../shared/components/toast.service';

type SettingsSection =
  | 'general'
  | 'branding'
  | 'checkout'
  | 'fulfillment'
  | 'inventory'
  | 'payments'
  | 'notifications'
  | 'reviews'
  | 'accounts'
  | 'security'
  | 'integrations'
  | 'reports';

interface SettingsSectionItem {
  id: SettingsSection;
  label: string;
  caption: string;
  icon: string;
}

interface PageNotice {
  message: string;
  tone: 'success' | 'warning' | 'danger';
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const httpsPattern = /^https:\/\//i;
const announcementLinkPattern = /^(\/|https:\/\/)/i;

@Component({
  selector: 'cc-store-settings-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonButton,
    IonIcon,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
    IonToggle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class StoreSettingsPage {
  private readonly destroyRef = inject(DestroyRef);
  storeSource: StoreSettings = this.data.settings();
  securitySource: AdminSecuritySettings = this.data.security();
  private savedSnapshot = '';
  private hydrating = false;
  private hydrated = false;

  readonly sections: readonly SettingsSectionItem[] = [
    { id: 'general', label: 'General', caption: 'Identity & contact', icon: 'storefront-outline' },
    { id: 'branding', label: 'Branding', caption: 'Banner & social', icon: 'color-palette-outline' },
    { id: 'checkout', label: 'Checkout', caption: 'Fees & limits', icon: 'bag-check-outline' },
    { id: 'fulfillment', label: 'Fulfillment', caption: 'Delivery workflow', icon: 'cube-outline' },
    { id: 'inventory', label: 'Inventory', caption: 'Availability rules', icon: 'layers-outline' },
    { id: 'payments', label: 'Payments', caption: 'Customer methods', icon: 'card-outline' },
    { id: 'notifications', label: 'Notifications', caption: 'Email & device', icon: 'notifications-outline' },
    { id: 'reviews', label: 'Reviews', caption: 'Trust controls', icon: 'star-outline' },
    { id: 'accounts', label: 'Accounts', caption: 'Customer access', icon: 'person-circle-outline' },
    { id: 'security', label: 'Security', caption: 'Admin protection', icon: 'shield-checkmark-outline' },
    { id: 'integrations', label: 'Integrations', caption: 'Service health', icon: 'git-network-outline' },
    { id: 'reports', label: 'Reports & privacy', caption: 'Briefings & retention', icon: 'analytics-outline' },
  ];

  readonly activeSection = signal<SettingsSection>('general');
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly checking = signal(false);
  readonly pushWorking = signal(false);
  readonly ready = signal(false);
  readonly remoteUpdateWaiting = signal(false);
  readonly notice = signal<PageNotice | null>(null);

  readonly activeSectionMeta = computed(() =>
    this.sections.find((item) => item.id === this.activeSection()) ?? this.sections[0],
  );
  readonly sectionPosition = computed(() =>
    this.sections.findIndex((item) => item.id === this.activeSection()) + 1,
  );
  readonly canEdit = computed(() => this.auth.role() === 'superadmin');
  readonly integrationEntries = signal<Array<{ key: string; label: string; available: boolean }>>([]);
  readonly pushStatusLabel = computed(() => {
    if (!this.native.native()) return 'Available in installed Android and iOS builds';
    return this.native.pushEnabled() ? 'Registered on this device' : 'Not registered on this device';
  });

  readonly form = new FormGroup({
    general: new FormGroup({
      store_name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(2), Validators.maxLength(100)],
      }),
      contact_email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email],
      }),
      support_phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
      business_address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
      store_description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1200)] }),
    }),
    branding: new FormGroup({
      announcement_enabled: new FormControl(false, { nonNullable: true }),
      maintenance_mode: new FormControl(false, { nonNullable: true }),
      announcement_text: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
      announcement_link: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
      facebook: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
      instagram: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
      tiktok: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    }),
    checkout: new FormGroup({
      standard_delivery_fee: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      free_delivery_minimum: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      minimum_order_amount: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      maximum_order_amount: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
    }),
    fulfillment: new FormGroup({
      delivery_area: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
      order_number_prefix: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^[A-Z0-9-]{1,10}$/)],
      }),
      estimated_delivery_days_min: new FormControl(1, { nonNullable: true, validators: [Validators.min(1)] }),
      estimated_delivery_days_max: new FormControl(1, { nonNullable: true, validators: [Validators.min(1)] }),
      cancellation_window_hours: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      return_window_days: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      stock_reservation_minutes: new FormControl(15, { nonNullable: true, validators: [Validators.min(1)] }),
    }),
    inventory: new FormGroup({
      low_stock_threshold: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      inventory_alerts: new FormControl(false, { nonNullable: true }),
      out_of_stock_behavior: new FormControl<'hide' | 'show_unavailable'>('show_unavailable', { nonNullable: true }),
      auto_archive_discontinued: new FormControl(false, { nonNullable: true }),
    }),
    payments: new FormGroup({
      cod_enabled: new FormControl(true, { nonNullable: true }),
      card_enabled: new FormControl(true, { nonNullable: true }),
      gcash_enabled: new FormControl(true, { nonNullable: true }),
      cod_maximum_order: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
    }),
    notifications: new FormGroup({
      account_confirmation: new FormControl(true, { nonNullable: true }),
      order_confirmation: new FormControl(true, { nonNullable: true }),
      payment_received: new FormControl(true, { nonNullable: true }),
      fulfillment_updates: new FormControl(true, { nonNullable: true }),
      delivered: new FormControl(true, { nonNullable: true }),
      cancelled_refunded: new FormControl(true, { nonNullable: true }),
      support_replies: new FormControl(true, { nonNullable: true }),
    }),
    reviews: new FormGroup({
      approval_required: new FormControl(false, { nonNullable: true }),
      verified_purchases_only: new FormControl(true, { nonNullable: true }),
      minimum_length: new FormControl(5, { nonNullable: true, validators: [Validators.min(5), Validators.max(5000)] }),
      maximum_length: new FormControl(2000, { nonNullable: true, validators: [Validators.min(5), Validators.max(5000)] }),
      photos_enabled: new FormControl(false, { nonNullable: true }),
    }),
    accounts: new FormGroup({
      username_required: new FormControl(true, { nonNullable: true }),
      google_auth_enabled: new FormControl(true, { nonNullable: true }),
      email_verification_required: new FormControl(true, { nonNullable: true }),
      password_minimum_length: new FormControl(8, {
        nonNullable: true,
        validators: [Validators.min(8), Validators.max(72)],
      }),
      customer_mfa_available: new FormControl(true, { nonNullable: true }),
    }),
    security: new FormGroup({
      require_admin_mfa: new FormControl(true, { nonNullable: true }),
      security_alerts_enabled: new FormControl(true, { nonNullable: true }),
      session_timeout_minutes: new FormControl(480, {
        nonNullable: true,
        validators: [Validators.min(15), Validators.max(1440)],
      }),
      maximum_failed_logins: new FormControl(5, {
        nonNullable: true,
        validators: [Validators.min(3), Validators.max(20)],
      }),
      lockout_minutes: new FormControl(15, {
        nonNullable: true,
        validators: [Validators.min(5), Validators.max(1440)],
      }),
      notification_email: new FormControl('', { nonNullable: true, validators: [Validators.email] }),
    }),
    reports: new FormGroup({
      weekly_report_enabled: new FormControl(false, { nonNullable: true }),
      frequency: new FormControl<'weekly' | 'monthly'>('weekly', { nonNullable: true }),
      default_range: new FormControl<'This week' | 'This month' | 'Quarter'>('This month', { nonNullable: true }),
      timezone: new FormControl('Asia/Manila', { nonNullable: true, validators: [Validators.required] }),
      recipients: new FormControl('', { nonNullable: true }),
      data_retention_days: new FormControl(90, {
        nonNullable: true,
        validators: [Validators.min(7), Validators.max(3650)],
      }),
    }),
  });

  constructor(
    readonly data: AdminDataService,
    readonly auth: AdminAuthService,
    readonly native: NativePlatformService,
    private readonly actions: AdminActionsService,
    private readonly alerts: AlertController,
    private readonly toast: CozyToastService,
  ) {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateDirtyState());

    effect(() => {
      const store = this.data.settings();
      const security = this.data.security();
      if (!this.hydrated || !this.dirty()) {
        this.hydrate(store, security);
      } else if (this.snapshot(store, security) !== this.savedSnapshot) {
        this.remoteUpdateWaiting.set(true);
      }
    });

    effect(() => {
      if (this.auth.role() === 'superadmin') this.form.enable({ emitEvent: false });
      else this.form.disable({ emitEvent: false });
    });
  }

  selectSection(section: SettingsSection) {
    this.activeSection.set(section);
    this.notice.set(null);
    void this.native.tap();
  }

  normalizeOrderPrefix() {
    const control = this.form.controls.fulfillment.controls.order_number_prefix;
    const normalized = control.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
    if (normalized !== control.value) control.setValue(normalized);
  }

  async reviewAndSave() {
    if (!this.canEdit() || !this.dirty() || this.saving()) return;
    const validationError = this.validationMessage();
    if (validationError) {
      this.notice.set({ message: validationError, tone: 'danger' });
      this.form.markAllAsTouched();
      await this.native.warning();
      return;
    }

    const alert = await this.alerts.create({
      header: 'Apply store configuration?',
      message: 'These controls take effect across the customer storefront and administrator workspace in realtime.',
      buttons: [
        { text: 'Keep editing', role: 'cancel' },
        { text: 'Apply changes', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;
    await this.save();
  }

  async discardChanges() {
    if (!this.dirty() || this.saving()) return;
    const alert = await this.alerts.create({
      header: 'Discard unsaved changes?',
      message: 'The latest settings synchronized from CozyCraft will replace every local edit on this page.',
      buttons: [
        { text: 'Continue editing', role: 'cancel' },
        { text: 'Discard changes', role: 'destructive' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'destructive') return;
    this.hydrate(this.data.settings(), this.data.security());
    this.notice.set({ message: 'Local changes discarded. The live database version is restored.', tone: 'success' });
    await this.native.tap();
  }

  async useLiveVersion() {
    if (!this.remoteUpdateWaiting()) return;
    if (this.dirty()) {
      await this.discardChanges();
      return;
    }
    this.hydrate(this.data.settings(), this.data.security());
  }

  async testConnection() {
    if (this.checking()) return;
    this.checking.set(true);
    this.notice.set(null);
    const result = await this.actions.testConnection();
    this.checking.set(false);
    if (result.error) {
      this.notice.set({ message: `Connection check failed: ${result.error}`, tone: 'danger' });
      await this.native.warning();
      return;
    }
    this.notice.set({
      message: 'Supabase data access is healthy. Realtime changes and protected Edge integrations remain server-managed.',
      tone: 'success',
    });
    await this.native.success();
  }

  async registerPush() {
    if (this.pushWorking()) return;
    this.pushWorking.set(true);
    const message = await this.native.registerPushNotifications();
    this.pushWorking.set(false);
    if (message) {
      this.notice.set({ message, tone: this.native.native() ? 'warning' : 'success' });
      await this.toast.show(message, this.native.native() ? 'neutral' : 'success');
      return;
    }
    const successMessage = 'Push registration requested. This device will receive live operational alerts once its native token is confirmed.';
    this.notice.set({ message: successMessage, tone: 'success' });
    await this.toast.show(successMessage, 'success');
    await this.native.success();
  }

  async unregisterPush() {
    if (this.pushWorking()) return;
    this.pushWorking.set(true);
    const message = await this.native.unregisterPushNotifications();
    this.pushWorking.set(false);
    this.notice.set({ message: message ?? 'Push alerts were removed from this device.', tone: message ? 'warning' : 'success' });
    await this.toast.show(message ?? 'Push alerts removed from this device.', message ? 'neutral' : 'success');
    await this.native.tap();
  }

  updatedLabel(value: string | null) {
    if (!value) return 'Not recorded';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Not recorded';
    return parsed.toLocaleString('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    });
  }

  private async save() {
    this.saving.set(true);
    this.notice.set(null);
    const store = this.composeStoreSettings();
    const security = this.composeSecuritySettings();
    const result = await this.actions.saveSettings(store, security);
    this.saving.set(false);
    if (result.error) {
      this.notice.set({ message: result.error, tone: 'danger' });
      await this.toast.show(result.error, 'danger');
      await this.native.warning();
      return;
    }

    this.hydrate(this.data.settings(), this.data.security());
    const successMessage = 'Settings applied across CozyCraft in realtime.';
    this.notice.set({ message: successMessage, tone: 'success' });
    await this.toast.show(successMessage, 'success');
    await this.native.success();
  }

  private hydrate(store: StoreSettings, security: AdminSecuritySettings) {
    this.hydrating = true;
    this.storeSource = this.cloneStore(store);
    this.securitySource = this.cloneSecurity(security);
    this.integrationEntries.set(Object.entries(security.integration_status)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, available]) => ({
        key,
        label: key
          .split('_')
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
        available,
      })));
    this.form.patchValue({
      general: {
        store_name: store.store_name,
        contact_email: store.contact_email,
        support_phone: store.support_phone,
        business_address: store.business_address,
        store_description: store.store_description,
      },
      branding: {
        announcement_enabled: store.announcement_enabled,
        maintenance_mode: store.maintenance_mode,
        announcement_text: store.announcement_text,
        announcement_link: store.announcement_link,
        facebook: store.social_links['facebook'] ?? '',
        instagram: store.social_links['instagram'] ?? '',
        tiktok: store.social_links['tiktok'] ?? '',
      },
      checkout: {
        standard_delivery_fee: store.checkout_settings.standard_delivery_fee,
        free_delivery_minimum: store.checkout_settings.free_delivery_minimum,
        minimum_order_amount: store.checkout_settings.minimum_order_amount,
        maximum_order_amount: store.checkout_settings.maximum_order_amount,
      },
      fulfillment: {
        delivery_area: store.delivery_area,
        order_number_prefix: store.fulfillment_settings.order_number_prefix,
        estimated_delivery_days_min: store.fulfillment_settings.estimated_delivery_days_min,
        estimated_delivery_days_max: store.fulfillment_settings.estimated_delivery_days_max,
        cancellation_window_hours: store.fulfillment_settings.cancellation_window_hours,
        return_window_days: store.fulfillment_settings.return_window_days,
        stock_reservation_minutes: store.fulfillment_settings.stock_reservation_minutes,
      },
      inventory: {
        low_stock_threshold: store.low_stock_threshold,
        inventory_alerts: store.inventory_alerts,
        out_of_stock_behavior: store.fulfillment_settings.out_of_stock_behavior,
        auto_archive_discontinued: store.fulfillment_settings.auto_archive_discontinued,
      },
      payments: {
        cod_enabled: store.checkout_settings.cod_enabled,
        card_enabled: store.checkout_settings.card_enabled,
        gcash_enabled: store.checkout_settings.gcash_enabled,
        cod_maximum_order: store.checkout_settings.cod_maximum_order,
      },
      notifications: { ...store.email_event_settings },
      reviews: { ...store.review_settings },
      accounts: { ...store.account_settings },
      security: {
        require_admin_mfa: security.require_admin_mfa,
        security_alerts_enabled: security.security_alerts_enabled,
        session_timeout_minutes: security.session_timeout_minutes,
        maximum_failed_logins: security.maximum_failed_logins,
        lockout_minutes: security.lockout_minutes,
        notification_email: security.notification_email,
      },
      reports: {
        weekly_report_enabled: store.weekly_report_enabled,
        frequency: store.report_settings.frequency,
        default_range: store.report_settings.default_range,
        timezone: store.report_settings.timezone,
        recipients: store.report_settings.recipients.join('\n'),
        data_retention_days: store.report_settings.data_retention_days,
      },
    }, { emitEvent: false });
    this.savedSnapshot = this.snapshot(store, security);
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.dirty.set(false);
    this.remoteUpdateWaiting.set(false);
    this.ready.set(true);
    this.hydrated = true;
    this.hydrating = false;
  }

  private updateDirtyState() {
    if (this.hydrating || !this.hydrated) return;
    this.dirty.set(
      this.snapshot(this.composeStoreSettings(), this.composeSecuritySettings()) !== this.savedSnapshot,
    );
  }

  private composeStoreSettings(): StoreSettings {
    const value = this.form.getRawValue();
    const recipients = this.parseRecipients(value.reports.recipients);
    return {
      ...this.storeSource,
      store_name: value.general.store_name.trim(),
      contact_email: value.general.contact_email.trim().toLowerCase(),
      support_phone: value.general.support_phone.trim(),
      business_address: value.general.business_address.trim(),
      store_description: value.general.store_description.trim(),
      delivery_area: value.fulfillment.delivery_area.trim(),
      low_stock_threshold: this.integer(value.inventory.low_stock_threshold),
      inventory_alerts: value.inventory.inventory_alerts,
      weekly_report_enabled: value.reports.weekly_report_enabled,
      social_links: {
        ...this.storeSource.social_links,
        facebook: value.branding.facebook.trim(),
        instagram: value.branding.instagram.trim(),
        tiktok: value.branding.tiktok.trim(),
      },
      announcement_enabled: value.branding.announcement_enabled,
      announcement_text: value.branding.announcement_text.trim(),
      announcement_link: value.branding.announcement_link.trim(),
      maintenance_mode: value.branding.maintenance_mode,
      checkout_settings: {
        standard_delivery_fee: this.amount(value.checkout.standard_delivery_fee),
        free_delivery_minimum: this.amount(value.checkout.free_delivery_minimum),
        minimum_order_amount: this.amount(value.checkout.minimum_order_amount),
        maximum_order_amount: this.amount(value.checkout.maximum_order_amount),
        cod_enabled: value.payments.cod_enabled,
        card_enabled: value.payments.card_enabled,
        gcash_enabled: value.payments.gcash_enabled,
        cod_maximum_order: this.amount(value.payments.cod_maximum_order),
      },
      fulfillment_settings: {
        estimated_delivery_days_min: this.integer(value.fulfillment.estimated_delivery_days_min),
        estimated_delivery_days_max: this.integer(value.fulfillment.estimated_delivery_days_max),
        cancellation_window_hours: this.integer(value.fulfillment.cancellation_window_hours),
        return_window_days: this.integer(value.fulfillment.return_window_days),
        order_number_prefix: value.fulfillment.order_number_prefix.trim().toUpperCase(),
        stock_reservation_minutes: this.integer(value.fulfillment.stock_reservation_minutes),
        out_of_stock_behavior: value.inventory.out_of_stock_behavior,
        auto_archive_discontinued: value.inventory.auto_archive_discontinued,
      },
      review_settings: {
        approval_required: value.reviews.approval_required,
        verified_purchases_only: value.reviews.verified_purchases_only,
        minimum_length: this.integer(value.reviews.minimum_length),
        maximum_length: this.integer(value.reviews.maximum_length),
        photos_enabled: value.reviews.photos_enabled,
      },
      account_settings: {
        username_required: value.accounts.username_required,
        google_auth_enabled: value.accounts.google_auth_enabled,
        email_verification_required: value.accounts.email_verification_required,
        password_minimum_length: this.integer(value.accounts.password_minimum_length),
        customer_mfa_available: value.accounts.customer_mfa_available,
      },
      email_event_settings: { ...value.notifications },
      report_settings: {
        timezone: value.reports.timezone.trim(),
        frequency: value.reports.frequency,
        default_range: value.reports.default_range,
        recipients,
        data_retention_days: this.integer(value.reports.data_retention_days),
      },
    };
  }

  private composeSecuritySettings(): AdminSecuritySettings {
    const value = this.form.controls.security.getRawValue();
    return {
      ...this.securitySource,
      require_admin_mfa: value.require_admin_mfa,
      session_timeout_minutes: this.integer(value.session_timeout_minutes),
      maximum_failed_logins: this.integer(value.maximum_failed_logins),
      lockout_minutes: this.integer(value.lockout_minutes),
      security_alerts_enabled: value.security_alerts_enabled,
      notification_email: value.notification_email.trim().toLowerCase(),
      integration_status: { ...this.securitySource.integration_status },
    };
  }

  private validationMessage(): string {
    const store = this.composeStoreSettings();
    const security = this.composeSecuritySettings();
    if (store.store_name.length < 2 || store.store_name.length > 100) {
      return 'Store name must contain 2 to 100 characters.';
    }
    if (!emailPattern.test(store.contact_email)) return 'Enter a valid customer contact email.';
    if (store.announcement_enabled && store.announcement_text.length < 3) {
      return 'Announcement text is required while the storefront banner is enabled.';
    }
    if (store.announcement_link && !announcementLinkPattern.test(store.announcement_link)) {
      return 'Announcement links must be an internal path or an HTTPS URL.';
    }
    if (Object.values(store.social_links).some((link) => link && !httpsPattern.test(link))) {
      return 'Every social link must use HTTPS.';
    }
    const checkout = store.checkout_settings;
    if ([checkout.standard_delivery_fee, checkout.free_delivery_minimum, checkout.minimum_order_amount,
      checkout.maximum_order_amount, checkout.cod_maximum_order].some((entry) => entry < 0)) {
      return 'Checkout fees and limits cannot be negative.';
    }
    if (checkout.maximum_order_amount > 0 && checkout.maximum_order_amount < checkout.minimum_order_amount) {
      return 'The maximum order must be greater than or equal to the minimum order, or set to zero for unlimited.';
    }
    if (!checkout.cod_enabled && !checkout.card_enabled && !checkout.gcash_enabled) {
      return 'Keep at least one customer payment method enabled.';
    }
    const fulfillment = store.fulfillment_settings;
    if (fulfillment.estimated_delivery_days_min < 1 ||
      fulfillment.estimated_delivery_days_min > fulfillment.estimated_delivery_days_max) {
      return 'Estimated delivery minimum cannot exceed the maximum.';
    }
    if (!/^[A-Z0-9-]{1,10}$/.test(fulfillment.order_number_prefix)) {
      return 'Order number prefix must use 1–10 uppercase letters, numbers, or hyphens.';
    }
    if (fulfillment.stock_reservation_minutes < 1) return 'Stock reservation must be at least one minute.';
    const reviews = store.review_settings;
    if (reviews.minimum_length < 5 || reviews.maximum_length > 5000 || reviews.minimum_length > reviews.maximum_length) {
      return 'Review length must stay between 5 and 5,000 characters, with the minimum below the maximum.';
    }
    if (store.account_settings.password_minimum_length < 8 || store.account_settings.password_minimum_length > 72) {
      return 'Customer password minimum must stay between 8 and 72 characters.';
    }
    if (security.session_timeout_minutes < 15 || security.session_timeout_minutes > 1440) {
      return 'Administrator session timeout must stay between 15 and 1,440 minutes.';
    }
    if (security.maximum_failed_logins < 3 || security.maximum_failed_logins > 20) {
      return 'Maximum failed logins must stay between 3 and 20 attempts.';
    }
    if (security.lockout_minutes < 5 || security.lockout_minutes > 1440) {
      return 'Account lockout must stay between 5 and 1,440 minutes.';
    }
    if (security.notification_email && !emailPattern.test(security.notification_email)) {
      return 'Enter a valid security notification email or leave it blank.';
    }
    if (store.report_settings.recipients.some((email) => !emailPattern.test(email))) {
      return 'Every scheduled-report recipient must be a valid email address.';
    }
    if (store.report_settings.data_retention_days < 7 || store.report_settings.data_retention_days > 3650) {
      return 'Operational data retention must stay between 7 and 3,650 days.';
    }
    try {
      new Intl.DateTimeFormat('en-PH', { timeZone: store.report_settings.timezone }).format();
    } catch {
      return 'Enter a valid IANA reporting timezone, such as Asia/Manila.';
    }
    return this.form.invalid ? 'Review the highlighted settings before applying changes.' : '';
  }

  private parseRecipients(value: string) {
    return [...new Set(value
      .split(/[\n,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean))];
  }

  private amount(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
  }

  private integer(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  private snapshot(store: StoreSettings, security: AdminSecuritySettings) {
    return JSON.stringify({ store, security });
  }

  private cloneStore(store: StoreSettings): StoreSettings {
    return {
      ...store,
      social_links: { ...store.social_links },
      checkout_settings: { ...store.checkout_settings },
      fulfillment_settings: { ...store.fulfillment_settings },
      review_settings: { ...store.review_settings },
      account_settings: { ...store.account_settings },
      email_event_settings: { ...store.email_event_settings },
      report_settings: {
        ...store.report_settings,
        recipients: [...store.report_settings.recipients],
      },
    };
  }

  private cloneSecurity(security: AdminSecuritySettings): AdminSecuritySettings {
    return {
      ...security,
      integration_status: { ...security.integration_status },
    };
  }
}

// Keep the route-facing name compact while retaining the explicit feature name for direct imports.
export { StoreSettingsPage as SettingsPage };
