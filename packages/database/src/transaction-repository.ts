import type { Transaction } from "@aqchafold/domain";
import { eq } from "drizzle-orm";
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
        this.assertReferences(database, row);
        database.insert(transactions).values(row).run();
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
      this.assertReferences(database, row);
      return transaction;
    });
  }

  private assertReferences(
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
}
