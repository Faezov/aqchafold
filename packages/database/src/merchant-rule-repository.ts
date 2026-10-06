import { and, asc, eq } from "drizzle-orm";
import type { openLedgeraseDatabase } from "./database";
import { households, merchantRules, merchants } from "./schema";

/** Durable user-confirmed exact identity mapping within one Household, after normalization. */
export type MerchantRule = {
  readonly householdId: string;
  readonly normalizedDescription: string;
  readonly merchantId: string;
};

type ReadDatabase = Pick<ReturnType<typeof openLedgeraseDatabase>, "select">;

// Only repository-owned errors are safe to propagate without SQL parameters.
class MerchantRuleError extends Error {}

/** User-confirmed local mappings; never derives rules from or applies them to Transactions. */
export class MerchantRuleRepository {
  constructor(
    private readonly database: ReturnType<typeof openLedgeraseDatabase>,
  ) {}

  /** Call only after the Household has explicitly confirmed this exact mapping. */
  create(rule: MerchantRule): void {
    const validated = validateRule(rule);
    try {
      this.database.transaction(
        (database) => {
          assertReferences(database, validated);
          if (
            findRow(
              database,
              validated.householdId,
              validated.normalizedDescription,
            ) !== undefined
          ) {
            throw new MerchantRuleError(
              "Merchant rule already exists for this Household and description.",
            );
          }
          database.insert(merchantRules).values(validated).run();
        },
        { behavior: "immediate" },
      );
    } catch (error) {
      if (error instanceof MerchantRuleError) throw error;
      throw new Error("Merchant rule creation failed.");
    }
  }

  /** Exact key lookup without trimming, case folding, or textual normalization. */
  get(
    householdId: string,
    normalizedDescription: string,
  ): MerchantRule | undefined {
    assertNonblank(householdId, "Merchant rule Household ID");
    if (typeof normalizedDescription !== "string") {
      throw new TypeError("Merchant rule lookup description must be a string.");
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
      if (error instanceof MerchantRuleError) throw error;
      throw new Error("Merchant rule lookup failed.");
    }
  }

  /** Lists one Household's rules in SQLite BINARY description order. */
  list(householdId: string): readonly MerchantRule[] {
    assertNonblank(householdId, "Merchant rule Household ID");
    try {
      return this.database.transaction((database) => {
        const rows = database
          .select()
          .from(merchantRules)
          .where(eq(merchantRules.householdId, householdId))
          .orderBy(asc(merchantRules.normalizedDescription))
          .all();
        return rows.map((row) => {
          const rule = validateRule(row);
          assertReferences(database, rule);
          return rule;
        });
      });
    } catch (error) {
      if (error instanceof MerchantRuleError) throw error;
      throw new Error("Merchant rule listing failed.");
    }
  }
}

function validateRule(rule: MerchantRule): MerchantRule {
  if (typeof rule !== "object" || rule === null) {
    throw new TypeError("Merchant rule must be an object.");
  }
  assertNonblank(rule.householdId, "Merchant rule Household ID");
  assertNonblank(rule.normalizedDescription, "Merchant rule description");
  assertNonblank(rule.merchantId, "Merchant rule Merchant ID");
  return Object.freeze({
    householdId: rule.householdId,
    normalizedDescription: rule.normalizedDescription,
    merchantId: rule.merchantId,
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
    .from(merchantRules)
    .where(
      and(
        eq(merchantRules.householdId, householdId),
        eq(merchantRules.normalizedDescription, normalizedDescription),
      ),
    )
    .get();
}

function assertReferences(database: ReadDatabase, rule: MerchantRule): void {
  if (
    database
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, rule.householdId))
      .get() === undefined
  ) {
    throw new MerchantRuleError(
      "Merchant rule must reference an existing Household.",
    );
  }
  if (
    database
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.id, rule.merchantId))
      .get() === undefined
  ) {
    throw new MerchantRuleError(
      "Merchant rule must reference an existing Merchant.",
    );
  }
}
