import { describe, expect, expectTypeOf, it } from "vitest";
import { CategoryBudget, Money, type CategoryBudgetOptions } from "./index";

const baseOptions: CategoryBudgetOptions = {
  categoryId: "category-1",
  amount: new Money(1234, "AUD"),
  role: "spending",
  spendingCharacter: "essential",
};

const validTargets: [string, CategoryBudgetOptions][] = [
  ["essential spending", baseOptions],
  [
    "discretionary spending",
    { ...baseOptions, spendingCharacter: "discretionary" },
  ],
  [
    "income",
    {
      categoryId: baseOptions.categoryId,
      amount: baseOptions.amount,
      role: "income",
    },
  ],
];

describe("CategoryBudget", () => {
  it.each(validTargets)(
    "retains an explicit %s target with its supplied Money",
    (_label, options) => {
      const target = new CategoryBudget(options);
      expect(target.categoryId).toBe(baseOptions.categoryId);
      expect(target.role).toBe(options.role);
      expect(target.spendingCharacter).toBe(options.spendingCharacter);
      expect("spendingCharacter" in target).toBe(options.role === "spending");
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
    for (const field of [
      "categoryId",
      "amount",
      "role",
      "spendingCharacter",
    ] as const) {
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

  it.each(validTargets)(
    "allows an explicit zero %s target",
    (_label, options) => {
      const amount = new Money(-0, "JPY");
      const target = new CategoryBudget({ ...options, amount });
      expect(target.amount).toBe(amount);
      expect(Object.is(target.amount.amountMinor, 0)).toBe(true);
      expect(target.amount.currency).toBe("JPY");
    },
  );

  it.each(validTargets)(
    "rejects negative %s targets without changing Money",
    (_label, options) => {
      const amount = new Money(-1, "AUD");
      expect(() => new CategoryBudget({ ...options, amount })).toThrow(
        RangeError,
      );
      expect(amount.amountMinor).toBe(-1);
      expect(amount.currency).toBe("AUD");
    },
  );

  it("rejects missing or unsupported spending character without inference or defaults", () => {
    for (const spendingCharacter of [
      undefined,
      null,
      "",
      "Essential",
      " essential ",
      "irregular",
      "work/admin",
      123,
    ]) {
      const options = { ...baseOptions, spendingCharacter };
      expect(() => Reflect.construct(CategoryBudget, [options])).toThrow(
        TypeError,
      );
      expect(options.spendingCharacter).toBe(spendingCharacter);
    }
  });

  it("rejects any character field on income targets, even explicit undefined", () => {
    for (const spendingCharacter of [
      "essential",
      "discretionary",
      undefined,
      null,
    ]) {
      const options = { ...baseOptions, role: "income", spendingCharacter };
      expect(() => Reflect.construct(CategoryBudget, [options])).toThrow(
        TypeError,
      );
      expect(options.role).toBe("income");
      expect(options.spendingCharacter).toBe(spendingCharacter);
    }
  });

  it("constrains spending/income character combinations in constructor types", () => {
    type Income = Extract<CategoryBudgetOptions, { role: "income" }>;
    type Spending = Extract<CategoryBudgetOptions, { role: "spending" }>;
    expectTypeOf<Income & { spendingCharacter: "essential" }>().toBeNever();
    expectTypeOf<
      Omit<Spending, "spendingCharacter">
    >().not.toExtend<CategoryBudgetOptions>();
    expectTypeOf<Spending["spendingCharacter"]>().toEqualTypeOf<
      "essential" | "discretionary"
    >();
  });

  it("changes planning character only through a new value for the same Category", () => {
    const original = new CategoryBudget(baseOptions);
    const changed = new CategoryBudget({
      ...baseOptions,
      spendingCharacter: "discretionary",
    });
    expect(original.spendingCharacter).toBe("essential");
    expect(changed.spendingCharacter).toBe("discretionary");
    expect(changed.categoryId).toBe(original.categoryId);
    expect(changed.amount).toBe(original.amount);
  });

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
    options.spendingCharacter = "discretionary";
    for (const field of [
      "categoryId",
      "amount",
      "role",
      "spendingCharacter",
    ] as const) {
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
    expect(target.spendingCharacter).toBe("essential");
    expect(target.amount).toBe(baseOptions.amount);
    expect(target.amount.amountMinor).toBe(1234);
    expect(target.amount.currency).toBe("AUD");
  });
});
