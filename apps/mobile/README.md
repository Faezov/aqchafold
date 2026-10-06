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
It retains one connection for the app's lifetime and closes it on root cleanup.
Failed or cancelled initialization closes its connection after migrations settle.
Initialization failures show a fixed error message without logging database contents.

Home opens Accounts through simple app-level state. Accounts reads real canonical
records using `AccountRepository.list()` whenever entered, with loading, empty,
and sanitized error states. It shows label, type, status, primary currency, and
ownership kind; no balances are inferred. The Back control and Android Back return
Home.

Transactions uses the same connection and reads `TransactionRepository.list()` once
per entry. Rows show posting date, unchanged raw description (or an explicit
absence), signed amount with currency, and Account ID. Ordering is posting date
descending, then ID ascending. Zero-value records remain visible. Loading, empty,
and sanitized error states follow Accounts; both Back controls return Home.

The presentation-local formatter supports AUD's two-decimal display using integer
digit strings, without floating-point monetary conversion. Other currencies show
exact signed minor units because currency-scale metadata is not implemented.

Home's Import statement control opens Android's system document picker using
`expo-document-picker`, installed with
`pnpm --filter @aqchafold/mobile exec expo install expo-document-picker --pnpm`.
It requests one `application/pdf` document with cache copying disabled and no
storage/media permission request. The mobile wrapper preserves the opaque URI
and returns only URI, optional filename, MIME type, and size; it does not read
document bytes, parse, import, or persist the document.

The app root retains this selection in memory during the current session, including
navigation to Accounts/Transactions and back. Another selection replaces it;
cancellation keeps any previous selection and shows no error. Picker failures
show a fixed message without logging document details. Repeated launches are
blocked while picking. Home shows the filename and explicitly says the document
has not been imported yet. Selection is lost on app restart.

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
