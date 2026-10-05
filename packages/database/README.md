# Ledgerase database runtime

Local persistence runtime for the Expo application. This package owns
`expo-sqlite` and `drizzle-orm`. SQLite declares its Expo, React, and React Native
host peers; mobile depends on this workspace package so Expo autolinking can
discover SQLite transitively.

```ts
import { openLedgeraseDatabase } from "@aqchafold/database";

const database = openLedgeraseDatabase();
// When the caller is finished using this connection:
database.$client.closeSync();
```

`openLedgeraseDatabase(databaseName?)` uses Expo's `openDatabaseSync`, then wraps
the connection with `drizzle-orm/expo-sqlite`. The default filename is
`ledgerase.db`; Expo manages its normal local directory. The returned Drizzle
handle exposes the underlying SQLite connection through its typed `$client`.
Opening enables SQLite foreign keys and supplies the canonical schema to Drizzle.
Importing this package does not open a database, and there is no global singleton.

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

### Later repository invariants

- An initialized v0.1 store contains exactly one Household.
- Individual ownership has one Member row; shared ownership has at least two;
  household-level and unknown ownership have none. Ordinals are contiguous from
  zero, with individual ownership at zero.
- Ownership Members and an Import's confirmed Account share its Household.
- Transaction currency matches its Account's primary currency.
- Writes and reads preserve domain nonblank-string and Gregorian date validation,
  mapping SQL NULL to absent optional fields without changing raw evidence.
- Ownership updates are atomic; archival/closure preserves references and history.

Simple foreign keys and row checks cannot enforce these cross-row/domain rules.
They require later repositories and domain construction; no triggers are added.

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
Runtime migration execution, repositories, persistence tests, and Android/iOS
runtime verification remain deferred. Receipt/Budget, observations, reconciliation,
balances, duplicate matching, and Transaction-to-Import linkage are not implemented
domain structures and have no tables or invented fields here.
