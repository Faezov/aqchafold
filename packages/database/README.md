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
either complete or absent. Fingerprints are not unique: repeat attempts retain
independent Import IDs. Processing status does not imply financial verification.

Foreign keys cover Member/Account/Import to Household, Import's optional confirmed
Account, Transaction's Account and optional Merchant/Category, and ownership
Member rows. No cascading deletes erase history. Merchant and Category currently
have no Household field in the implemented domain; none is invented here.

## Repositories

`HouseholdRepository`, `MemberRepository`, `AccountRepository`,
`TransactionRepository`, and `MerchantRepository` take an already-open Drizzle
handle.
They do not open connections or apply migrations; tables must exist before use.
Their synchronous APIs are:

```ts
new HouseholdRepository(database).create(household); // void
new HouseholdRepository(database).get(); // Household | undefined
new MemberRepository(database).create(member); // void
new MemberRepository(database).getById(id); // Member | undefined
new AccountRepository(database).create(account); // void
new AccountRepository(database).getById(id); // Account | undefined
new TransactionRepository(database).create(transaction); // void
new TransactionRepository(database).getById(id); // Transaction | undefined
new MerchantRepository(database).create(merchant); // void
new MerchantRepository(database).getById(id); // Merchant | undefined
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

Transaction creation validates through `Transaction` and checks references before
inserting in an immediate transaction. Reads use one transaction, reconstruct
`Money` and `Transaction`, and repeat reference checks. The Account must exist and
its primary currency must exactly match the Transaction currency. Supplied
Merchant and Category references must each exist; closed Accounts and archived
Categories remain valid references.

Signed integer minor units, posting date, optional transaction date, origin, and
raw descriptions are preserved without inference or normalization. Optional
fields map between absent domain values and SQL NULL. Imported descriptions are
required and may be empty; manual descriptions remain optional. Merchant and
Category references stay independently optional. Invalid persisted domain values,
currency mismatches, or dangling references fail explicitly. Pure mapping tests
cover these conversions. The development smoke check exercises SQLite round-trips
and selected reference checks when run on a native runtime. No Transaction-to-Import
relationship is introduced.

Merchant creation validates through `Merchant` and inserts the supplied ID and
display name exactly. Reads reconstruct through `Merchant`, rejecting invalid
persisted fields, or return `undefined` when absent. IDs are unique through the
existing primary key; duplicate display names remain allowed. Each operation is
one SQL statement. Category assignment and merchant resolution remain separate.

### Remaining repository invariants

- An Import's confirmed Account shares its Household.
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
balances, duplicate matching, and Transaction-to-Import linkage are not implemented
domain structures and have no tables or invented fields here.

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
