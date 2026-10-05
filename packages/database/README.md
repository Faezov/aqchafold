# Ledgerase database runtime

Local persistence runtime for the Expo application. This package owns
`expo-sqlite` and `drizzle-orm`; its host peers match the application's current
Expo, React, and React Native versions. Mobile depends on this workspace package
so Expo autolinking can discover SQLite transitively.

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
Importing this package does not open a database, and there is no global singleton.

No schema, migrations, repositories, or application data are created. Drizzle Kit
and its configuration are deferred to schema/migration work. Verification here
covers types, dependency compatibility, and native-module discovery; persistence
and Android/iOS runtime verification remain separate PLAN tasks.
