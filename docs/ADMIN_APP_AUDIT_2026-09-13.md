# Admin Mobile audit — 13 September 2026

## Scope and outcome

Source audit, website feature comparison, dependency checks, regression tests, synthetic browser testing, PDF inspection and native compile checks for the separate CozyCraft Admin Mobile repository. The customer/admin website was inspected read-only. Its working tree remained unchanged.

This is a local implementation and verification pass, **not a production certification or deployment**. Production refunds, order transitions, emails, invitations, account suspensions and notification sends were not executed. No private server credentials were copied into the app.

The app already had a feature-based Angular/Ionic structure, lazy-loaded pages, mobile safe-area rules, reduced-effect rendering, protected auth, and extensive administrative workflows. The changes retain that structure and focus on shorter lists, reliable data transitions and website capabilities missing from mobile.

## Implemented findings

| Area | Finding | Change |
| --- | --- | --- |
| Connectivity | An older failed connectivity probe could replace a successful reconnect/retry. | Retry cancels/supersedes the old probe; stale completions cannot set connectivity state. Background probes still share a request. |
| Realtime | Order, item, status-history and payment events could cause repeated full-order reads. | Debounced order IDs are refreshed in batches of at most 40. Parent deletion removes one retained order. Unidentified child deletion falls back to reconciliation instead of guessing its parent. |
| Refresh | Concurrent workspace refreshes duplicated reads; late snapshots could undo a newer detail response. | Shared in-flight refresh and per-order version checks. Logout invalidates subsequent pagination requests. |
| Mutation feedback | A successful write followed by a failed refresh could look like a failed write and encourage duplicate submission. | Reconciliation has a separate warning stating that the change was saved and should not be submitted again. |
| Staff support | Replying could unnecessarily reload an admin-only customer directory. | Replies refresh the relevant ticket collection only. |
| Native Edge requests | Some financial/team actions still used the browser-only function invocation path. | Cancellation, return refund, refund email and team management use the existing authenticated native-compatible transport. |
| Catalog | Editing a product could resend an old stock quantity after stock changed elsewhere. | Product edits omit stock; opening stock remains supported on creation. Inventory adjustments remain the stock-edit workflow. |
| Product editor | Reused routes, outstanding uploads and asynchronous cleanup could target a different draft or delete saved images. | Route/upload request guards, busy-navigation guard, stable creation ID, committed-upload ownership before cleanup, and failure-safe busy flags. |
| Mobile density | Growing lists required long scrolling and increasingly large rendered trees. | Shared accessible pagination: orders 6, products 8, inventory 8, categories 6, customers 8, inbox 8 and reviews 6 per page. Existing customer-history, loyalty and payment pagination is retained. |
| Order discovery | Website workflow/date/payment filters were missing. | Optional collapsed filters for fulfillment-ready, awaiting payment, cancellations, returns, refund attention, 48-hour backlog, PHT dates, payment state/method and sorting. Search includes exact IDs, product names and phone numbers. |
| Deep links | Customer/product/inventory detail state could retain an earlier route parameter. | Reactive parameter handling and inventory pagination targeting. New tool destinations are allowed; legacy return IDs are not mistaken for order IDs. |
| Customer administration | The website's protected profile edit/access controls were absent. | Compact customer management panel using the existing `manage-customer` function. Email, addresses and auth settings are not edited. Access changes require explicit confirmation. See backend caveat below. |
| System health | No mobile counterpart for the website's operational health view. | Role-protected System Health page, linked from More/search: synchronization, payment/refund issues, backlog, priority support, zero stock and recent UI errors. At most 30 error details are requested with an aggregate count. |
| Packing | The website's packing checklist was missing from mobile. | Order-specific packing-list PDF with delivery details, item/SKU/quantity checks and release-signature fields. Blocks cancelled orders and pending cancellation requests. One targeted order refresh; no extra billing or catalog download. |
| PDF export | Fixed-height cells truncated long customer/product details. Footer notes could compete with generation metadata. | Lossless wrapped cells with continuation pages, separate footer note line, and stale-order share guards. Report money and order-detail amounts retain cents. |
| CSV | Customer-provided strings could be interpreted as spreadsheet formulas. | Formula-like text is neutralized; numeric values and CSV quoting are preserved. |
| Reporting dates | Calendar boundaries depended on the device timezone. | Dashboard month buckets and report ranges use Philippine time. Customer reports group orders once rather than scanning all orders for each customer. |
| Loyalty | Late page requests could overwrite newer results; cached-page return could leave a spinner running. | Request sequencing, stable tie-breaking order and cached-page loading reset. Loyalty/merchandising service instances are page-scoped rather than retained across accounts. |
| Content | Unsaved newsletter drafts shared one local-storage key across administrators. | Drafts are keyed by the authenticated administrator. Legacy unscoped drafts are deliberately not imported into another account. |
| Forms | Thrown network/native errors could leave MFA, notification or connection-check controls busy indefinitely. | Error/finally cleanup and actionable retry messages. Delivery amounts reject non-finite numbers and fractional day ranges. |
| Icons | Receipt download/loading icons were referenced but not registered. | Both icons are bundled; a regression scans all static outline-icon references. |
| Dependencies | Production Angular packages were affected by published advisories. | Aligned Angular framework/compiler packages at 20.3.31. The current production dependency audit reports zero known advisories. |

