import { describe, expect, it } from "vitest";
import { CategoryBudget, Money, type CategoryBudgetOptions } from "./index";

const baseOptions: CategoryBudgetOptions = {
  categoryId: "category-1",
  amount: new Money(1234, "AUD"),
  role: "spending",
};

describe("CategoryBudget", () => {
  it.each(["spending", "income"] as const)(
    "retains an explicit %s target with its supplied Money",
    (role) => {
      const target = new CategoryBudget({ ...baseOptions, role });
      expect(target.categoryId).toBe(baseOptions.categoryId);
      expect(target.role).toBe(role);
      expect(target.amount).toBe(baseOptions.amount);
      expect(target.amount.amountMinor).toBe(1234);
      expect(target.amount.currency).toBe("AUD");
    },
  );

  it("preserves opaque category IDs exactly without requiring category metadata", () => {
    const categoryId = "  opaque/category:42\t ";
    expect(new CategoryBudget({ ...baseOptions, categoryId }).categoryId).toBe(
      categoryId,
    );
  });

  it("rejects blank or non-string category IDs", () => {
    for (const categoryId of ["", " \t\n ", null, 123]) {
      expect(() =>
        Reflect.construct(CategoryBudget, [{ ...baseOptions, categoryId }]),
      ).toThrow(TypeError);
    }
  });

  it("requires object options and every field without defaults", () => {
    for (const options of [undefined, null, 123, "category-1", true]) {
      expect(() => Reflect.construct(CategoryBudget, [options])).toThrow(
        TypeError,
      );
    }
    for (const field of ["categoryId", "amount", "role"] as const) {
      const options = { ...baseOptions };
      Reflect.deleteProperty(options, field);
      expect(() => Reflect.construct(CategoryBudget, [options])).toThrow(
        TypeError,
      );
    }
  });

  it("requires a Money instance rather than inferring an amount or currency", () => {
    for (const amount of [
      undefined,
      null,
      1234,
      "12.34",
      { amountMinor: 1234, currency: "AUD" },
      { amountMinor: 1234 },
    ]) {
      expect(() =>
        Reflect.construct(CategoryBudget, [{ ...baseOptions, amount }]),
      ).toThrow(TypeError);
    }
  });

  it("rejects unsupported roles without deriving or normalizing them", () => {
    for (const role of [
      undefined,
      null,
      "",
      "expense",
      "Spending",
      " income ",
      123,
    ]) {
      expect(() =>
        Reflect.construct(CategoryBudget, [{ ...baseOptions, role }]),
      ).toThrow(TypeError);
    }
  });

  it.each(["spending", "income"] as const)(
    "allows an explicit zero %s target",
    (role) => {
      const amount = new Money(-0, "JPY");
      const target = new CategoryBudget({ ...baseOptions, amount, role });
      expect(target.amount).toBe(amount);
      expect(Object.is(target.amount.amountMinor, 0)).toBe(true);
      expect(target.amount.currency).toBe("JPY");
    },
  );

  it.each(["spending", "income"] as const)(
    "rejects negative %s targets without changing Money",
    (role) => {
      const amount = new Money(-1, "AUD");
      expect(
        () => new CategoryBudget({ ...baseOptions, amount, role }),
      ).toThrow(RangeError);
      expect(amount.amountMinor).toBe(-1);
      expect(amount.currency).toBe("AUD");
    },
  );

  it("accepts different Money currencies without conversion or minor-unit scale assumptions", () => {
    for (const currency of ["AUD", "USD", "JPY", "BHD", "ZZZ"]) {
      const amount = new Money(Number.MAX_SAFE_INTEGER, currency);
      const target = new CategoryBudget({ ...baseOptions, amount });
      expect(target.amount).toBe(amount);
      expect(target.amount.amountMinor).toBe(Number.MAX_SAFE_INTEGER);
      expect(target.amount.currency).toBe(currency);
    }
  });

  it("preserves inputs and freezes the target and its retained Money", () => {
    const options = { ...baseOptions };
    const target = new CategoryBudget(options);
    expect(options).toEqual(baseOptions);
    expect(Object.isFrozen(options)).toBe(false);
    options.categoryId = "changed";
    options.amount = new Money(0, "USD");
    options.role = "income";
    for (const field of ["categoryId", "amount", "role"] as const) {
      expect(Reflect.set(target, field, undefined)).toBe(false);
      expect(Reflect.defineProperty(target, field, { value: undefined })).toBe(
        false,
      );
      expect(Reflect.deleteProperty(target, field)).toBe(false);
    }
    expect(Reflect.set(target, "period", {})).toBe(false);
    expect(Reflect.set(target.amount, "amountMinor", 0)).toBe(false);
    expect(Reflect.set(target.amount, "currency", "USD")).toBe(false);
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target.amount)).toBe(true);
    expect(target.categoryId).toBe(baseOptions.categoryId);
    expect(target.role).toBe(baseOptions.role);
    expect(target.amount).toBe(baseOptions.amount);
    expect(target.amount.amountMinor).toBe(1234);
    expect(target.amount.currency).toBe("AUD");
  });
});
