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

Create account opens a plain form within Accounts. An empty store requires an
explicit Household label first; an existing Household is shown and reused.
Account label, canonical type, three-uppercase-letter currency, and ownership
must all be supplied. Ownership choices are household-level and unknown; status
is created as active. Nothing is preselected or inferred from the phone or PDF.

`createLocalAccount()` validates canonical objects before writing and uses one
SQLite transaction, with repository savepoints, to create a new Household and
first Account together. A failure rolls back both. Existing Household setup
creates only the Account. Form UUIDs are retained across retries, repeated
submissions are guarded, and errors show fixed messages without logging values.
Accounts refreshes immediately after creation; returning Home reloads the real
import selector while preserving the selected PDF and requiring confirmation.

Transactions uses the same connection and reads `TransactionRepository.list()` once
per entry. Rows show posting date, unchanged raw description (or an explicit
absence), signed amount with currency, and Account ID. Ordering is posting date
descending, then ID ascending. Zero-value records remain visible. Loading, empty,
and sanitized error states follow Accounts; both Back controls return Home.

The presentation-local formatter supports AUD's two-decimal display using integer
digit strings, without floating-point monetary conversion. Other currencies show
exact signed minor units because currency-scale metadata is not implemented.

Home also opens a Merchant review screen using the same root screen
state and database connection. Each entry reads current Transactions, Accounts,
and Categories and rebuilds the queue; no review data is cached across entries.
Both Back controls return Home, preserving the selected statement and retained
import result.

The presentation helper `buildMerchantReviewQueues()` omits Transactions without a
raw description and empty `normalizeMerchantDescription()` results. Each
remaining Transaction gets Household context from its persisted Account, including
closed Accounts; missing Account context fails instead of assuming a Household.
Review queues retain internal `householdId` and `currency`, and equal descriptions
in different Households never merge. Household IDs sort by ordinary JS string
ordering before currency queues; this is presentation order, not a combined
monetary ranking. Duplicate Transaction IDs are rejected globally, including
across Households.

`MerchantRuleRepository.get(account.householdId, normalizedDescription)` supplies
an exact, Household-scoped confirmed identity to `resolveMerchantIdentity()`.
Confirmed groups are excluded before financial ranking and take priority over
historical suggestions. Existing Transaction `merchantId` associations supply
historical evidence only: those Transactions never contribute to review counts
or spending. Within each Household and exact, case-sensitive normalized
description, one distinct historical Merchant ID can suggest that Merchant.
Repeated agreeing associations remain one candidate. Zero IDs or two or more
distinct IDs produce `unknown`; conflicting evidence never chooses arbitrarily
and does not throw merely because IDs disagree. Evidence can span a Household's
currencies, while money is always ranked separately by currency. No fuzzy,
substring, location-removal, catalog, or alias-persistence behavior is added.

Each unique candidate is read through `MerchantRepository.getById()`. Missing,
mismatched, or invalid canonical records fail with a fixed load error rather than
becoming a suggestion. The Transaction repository also validates persisted
Merchant references on read. Suggested review groups carry readonly `status`,
internal `merchantId`, and canonical `displayName`; unknown groups carry no
candidate identity/name. All output layers are frozen. Source Transactions and
`rawDescription` remain unchanged.

The helper partitions unassociated observations by Household, reuses
`rankUnknownMerchantReviewQueues()` for identity-free financial ordering, then
attaches unconfirmed review state. The screen preserves spending/count/description
order within each Household/currency, showing derived descriptions, Transaction
counts, total outgoing value, and canonical names for actual suggestions. Credits
and zero contribute to counts but do not reduce outgoing value. AUD uses the
existing safe two-decimal formatter; other currencies show exact minor units
without assuming a scale or converting currencies. Household and Merchant IDs are
retained only in internal presentation state, never rendered. Loading, empty, and
fixed error states expose no raw source fields or database diagnostics.

On Android, suggested groups show `Suggested: <canonical display name>` and a
Confirm button; unknown groups have no Merchant confirmation action. iOS
confirmation remains deferred.
`createMerchantReviewController().confirm()` accepts a typed suggested item with
its internal Household context. It validates nonblank action fields, requires the
actual suggested group from the current queue, and rechecks the canonical Merchant
by ID. Display names never establish identity. Only an explicit confirmation calls
`MerchantRuleRepository.create({ householdId, normalizedDescription, merchantId })`.
No Merchant is created or edited, and no Transaction, raw description, or category
is changed.

A synchronous submission guard and current-item check prevent repeated writes,
including stale taps from another currency group. The group remains until the
write succeeds and the queue is rebuilt from SQLite. The confirmed exact key is
excluded in every currency of that Household, while other Households and unrelated
groups remain. Reentering the screen reads the persisted rule again. Identical
and conflicting existing keys are rejected without overwrite. Failed confirmation
shows fixed text without inspecting error strings and reloads SQLite source truth;
a failed reload shows the existing fixed load-error state. Suggestions themselves
are still derived afresh, rather than persisted as unconfirmed rules.

Category assignment is independent of Merchant confirmation. The pure
`addReviewCategoryState()` helper uses each group's exact `transactionIds` and the
same Transaction snapshot to report Uncategorized, a canonical Category name, or
Mixed categories (including categorized and uncategorized records together).
Archived current Categories remain readable by name. Neither Merchant identity
nor display text supplies a Category.

