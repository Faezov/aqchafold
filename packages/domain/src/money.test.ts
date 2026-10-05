import { describe, expect, it } from "vitest";
import { Money } from "./index";

describe("Money", () => {
  it("creates signed safe-integer amounts in an explicit currency", () => {
    for (const amount of [
      1234,
      -1234,
      0,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ]) {
      const money = new Money(amount, "AUD");
      expect(money.amountMinor).toBe(amount);
      expect(money.currency).toBe("AUD");
    }
  });

  it("canonicalizes negative zero and arithmetic zero", () => {
    const value = new Money(-100, "AUD");
    for (const zero of [
      new Money(-0, "AUD"),
      value.add(new Money(100, "AUD")),
      value.subtract(value),
    ]) {
      expect(Object.is(zero.amountMinor, 0)).toBe(true);
      expect(zero.equals(new Money(0, "AUD"))).toBe(true);
    }
  });

  it("rejects fractional, nonfinite, and unsafe amounts without rounding", () => {
    for (const amount of [
      1.5,
      12.7,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MIN_SAFE_INTEGER - 1,
    ]) {
      expect(() => new Money(amount, "AUD")).toThrow(RangeError);
    }
  });

  it("rejects missing or non-number amounts at runtime", () => {
    for (const amount of [undefined, null, "1234"]) {
      expect(() => Reflect.construct(Money, [amount, "AUD"])).toThrow(
        RangeError,
      );
    }
  });

  it("accepts explicit uppercase codes without assuming a currency registry", () => {
    for (const currency of ["AUD", "USD", "JPY", "ZZZ"]) {
      expect(new Money(1234, currency).currency).toBe(currency);
    }
  });

  it("rejects malformed, missing, or non-string currencies without normalization", () => {
    for (const currency of [
      "aud",
      "Aud",
      "",
      "AU",
      "AUDD",
      " AUD",
      "AUD ",
      "AUD\n",
      "AUD\r",
      "$",
      "A1D",
      "ÅUD",
      "ＡＵＤ",
      undefined,
      null,
      123,
    ]) {
      expect(() => Reflect.construct(Money, [1234, currency])).toThrow(
        TypeError,
      );
    }
    expect(() => Reflect.construct(Money, [1234])).toThrow(TypeError);
  });

  it("compares equality by amount and currency independently of identity", () => {
    for (const [left, leftCurrency, right, rightCurrency, equal] of [
      [1234, "AUD", 1234, "AUD", true],
      [1234, "AUD", 1235, "AUD", false],
      [1234, "AUD", 1234, "USD", false],
      [0, "AUD", 0, "USD", false],
    ] as const) {
      expect(
        new Money(left, leftCurrency).equals(new Money(right, rightCurrency)),
      ).toBe(equal);
    }
  });

  it("adds exact signed minor units in the same currency", () => {
    for (const [left, right, expected] of [
      [1234, 566, 1800],
      [-1234, 234, -1000],
      [Number.MAX_SAFE_INTEGER, -1, Number.MAX_SAFE_INTEGER - 1],
    ]) {
      const result = new Money(left, "USD").add(new Money(right, "USD"));
      expect(result.amountMinor).toBe(expected);
      expect(result.currency).toBe("USD");
    }
  });

  it("subtracts exact signed minor units in the same currency", () => {
    for (const [left, right, expected] of [
      [1234, 234, 1000],
      [-1234, 234, -1468],
      [-100, -300, 200],
    ]) {
      const result = new Money(left, "AUD").subtract(new Money(right, "AUD"));
      expect(result.amountMinor).toBe(expected);
      expect(result.currency).toBe("AUD");
    }
  });

  it.each(["add", "subtract", "compare"] as const)(
    "rejects cross-currency %s",
    (operation) => {
      expect(() => new Money(0, "AUD")[operation](new Money(0, "USD"))).toThrow(
        RangeError,
      );
    },
  );

  it.each([
    ["add", Number.MAX_SAFE_INTEGER, 1],
    ["add", Number.MIN_SAFE_INTEGER, -1],
    ["subtract", Number.MAX_SAFE_INTEGER, -1],
    ["subtract", Number.MIN_SAFE_INTEGER, 1],
  ] as const)(
    "rejects unsafe %s results for %s and %s minor units",
    (operation, left, right) => {
      expect(() =>
        new Money(left, "AUD")[operation](new Money(right, "AUD")),
      ).toThrow(RangeError);
    },
  );

  it("orders same-currency signed amounts, including opposite safe limits", () => {
    for (const [left, right, expected] of [
      [-100, 100, -1],
      [0, 0, 0],
      [100, -100, 1],
      [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -1],
      [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 1],
    ]) {
      expect(new Money(left, "AUD").compare(new Money(right, "AUD"))).toBe(
        expected,
      );
    }
  });

  it("returns new arithmetic values without changing either operand", () => {
    const left = new Money(100, "AUD");
    const right = new Money(50, "AUD");
    const sum = left.add(right);
    const difference = left.subtract(right);
    expect(sum.equals(new Money(150, "AUD"))).toBe(true);
    expect(difference.equals(new Money(50, "AUD"))).toBe(true);
    expect(sum).not.toBe(left);
    expect(difference).not.toBe(right);
    expect(left.amountMinor).toBe(100);
    expect(right.amountMinor).toBe(50);
  });

  it("prevents mutation and redefinition of established amount and currency", () => {
    const money = new Money(1234, "AUD");
    expect(Reflect.set(money, "amountMinor", 999)).toBe(false);
    expect(Reflect.set(money, "currency", "USD")).toBe(false);
    expect(Reflect.defineProperty(money, "amountMinor", { value: 999 })).toBe(
      false,
    );
    expect(Reflect.defineProperty(money, "currency", { value: "USD" })).toBe(
      false,
    );
    expect(money.amountMinor).toBe(1234);
    expect(money.currency).toBe("AUD");
  });
});