The existing uncommitted delivered-receipt implementation and official logo were preserved. Its 14 tests were rerun; it is not presented as a newly discovered feature in this pass.

## Route coverage

Every row below received source inspection and synthetic rendering. Five authentication variants and 24 workspace/detail variants total **29 route variants**. A rendering pass is not proof of a successful production mutation.

| Route / screen | Checks and retained capability | Additional verification needed |
| --- | --- | --- |
| Login | Form validation, disconnected state, retry controls, safe return path | Real auth expiry and reconnect on device |
| MFA / enrollment | Protected flow, busy/failure cleanup, enrollment and verification screens | A real authenticator and recovery path |
| PIN setup / unlock | Six-digit input, secure native-storage boundary, account switching UI | Keychain/Keystore, biometrics, lockout and reinstall on phones |
| Overview | Operational totals, priority links, shared state, Philippine month buckets | Database totals versus website for the same instant |
| Orders | Six-row pages, search/page reset, workflow/status/payment/date filters | Concurrent live status/payment changes |
| Order details | Exact record navigation, timeline, item totals, cancellations/returns/COD, PDF actions | Approved staging orders for each transition/refund path |
| Catalog | Eight-row pages, search/status/category filters, product images | Large real catalogs and image failures |
| Product create/edit | Validation, immutable existing stock, asynchronous upload/save ownership | Real storage upload/delete and conflicting edits |
| Categories | Six-row pages, visibility, rename, ordering, full-category move logic | Transactional rename/reorder backend work described below |
| Inventory | Eight-row stock pages, low-stock filter, exact product deep link, quantity/reason adjustment | Concurrent stock transactions and native keyboard/safe-area test |
| Store Payments | Existing eight-row pages, settlement summary, PDF/CSV paths | Provider settlement reconciliation and signed release sharing |
| Customers | Eight-row pages, images, search, ordering and compact summaries | Real private avatar/address policy and expiring signed URLs |
| Customer profile | Reactive customer ID, saved address, paged order history, protected edit panel | Live edit/access-change function and ban-result caveat |
| Member tiers | Server-paged members, history/rewards pages, stale-response guard | Search completeness beyond the profile-ID cap |
| Merchandising / Experience | Delivery promises, synonyms, intent summaries, finite input validation | Truncated insight datasets and delivery-area creation gap |
| Content Studio | Content, banners, template/newsletter controls, owner-scoped drafts, native transport | Real provider/email/render/send path; no campaigns sent in audit |
| Reviews | Six-row pages, profile/customer photos, exact review destination and moderation | Live publish/hide with each authorized role |
| Inbox | Eight-row pages, attention scope, search and filtering | Real realtime arrivals/attachments |
| Conversation | Exact ticket route, reply/assignment/status handling | Approved staging ticket for uploads and reply concurrency |
| Reports | PHT periods, grouped customer metrics, cent precision, lossless PDF tables, safe CSV | Server-aggregated historical reporting and physical share destinations |
| Activity | Bounded server reads, scopes/channel/role/range controls, existing load-more | Large histories and live permission coverage |
| System Health | Automatic entry check, aggregate count plus 30 error details, drill-down links | Production signal parity; not an external uptime monitor |
| Notifications | Existing bounded loading, read/dismiss actions, role-safe destinations | Real mark-all RPC and foreground/background/terminated delivery |
| Team access | Role protection, confirmation controls, native Edge transport, local patches | Dedicated staging members; no invitations/role changes executed |
| Store Settings | Existing 12 sections, conflict-aware editing, recipient-read failure handling, native alerts | Staging save of each section and schema-version parity |
| More / global search / floating navigation | Tool availability, System Health links, exact routes, icon registry | Physical Android three-button/gesture and iPhone safe-area behavior |

