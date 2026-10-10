import { and, eq } from "drizzle-orm";
import { CategoryRepository } from "./category-repository";
import type { openLedgeraseDatabase } from "./database";
import { categoryRules, households } from "./schema";

/** Explicitly remembered exact-description categorization within one Household. */
export type CategoryRule = {
  readonly householdId: string;
  readonly normalizedDescription: string;
  readonly categoryId: string;
};

type ReadDatabase = Pick<ReturnType<typeof openLedgeraseDatabase>, "select">;

// Only these repository-owned errors may leave the persistence boundary.
class CategoryRuleError extends Error {}

/** Durable opt-in corrections; no Merchant-wide defaults or historical writes. */
export class CategoryRuleRepository {
  constructor(
    private readonly database: Pick<
      ReturnType<typeof openLedgeraseDatabase>,
      "select" | "insert" | "transaction"
    >,
  ) {}

  /** Create only after the user explicitly requests future reuse. Never overwrite. */
  create(rule: CategoryRule): void {
    const validated = validateRule(rule);
    try {
      this.database.transaction(
        (database) => {
          const category = assertReferences(database, validated);
          if (category.status !== "active") {
            throw new CategoryRuleError(
              "Category rule creation requires an active Category.",
            );
          }
          if (
            findRow(
              database,
              validated.householdId,
              validated.normalizedDescription,
            ) !== undefined
          ) {
            throw new CategoryRuleError(
              "Category rule already exists for this Household and description.",
            );
          }
          if (
            database.insert(categoryRules).values(validated).run().changes !== 1
          ) {
            throw new CategoryRuleError(
              "Category rule creation must store the supplied rule.",
            );
          }
        },
        { behavior: "immediate" },
      );
    } catch (error) {
      if (error instanceof CategoryRuleError) throw error;
      throw new Error("Category rule creation failed.");
    }
  }

  /** Exact case-sensitive lookup. Archived targets remain readable historically. */
  get(
    householdId: string,
    normalizedDescription: string,
  ): CategoryRule | undefined {
    assertNonblank(householdId, "Category rule Household ID");
    if (typeof normalizedDescription !== "string") {
      throw new TypeError("Category rule lookup description must be a string.");
    }
    try {
      return this.database.transaction((database) => {
        const row = findRow(database, householdId, normalizedDescription);
        if (row === undefined) return undefined;
        const rule = validateRule(row);
        assertReferences(database, rule);
        return rule;
      });
    } catch (error) {
      if (error instanceof CategoryRuleError) throw error;
      throw new Error("Category rule lookup failed.");
    }
  }
}

function validateRule(rule: CategoryRule): CategoryRule {
  if (typeof rule !== "object" || rule === null) {
    throw new TypeError("Category rule must be an object.");
  }
  assertNonblank(rule.householdId, "Category rule Household ID");
  assertNonblank(rule.normalizedDescription, "Category rule description");
  assertNonblank(rule.categoryId, "Category rule Category ID");
  return Object.freeze({
    householdId: rule.householdId,
    normalizedDescription: rule.normalizedDescription,
    categoryId: rule.categoryId,
  });
}

function assertNonblank(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonblank string.`);
  }
}

function findRow(
  database: ReadDatabase,
  householdId: string,
  normalizedDescription: string,
) {
  return database
    .select()
    .from(categoryRules)
    .where(
      and(
        eq(categoryRules.householdId, householdId),
        eq(categoryRules.normalizedDescription, normalizedDescription),
      ),
    )
    .get();
}

function assertReferences(database: ReadDatabase, rule: CategoryRule) {
  if (
    database
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, rule.householdId))
      .get() === undefined
  ) {
    throw new CategoryRuleError(
      "Category rule must reference an existing Household.",
    );
  }
  const category = new CategoryRepository(database).getById(rule.categoryId);
  if (category === undefined) {
    throw new CategoryRuleError(
      "Category rule must reference an existing Category.",
    );
  }
  return category;
}
