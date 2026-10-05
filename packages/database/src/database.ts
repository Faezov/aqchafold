import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";

/** Opens a local connection explicitly; callers own its lifetime via $client. */
export function openLedgeraseDatabase(databaseName = "ledgerase.db") {
  const sqlite = openDatabaseSync(databaseName);
  return drizzle(sqlite);
}
