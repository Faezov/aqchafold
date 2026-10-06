import { describe, expect, it } from "vitest";
import { formatTransactionAmount } from "./format-transaction-amount";

describe("Transaction amount presentation", () => {
  it.each([
    [0, "AUD 0.00"],
    [-0, "AUD 0.00"],
    [1, "AUD +0.01"],
    [-1, "AUD -0.01"],
    [99, "AUD +0.99"],
    [-100, "AUD -1.00"],
    [101, "AUD +1.01"],
    [-1234, "AUD -12.34"],
    [Number.MAX_SAFE_INTEGER, "AUD +90071992547409.91"],
    [Number.MIN_SAFE_INTEGER, "AUD -90071992547409.91"],
  ] as const)("displays %s AUD minor units exactly", (amount, expected) => {
    expect(formatTransactionAmount(amount, "AUD")).toBe(expected);
  });

  it.each([
    [1234, "USD", "USD +1234 minor units"],
    [-1234, "JPY", "JPY -1234 minor units"],
    [1, "KWD", "KWD +1 minor units"],
    [0, "XXX", "XXX 0 minor units"],
  ] as const)(
    "retains %s %s minor units without guessing currency scale",
    (amount, currency, expected) => {
      expect(formatTransactionAmount(amount, currency)).toBe(expected);
    },
  );

  it.each([0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "refuses invalid monetary input %s instead of rounding it",
    (amount) => {
      expect(() => formatTransactionAmount(amount, "AUD")).toThrow(RangeError);
    },
  );
});
