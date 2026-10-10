import { describe, expect, it } from "vitest";
import {
  TransactionSpendingClassification,
  type TransactionSpendingClassificationOptions,
} from "./index";

const baseOptions: TransactionSpendingClassificationOptions = {
  transactionId: "transaction-1",
  classification: "spending",
};

describe("TransactionSpendingClassification", () => {
  it.each(["spending", "not-spending"] as const)(
    "retains an explicit %s decision and the exact opaque Transaction ID",
    (classification) => {
      const decision = new TransactionSpendingClassification({
        transactionId: " transaction:1/opaque \t",
        classification,
      });
      expect(decision.transactionId).toBe(" transaction:1/opaque \t");
      expect(decision.classification).toBe(classification);
      expect(Object.keys(decision).sort()).toEqual([
        "classification",
        "transactionId",
      ]);
    },
  );

  it("rejects missing or non-object constructor options", () => {
    for (const options of [undefined, null, 123, "spending", true]) {
      expect(() =>
        Reflect.construct(TransactionSpendingClassification, [options]),
      ).toThrow(TypeError);
    }
  });

  it("requires a nonblank string Transaction ID without defaults", () => {
    expect(() =>
      Reflect.construct(TransactionSpendingClassification, [
        { classification: "spending" },
      ]),
    ).toThrow(TypeError);
    for (const transactionId of [undefined, "", " \t\n ", null, 123, true]) {
      expect(() =>
        Reflect.construct(TransactionSpendingClassification, [
          { ...baseOptions, transactionId },
        ]),
      ).toThrow(TypeError);
    }
  });

  it("requires an exact supported classification without defaulting or adding unresolved", () => {
    expect(() =>
      Reflect.construct(TransactionSpendingClassification, [
        { transactionId: "transaction-1" },
      ]),
    ).toThrow(TypeError);
    for (const classification of [
      undefined,
      null,
      "",
      "unresolved",
      "income",
      "Spending",
      "NOT-SPENDING",
      " spending ",
      "not-spending ",
      123,
      true,
    ]) {
      expect(() =>
        Reflect.construct(TransactionSpendingClassification, [
          { ...baseOptions, classification },
        ]),
      ).toThrow(TypeError);
    }
  });

  it("preserves constructor input and requires a new frozen value to change the decision", () => {
    const options = { ...baseOptions };
    const decision = new TransactionSpendingClassification(options);
    expect(options).toEqual(baseOptions);
    expect(Object.isFrozen(options)).toBe(false);
    options.transactionId = "changed";
    options.classification = "not-spending";
    const changed = new TransactionSpendingClassification({
      ...decision,
      classification: "not-spending",
    });

    for (const field of ["transactionId", "classification"] as const) {
      expect(Reflect.set(decision, field, "changed")).toBe(false);
      expect(
        Reflect.defineProperty(decision, field, { value: "changed" }),
      ).toBe(false);
      expect(Reflect.deleteProperty(decision, field)).toBe(false);
    }
    expect(Object.isFrozen(decision)).toBe(true);
    expect(decision).toEqual(baseOptions);
    expect(changed).not.toBe(decision);
    expect(changed.transactionId).toBe(decision.transactionId);
    expect(changed.classification).toBe("not-spending");
  });
});
