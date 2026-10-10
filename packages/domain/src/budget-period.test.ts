import { describe, expect, it } from "vitest";
import { BudgetPeriod, Money, Transaction } from "./index";

const baseOptions = { startDate: "2026-10-15", endDate: "2026-11-14" };

describe("BudgetPeriod", () => {
  it("supports a one-day period with inclusive boundaries", () => {
    const period = new BudgetPeriod({
      startDate: "2024-02-29",
      endDate: "2024-02-29",
    });
    expect(period.contains("2024-02-29")).toBe(true);
    expect(period.contains("2024-02-28")).toBe(false);
    expect(period.contains("2024-03-01")).toBe(false);
  });

  it("includes both edges and interior dates in an arbitrary multi-day range", () => {
    const period = new BudgetPeriod(baseOptions);
    for (const date of ["2026-10-15", "2026-10-31", "2026-11-14"]) {
      expect(period.contains(date)).toBe(true);
    }
    expect(period.contains("2026-10-14")).toBe(false);
    expect(period.contains("2026-11-15")).toBe(false);
  });

  it("supports year boundaries, historical and future dates, and overlapping ranges", () => {
    const period = new BudgetPeriod({
      startDate: "0001-01-01",
      endDate: "9999-12-31",
    });
    const overlapping = new BudgetPeriod({
      startDate: "2025-12-31",
      endDate: "2026-01-01",
    });
    for (const date of [
      "0001-01-01",
      "2025-12-31",
      "2026-01-01",
      "9999-12-31",
    ]) {
      expect(period.contains(date)).toBe(true);
    }
    expect(overlapping.contains("2025-12-31")).toBe(true);
    expect(overlapping.contains("2026-01-01")).toBe(true);
  });

  it.each(["2024-02-29", "2000-02-29", "2400-02-29", "1900-02-28"])(
    "preserves valid Gregorian date %s in construction and membership",
    (date) => {
      const period = new BudgetPeriod({ startDate: date, endDate: date });
      expect(period.startDate).toBe(date);
      expect(period.endDate).toBe(date);
      expect(period.contains(date)).toBe(true);
    },
  );

  it("rejects impossible Gregorian dates in either boundary and in membership", () => {
    const period = new BudgetPeriod(baseOptions);
    for (const date of [
      "2026-02-29",
      "1900-02-29",
      "2100-02-29",
      "2026-02-30",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
      "0000-01-01",
    ]) {
      for (const field of ["startDate", "endDate"] as const) {
        expect(
          () => new BudgetPeriod({ ...baseOptions, [field]: date }),
        ).toThrow(RangeError);
      }
      expect(() => period.contains(date)).toThrow(RangeError);
    }
  });

  it("rejects noncanonical date shapes and types without normalization", () => {
    const period = new BudgetPeriod(baseOptions);
    for (const date of [
      "",
      "2026-2-28",
      "05/10/2026",
      "10000-01-01",
      "2026-10-05T00:00:00Z",
      " 2026-10-05",
      "2026-10-05 ",
      "2026-10-05\n",
      undefined,
      null,
      123,
    ]) {
      for (const field of ["startDate", "endDate"] as const) {
        expect(() =>
          Reflect.construct(BudgetPeriod, [{ ...baseOptions, [field]: date }]),
        ).toThrow(TypeError);
      }
      expect(() => Reflect.apply(period.contains, period, [date])).toThrow(
        TypeError,
      );
    }
  });

  it("rejects reversed boundaries without sorting or mutating the input", () => {
    const options = { startDate: "2026-11-14", endDate: "2026-10-15" };
    expect(() => new BudgetPeriod(options)).toThrow(RangeError);
    expect(options).toEqual({ startDate: "2026-11-14", endDate: "2026-10-15" });
  });

  it("requires explicit options and both dates without defaults", () => {
    for (const options of [
      undefined,
      null,
      123,
      "2026-10",
      true,
      {},
      { startDate: baseOptions.startDate },
      { endDate: baseOptions.endDate },
    ]) {
      expect(() => Reflect.construct(BudgetPeriod, [options])).toThrow(
        TypeError,
      );
    }
  });

  it("uses the supplied posting date without substituting a transaction date", () => {
    const period = new BudgetPeriod({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    const transaction = new Transaction({
      id: "tx-1",
      accountId: "account-1",
      postingDate: "2026-11-01",
      transactionDate: "2026-10-31",
      amount: new Money(-1000, "AUD"),
      origin: "manual",
    });
    expect(period.contains(transaction.postingDate)).toBe(false);
    expect(transaction.transactionDate).toBe("2026-10-31");
    expect(transaction.postingDate).toBe("2026-11-01");
  });

  it("copies explicit dates without mutating or freezing options and freezes the value", () => {
    const options = { ...baseOptions };
    const period = new BudgetPeriod(options);
    expect(options).toEqual(baseOptions);
    expect(Object.isFrozen(options)).toBe(false);
    options.startDate = "2026-10-16";
    options.endDate = "2026-11-13";
    for (const field of ["startDate", "endDate"] as const) {
      expect(Reflect.set(period, field, "2026-10-20")).toBe(false);
      expect(
        Reflect.defineProperty(period, field, { value: "2026-10-20" }),
      ).toBe(false);
      expect(Reflect.deleteProperty(period, field)).toBe(false);
    }
    expect(Reflect.set(period, "amountMinor", 1000)).toBe(false);
    expect(Object.isFrozen(period)).toBe(true);
    expect(period.startDate).toBe(baseOptions.startDate);
    expect(period.endDate).toBe(baseOptions.endDate);
    expect(new BudgetPeriod(Object.freeze({ ...baseOptions }))).toEqual(period);
  });
});
