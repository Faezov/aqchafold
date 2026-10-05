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
