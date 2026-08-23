# CozyCraft Admin Mobile

Mobile operations application for CozyCraft Furnitures, built with Angular, Ionic, Capacitor, and Supabase. The same application source is packaged for Android and iOS.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Android Studio with JDK 21 for Android development
- Xcode with an Apple development team for iOS device builds

## Setup

```bash
cp .env.example .env.local
npm ci
npm start
```

Configure the browser-safe project values in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-browser-safe-publishable-key
```

The prebuild script generates `src/environments/environment.generated.ts`. Local environment files and the generated module are ignored by Git. Never add a Supabase service-role key, payment secret, Firebase service-account JSON, or APNs private key to the application bundle.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Angular development server |
| `npm run typecheck` | Run Angular and TypeScript checks |
| `npm run build:production` | Create an optimized web build |
| `npm run verify` | Type-check and create a production build |
| `npm run cap:sync` | Build and synchronize Android/iOS projects |
| `npm run android` | Synchronize and open the Android project |
| `npm run ios` | Synchronize and open the iOS project |
| `npm run clean` | Remove generated web and native build output |

## Project structure

```text
cozycraft-admin-mobile/
├── android/              Capacitor Android project
├── docs/                 Engineering documentation
├── ios/                  Capacitor iOS project
├── resources/            Source artwork for native assets
├── scripts/              Build and environment utilities
├── src/
│   ├── app/
│   │   ├── core/         Auth, data access, models, native services, utilities
│   │   ├── features/     Route-level business capabilities
│   │   ├── shared/       Reusable UI components and directives
│   │   └── shell/        Authenticated mobile shell and global search
│   ├── assets/           Fonts and application branding
│   ├── environments/     Generated browser-safe runtime configuration
│   └── theme/            Global Ionic design tokens
├── capacitor.config.ts   Native container configuration
└── package.json          Tooling, scripts, and dependencies
```

Feature folders map directly to the mobile workspaces: authentication, dashboard, orders, catalog, customers, reviews, support, notifications, reporting, team, settings, and secondary navigation. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for dependency rules and data-flow guidance.

## Android

```bash
npm run cap:sync
cd android
./gradlew assembleDebug
```

Open `android/` in Android Studio as the Gradle project. Select JDK 21 as the Gradle JVM. The debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

Firebase push delivery requires the matching `android/app/google-services.json`; keep that project-specific file outside version control.

The app creates the `cozycraft_operations` notification channel and registers the resulting FCM token only after Android grants notification permission. Registration is not reported as successful until the authenticated `register_mobile_push_token` RPC confirms the token was stored.

## iOS

```bash
npm run ios
```

The command builds and synchronizes the web application, prepares Xcode's build-service environment with the Xcode 26.6 compiler-probe workaround, and opens `ios/App/App.xcodeproj`. Quit any existing Xcode instance before running it. In Xcode, choose the `App` scheme and a destination, then select the development team for `com.cozycraft.admin`.

The checked-in project intentionally leaves the iOS Push Notifications capability disabled so it can still be signed and launched by an Apple Personal Team. In this mode, the app uses the same local-notification bridge as CozyCraft Customer: alerts arriving through the existing authenticated Supabase Realtime channel are presented by iOS without adding another polling request. This path works while the application process remains active, including its normal foreground and brief background lifetime.

For reliable delivery after iOS fully suspends or terminates the application, select a paid Apple Developer Program team, open **Signing & Capabilities**, add **Push Notifications**, and rebuild on the physical device. Xcode will add the required `aps-environment` entitlement, the generated environment will automatically select APNs registration, and the server dispatcher must be configured for the `com.cozycraft.admin` topic. Debug device tokens use the APNs sandbox; release/TestFlight tokens use production APNs.

The workaround is intentionally narrow: it asks Apple Clang to remove the verbose `-v` argument that causes Xcode's `-E -dM /dev/null` compiler metadata probe to exceed the build service's output pipe and stall during pre-planning. The app continues to use Xcode's standard Apple Clang toolchain, SDKs, compiler arguments, linker, and signing flow.

## Native alert delivery

The installed app performs the complete client registration sequence: permission check, operating-system token registration, authenticated token persistence, foreground presentation, deep-link handling, removal, and startup verification. Provider credentials remain outside the application bundle.

The server-side `dispatch-admin-push` Edge Function requires these Supabase secrets:

- `FIREBASE_SERVICE_ACCOUNT_JSON` for Android FCM delivery
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_BUNDLE_ID=com.cozycraft.admin` for iOS APNs delivery
- `APNS_PRODUCTION=false` while testing a Debug build from Xcode, and `APNS_PRODUCTION=true` for release/TestFlight tokens
- `ADMIN_PUSH_WEBHOOK_SECRET` for authenticated notification webhooks

Do not place private server credentials in `.env.local`, `google-services.json`, the Angular bundle, or the Git repository.

## Development conventions

- Keep route-level behavior in its feature directory.
- Put application-wide state, authorization, data access, or native integrations in `core`.
- Keep `shared` components presentational and free of direct database access.
- Lazy load route pages from `app.routes.ts`.
- Reuse the shared operational snapshot instead of adding per-page full-table requests.
- Enforce authorization in Supabase policies/RPCs; route visibility is not a security boundary.
- Run `npm run verify` and `npm run cap:sync` before a native release build.

## Generated files

The following directories are build output or workstation state and are not source code: `.angular/`, `www/`, `out-tsc/`, `build/`, Android Gradle/build caches, iOS build products, and IDE metadata. Run `npm run clean` when a fresh local build is needed. Dependencies under `node_modules/` are restored with `npm ci`.
