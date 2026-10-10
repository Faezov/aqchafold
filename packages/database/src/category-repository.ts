import { Category } from "@aqchafold/domain";
import { asc, eq } from "drizzle-orm";
import type { openLedgeraseDatabase } from "./database";
import { categories } from "./schema";

/** Reads canonical Categories, including archived historical references. */
export class CategoryRepository {
  constructor(
    private readonly database: Pick<
      ReturnType<typeof openLedgeraseDatabase>,
      "select"
    >,
  ) {}

  getById(id: string): Category | undefined {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new TypeError("Category ID must be a nonblank string.");
    }
    try {
      const row = this.database
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .get();
      return row === undefined ? undefined : new Category(row);
    } catch {
      throw new Error("Category lookup failed.");
    }
  }

  /** Lists all Categories in SQLite BINARY name order, then ID order. */
  list(): readonly Category[] {
    try {
      return this.database
        .select()
        .from(categories)
        .orderBy(asc(categories.name), asc(categories.id))
        .all()
        .map((row) => new Category(row));
    } catch {
      throw new Error("Category listing failed.");
    }
  }
}
