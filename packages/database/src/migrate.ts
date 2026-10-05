import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "../drizzle/migrations";
import type { openLedgeraseDatabase } from "./database";

/** Applies pending generated migrations to an explicitly opened connection. */
export async function migrateLedgeraseDatabase(
  database: ReturnType<typeof openLedgeraseDatabase>,
): Promise<void> {
  await migrate(database, migrations);
}
