# Application architecture

CozyCraft Admin Mobile uses a feature-first Angular architecture inside Capacitor native shells. The structure is intentionally shallow: developers can locate a page from its product name without traversing framework-specific layers.

## Source map

```text
src/app/
├── core/                 Application-wide services and domain contracts
│   ├── auth/             Session, authorization, MFA, PIN, and app lock
│   ├── data/             Supabase reads, realtime state, and admin mutations
│   ├── models/           Shared domain types and normalized defaults
│   ├── native/           Capacitor and device integrations
│   └── utils/            Permission and formatting utilities
├── features/             Route-level business capabilities
│   ├── authentication/   Sign-in, MFA, PIN setup, and unlock
│   ├── catalog/          Products, categories, and inventory
│   ├── content/          Pages, homepage banners, email, and newsletters
│   ├── customers/        Customer directory and account detail
│   ├── dashboard/        Operations overview
│   ├── loyalty/          Member tiers, points, and redemption history
│   ├── merchandising/    Delivery areas and customer search intent
│   ├── notifications/    Administrator notification inbox
│   ├── orders/           Fulfillment queue and order detail
│   ├── reporting/        Payments, reports, exports, and activity
│   ├── reviews/          Review moderation
│   ├── support/          Support inbox and conversation detail
│   ├── team/             Staff administration
│   ├── settings/         Store and security configuration
│   └── more/             Secondary mobile navigation
├── shared/               Reusable presentational components and directives
├── shell/                Authenticated application shell and global search
├── app.config.ts         Angular and Ionic providers
└── app.routes.ts         Route ownership and lazy-loading boundaries
```

## Dependency rules

1. Feature code may depend on `core` and `shared`.
2. `core` must not import route-level feature code.
3. Shared components remain presentational and do not access Supabase directly.
4. Cross-feature navigation goes through routes; business state remains in core services.
5. Pages are lazy loaded from `app.routes.ts` so secondary workspaces do not increase startup cost.
6. Privileged writes use server-enforced policies or RPCs. UI permissions are a presentation layer, not an authorization boundary.

## Data lifecycle

`AdminDataService` owns the in-memory operational snapshot. It performs bounded initial reads, subscribes to relevant realtime changes, and reconciles state on resume or reconnect. Feature pages consume that shared state instead of independently refetching full tables. Large secondary workspaces use page-scoped services with explicit limits, pagination, short-lived caches, and detail-on-demand reads. Mutations are centralized in `AdminActionsService` or a domain action service, which keeps audit, error, and refresh behavior consistent.

## Native boundary

The Angular application contains product behavior. The `android/` and `ios/` directories contain Capacitor wrappers, signing configuration, platform assets, and native capabilities. Run `npm run cap:sync` after every production web build or plugin/configuration change.

## Adding a feature

Create one directory under `features/`, keep its route page and feature-only styles together, and add a lazy route in `app.routes.ts`. Promote code to `shared` only after it is reused by multiple features; promote business or platform behavior to `core` only when it is application-wide.
