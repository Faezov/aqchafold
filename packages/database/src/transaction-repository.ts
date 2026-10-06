import type { Transaction } from "@aqchafold/domain";
import { asc, desc, eq } from "drizzle-orm";
import type { openLedgeraseDatabase } from "./database";
import { accounts, categories, merchants, transactions } from "./schema";
import { transactionFromRow, transactionToRow } from "./transaction-mapping";

/** Creates and reads canonical posted movements with validated references. */
export class TransactionRepository {
  constructor(
    private readonly database: ReturnType<typeof openLedgeraseDatabase>,
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
