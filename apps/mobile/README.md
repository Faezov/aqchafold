# Ledgerase mobile

Minimal Expo TypeScript application in the pnpm workspace.

From the repository root:

```sh
pnpm install
pnpm --filter @aqchafold/mobile start
```

To launch on a connected Android device or a running emulator:

```sh
pnpm --filter @aqchafold/mobile android
```

This runs `expo start --android` using the existing Expo Go workflow. Use an
Expo Go version compatible with this app's Expo SDK 57. Alternatively, run
`start` and scan its QR code with Expo Go on an Android phone on the same network.

The app root opens the real local `ledgerase.db` and awaits the database package's
generated migrations before rendering the presentation-only Home screen.
It closes the initialization connection afterward. Initialization failures show
a fixed error message without logging database contents.

Home shows the Ledgerase title, local-first copy, and disabled Accounts,
Transactions, and Import statement controls marked “Not yet available.”

Android bundle validation without a device:

```sh
pnpm --filter @aqchafold/mobile exec expo export --platform android --output-dir /tmp/ledgerase-android
```

Export verifies bundling and Hermes compilation, not Android runtime execution.

Non-interactive checks:

```sh
pnpm --filter @aqchafold/mobile exec expo config --type public
pnpm --filter @aqchafold/mobile exec tsc --noEmit
```

The app is the presentation/platform layer; business logic belongs in `packages/`.
See the root `ARCHITECTURE.md` before adding implementation.

For the opt-in development persistence check:

```sh
pnpm --filter @aqchafold/mobile db:smoke
```

Open the session in a compatible Android/iOS Expo Go or development build. The
entry point runs the synthetic database check only with `__DEV__` and
`EXPO_PUBLIC_LEDGERASE_DATABASE_SMOKE=1`. It adds no UI and uses a disposable
database that is closed and deleted after the check. Look for
`[Ledgerase database smoke] PASS (android)` or `PASS (ios)` in the development
console; FAIL means checks or cleanup failed. See the
[database README](../../packages/database/README.md) for the scenario and migration
API. A successful bundle export alone does not verify native SQLite execution.

For the opt-in development CommBank detection check:

```sh
pnpm --filter @aqchafold/mobile commbank:smoke --android
```

The launcher reads only the committed synthetic `browser-summary-01.pdf` and
supplies its bytes to the development bundle. It also creates an unrelated PDF
by replacing the synthetic title without changing PDF offsets. The check runs
only with `__DEV__` and its smoke flag, and reports PDF text extraction plus
detection scores: fixture 1, unrelated 0, malformed 0, followed by
`[Ledgerase CommBank smoke] PASS (android)`. It adds no UI, persistence, native PDF
library, or financial-content logging. Dependency imports for this check are
development-only. Clear and reload the session when comparing dependency patches.
