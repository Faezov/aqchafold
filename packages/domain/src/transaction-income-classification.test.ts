import { describe, expect, it } from "vitest";
import {
  TransactionIncomeClassification,
  type TransactionIncomeClassificationOptions,
} from "./index";

const baseOptions: TransactionIncomeClassificationOptions = {
  transactionId: "transaction-1",
  classification: "income",
};

describe("TransactionIncomeClassification", () => {
  it.each(["income", "not-income"] as const)(
    "retains an explicit %s decision and the exact opaque Transaction ID",
    (classification) => {
      const decision = new TransactionIncomeClassification({
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
    for (const options of [undefined, null, 123, "income", true]) {
      expect(() =>
        Reflect.construct(TransactionIncomeClassification, [options]),
      ).toThrow(TypeError);
    }
  });

  it("requires a nonblank string Transaction ID without defaults", () => {
    expect(() =>
      Reflect.construct(TransactionIncomeClassification, [
        { classification: "income" },
      ]),
    ).toThrow(TypeError);
    for (const transactionId of [undefined, "", " \t\n ", null, 123, true]) {
      expect(() =>
        Reflect.construct(TransactionIncomeClassification, [
          { ...baseOptions, transactionId },
        ]),
      ).toThrow(TypeError);
    }
  });

  it("requires an exact supported classification without defaulting or adding unresolved", () => {
    expect(() =>
      Reflect.construct(TransactionIncomeClassification, [
        { transactionId: "transaction-1" },
      ]),
    ).toThrow(TypeError);
    for (const classification of [
      undefined,
      null,
      "",
      "unresolved",
      "spending",
      "Income",
      "NOT-INCOME",
      " income ",
      "not-income ",
      123,
      true,
    ]) {
      expect(() =>
        Reflect.construct(TransactionIncomeClassification, [
          { ...baseOptions, classification },
        ]),
      ).toThrow(TypeError);
    }
  });

  it("preserves constructor input and requires a new frozen value to change the decision", () => {
    const options = { ...baseOptions };
    const decision = new TransactionIncomeClassification(options);
    expect(options).toEqual(baseOptions);
    expect(Object.isFrozen(options)).toBe(false);
    options.transactionId = "changed";
    options.classification = "not-income";
    const changed = new TransactionIncomeClassification({
      ...decision,
      classification: "not-income",
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
    expect(changed.classification).toBe("not-income");
  });
});
