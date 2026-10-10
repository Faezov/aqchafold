import { CategoryRuleRepository } from "./category-rule-repository";
import type { openLedgeraseDatabase } from "./database";
import {
  TransactionRepository,
  type TransactionCategoryAssignment,
} from "./transaction-repository";

export type RememberedTransactionCategoryAssignment =
  TransactionCategoryAssignment & {
    readonly normalizedDescription: string;
  };

/** Atomically assign the explicit current selection and remember its exact future key. */
export function assignCategoryAndRemember(
  database: ReturnType<typeof openLedgeraseDatabase>,
  input: RememberedTransactionCategoryAssignment,
): void {
  try {
    const { householdId, normalizedDescription, transactionIds, categoryId } =
      input;
    database.transaction(
      (transaction) => {
        new CategoryRuleRepository(transaction).create({
          householdId,
          normalizedDescription,
          categoryId,
        });
        new TransactionRepository(transaction).assignCategory({
          householdId,
          transactionIds,
          categoryId,
        });
      },
      { behavior: "immediate" },
    );
  } catch {
    // Either nested write fails the outer transaction; never expose SQL or input data.
    throw new Error("Remembered category assignment failed.");
  }
}
