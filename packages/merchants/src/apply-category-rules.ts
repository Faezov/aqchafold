import { Category, Transaction } from "@aqchafold/domain";
import { normalizeMerchantDescription } from "./normalization";

export type CategoryRuleApplicationOptions = {
  readonly transactions: readonly Transaction[];
  /** Household established by the Transactions' confirmed Account context. */
  readonly householdId: string;
  readonly findRule: (
    householdId: string,
    normalizedDescription: string,
  ) =>
    | {
        readonly householdId: string;
        readonly normalizedDescription: string;
        readonly categoryId: string;
      }
    | undefined;
  readonly findCategoryById: (id: string) => Category | undefined;
};

/** Apply explicit exact-description rules to new uncategorized canonical records. */
export function applyCategoryRules({
  transactions,
  householdId,
  findRule,
  findCategoryById,
}: CategoryRuleApplicationOptions): readonly Transaction[] {
  if (typeof householdId !== "string" || householdId.trim().length === 0) {
    throw new TypeError("Category rule application requires a Household ID.");
  }
  try {
    return Object.freeze(
      transactions.map((transaction) => {
        if (!(transaction instanceof Transaction)) {
          throw new Error("Category rule application requires Transactions.");
        }
        const rawDescription = transaction.rawDescription;
        if (
          transaction.categoryId !== undefined ||
          rawDescription === undefined
        )
          return transaction;
        const { normalizedDescription } =
          normalizeMerchantDescription(rawDescription);
        if (normalizedDescription.length === 0) return transaction;
        const rule = findRule(householdId, normalizedDescription);
        if (rule === undefined) return transaction;
        if (
          rule.householdId !== householdId ||
          rule.normalizedDescription !== normalizedDescription ||
          typeof rule.categoryId !== "string" ||
          rule.categoryId.trim().length === 0
        ) {
          throw new Error("Category rule application requires an exact rule.");
        }
        const category = findCategoryById(rule.categoryId);
        if (
          !(category instanceof Category) ||
          category.id !== rule.categoryId
        ) {
          throw new Error("Category rule application requires a Category.");
        }
        // Archival preserves the remembered reference but stops future assignment.
        if (category.status !== "active") return transaction;
        return new Transaction({
          ...transaction,
          categoryId: category.id,
          ...(transaction.origin === "imported"
            ? { origin: "imported", rawDescription }
            : { origin: "manual", rawDescription }),
        });
      }),
    );
  } catch {
    // Lookup implementations may throw SQL parameters or sensitive source text.
    throw new Error("Remembered category rule application failed.");
  }
}
