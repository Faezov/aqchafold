import { Money, Transaction } from "@aqchafold/domain";
import { describe, expect, it } from "vitest";
import { calculateMonthlyCategoryTotals } from "./index";

function transaction(
  amountMinor: number,
  options: {
    id?: string;
    postingDate?: string;
    transactionDate?: string;
    categoryId?: string;
    currency?: string;
    merchantId?: string;
    rawDescription?: string;
  } = {},
): Transaction {
  const { currency = "AUD", ...fields } = options;
  return new Transaction({
    id: "synthetic-transaction",
    accountId: "synthetic-account",
    postingDate: "2026-10-05",
    categoryId: "category-1",
    origin: "manual",
    amount: new Money(amountMinor, currency),
    ...fields,
  });
}

describe("calculateMonthlyCategoryTotals", () => {
  it.each([
    [-1234, 1234, 0],
    [1234, 0, 1234],
  ])(
    "totals one signed %s movement as separate Money magnitudes",
    (amount, debit, credit) => {
      const result = calculateMonthlyCategoryTotals([transaction(amount)]);
      expect(result).toEqual([
        {
          month: "2026-10",
          categoryId: "category-1",
          currency: "AUD",
          debitTotal: new Money(debit, "AUD"),
          creditTotal: new Money(credit, "AUD"),
        },
      ]);
      expect(result[0].debitTotal).toBeInstanceOf(Money);
      expect(result[0].creditTotal).toBeInstanceOf(Money);
    },
  );

  it("sums several debits and credits exactly without either reducing the other", () => {
    const [total] = calculateMonthlyCategoryTotals(
      [-1234, 200, -66, 300].map((amount) => transaction(amount)),
    );
    expect(total.debitTotal.equals(new Money(1300, "AUD"))).toBe(true);
    expect(total.creditTotal.equals(new Money(500, "AUD"))).toBe(true);
  });

  it("separates Gregorian months across leap days, years, and the supported date range", () => {
    const dates = [
      "0001-01-01",
      "2024-02-29",
      "2026-09-30",
      "2026-10-01",
      "2027-01-01",
      "9999-12-31",
    ];
    const result = calculateMonthlyCategoryTotals(
      dates.map((postingDate) => transaction(-1, { postingDate })),
    );
    expect(result.map((total) => total.month)).toEqual([
      "0001-01",
      "2024-02",
      "2026-09",
      "2026-10",
      "2027-01",
      "9999-12",
    ]);
    expect(result.every((total) => total.debitTotal.amountMinor === 1)).toBe(
      true,
    );
  });

  it("uses postingDate even when transactionDate falls in an earlier or later month", () => {
    const result = calculateMonthlyCategoryTotals([
      transaction(-100, {
        postingDate: "2026-11-01",
        transactionDate: "2026-10-31",
      }),
      transaction(50, {
        postingDate: "2026-10-31",
        transactionDate: "2026-11-01",
      }),
    ]);
    expect(
      result.map(({ month, debitTotal, creditTotal }) => [
        month,
        debitTotal.amountMinor,
        creditTotal.amountMinor,
      ]),
    ).toEqual([
      ["2026-10", 0, 50],
      ["2026-11", 100, 0],
    ]);
  });

  it("preserves distinct opaque Category IDs without trimming or inferred identity", () => {
    const categoryIds = [
      ' category|"/Å:42\t ',
      'category|"/Å:42',
      "uncategorized",
    ];
    const result = calculateMonthlyCategoryTotals(
      categoryIds.map((categoryId) => transaction(-1, { categoryId })),
    );
    expect(result.map((total) => total.categoryId)).toEqual(
      [...categoryIds].sort(),
    );
    expect(result.every((total) => total.debitTotal.amountMinor === 1)).toBe(
      true,
    );
  });

  it("returns uncategorized activity without a fake ID or category inference", () => {
    const result = calculateMonthlyCategoryTotals([
      transaction(-100, {
        categoryId: undefined,
        merchantId: "merchant-1",
        rawDescription: "Synthetic groceries",
      }),
      transaction(50, { categoryId: undefined }),
      transaction(-25, { categoryId: "uncategorized" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].categoryId).toBe("uncategorized");
    expect(result[0].debitTotal.amountMinor).toBe(25);
    expect(result[1].categoryId).toBeUndefined();
    expect("categoryId" in result[1]).toBe(false);
    expect(result[1].debitTotal.amountMinor).toBe(100);
    expect(result[1].creditTotal.amountMinor).toBe(50);
  });

  it("keeps currencies separate without FX or decimal-scale assumptions", () => {
    const currencies = ["USD", "JPY", "BHD", "AUD", "ZZZ"];
    const result = calculateMonthlyCategoryTotals(
      currencies.flatMap((currency) => [
        transaction(-123, { currency }),
        transaction(7, { currency }),
      ]),
    );
    expect(result.map((total) => total.currency)).toEqual(
      [...currencies].sort(),
    );
    for (const total of result) {
      expect(total.debitTotal.equals(new Money(123, total.currency))).toBe(
        true,
      );
      expect(total.creditTotal.equals(new Money(7, total.currency))).toBe(true);
    }
  });

  it("returns no groups for empty input or zero-only activity", () => {
    for (const input of [
      [],
      [transaction(0)],
      [transaction(-0, { categoryId: undefined, currency: "JPY" })],
    ]) {
      expect(calculateMonthlyCategoryTotals(input)).toEqual([]);
    }
  });

  it("ignores zero in existing groups and does not create new zero-only groups", () => {
    const input = [transaction(-100), transaction(50)];
    expect(
      calculateMonthlyCategoryTotals([
        transaction(0),
        ...input,
        transaction(-0, {
          postingDate: "2026-11-01",
          currency: "JPY",
          categoryId: undefined,
        }),
      ]),
    ).toEqual(calculateMonthlyCategoryTotals(input));
  });

  it.each([-1, 1])(
    "allows exact safe-limit accumulation for direction %s in either order",
    (direction) => {
      const input = [
        transaction(direction * (Number.MAX_SAFE_INTEGER - 1)),
        transaction(direction),
      ];
      for (const values of [input, [...input].reverse()]) {
        const [total] = calculateMonthlyCategoryTotals(values);
        expect(
          total[direction < 0 ? "debitTotal" : "creditTotal"].amountMinor,
        ).toBe(Number.MAX_SAFE_INTEGER);
      }
    },
  );

  it.each([-1, 1])(
    "rejects overflow for direction %s in either order without changing inputs",
    (direction) => {
      const input = [
        transaction(direction * Number.MAX_SAFE_INTEGER),
        transaction(direction),
      ];
      for (const values of [input, [...input].reverse()]) {
        expect(() => calculateMonthlyCategoryTotals(values)).toThrow(
          RangeError,
        );
      }
      expect(input.map((value) => value.amount.amountMinor)).toEqual([
        direction * Number.MAX_SAFE_INTEGER,
        direction,
      ]);
    },
  );

  it("allows independent maximum magnitudes across directions and every grouping key", () => {
    const result = calculateMonthlyCategoryTotals([
      transaction(-Number.MAX_SAFE_INTEGER),
      transaction(Number.MAX_SAFE_INTEGER),
      transaction(-Number.MAX_SAFE_INTEGER, { currency: "JPY" }),
      transaction(-Number.MAX_SAFE_INTEGER, { categoryId: "category-2" }),
      transaction(-Number.MAX_SAFE_INTEGER, { postingDate: "2026-11-01" }),
    ]);
    expect(result).toHaveLength(4);
    expect(
      result.every(
        (total) => total.debitTotal.amountMinor === Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(true);
    expect(result[0].creditTotal.amountMinor).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("orders by month, categorized IDs, then currency, with uncategorized last in each month", () => {
    const input = [
      transaction(-1, { postingDate: "2026-11-01" }),
      transaction(-1, { categoryId: undefined, currency: "USD" }),
      transaction(-1, { categoryId: "a", currency: "USD" }),
      transaction(-1, { categoryId: "Z", currency: "JPY" }),
      transaction(-1, { categoryId: undefined }),
      transaction(-1, { categoryId: "a" }),
      transaction(-1, { categoryId: "Z" }),
      transaction(-1, { postingDate: "2026-09-30", categoryId: undefined }),
    ];
    const expected = [
      ["2026-09", undefined, "AUD"],
      ["2026-10", "Z", "AUD"],
      ["2026-10", "Z", "JPY"],
      ["2026-10", "a", "AUD"],
      ["2026-10", "a", "USD"],
      ["2026-10", undefined, "AUD"],
      ["2026-10", undefined, "USD"],
      ["2026-11", "category-1", "AUD"],
    ];
    for (const values of [
      input,
      [...input].reverse(),
      [...input.slice(3), ...input.slice(0, 3)],
    ]) {
      expect(
        calculateMonthlyCategoryTotals(values).map(
          ({ month, categoryId, currency }) => [month, categoryId, currency],
        ),
      ).toEqual(expected);
    }
  });

  it.each(["salary", "purchase refund", "reimbursement", "internal transfer"])(
    "includes raw %s activity without interpreting descriptions",
    (rawDescription) => {
      const [total] = calculateMonthlyCategoryTotals([
        transaction(-100, { rawDescription }),
        transaction(75, { rawDescription }),
      ]);
      expect(total.debitTotal.amountMinor).toBe(100);
      expect(total.creditTotal.amountMinor).toBe(75);
      expect(total).not.toHaveProperty("spending");
      expect(total).not.toHaveProperty("income");
    },
  );

  it("preserves readonly input records and order, and freezes all returned values", () => {
    const input = Object.freeze([
      transaction(50, {
        id: "later",
        postingDate: "2026-11-01",
        transactionDate: "2026-10-31",
        merchantId: "merchant-1",
        rawDescription: "Synthetic credit",
      }),
      transaction(-100, { id: "earlier" }),
    ]);
    const before = input.map((value) => ({ ...value }));
    const result = calculateMonthlyCategoryTotals(input);
    expect(input.map((value) => ({ ...value }))).toEqual(before);
    expect(input.map((value) => value.id)).toEqual(["later", "earlier"]);
    expect(input[0].amount).toBe(before[0].amount);
    expect(input[1].amount).toBe(before[1].amount);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, "0", undefined)).toBe(false);
    for (const total of result) {
      expect(Object.isFrozen(total)).toBe(true);
      expect(Object.isFrozen(total.debitTotal)).toBe(true);
      expect(Object.isFrozen(total.creditTotal)).toBe(true);
      expect(Reflect.set(total, "categoryId", "changed")).toBe(false);
      expect(Reflect.set(total.debitTotal, "amountMinor", 0)).toBe(false);
      expect(Reflect.set(total.creditTotal, "currency", "USD")).toBe(false);
    }
  });
});
