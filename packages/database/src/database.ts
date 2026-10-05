import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import * as schema from "./schema";

/** Opens a local connection explicitly; callers own its lifetime via $client. */
export function openLedgeraseDatabase(databaseName = "ledgerase.db") {
  const sqlite = openDatabaseSync(databaseName);
  sqlite.execSync("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}
