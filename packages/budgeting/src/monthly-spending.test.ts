import { describe, expect, it } from "vitest";
import {
  Category,
  CategoryBudget,
  Merchant,
  Money,
  Transaction,
  TransactionSpendingClassification,
} from "@aqchafold/domain";
import {
  calculateMonthlyCategoryTotals,
  calculateMonthlySpending,
} from "./index";

function transaction(
  id: string,
  amountMinor: number,
  options: {
    postingDate?: string;
    transactionDate?: string;
    currency?: string;
    categoryId?: string;
    merchantId?: string;
    rawDescription?: string;
  } = {},
): Transaction {
  return new Transaction({
    id,
    accountId: "account-1",
    postingDate: options.postingDate ?? "2026-10-05",
    transactionDate: options.transactionDate,
    amount: new Money(amountMinor, options.currency ?? "AUD"),
    origin: "manual",
    categoryId: options.categoryId,
    merchantId: options.merchantId,
    rawDescription: options.rawDescription,
  });
}

function decision(
  transactionId: string,
  classification: TransactionSpendingClassification["classification"],
): TransactionSpendingClassification {
  return new TransactionSpendingClassification({
    transactionId,
    classification,
  });
}

function classifySpending(
  transactions: readonly Transaction[],
): TransactionSpendingClassification[] {
  return transactions.map((item) => decision(item.id, "spending"));
}

