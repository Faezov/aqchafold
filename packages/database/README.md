# Ledgerase database runtime

Local persistence runtime for the Expo application. This package owns
`expo-sqlite` and `drizzle-orm`. SQLite declares its Expo, React, and React Native
host peers; mobile depends on this workspace package so Expo autolinking can
discover SQLite transitively.

```ts
import {
  migrateLedgeraseDatabase,
  openLedgeraseDatabase,
} from "@aqchafold/database";

const database = openLedgeraseDatabase();
await migrateLedgeraseDatabase(database);
// When the caller is finished using this connection:
database.$client.closeSync();
```

`openLedgeraseDatabase(databaseName?)` uses Expo's `openDatabaseSync`, then wraps
the connection with `drizzle-orm/expo-sqlite`. The default filename is
`ledgerase.db`; Expo manages its normal local directory. The returned Drizzle
handle exposes the underlying SQLite connection through its typed `$client`.
Opening enables SQLite foreign keys and supplies the canonical schema to Drizzle.
Importing this package does not open a database, and there is no global singleton.

`migrateLedgeraseDatabase(database): Promise<void>` explicitly applies pending
migrations from the existing generated `drizzle/migrations.js` bundle using
Drizzle's Expo SQLite migrator. Await it before using repositories. Reapplying
migrations uses Drizzle's migration journal; migration failures propagate to the
caller. The mobile Babel/Metro configuration bundles generated SQL as strings.

## Initial schema

`src/schema.ts` is the schema source. It includes all seven implemented entities:
Household, Member, Account, Merchant, Category, Import, and Transaction. String
primary keys are supplied explicitly; names are not unique. Optional domain
fields map to SQL NULL, without invented defaults or timestamps.

Accounts store the explicit `individual`, `shared`, `household-level`, or `unknown`
ownership kind. `account_members` stores Member references relationally, with a
composite key preventing duplicates. `member_order` preserves the shared domain
array's supplied order; it does not imply rank, attribution, or ownership shares.

Transaction Money uses signed INTEGER minor units within JavaScript's safe-integer
range and a required currency. SQL checks reject fractional storage and malformed
currency shapes. Currency validation matches the implemented domain's three
uppercase ASCII letters; an ISO/support registry remains deferred. Posting date
and optional transaction date are separate date-only text columns. Merchant and
Category references are independently nullable. Imported Transactions require
non-NULL raw descriptions, including legitimate empty source text.

Import fingerprint method/value and parser ID/version are nullable pairs, each
either complete or absent. Repeat attempts retain independent Import IDs.
The forward `0001_completed_artifact.sql` migration adds a partial unique index
on `(household_id, fingerprint_method, fingerprint_value)` for completed Imports.
Pending, processing, and failed attempts remain nonunique. Processing status does
not imply financial verification; the repository's completion operation commits
its supplied canonical batch atomically with the completed status.

Foreign keys cover Member/Account/Import to Household, Import's optional confirmed
Account, Transaction's Account and optional Merchant/Category, and ownership
Member rows. No cascading deletes erase history. Merchant and Category currently
have no Household field in the implemented domain; none is invented here.
Category definitions remain globally modeled within the local database in v0.1.
Category reads have no Household scope; assignment guards Transaction membership
through each Account's Household independently.

`merchant_rules` stores local, durable, user-confirmed Household-scoped exact
mappings after textual normalization:
`household_id` + `normalized_description` → `merchant_id`.
The composite primary key enforces uniqueness within each Household; all three
columns are required, with foreign keys to existing Households and Merchants.
No separate rule ID is needed for the current exact-key operations. The forward
`0002_merchant_rules.sql` migration adds only this table.

## Repositories

`HouseholdRepository`, `MemberRepository`, `AccountRepository`,
`TransactionRepository`, `CategoryRepository`, `MerchantRepository`,
`MerchantRuleRepository`, and `ImportRepository` take an already-open Drizzle handle.
They do not open connections or apply migrations; tables must exist before use.
Their synchronous APIs are:

