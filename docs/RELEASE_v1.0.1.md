# CozyCraft Admin 1.0.1 — mobile preview

Version 1.0.1, native build 2. This is a source pre-release for controlled testing, not an App Store or Google Play release. An installable APK is not included until it has been signed with the existing admin release key and its certificate verified.

## Included

- Compact, paginated orders, catalog, inventory, categories, customers, inbox and reviews.
- Additional order workflow/date/payment filters, exact detail navigation and System Health.
- Protected customer profile editing. Suspension/reactivation is intentionally not enabled pending the shared backend correction documented in the audit.
- Delivered-order PDF receipts using the official CozyCraft logo, plus order packing-list PDFs.
- Wrapped, multipage report exports and spreadsheet-safe CSV text; financial amounts retain cents and date boundaries use Philippine time.
- Reconnect race fixes, coalesced refreshes and targeted order-event reads. Startup still loads the shared historical snapshot; UI pagination does not eliminate those initial reads.
- Product edit/upload ownership guards, immutable stock during catalog edits, account-scoped drafts and safer post-write feedback.

## Release checks

- Clean dependency install, Angular typecheck and optimized production build passed.
- 50 regression checks passed: 30 app/data checks, 14 receipt checks and 6 export checks. Tests use synthetic data and do not mutate production records.
- Production dependency audit: zero known vulnerabilities at release preparation.
- Receipt, packing-list and report-continuation PDFs rendered and visually inspected.
- All 29 route variants passed the isolated browser layout sweep at 320, 360, 390, 430 and 768 CSS-pixel widths, with no captured runtime errors or uncontained-overflow candidates. Pagination, exact order search and detail navigation also passed at phone width. This is not authenticated production end-to-end testing or a physical keyboard test.
- Native web assets synchronized. Android release compilation and unsigned iOS Simulator compilation passed, both reporting version 1.0.1/build 2. All 1,462 packaged web assets checked against the production output matched in Android and the iOS sync; the Android Firebase configuration uses the admin package.

## Before distributing a signed build

1. Build the Android project from `android/` with JDK 21 and the existing release key. Keep signing passwords in Android Studio or an approved local secret store, never in Git, shell history or chat.
2. Verify `com.cozycraft.admin`, version name `1.0.1`, version code `2`, and the signing certificate before uploading the APK. Do not substitute a debug-signed APK; existing release installations need the original signing identity.
3. Test an upgrade from version 1.0 on a member's authorized test device. Do not uninstall the existing app as a workaround for a signature mismatch.
4. Validate login/MFA, exact order navigation, reconnect, keyboard/safe areas, PDF save/share and role permissions on physical Android and iPhone devices. Test protected mutations only against approved test accounts/orders.

The iOS project remains compatible with its existing signing setup. Reliable suspended/terminated-app push still requires paid-team APNs provisioning; an unsigned simulator build does not verify that mode. No TestFlight/App Store submission is part of this source release.

The customer/admin website and production database were not modified. See [the full audit](ADMIN_APP_AUDIT_2026-09-13.md) for remaining startup-egress, shared-backend and feature-completeness work.