describe("calculateMonthlySpending", () => {
  it("sums several explicitly classified debits as exact positive spending", () => {
    const transactions = [
      transaction("a", -1234, { categoryId: "category-1" }),
      transaction("b", -5678, { categoryId: "category-1" }),
    ];
    expect(
      calculateMonthlySpending(transactions, classifySpending(transactions)),
    ).toEqual([
      {
        month: "2026-10",
        categoryId: "category-1",
        currency: "AUD",
        total: new Money(6912, "AUD"),
      },
    ]);
  });

  it("nets explicit spending offsets and permits negative monthly spending", () => {
    const transactions = [
      transaction("purchase", -1000),
      transaction("refund", 300),
      transaction("reimbursement", 200),
      transaction("excess-offset", 42, { postingDate: "2026-11-01" }),
    ];
    expect(
      calculateMonthlySpending(transactions, classifySpending(transactions)),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(500, "AUD") },
      { month: "2026-11", currency: "AUD", total: new Money(-42, "AUD") },
    ]);
  });

  it("excludes either sign when unresolved or not-spending and preserves raw activity", () => {
    const transactions = [
      transaction("unresolved-debit", -500),
      transaction("unresolved-credit", 200),
      transaction("excluded-debit", -300),
      transaction("excluded-credit", 100),
    ];
    expect(
      calculateMonthlySpending(transactions, [
        decision("excluded-debit", "not-spending"),
        decision("excluded-credit", "not-spending"),
      ]),
    ).toEqual([]);
    expect(calculateMonthlyCategoryTotals(transactions)).toEqual([
      {
        month: "2026-10",
        currency: "AUD",
        debitTotal: new Money(800, "AUD"),
        creditTotal: new Money(300, "AUD"),
      },
    ]);
  });

  it("does not infer spending or offset eligibility from Category, Merchant, or descriptions", () => {
    const category = new Category({
      id: "groceries",
      name: "Groceries",
      status: "active",
    });
    const merchant = new Merchant({
      id: "supermarket",
      displayName: "Supermarket",
    });
    const transactions = [
      transaction("unresolved", -1000, {
        categoryId: category.id,
        merchantId: merchant.id,
        rawDescription: "Groceries purchase",
      }),
      transaction("excluded", -1000, {
        categoryId: category.id,
        merchantId: merchant.id,
        rawDescription: "Spending purchase",
      }),
      transaction("explicit", 50, { rawDescription: "Uninformative credit" }),
      transaction("unresolved-refund", 300, {
        rawDescription: "Purchase refund",
      }),
    ];
    expect(
      calculateMonthlySpending(transactions, [
        decision("excluded", "not-spending"),
        decision("explicit", "spending"),
      ]),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(-50, "AUD") },
    ]);
  });

  it("excludes explicitly not-spending transfer movements without identifying transfers from text", () => {
    const transactions = [
      transaction("outgoing", -1000, { rawDescription: "Internal transfer" }),
      transaction("incoming", 1000, { rawDescription: "Internal transfer" }),
    ];
    expect(
      calculateMonthlySpending(
        transactions,
        transactions.map((item) => decision(item.id, "not-spending")),
      ),
    ).toEqual([]);
    expect(calculateMonthlySpending(transactions, [])).toEqual([]);
  });

  it("accepts actuals regardless of CategoryBudget presence or planning role", () => {
    const spendingTarget = new CategoryBudget({
      categoryId: "planned-spending",
      amount: new Money(5000, "AUD"),
      role: "spending",
      spendingCharacter: "essential",
      spendingRegularity: "regular",
    });
    const incomeTarget = new CategoryBudget({
      categoryId: "planned-income",
      amount: new Money(5000, "AUD"),
      role: "income",
    });
    const transactions = [
      transaction("target-alone", -5000, {
        categoryId: spendingTarget.categoryId,
      }),
      transaction("income-category", -100, {
        categoryId: incomeTarget.categoryId,
      }),
      transaction("no-target", -200, { categoryId: "other-category" }),
      transaction("uncategorized", -300),
    ];
    expect(
      calculateMonthlySpending(
        transactions,
        classifySpending(transactions.slice(1)),
      ),
    ).toEqual([
      {
        month: "2026-10",
        categoryId: "other-category",
        currency: "AUD",
        total: new Money(200, "AUD"),
      },
      {
        month: "2026-10",
        categoryId: "planned-income",
        currency: "AUD",
        total: new Money(100, "AUD"),
      },
      { month: "2026-10", currency: "AUD", total: new Money(300, "AUD") },
    ]);
  });

  it("preserves opaque category grouping keys and omits the uncategorized property", () => {
    const categoryIds = [
      ' category|["\\/Å:42\t ',
      'category|["\\/Å:42',
      "uncategorized",
      "null",
    ];
    const transactions = [
      ...categoryIds.map((categoryId, index) =>
        transaction(`category-${index}`, -1, { categoryId }),
      ),
      transaction("uncategorized", -2),
    ];
    const results = calculateMonthlySpending(
      transactions,
      classifySpending(transactions),
    );
    expect(results.map((item) => item.categoryId)).toEqual([
      ...[...categoryIds].sort(),
      undefined,
    ]);
    expect(
      results.slice(0, -1).every((item) => item.total.amountMinor === 1),
    ).toBe(true);
    expect(results.at(-1)).toEqual({
      month: "2026-10",
      currency: "AUD",
      total: new Money(2, "AUD"),
    });
    expect(results.at(-1)).not.toHaveProperty("categoryId");
  });

  it("uses Gregorian posting months, independent of transactionDate or current time", () => {
    const transactions = [
      transaction("october", -100, {
        postingDate: "2026-10-01",
        transactionDate: "2026-09-30",
      }),
      transaction("november", -200, {
        postingDate: "2026-11-01",
        transactionDate: "2026-10-31",
      }),
      transaction("earliest", -300, { postingDate: "0001-01-01" }),
      transaction("latest", -400, { postingDate: "9999-12-31" }),
      transaction("leap-day", -500, { postingDate: "2024-02-29" }),
    ];
    expect(
      calculateMonthlySpending(transactions, classifySpending(transactions)),
    ).toEqual([
      { month: "0001-01", currency: "AUD", total: new Money(300, "AUD") },
      { month: "2024-02", currency: "AUD", total: new Money(500, "AUD") },
      { month: "2026-10", currency: "AUD", total: new Money(100, "AUD") },
      { month: "2026-11", currency: "AUD", total: new Money(200, "AUD") },
      { month: "9999-12", currency: "AUD", total: new Money(400, "AUD") },
    ]);
  });

  it("keeps currencies separate without FX or decimal-scale assumptions", () => {
    const transactions = [
      transaction("aud", -1234),
      transaction("usd", -5678, { currency: "USD" }),
      transaction("jpy", 42, { currency: "JPY" }),
      transaction("bhd", -12345, { currency: "BHD" }),
      transaction("usd-offset", 678, { currency: "USD" }),
    ];
    expect(
      calculateMonthlySpending(transactions, classifySpending(transactions)),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(1234, "AUD") },
      { month: "2026-10", currency: "BHD", total: new Money(12345, "BHD") },
      { month: "2026-10", currency: "JPY", total: new Money(-42, "JPY") },
      { month: "2026-10", currency: "USD", total: new Money(5000, "USD") },
    ]);
  });

  it("omits empty/zero-only groups and retains nonzero activity cancelling to canonical zero", () => {
    expect(calculateMonthlySpending([], [])).toEqual([]);
    const zeros = [transaction("zero", 0), transaction("negative-zero", -0)];
    expect(calculateMonthlySpending(zeros, classifySpending(zeros))).toEqual(
      [],
    );
    const transactions = [
      transaction("purchase", -100),
      transaction("offset", 100),
      transaction("zero", 0),
      transaction("zero-month", 0, { postingDate: "2026-11-01" }),
      transaction("zero-currency", 0, { currency: "USD" }),
      transaction("zero-category", 0, { categoryId: "other" }),
    ];
    const results = calculateMonthlySpending(
      transactions,
      classifySpending(transactions),
    );
    expect(results).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(0, "AUD") },
    ]);
    expect(Object.is(results[0].total.amountMinor, -0)).toBe(false);
  });

  it.each([0, -100])(
    "rejects duplicate Transaction IDs even without decisions (%s)",
    (amount) => {
      expect(() =>
        calculateMonthlySpending(
          [transaction("duplicate", amount), transaction("duplicate", amount)],
          [],
        ),
      ).toThrow(/unique Transaction IDs/);
    },
  );

  it.each(["spending", "not-spending"] as const)(
    "rejects duplicate/conflicting classification references (%s)",
    (classification) => {
      for (const other of ["spending", "not-spending"] as const) {
        expect(() =>
          calculateMonthlySpending(
            [transaction("a", 0)],
            [decision("a", classification), decision("a", other)],
          ),
        ).toThrow(/unique classification Transaction IDs/);
      }
    },
  );

  it.each(["spending", "not-spending"] as const)(
    "rejects dangling %s references",
    (classification) => {
      expect(() =>
        calculateMonthlySpending([], [decision("missing", classification)]),
      ).toThrow(/refer to supplied Transactions/);
    },
  );

  it("validates references before any accumulation, including otherwise excluded decisions", () => {
    const transactions = [
      transaction("a", -Number.MAX_SAFE_INTEGER),
      transaction("b", -1),
    ];
    expect(() =>
      calculateMonthlySpending(transactions, [
        ...classifySpending(transactions),
        decision("missing", "not-spending"),
      ]),
    ).toThrow(/refer to supplied Transactions/);
  });

  it("matches opaque Transaction IDs exactly without trimming or case folding", () => {
    const transactions = [
      transaction(" Tx:1/opaque \t", -100),
      transaction("tx:1/opaque", -200),
    ];
    expect(
      calculateMonthlySpending(transactions, [
        decision(" Tx:1/opaque \t", "spending"),
      ]),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(100, "AUD") },
    ]);
    expect(() =>
      calculateMonthlySpending(transactions, [
        decision("Tx:1/opaque", "spending"),
      ]),
    ).toThrow(/refer to supplied Transactions/);
  });

  it.each([1, -1])(
    "accumulates exactly to the signed safe boundary (%s)",
    (direction) => {
      const transactions = [
        transaction("a", -direction * (Number.MAX_SAFE_INTEGER - 1)),
        transaction("b", -direction),
      ];
      for (const values of [transactions, [...transactions].reverse()]) {
        expect(
          calculateMonthlySpending(values, classifySpending(values)),
        ).toEqual([
          {
            month: "2026-10",
            currency: "AUD",
            total: new Money(direction * Number.MAX_SAFE_INTEGER, "AUD"),
          },
        ]);
      }
    },
  );

  it.each([1, -1])(
    "rejects overflow in either input order and before later cancellation (%s)",
    (direction) => {
      const transactions = [
        transaction("a", -direction * Number.MAX_SAFE_INTEGER),
        transaction("b", -direction),
      ];
      for (const values of [
        transactions,
        [...transactions].reverse(),
        [...transactions, transaction("later-offset", direction)],
      ]) {
        expect(() =>
          calculateMonthlySpending(values, classifySpending(values)),
        ).toThrow(RangeError);
      }
      expect(transactions.map((item) => item.amount.amountMinor)).toEqual([
        -direction * Number.MAX_SAFE_INTEGER,
        -direction,
      ]);
    },
  );

  it("checks safe bounds separately for every grouping dimension", () => {
    const transactions = [
      transaction("aud", -Number.MAX_SAFE_INTEGER),
      transaction("usd", -Number.MAX_SAFE_INTEGER, { currency: "USD" }),
      transaction("category", -Number.MAX_SAFE_INTEGER, {
        categoryId: "category",
      }),
      transaction("next-month", -Number.MAX_SAFE_INTEGER, {
        postingDate: "2026-11-01",
      }),
    ];
    const results = calculateMonthlySpending(
      transactions,
      classifySpending(transactions),
    );
    expect(results).toHaveLength(4);
    expect(
      results.every(
        (item) => item.total.amountMinor === Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(true);
  });

  it("orders by month, exact categorized IDs, uncategorized last, then currency", () => {
    const transactions = [
      transaction("november", -1, { postingDate: "2026-11-01" }),
      transaction("uncat-usd", -1, { currency: "USD" }),
      transaction("a-usd", -1, { categoryId: "a", currency: "USD" }),
      transaction("z-jpy", -1, { categoryId: "Z", currency: "JPY" }),
      transaction("uncat-aud", -1),
      transaction("a-aud", -1, { categoryId: "a" }),
      transaction("z-aud", -1, { categoryId: "Z" }),
      transaction("september", -1, { postingDate: "2026-09-30" }),
    ];
    const expected = [
      ["2026-09", undefined, "AUD"],
      ["2026-10", "Z", "AUD"],
      ["2026-10", "Z", "JPY"],
      ["2026-10", "a", "AUD"],
      ["2026-10", "a", "USD"],
      ["2026-10", undefined, "AUD"],
      ["2026-10", undefined, "USD"],
      ["2026-11", undefined, "AUD"],
    ];
    for (const values of [
      transactions,
      [...transactions].reverse(),
      [...transactions.slice(3), ...transactions.slice(0, 3)],
    ]) {
      expect(
        calculateMonthlySpending(
          values,
          classifySpending(values).reverse(),
        ).map(({ month, categoryId, currency }) => [
          month,
          categoryId,
          currency,
        ]),
      ).toEqual(expected);
    }
  });

  it("preserves input arrays/values and freezes records, Money, and result arrays", () => {
    const transactions = Object.freeze([
      transaction("b", 100),
      transaction("a", -300),
    ]);
    const classifications = Object.freeze(classifySpending(transactions));
    const beforeTransactions = transactions.map((item) => ({ ...item }));
    const beforeDecisions = classifications.map((item) => ({ ...item }));
    const results = calculateMonthlySpending(transactions, classifications);
    expect(transactions).toEqual(beforeTransactions);
    expect(classifications).toEqual(beforeDecisions);
    transactions.forEach((item, index) =>
      expect(item.amount).toBe(beforeTransactions[index].amount),
    );
    expect(results).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(200, "AUD") },
    ]);
    expect(Object.isFrozen(results)).toBe(true);
    expect(Reflect.set(results, "0", {})).toBe(false);
    for (const result of results) {
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.total)).toBe(true);
      expect(Reflect.set(result, "categoryId", "changed")).toBe(false);
      expect(Reflect.set(result.total, "amountMinor", 999)).toBe(false);
    }
    expect(Object.isFrozen(calculateMonthlySpending([], []))).toBe(true);
  });
});