```ts
new HouseholdRepository(database).create(household); // void
new HouseholdRepository(database).get(); // Household | undefined
new MemberRepository(database).create(member); // void
new MemberRepository(database).getById(id); // Member | undefined
new AccountRepository(database).create(account); // void
new AccountRepository(database).getById(id); // Account | undefined
new AccountRepository(database).list(); // readonly Account[]; label then ID order
new TransactionRepository(database).create(transaction); // void
new TransactionRepository(database).createMany(transactions); // void
new TransactionRepository(database).getById(id); // Transaction | undefined
new TransactionRepository(database).list(); // readonly Transaction[]
new TransactionRepository(database).assignCategory({ householdId, transactionIds, categoryId }); // void; atomic
new CategoryRepository(database).getById(id); // Category | undefined
new CategoryRepository(database).list(); // readonly Category[]; name then ID order
new MerchantRepository(database).create(merchant); // void
new MerchantRepository(database).getById(id); // Merchant | undefined
new MerchantRuleRepository(database).create(rule); // void
new MerchantRuleRepository(database).get(householdId, normalizedDescription); // MerchantRule | undefined
new MerchantRuleRepository(database).list(householdId); // readonly MerchantRule[]
new ImportRepository(database).create(attempt); // void; pending/processing/failed
new ImportRepository(database).getById(id); // Import | undefined
new ImportRepository(database).findCompleted(householdId, fingerprint); // Import | undefined
new ImportRepository(database).complete(id, transactions); // void; atomic success
new ImportRepository(database).fail(id); // void; pending/processing -> failed
```

Creates validate through domain constructors; reads reconstruct canonical domain
objects and return `undefined` when a record is absent.
Create operations insert new records; they do not update or silently reuse them.

Household creation checks and inserts in an immediate transaction, enforcing at
most one Household even across concurrent repository writers. Any existing
Household causes creation to fail, including the same ID. Household reads reject
a store containing multiple Households. Direct database writes can bypass this
repository-level invariant.

Member creation validates the referenced Household and inserts in an immediate
transaction. Member reads reconstruct through `Member` and validate the Household
in one transaction. Display names and `active`/`archived` status are preserved
exactly; archived Members remain readable and valid Account ownership references.

Account creation checks references and inserts the Account plus `account_members`
in one immediate transaction. Individual ownership has exactly one Member row;
shared ownership has at least two distinct Members; household-level and unknown
ownership have none. Contiguous zero-based ordinals preserve the supplied shared
Member order without sorting by ID. The Household and every ownership Member must
exist, and Members must belong to that Household. Archived Members remain valid.

Account reads use a transaction for a coherent snapshot, validate all ownership
rows and references, and reconstruct through `Account`. Invalid cardinality,
ordinals, duplicate references, missing references, or foreign-Household Members
fail explicitly; no rows are dropped or ownership meanings repaired. Pure mapping
tests cover these checks without exercising SQLite persistence.

`AccountRepository.list()` returns every stored Account, including closed Accounts,
ordered by label then ID. It reads a coherent snapshot and uses the same canonical
ownership and reference validation as single-Account reads. An invalid record
fails the read rather than returning a partial list or repairing its meaning.

`CategoryRepository` is read-only. `getById()` requires a nonblank string ID,
performs an exact lookup without trimming, and returns `undefined` when absent.
`list()` returns all persisted Categories, including archived ones, in SQLite
BINARY name ascending then ID ascending order. Both reconstruct canonical
`Category` objects, validating names, IDs, and `active`/`archived` status. Invalid
stored rows and unexpected database errors produce fixed sanitized errors, without
SQL, parameters, or attached causes. No Category creation, editing, deletion, or
default catalog is provided.

Transaction creation validates through `Transaction` and checks references before
inserting in an immediate transaction. Reads use one transaction, reconstruct
`Money` and `Transaction`, and repeat reference checks. The Account must exist and
its primary currency must exactly match the Transaction currency. Supplied
Merchant and Category references must each exist; closed Accounts and archived
Categories remain valid references.

`TransactionRepository.list()` returns all canonical posted Transactions in one
read transaction, ordered by posting date descending and ID ascending for ties.
It preserves Money, descriptions (including empty/absent), optional fields, and
zero-value movements. It uses the same domain and reference validation as `getById`;
an invalid row fails the entire read rather than producing a partial list.

`TransactionRepository.createMany(transactions: readonly Transaction[]): void`
persists a batch of canonical Transactions in supplied order using one immediate
database transaction. It uses the same domain revalidation, reference checks, and
insertion logic as `create()`. An empty batch is a no-op with no database work.
Any invalid record, missing reference, currency mismatch, duplicate supplied ID,
or SQLite constraint failure throws and rolls back all new rows in that batch.
Previously stored records remain unchanged; there is no skip, upsert, or update.
Primary-key uniqueness enforces Transaction IDs and does not detect repeat imports.

