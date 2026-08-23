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

## iOS

```bash
npm run ios
```

The command builds and synchronizes the web application, prepares Xcode's build-service environment with the Xcode 26.6 compiler-probe workaround, and opens `ios/App/App.xcodeproj`. Quit any existing Xcode instance before running it. In Xcode, choose the `App` scheme and a destination, then select the development team for `com.cozycraft.admin`. Physical-device push notifications require a provisioning profile with the Push Notifications capability.

The workaround is intentionally narrow: it asks Apple Clang to remove the verbose `-v` argument that causes Xcode's `-E -dM /dev/null` compiler metadata probe to exceed the build service's output pipe and stall during pre-planning. The app continues to use Xcode's standard Apple Clang toolchain, SDKs, compiler arguments, linker, and signing flow.

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