On Android, both unknown and suggested groups offer persisted active Categories
from `CategoryRepository.list()` in repository order. Category names are displayed;
IDs stay internal. Choosing an option does not write. Apply is disabled until an
option is selected, and an empty active list shows “No categories available”
without creating defaults. Category assignment controls on iOS remain deferred.

`createMerchantReviewController().applyCategory({ householdId, group, categoryId })`
requires the actual current review group and rechecks the selected persisted
Category by ID and active status. It calls
`TransactionRepository.assignCategory({ householdId, transactionIds: group.transactionIds, categoryId })`
to atomically change only those Transactions' `category_id`, with Household
membership guarded through their Accounts. Categories remain globally modeled in
v0.1. Other review groups, currencies, Households, and historical Merchant-evidence
Transactions excluded from the selected group are unaffected. MerchantRules and
all other Transaction fields remain unchanged.

Apply and Confirm share the submission guard. Neither updates the queue
optimistically; both reload SQLite after persistence or failure. Reloaded groups
invalidate old selections and stale taps. Assignment failures show fixed text,
and a failed reload shows the fixed load-error state. Confirm can remove a group
without assigning any Category. This explicit correction persists on existing
Transactions only; no future-category default or categorization rule is learned.
“Remember correction permanently” remains a separate task.

Home's Choose statement PDF control opens Android's system document picker using
`expo-document-picker`, installed with
`pnpm --filter @aqchafold/mobile exec expo install expo-document-picker --pnpm`.
It requests one `application/pdf` document with cache copying disabled and no
storage/media permission request. The mobile wrapper preserves the opaque URI
and returns only URI, optional filename, MIME type, and size. Selection alone
does not read document bytes, parse, import, or persist the document.

The app root retains this selection in memory during the current session, including
navigation to Accounts/Transactions and back. Another selection replaces it;
cancellation keeps any previous selection and shows no error. Picker failures
show a fixed message without logging document details. Repeated launches are
blocked while picking. Home shows only the filename, never the URI. Selection is
lost on app restart.

After selection, Home reads real Accounts and requires an explicit Account choice
and confirmation of its currency and two-decimal scope before Import statement is
enabled, even with one Account. `AccountRepository.getById()` revalidates the
persisted Account and its Household before conversion. Household context comes
only from that Account's `householdId`; source metadata never supplies identity
or ISO currency.

The mobile byte adapter reads `new File(uri).bytes()` using Expo FileSystem's
content-URI support. The same exact `Uint8Array` supplies importer-core SHA-256
fingerprinting and the production CommBank detection/parser. The production
converter requires verified reconciliation and the confirmed Account context.
Only after conversion does `ImportRepository.create()` record a processing
attempt; `complete()` atomically persists all Transactions and completes it.
Completion failures leave no partial batch and are marked failed where possible.
Only `DuplicateImportError` produces the already-imported message.

Each attempt receives a fresh Expo Crypto UUID. Transaction IDs combine that
Import ID with source page/row positions through the existing converter callback;
they are unrelated to financial values or filename. The original filename is
optional display metadata and does not affect fingerprint identity.

The coordinator returns explicit import outcomes; success reports the number of
newly persisted Transactions. Home shows a
plain result with that count, the Account label, and filename when available.
Duplicate, unsupported-format, and failure results have distinct fixed messages
without identifiers, financial source contents, or underlying diagnostics.

Only a successful result offers View transactions, using the existing Home
navigation. It opens the canonical all-transactions screen, which reads current
SQLite records on every entry. No rows are highlighted or associated with an
Import in persistence. Back returns to the retained result and reconciliation
summary; other outcomes retain the normal Home Transactions destination.

Reconciliation is summarized directly from `ParsedStatement.reconciliation` as
total row checks, verified row checks, and the explicit closing-check status.
Successful results show the verified row count and closing status separately from
the imported Transaction count. A parsed mismatch or unresolved check returns
`reconciliation-failed` before conversion or persistence; Home says reconciliation
could not be verified and no Transactions were imported. Other failures remain
generic, and duplicate/unsupported/generic failure results carry no reconciliation.

The app root keeps ready/importing/finished state separate from Account availability.
Finished results remain visible across Accounts/Transactions navigation during the
session. Successful document selection clears the prior result; picker cancellation
preserves it. A new import replaces it, while changing the selected Account alone
does not rewrite the prior result. Results are not persisted across app restarts.
Reconciliation fields are copied into the result snapshot with no source values,
positions, warnings, or diagnostics, and follow the same session lifecycle.

Concurrent imports and selection changes are blocked
while processing; navigation works when idle. Root cleanup cancels pending work
before closing the retained database, and the coordinator checks cancellation
before writing. Successful records are available on the existing Transactions
screen when entered.

A clean installation can now create its Household and Account through Accounts.
Until an Account exists, Home refuses import with “Create an account before
importing a statement.” It never creates a default Account or seeds the database.
The production mobile coordinator is tested with the tracked synthetic CommBank
PDF and real SQLite for 11 Transactions and exact-artifact duplicate refusal;
native end-to-end incorporation can now be verified in the separate import task.

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
library, or financial-content logging. The smoke check remains development-only;
the production import action uses the same real importer package. Clear and reload
the session when comparing dependency patches.
