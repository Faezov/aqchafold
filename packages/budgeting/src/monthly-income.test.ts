import { describe, expect, it } from "vitest";
import {
  Category,
  CategoryBudget,
  Merchant,
  Money,
  Transaction,
  TransactionIncomeClassification,
  type IncomeClassification,
} from "@aqchafold/domain";
import {
  calculateMonthlyCategoryTotals,
  calculateMonthlyIncome,
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
  classification: IncomeClassification,
): TransactionIncomeClassification {
  return new TransactionIncomeClassification({ transactionId, classification });
}

function classifyIncome(
  transactions: readonly Transaction[],
): TransactionIncomeClassification[] {
  return transactions.map((item) => decision(item.id, "income"));
}

describe("calculateMonthlyIncome", () => {
  it("totals several positive explicitly classified income amounts exactly", () => {
    const transactions = [transaction("a", 1234), transaction("b", 5678)];
    expect(
      calculateMonthlyIncome(transactions, classifyIncome(transactions)),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(6912, "AUD") },
    ]);
  });

  it("nets signed classified income and retains negative monthly totals", () => {
    const transactions = [
      transaction("a", 1000),
      transaction("b", -300),
      transaction("c", 200),
      transaction("d", -42, { postingDate: "2026-11-01" }),
    ];
    expect(
      calculateMonthlyIncome(transactions, classifyIncome(transactions)),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(900, "AUD") },
      { month: "2026-11", currency: "AUD", total: new Money(-42, "AUD") },
    ]);
  });

  it("excludes both signs when not-income or unresolved, preserving raw activity", () => {
    const transactions = [
      transaction("unresolved-credit", 500),
      transaction("unresolved-debit", -200),
      transaction("excluded-credit", 300),
      transaction("excluded-debit", -100),
    ];
    const classifications = [
      decision("excluded-credit", "not-income"),
      decision("excluded-debit", "not-income"),
    ];
    expect(calculateMonthlyIncome(transactions, classifications)).toEqual([]);
    expect(calculateMonthlyCategoryTotals(transactions)).toEqual([
      {
        month: "2026-10",
        currency: "AUD",
        debitTotal: new Money(300, "AUD"),
        creditTotal: new Money(800, "AUD"),
      },
    ]);
  });

  it("does not infer income from Category, Merchant, or descriptions", () => {
    const category = new Category({
      id: "salary",
      name: "Salary",
      status: "active",
    });
    const merchant = new Merchant({ id: "employer", displayName: "Employer" });
    const transactions = [
      transaction("unresolved", 1000, {
        categoryId: category.id,
        merchantId: merchant.id,
        rawDescription: "Salary payment",
      }),
      transaction("excluded", 1000, {
        categoryId: category.id,
        merchantId: merchant.id,
        rawDescription: "Income salary payment",
      }),
      transaction("explicit", -50, {
        categoryId: "unrelated",
        merchantId: "unrelated",
        rawDescription: "Uninformative description",
      }),
    ];
    expect(
      calculateMonthlyIncome(transactions, [
        decision("excluded", "not-income"),
        decision("explicit", "income"),
      ]),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(-50, "AUD") },
    ]);
  });

  it("excludes deliberately not-income credits without inferring transfer/refund kinds", () => {
    const transactions = [
      transaction("transfer", 1000, { rawDescription: "Internal transfer" }),
      transaction("refund", 200, { rawDescription: "Purchase refund" }),
      transaction("reimbursement", 300, { rawDescription: "Reimbursement" }),
    ];
    expect(
      calculateMonthlyIncome(
        transactions,
        transactions.map((item) => decision(item.id, "not-income")),
      ),
    ).toEqual([]);
    // Text alone cannot establish these economic kinds or classify income.
    expect(calculateMonthlyIncome(transactions, [])).toEqual([]);
  });

  it("accepts categorized and uncategorized income regardless of planning targets", () => {
    const incomeTarget = new CategoryBudget({
      categoryId: "planned-income",
      amount: new Money(5000, "AUD"),
      role: "income",
    });
    const spendingTarget = new CategoryBudget({
      categoryId: "planned-spending",
      amount: new Money(5000, "AUD"),
      role: "spending",
      spendingCharacter: "essential",
      spendingRegularity: "regular",
    });
    const transactions = [
      transaction("target-alone", 5000, {
        categoryId: incomeTarget.categoryId,
      }),
      transaction("spending-category", 100, {
        categoryId: spendingTarget.categoryId,
      }),
      transaction("no-target", 200, { categoryId: "other-category" }),
      transaction("uncategorized", 300),
    ];
    expect(
      calculateMonthlyIncome(
        transactions,
        classifyIncome(transactions.slice(1)),
      ),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(600, "AUD") },
    ]);
  });

  it("uses Gregorian posting months, ignoring transactionDate and current time", () => {
    const transactions = [
      transaction("october", 100, {
        postingDate: "2026-10-01",
        transactionDate: "2026-09-30",
      }),
      transaction("november", 200, {
        postingDate: "2026-11-01",
        transactionDate: "2026-10-31",
      }),
      transaction("earliest", 300, { postingDate: "0001-01-01" }),
      transaction("latest", 400, { postingDate: "9999-12-31" }),
      transaction("leap-day", 500, { postingDate: "2024-02-29" }),
    ];
    expect(
      calculateMonthlyIncome(transactions, classifyIncome(transactions)),
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
      transaction("aud", 1234),
      transaction("usd", 5678, { currency: "USD" }),
      transaction("jpy", -42, { currency: "JPY" }),
      transaction("bhd", 12345, { currency: "BHD" }),
      transaction("usd-adjustment", -678, { currency: "USD" }),
    ];
    expect(
      calculateMonthlyIncome(transactions, classifyIncome(transactions)),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(1234, "AUD") },
      { month: "2026-10", currency: "BHD", total: new Money(12345, "BHD") },
      { month: "2026-10", currency: "JPY", total: new Money(-42, "JPY") },
      { month: "2026-10", currency: "USD", total: new Money(5000, "USD") },
    ]);
  });

  it("omits empty and zero-only groups but retains nonzero activity that cancels", () => {
    expect(calculateMonthlyIncome([], [])).toEqual([]);
    const zeroOnly = [transaction("zero", 0), transaction("negative-zero", -0)];
    expect(calculateMonthlyIncome(zeroOnly, classifyIncome(zeroOnly))).toEqual(
      [],
    );
    const transactions = [
      transaction("positive", 100),
      transaction("negative", -100),
      transaction("zero", 0),
      transaction("zero-other-month", 0, { postingDate: "2026-11-01" }),
      transaction("zero-other-currency", 0, { currency: "USD" }),
    ];
    const results = calculateMonthlyIncome(
      transactions,
      classifyIncome(transactions),
    );
    expect(results).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(0, "AUD") },
    ]);
    expect(Object.is(results[0].total.amountMinor, -0)).toBe(false);
  });

  it.each([0, 100])(
    "rejects duplicate Transaction IDs even without decisions (%s)",
    (amount) => {
      const transactions = [
        transaction("duplicate", amount),
        transaction("duplicate", amount),
      ];
      expect(() => calculateMonthlyIncome(transactions, [])).toThrow(
        /unique Transaction IDs/,
      );
    },
  );

  it.each(["income", "not-income"] as const)(
    "rejects repeated and conflicting classification references (%s)",
    (classification) => {
      const transactions = [transaction("a", 0)];
      for (const other of ["income", "not-income"] as const) {
        expect(() =>
          calculateMonthlyIncome(transactions, [
            decision("a", classification),
            decision("a", other),
          ]),
        ).toThrow(/unique classification Transaction IDs/);
      }
    },
  );

  it.each(["income", "not-income"] as const)(
    "rejects dangling %s references rather than ignoring them",
    (classification) => {
      expect(() =>
        calculateMonthlyIncome([], [decision("missing", classification)]),
      ).toThrow(/refer to supplied Transactions/);
    },
  );

  it("matches opaque IDs exactly without trimming, case folding, or normalization", () => {
    const transactions = [
      transaction(" Tx:1/opaque \t", 100),
      transaction("tx:1/opaque", 200),
    ];
    expect(
      calculateMonthlyIncome(transactions, [
        decision(" Tx:1/opaque \t", "income"),
      ]),
    ).toEqual([
      { month: "2026-10", currency: "AUD", total: new Money(100, "AUD") },
    ]);
    expect(() =>
      calculateMonthlyIncome(transactions, [decision("Tx:1/opaque", "income")]),
    ).toThrow(/refer to supplied Transactions/);
  });

  it.each([1, -1])(
    "accumulates exactly to the safe integer boundary (%s)",
    (sign) => {
      const transactions = [
        transaction("a", sign * (Number.MAX_SAFE_INTEGER - 1)),
        transaction("b", sign),
      ];
      expect(
        calculateMonthlyIncome(transactions, classifyIncome(transactions)),
      ).toEqual([
        {
          month: "2026-10",
          currency: "AUD",
          total: new Money(sign * Number.MAX_SAFE_INTEGER, "AUD"),
        },
      ]);
    },
  );

  it.each([1, -1])(
    "rejects signed overflow before addition in either order (%s)",
    (sign) => {
      const transactions = [
        transaction("a", sign * Number.MAX_SAFE_INTEGER),
        transaction("b", sign),
      ];
      for (const input of [transactions, [...transactions].reverse()]) {
        expect(() =>
          calculateMonthlyIncome(input, classifyIncome(input)),
        ).toThrow(RangeError);
      }
      const laterCancellation = [...transactions, transaction("c", -sign)];
      expect(() =>
        calculateMonthlyIncome(
          laterCancellation,
          classifyIncome(laterCancellation),
        ),
      ).toThrow(RangeError);
    },
  );

  it("checks overflow per month and currency, without cross-currency summation", () => {
    const transactions = [
      transaction("aud", Number.MAX_SAFE_INTEGER),
      transaction("usd", Number.MAX_SAFE_INTEGER, { currency: "USD" }),
      transaction("next-month", Number.MAX_SAFE_INTEGER, {
        postingDate: "2026-11-01",
      }),
    ];
    expect(
      calculateMonthlyIncome(transactions, classifyIncome(transactions)),
    ).toHaveLength(3);
  });

  it("sorts deterministically by month then currency, independently of input order", () => {
    const transactions = [
      transaction("november", 40, { postingDate: "2026-11-01" }),
      transaction("usd", 30, { currency: "USD" }),
      transaction("bhd", 20, { currency: "BHD" }),
      transaction("aud", 10),
    ];
    const expected = [
      { month: "2026-10", currency: "AUD", total: new Money(10, "AUD") },
      { month: "2026-10", currency: "BHD", total: new Money(20, "BHD") },
      { month: "2026-10", currency: "USD", total: new Money(30, "USD") },
      { month: "2026-11", currency: "AUD", total: new Money(40, "AUD") },
    ];
    const classifications = classifyIncome(transactions);
    expect(calculateMonthlyIncome(transactions, classifications)).toEqual(
      expected,
    );
    expect(
      calculateMonthlyIncome(
        [...transactions].reverse(),
        [...classifications].reverse(),
      ),
    ).toEqual(expected);
  });

  it("preserves input arrays and values and returns frozen records, Money, and array", () => {
    const transactions = Object.freeze([
      transaction("b", -100),
      transaction("a", 300),
    ]);
    const classifications = Object.freeze(classifyIncome(transactions));
    const transactionSnapshot = transactions.map((item) => ({ ...item }));
    const classificationSnapshot = classifications.map((item) => ({ ...item }));
    const amounts = transactions.map((item) => item.amount);
    const results = calculateMonthlyIncome(transactions, classifications);
    expect(transactions).toEqual(transactionSnapshot);
    expect(classifications).toEqual(classificationSnapshot);
    transactions.forEach((item, index) =>
      expect(item.amount).toBe(amounts[index]),
    );
    expect(Object.isFrozen(results)).toBe(true);
    expect(Reflect.set(results, "0", {})).toBe(false);
    for (const result of results) {
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.total)).toBe(true);
      expect(Reflect.set(result, "month", "2000-01")).toBe(false);
      expect(Reflect.set(result.total, "amountMinor", 999)).toBe(false);
    }
    expect(results[0].total).toEqual(new Money(200, "AUD"));
    expect(Object.isFrozen(calculateMonthlyIncome([], []))).toBe(true);
  });
});
