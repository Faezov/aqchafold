import { Money, Transaction } from "@aqchafold/domain";
import type { transactions } from "./schema";

export function transactionToRow(
  transaction: Transaction,
): typeof transactions.$inferSelect {
  const validated = copyTransaction(transaction);
  return {
    id: validated.id,
    accountId: validated.accountId,
    postingDate: validated.postingDate,
    transactionDate: validated.transactionDate ?? null,
    amountMinor: validated.amount.amountMinor,
    currency: validated.amount.currency,
    origin: validated.origin,
    rawDescription: validated.rawDescription ?? null,
    merchantId: validated.merchantId ?? null,
    categoryId: validated.categoryId ?? null,
  };
}

export function transactionFromRow(
  row: typeof transactions.$inferSelect,
): Transaction {
  return copyTransaction({
    id: row.id,
    accountId: row.accountId,
    postingDate: row.postingDate,
    transactionDate:
      row.transactionDate === null ? undefined : row.transactionDate,
    amount: new Money(row.amountMinor, row.currency),
    origin: row.origin,
    rawDescription:
      row.rawDescription === null ? undefined : row.rawDescription,
    merchantId: row.merchantId === null ? undefined : row.merchantId,
    categoryId: row.categoryId === null ? undefined : row.categoryId,
  });
}

function copyTransaction(input: Transaction): Transaction {
  if (input.origin === "imported") {
    if (input.rawDescription === undefined) {
      throw new TypeError("Imported Transaction raw description is required.");
    }
    return new Transaction({
      ...input,
      origin: "imported",
      rawDescription: input.rawDescription,
    });
  }
  return new Transaction({ ...input, origin: input.origin });
}
