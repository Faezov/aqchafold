# Ledgerase mobile

Minimal Expo TypeScript application in the pnpm workspace.

From the repository root:

```sh
pnpm install
pnpm --filter @aqchafold/mobile start
```

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