`TransactionRepository.assignCategory({ householdId, transactionIds, categoryId })`
explicitly assigns an existing active Category to the exact supplied Transactions.
Household and Category IDs must be nonblank; Transaction IDs must be a non-empty
array of distinct nonblank strings. IDs are preserved exactly. The exported
`TransactionCategoryAssignment` type describes this readonly input.

One immediate SQLite transaction validates the global Category and every existing
Transaction before any update. Canonical Transaction/reference checks and
`AccountRepository` reads validate each Account and require its Household to match
the supplied Household. Explicit IDs may span that Household's currencies; no
currency conversion or description matching occurs. Only `transactions.category_id`
is updated. Merchant association, raw descriptions, Money, dates, Account, origin,
and all unselected records remain unchanged. Each update must affect its row;
missing records, foreign-Household records, suppressed writes, or database failures
roll back the whole batch. Errors contain fixed diagnostics without raw parameters
or underlying SQL causes.

Archived Categories remain readable and valid historical references; this
assignment operation accepts only active targets, without reactivating Categories.
No MerchantRule or reusable category rule is created or changed. This persists
canonical assignments on existing Transactions only; no categorization learning,
future defaults, or UI behavior is added.

The caller passes converted canonical Transactions to this repository; the
database API accepts no ParsedStatement or bank-specific evidence. CommBank
parsing/conversion remains independent of SQLite and Drizzle. No Transaction-to-Import
linkage is introduced.

Import creation revalidates the domain model and the Household/optional confirmed
Account references. A confirmed Account must share the Import's Household.
Source fields and parser provenance are preserved exactly. An attempt may lack a
fingerprint, parser, or confirmed Account while detection/confirmation is unresolved.
When a fingerprint is supplied, this v0.1 repository requires canonical `sha256`
and 64 lowercase hexadecimal characters, as produced by importer-core's
`fingerprintDocumentInput` over original `DocumentInput.bytes`.

An exact-artifact duplicate is a completed Import with the same fingerprint and
Household. Filenames, display labels, parser ID/version, and Transaction contents
are irrelevant to that identity. `findCompleted` is only a preflight lookup;
completion repeats the duplicate check inside `BEGIN IMMEDIATE`. It then inserts
the full batch with the existing Transaction validation/reference checks and sets
the Import status to completed before the same commit. Every supplied Transaction
must have imported origin and use that Import's explicitly confirmed Account.
Missing fingerprint or confirmed Account prevents completion. An empty canonical
batch can complete; no Transaction contents are inferred or skipped.

`DuplicateImportError` deterministically refuses an already completed artifact
without persisting another batch or changing either Import. Other completion
failures roll back both the batch and status change and remain distinct errors.
Creation/completion errors omit SQL parameters and source contents. The partial
unique index independently prevents two completed records for the same identity;
the immediate transaction serializes writers, including callers whose preflight
lookups both saw no duplicate. An existing Transaction primary-key conflict is an
ordinary persistence failure, never exact-artifact duplicate detection.

`create` cannot create completed Imports; successful repository completion must
use `complete`. Only pending/processing attempts may complete or fail. Failed
attempts remain historical and retries receive new Import IDs; they do not block
another attempt. Completed attempts cannot be downgraded to release the duplicate
guard. This repository guarantee does not redefine the generic Import domain's
processing state as proof of financial verification.

Signed integer minor units, posting date, optional transaction date, origin, and
raw descriptions are preserved without inference or normalization. Optional
fields map between absent domain values and SQL NULL. Imported descriptions are
required and may be empty; manual descriptions remain optional. Merchant and
Category references stay independently optional. Invalid persisted domain values,
currency mismatches, or dangling references fail explicitly. Pure mapping tests
cover these conversions. The development smoke check exercises SQLite round-trips
and selected reference checks when run on a native runtime. No Transaction-to-Import
relationship is introduced.

Repository integration tests run the existing Expo Drizzle driver over Node's
real in-memory SQLite engine through a small test-only synchronous client adapter.
They apply the generated migration SQL with foreign keys enabled and exercise
the synthetic CommBank fixture round-trip, single creation, and atomic rollback
after later-record failures. These tests verify SQLite/Drizzle behavior; they do
not replace the native Expo smoke check below. Node's SQLite module is used only
in tests and adds no runtime dependency to the mobile application.

Merchant creation validates through `Merchant` and inserts the supplied ID and
display name exactly. Reads reconstruct through `Merchant`, rejecting invalid
persisted fields, or return `undefined` when absent. IDs are unique through the
existing primary key; duplicate display names remain allowed. Each operation is
one SQL statement. Category assignment and merchant resolution remain separate.