## Verification evidence

- Standard `npm ci --no-audit --no-fund` succeeded with the aligned lockfile; Angular typecheck and production build passed.
- `npm run test:audit`: **29 checks passed**. Pure utilities and mocked services; no production requests/writes.
- `npm run test:receipts`: **14 checks passed**, including singular relations, invalid financial inputs, official logo reuse and 65-item/multi-page receipt cases.
- `npm run test:exports`: **6 checks passed**, including packing fields/guards, long report cells, an oversized unbroken cell, empty reports and stale export cancellation.
- PDF rendering inspected the packing list and continuation table. Text extraction found all **82 complete end markers across 14 pages** in the long-row fixture.
- Browser fixture rendered all **29 variants at 320, 360, 390, 430 and 768 CSS-pixel widths**, with no captured runtime exceptions or uncontained-overflow candidates. Automated geometry excludes intentionally scrollable/clipped ancestors, so it is a smoke check, not a complete pixel or accessibility audit.
- Browser interactions verified orders page 2 (7–12 of 51), exact search resetting the page, opening the exact order, customer edit fields at 320px (16px input text), a simulated profile save, and automatic System Health entry loading.
- Full-height phone fixtures at 390×844 and 320×710 also showed the inventory reason field and enabled save action unobstructed by navigation. Cancel closed the dialog, and inventory page 2 showed 9–16 of 51. No stock mutation was submitted. This does not simulate the physical iOS/Android keyboard.
- Both native projects synchronized. Xcode's unsigned iOS Simulator build passed. Android Debug compilation passed with JDK 21. An initial attempt with Android Studio's newer bundled Java failed with class version 69; using the installed Java 21 resolved the tooling incompatibility without changing app code.
- `npm audit --omit=dev`: **0 known production vulnerabilities**. This does not certify business logic, RLS policies, provider configuration or native plugin security.
- `git diff --check` passed. Test output is under ignored `tmp/`, and native/web build output remains ignored.
- A targeted source-file scan found no private-key, service-account JSON or common private-token pattern candidates. This is not an exhaustive secret scanner; environment and signing files remain ignored.

## Important remaining work

### 1. Startup egress and low-end performance: architectural priority

The app still downloads complete order/product/customer/ticket/review collections in paginated chunks for its shared workspace. **UI pagination bounds rendered rows; it does not make these initial database reads server-paged.** Event batching, coalescing, owner guards and fewer post-write reads reduce repeated traffic, but historical growth still increases startup bytes and memory.

The website includes optimized `admin_overview_snapshot`, `admin_order_queue` and customer-page read models. The next architecture change should adopt matching server summaries and on-demand pages together, with bounded caches and targeted detail reads. Do not silently cap orders while leaving local dashboard/report/search totals unchanged: that would produce incomplete financial and customer results. Test parity against the website before switching readers. Initial bundle transfer estimate remains roughly 334 kB (about 1.65 MB raw); this is not a measured low-end frame-rate guarantee.

