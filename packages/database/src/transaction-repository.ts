import { Category, type Transaction } from "@aqchafold/domain";
import { asc, desc, eq } from "drizzle-orm";
import { AccountRepository } from "./account-repository";
import type { openLedgeraseDatabase } from "./database";
import { accounts, categories, merchants, transactions } from "./schema";
import { transactionFromRow, transactionToRow } from "./transaction-mapping";

export type TransactionCategoryAssignment = {
  readonly householdId: string;
  readonly transactionIds: readonly string[];
  readonly categoryId: string;
};

// Only these repository-owned diagnostics may leave the assignment boundary.
class CategoryAssignmentError extends Error {}

/** Canonical posted movements with validated references and explicit category assignment. */
export class TransactionRepository {
  constructor(
    private readonly database: Pick<
      ReturnType<typeof openLedgeraseDatabase>,
      "select" | "insert" | "update" | "transaction"
    >,
  ) {}

  create(transaction: Transaction): void {
    const row = transactionToRow(transaction);
    this.database.transaction(
      (database) => {
        insertRow(database, row);
      },
      { behavior: "immediate" },
    );
  }

  /** Insert the entire batch in supplied order, or roll back every new row. */
  createMany(records: readonly Transaction[]): void {
    if (records.length === 0) return;
    this.database.transaction(
      (database) => {
        insertTransactionBatch(database, records);
      },
      { behavior: "immediate" },
    );
  }

  /** Change only category_id for the exact supplied Household-owned Transactions. */
  assignCategory(input: TransactionCategoryAssignment): void {
    const { householdId, transactionIds, categoryId } =
      validateCategoryAssignment(input);
    try {
      this.database.transaction(
        (database) => {
          // Categories are globally modeled in v0.1; Household scope comes from Accounts.
          const categoryRow = database
            .select()
            .from(categories)
            .where(eq(categories.id, categoryId))
            .get();
          if (categoryRow === undefined) {
            throw new CategoryAssignmentError(
              "Category assignment requires an existing Category.",
            );
          }
          if (new Category(categoryRow).status !== "active") {
            throw new CategoryAssignmentError(
              "Category assignment requires an active Category.",
            );
          }
          const accountRepository = new AccountRepository(database);
          // Validate the entire batch before any update; preserve corrupt-source failures.
          for (const id of transactionIds) {
            const row = database
              .select()
              .from(transactions)
              .where(eq(transactions.id, id))
              .get();
            if (row === undefined) {
              throw new CategoryAssignmentError(
                "Category assignment requires existing Transactions.",
              );
            }
            transactionFromRow(row);
            assertReferences(database, row);
            if (
              accountRepository.getById(row.accountId)?.householdId !==
              householdId
            ) {
              throw new CategoryAssignmentError(
                "Category assignment requires Transactions in the supplied Household.",
              );
            }
          }
          for (const id of transactionIds) {
            const result = database
              .update(transactions)
              .set({ categoryId })
              .where(eq(transactions.id, id))
              .run();
            if (result.changes !== 1) {
              throw new CategoryAssignmentError(
                "Category assignment must update every supplied Transaction.",
              );
            }
          }
        },
        { behavior: "immediate" },
      );
    } catch (error) {
      if (error instanceof CategoryAssignmentError) throw error;
      throw new Error("Transaction category assignment failed.");
    }
  }

  getById(id: string): Transaction | undefined {
    return this.database.transaction((database) => {
      const row = database
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))
        .get();
      if (row === undefined) {
        return undefined;
      }
      const transaction = transactionFromRow(row);
      assertReferences(database, row);
      return transaction;
    });
  }

  /** Lists all local Transactions by posting date descending, then ID ascending. */
  list(): readonly Transaction[] {
    return this.database.transaction((database) => {
      const rows = database
        .select()
        .from(transactions)
        .orderBy(desc(transactions.postingDate), asc(transactions.id))
        .all();
      return rows.map((row) => {
        const transaction = transactionFromRow(row);
        assertReferences(database, row);
        return transaction;
      });
    });
  }
}

function validateCategoryAssignment(
  input: TransactionCategoryAssignment,
): TransactionCategoryAssignment {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Transaction category assignment must be an object.");
  }
  const { householdId, categoryId } = input;
  assertAssignmentId(householdId, "Household ID");
  assertAssignmentId(categoryId, "Category ID");
  if (
    !Array.isArray(input.transactionIds) ||
    input.transactionIds.length === 0
  ) {
    throw new TypeError(
      "Category assignment requires a non-empty Transaction ID array.",
    );
  }
  const transactionIds = [...input.transactionIds];
  for (const id of transactionIds) assertAssignmentId(id, "Transaction ID");
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new TypeError(
      "Category assignment requires distinct Transaction IDs.",
    );
  }
  return { householdId, categoryId, transactionIds };
}

function assertAssignmentId(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      `Category assignment ${label} must be a nonblank string.`,
    );
  }
}

/** @internal Reuse batch validation/insertion inside the caller's SQL transaction. */
export function insertTransactionBatch(
  database: Pick<ReturnType<typeof openLedgeraseDatabase>, "select" | "insert">,
  records: readonly Transaction[],
): void {
  for (const transaction of records)
    insertRow(database, transactionToRow(transaction));
}

function insertRow(
  database: Pick<ReturnType<typeof openLedgeraseDatabase>, "select" | "insert">,
  row: typeof transactions.$inferSelect,
): void {
  assertReferences(database, row);
  database.insert(transactions).values(row).run();
}

function assertReferences(
  database: Pick<ReturnType<typeof openLedgeraseDatabase>, "select">,
  row: typeof transactions.$inferSelect,
): void {
  const account = database
    .select({ primaryCurrency: accounts.primaryCurrency })
    .from(accounts)
    .where(eq(accounts.id, row.accountId))
    .get();
  if (account === undefined) {
    throw new Error("Transaction must reference an existing Account.");
  }
  if (row.currency !== account.primaryCurrency) {
    throw new Error("Transaction currency must match its Account currency.");
  }
  if (row.merchantId !== null) {
    const merchant = database
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.id, row.merchantId))
      .get();
    if (merchant === undefined) {
      throw new Error("Transaction must reference an existing Merchant.");
    }
  }
  if (row.categoryId !== null) {
    const category = database
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, row.categoryId))
      .get();
    if (category === undefined) {
      throw new Error("Transaction must reference an existing Category.");
    }
  }
}
