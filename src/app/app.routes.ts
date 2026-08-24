import { Routes } from '@angular/router';
import { adminGuard, appUnlockGuard, mfaGuard, pinSetupGuard, signedOutGuard } from './core/auth/admin.guard';
import { AdminShellComponent } from './shell/admin-shell.component';

export const appRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'app/dashboard' },
  {
    path: 'auth/login',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./features/authentication/login.page').then((module) => module.LoginPage),
  },
  {
    path: 'auth/mfa',
    canActivate: [mfaGuard],
    loadComponent: () => import('./features/authentication/mfa.page').then((module) => module.MfaPage),
  },
  {
    path: 'auth/mfa-enroll',
    canActivate: [mfaGuard],
    loadComponent: () => import('./features/authentication/mfa.page').then((module) => module.MfaPage),
  },
  {
    path: 'auth/pin-setup',
    canActivate: [pinSetupGuard],
    loadComponent: () => import('./features/authentication/pin.page').then((module) => module.PinPage),
  },
  {
    path: 'auth/unlock',
    canActivate: [appUnlockGuard],
    loadComponent: () => import('./features/authentication/pin.page').then((module) => module.PinPage),
  },
  {
    path: 'app',
    component: AdminShellComponent,
    canActivate: [adminGuard],
    canActivateChild: [adminGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', data: { preload: true, preloadDelay: 400 }, loadComponent: () => import('./features/dashboard/dashboard.page').then((module) => module.DashboardPage) },
      { path: 'orders', data: { preload: true, preloadDelay: 800 }, loadComponent: () => import('./features/orders/orders.page').then((module) => module.OrdersPage) },
      { path: 'orders/:id', loadComponent: () => import('./features/orders/order-detail.page').then((module) => module.OrderDetailPage) },
      { path: 'products', data: { preload: true, preloadDelay: 1_400 }, loadComponent: () => import('./features/catalog/products.page').then((module) => module.ProductsPage) },
      { path: 'products/new', loadComponent: () => import('./features/catalog/product-editor.page').then((module) => module.ProductEditorPage) },
      { path: 'products/:id', loadComponent: () => import('./features/catalog/product-editor.page').then((module) => module.ProductEditorPage) },
      { path: 'categories', loadComponent: () => import('./features/catalog/categories.page').then((module) => module.CategoriesPage) },
      { path: 'inventory', loadComponent: () => import('./features/catalog/inventory.page').then((module) => module.InventoryPage) },
      { path: 'payments', loadComponent: () => import('./features/reporting/payments.page').then((module) => module.PaymentsPage) },
      { path: 'customers', loadComponent: () => import('./features/customers/customers.page').then((module) => module.CustomersPage) },
      { path: 'customers/:id', loadComponent: () => import('./features/customers/customer-detail.page').then((module) => module.CustomerDetailPage) },
      { path: 'member-tiers', loadComponent: () => import('./features/loyalty/member-tiers.page').then((module) => module.MemberTiersPage) },
      { path: 'experience', loadComponent: () => import('./features/merchandising/merchandising.page').then((module) => module.MerchandisingPage) },
      { path: 'content', loadComponent: () => import('./features/content/content-studio.page').then((module) => module.ContentStudioPage) },
      { path: 'reviews', loadComponent: () => import('./features/reviews/reviews.page').then((module) => module.ReviewsPage) },
      { path: 'support', data: { preload: true, preloadDelay: 2_000 }, loadComponent: () => import('./features/support/support-inbox.page').then((module) => module.SupportInboxPage) },
      { path: 'support/:id', loadComponent: () => import('./features/support/support-detail.page').then((module) => module.SupportDetailPage) },
      { path: 'reports', loadComponent: () => import('./features/reporting/reports.page').then((module) => module.ReportsPage) },
      { path: 'activity', loadComponent: () => import('./features/reporting/activity.page').then((module) => module.ActivityPage) },
      { path: 'notifications', data: { preload: true, preloadDelay: 2_600 }, loadComponent: () => import('./features/notifications/notifications.page').then((module) => module.NotificationsPage) },
      { path: 'team', loadComponent: () => import('./features/team/team.page').then((module) => module.TeamPage) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings.page').then((module) => module.SettingsPage) },
      { path: 'more', data: { preload: true, preloadDelay: 3_200 }, loadComponent: () => import('./features/more/more.page').then((module) => module.MorePage) },
    ],
  },
  { path: '**', redirectTo: 'app/dashboard' },
];