`MerchantRule` is a database-local readonly record containing `householdId`,
`normalizedDescription`, and `merchantId`. It is structurally compatible with the
pure in-memory `MerchantAlias` mapping, but includes durable Household scope.
SQLite concerns remain in this package; the pure alias resolver is independent
of persistence and does not load these rules automatically.

Every v0.1 persistent rule means the Household has explicitly confirmed the exact
description-to-Merchant mapping. These are authoritative household corrections;
the caller must establish confirmation before calling `create`. The repository
validates fields/references, not how confirmation was obtained. A separate status
or source column would only restate this invariant. Callers pass a rule's
`merchantId` as `confirmedMerchantId` to the pure `resolveMerchantIdentity`
function, where it always wins over a conflicting valid suggestion or alias
candidate.

Rule creation validates nonblank strings without changing their values, checks
both references, and inserts in one immediate transaction. Both identical
duplicates and conflicting mappings for the same Household/description are
explicit errors; creation never updates, replaces, or silently reuses a record.
The composite primary key independently prevents duplicate keys. The same exact
description can map to different Merchants in different Households. Normal v0.1
Household setup still permits only one Household in a local store.

Rule lookup uses exact, case-sensitive SQLite BINARY text equality. It never
trims, case-folds, normalizes Unicode, or otherwise reinterprets a key. Empty or
unmatched descriptions return `undefined`; listing returns only one Household's
rules in BINARY description order. Reads validate stored values and references
in one transaction. Errors omit SQL parameters and descriptor contents.

Rules have no status column, confidence score, priority field, or Category.
Normalization, importing, and suggestions never create rules automatically.
Rules are not yet automatically applied to Transactions, and creation/lookup never
changes `Transaction.rawDescription` or its Merchant association. User confirmation
UI arrives later. No automatic learning or built-in rule catalog exists.

### Remaining repository invariants

- Other entity writes and reads preserve domain validation, mapping SQL NULL to
  absent optional fields without changing raw evidence.
- Future ownership updates are atomic; archival/closure preserves history.

Simple foreign keys and row checks cannot enforce these cross-row/domain rules.
They require repositories and domain construction; no triggers are added.

## Migration generation

The package-local `drizzle.config.ts` uses SQLite dialect with the Expo driver.
From the repository root:

```sh
pnpm --filter @aqchafold/database db:generate
pnpm --filter @aqchafold/database db:check
```

Drizzle Kit generates forward SQL migrations, snapshots, its journal, and the
normal Expo `drizzle/migrations.js` bundle from the schema. Keep these generated
files together; do not maintain an independent SQL schema or edit historical
migrations. A second generation with an unchanged schema should create nothing.

The opener does not create tables, apply migrations, or seed application data.
Other repositories and broader persistence coverage remain deferred.
Receipt/Budget, observations, reconciliation,
balances, semantic Transaction duplicate matching, and Transaction-to-Import
linkage are not implemented domain structures and have no tables or invented fields here.

## Development persistence smoke check

From the repository root, run:

```sh
pnpm --filter @aqchafold/mobile db:smoke
```

Open that development session on Android or iOS using a compatible Expo Go or
development build. The app entry runs the check only when both `__DEV__` and
`EXPO_PUBLIC_LEDGERASE_DATABASE_SMOKE=1` are enabled. Normal startup and release
behavior do not execute it, and no debug UI is added. The harness is available
only through the separate `@aqchafold/database/development` entry point.

The check creates a uniquely named `ledgerase-persistence-smoke-*.db` file and
uses only synthetic data. It applies generated migrations, creates and reads
Household, active/archived Members, Account ownership variants, Merchant, and
Transaction through the repositories. A synthetic Category is inserted directly
with Drizzle to exercise independent Category references without another
repository. It checks signed Money, explicit currency, dates, origins, raw
descriptions, optional fields, and selected invalid-write rejection.

It then closes and reopens the same file, reapplies migrations, and checks the
stored canonical values again. A `finally` block closes the connection and
attempts deletion even if a check or close fails. It never opens `ledgerase.db`.
The app logs only a fixed PASS/FAIL marker and platform; no rows are logged. PASS
is emitted only after checks and cleanup complete successfully.

Only an actual native run ending with `[Ledgerase database smoke] PASS (android)`
or `PASS (ios)` verifies that platform. Typecheck, bundle export, and autolinking
do not verify SQLite execution.