### 2. Shared backend correctness: separate authorization required

Read-only inspection of `supabase/functions/manage-customer/index.ts` in the website found that `set-status` checks the profile update result but ignores the returned error from `auth.admin.updateUserById` when applying the auth ban. Thus a success response alone does not prove both operations succeeded. Profile editing can be verified independently; account suspension/reactivation needs a coordinated backend fix and a controlled auth test before relying on it operationally. The website/backend were not edited here.

Category rename/reorder still spans multiple writes rather than one transaction. Rollback reporting is now truthful, but atomicity needs a protected transactional backend operation. Existing customer-role/MFA/RLS checks must remain intact when doing this work.

### 3. Features whose completeness is still bounded

- Loyalty search first resolves at most 120 matching profile IDs. Broad matching terms can omit additional members even though the displayed member page is server-paged. Replace this with a protected joined search RPC, with matching count and stable cursor/page ordering.
- Merchandising reads currently cap delivery areas, synonyms and insight rows. Insights are recent samples, not full historical analytics. Mobile can edit existing delivery areas but does not create/delete them; implement the protected website-equivalent workflow after confirming supported schema/authorization rather than inventing client-side rules.
- Confirm every protected Edge function with a staging administrator at the required MFA level. Native transport does not automatically solve web-preview CORS: browser origins still need to be allowed by the shared backend.
- Reports still calculate primarily from the shared snapshot. Extremely large exports should move to server-selected ranges or background jobs instead of making the mobile device assemble all history.

### 4. iOS terminated-app notifications and physical devices

The checked-in iOS entitlements do not include `aps-environment`. The local/realtime notification path is not reliable after the OS suspends or terminates the app. A properly provisioned paid-team APNs build and provider credentials are required for that mode. Do not infer killed-app delivery from a successful permission prompt, token registration or simulator build.

Current project minimums are Android API 24 and iOS 15. Screen responsiveness is not a promise to support every older OS/device. Physical validation is still required on at least one lower-end Android (three-button navigation), one gesture-navigation Android, one small iPhone, and a larger iPhone. Cover keyboard open/close, background resume, interrupted connectivity, long-list scrolling, memory pressure, PDF save/share, safe-area overlap, push tap with warm/cold start, permissions denied and logout/account switching.

## Reproducing local checks

```sh
npm ci
npm run verify
npm run test:audit
npm run test:receipts
npm run test:exports
npm audit --omit=dev
npm run audit:ui
```

The UI fixture binds only to `127.0.0.1:8089`, uses synthetic data and blocks external fetch requests. Its mutations are simulations. It compiles the actual app pages/shell but substitutes auth/native/database services; it must never be used to claim authenticated production E2E coverage. Set both the browser viewport and fixture width when testing breakpoints. `npm run audit:ui` is development-only and not included in the mobile bundle.

For Android, select JDK 21 as the Gradle JVM. On this workstation it is installed at `/Users/imbatzy/Library/Java/JavaVirtualMachines/jbr-21.0.11/Contents/Home`. Use an unsigned simulator destination for iOS compile checks; use the user's proper development/release team for device installation.

## Release preparation update

Version 1.0.1 (native build 2) excludes the newly added customer suspension/reactivation controls until the shared backend correctly checks both profile and auth-ban updates. Profile editing remains available, with account status shown read-only. A release regression guards against accidentally restoring the unverified mutation. The original finding above is retained as audit history.

Publishing the source or a preview release does not resolve the physical-device, protected-production-workflow, startup-egress, or APNs limitations listed above.

## Release gate

Do not distribute a new production build based solely on this audit. Run the controlled role/mutation/device checks above, resolve shared-backend correctness issues for features being enabled, compare financial totals, then build and sign the release artifacts. This pass did not publish a release, push Git commits, change production database records, or modify the website.
