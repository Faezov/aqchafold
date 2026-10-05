import { Money, Transaction } from "@aqchafold/domain";
import { describe, expect, it } from "vitest";
import { transactionFromRow, transactionToRow } from "./transaction-mapping";
import type { transactions } from "./schema";

const baseRow: typeof transactions.$inferSelect = {
  id: " transaction-1 ",
  accountId: " account-1 ",
  postingDate: "2026-10-01",
  transactionDate: null,
  amountMinor: -1234,
  currency: "USD",
  origin: "manual",
  rawDescription: null,
  merchantId: null,
  categoryId: null,
};

describe("Transaction row mapping (pure mapping, without SQLite)", () => {
  it.each([
    { origin: "manual", rawDescription: null },
    { origin: "manual", rawDescription: "" },
    { origin: "imported", rawDescription: "" },
    { origin: "imported", rawDescription: "  SYNTHETIC SOURCE  " },
  ] as const)(
    "preserves $origin origin and rawDescription=$rawDescription",
    (fields) => {
      const row = { ...baseRow, ...fields };
      const transaction = transactionFromRow(row);
      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.amount).toBeInstanceOf(Money);
      expect(transaction.origin).toBe(row.origin);
      expect(transaction.rawDescription).toBe(
        row.rawDescription === null ? undefined : row.rawDescription,
      );
      expect(transactionToRow(transaction)).toEqual(row);
    },
  );

  it.each([-Number.MAX_SAFE_INTEGER, -1234, 0, 1234, Number.MAX_SAFE_INTEGER])(
    "preserves exact signed minor units %s and currency",
    (amountMinor) => {
      const row = { ...baseRow, amountMinor };
      const transaction = transactionFromRow(row);
      expect(transaction.amount.amountMinor).toBe(amountMinor);
      expect(transaction.amount.currency).toBe("USD");
      expect(transactionToRow(transaction)).toEqual(row);
    },
  );

  it.each([
    { merchantId: null, categoryId: null },
    { merchantId: "merchant-1", categoryId: null },
    { merchantId: null, categoryId: "category-1" },
    { merchantId: "merchant-1", categoryId: "category-1" },
  ])("preserves independent optional references %j", (references) => {
    const row = { ...baseRow, ...references, transactionDate: "2026-09-29" };
    const transaction = transactionFromRow(row);
    expect(transaction.postingDate).toBe("2026-10-01");
    expect(transaction.transactionDate).toBe("2026-09-29");
    expect(transaction.merchantId).toBe(references.merchantId ?? undefined);
    expect(transaction.categoryId).toBe(references.categoryId ?? undefined);
    expect(transactionToRow(transaction)).toEqual(row);
  });

  it("writes absent optional values as NULL and reads them as undefined", () => {
    const transaction = new Transaction({
      id: baseRow.id,
      accountId: baseRow.accountId,
      postingDate: baseRow.postingDate,
      amount: new Money(baseRow.amountMinor, baseRow.currency),
      origin: "manual",
    });
    expect(transactionToRow(transaction)).toEqual(baseRow);
    expect(transactionFromRow(baseRow)).toEqual(transaction);
  });

  it("rejects corrupt persisted Money, dates, origin, and imported descriptions", () => {
    for (const patch of [
      { postingDate: "2026-02-30" },
      { transactionDate: "2026-02-30" },
      { amountMinor: 12.34 },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { currency: "usd" },
      { origin: "bank" },
      { origin: "imported", rawDescription: null },
      { merchantId: " " },
      { categoryId: " " },
    ]) {
      expect(() =>
        Reflect.apply(transactionFromRow, undefined, [
          { ...baseRow, ...patch },
        ]),
      ).toThrow();
    }
  });

  it("revalidates writes instead of replacing invalid optional values with NULL", () => {
    const transaction = transactionFromRow(baseRow);
    for (const patch of [
      { transactionDate: null },
      { rawDescription: null },
      { merchantId: null },
      { categoryId: null },
      { origin: "bank" },
      { origin: "imported", rawDescription: undefined },
    ]) {
      expect(() =>
        Reflect.apply(transactionToRow, undefined, [
          { ...transaction, ...patch },
        ]),
      ).toThrow(TypeError);
    }
  });
});
