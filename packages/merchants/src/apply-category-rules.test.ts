import { Category, Money, Transaction } from "@aqchafold/domain";
import { describe, expect, it, vi } from "vitest";
import { applyCategoryRules } from "./index";

const category = new Category({
  id: "purpose-id",
  name: "Invented purpose",
  status: "active",
});
const rule = {
  householdId: "household-a",
  normalizedDescription: "Synthetic Café!",
  categoryId: category.id,
};

function record(options: Partial<Transaction> = {}) {
  return new Transaction({
    id: "new-record",
    accountId: "account-a",
    postingDate: "2040-03-02",
    transactionDate: "2040-03-01",
    amount: new Money(-1234, "AUD"),
    merchantId: "canonical-merchant",
    origin: "imported",
    rawDescription: "  PAYPAL *Synthetic   Café!\nValue Date 01/03/2040",
    ...options,
  } as ConstructorParameters<typeof Transaction>[0]);
}

function setup(transactions: readonly Transaction[] = [record()]) {
  const findRule = vi.fn(
    (householdId: string, normalizedDescription: string) =>
      householdId === rule.householdId &&
      normalizedDescription === rule.normalizedDescription
        ? rule
        : undefined,
  );
  const findCategoryById = vi.fn((id: string) =>
    id === category.id ? category : undefined,
  );
  return {
    transactions,
    householdId: "household-a",
    findRule,
    findCategoryById,
  };
}

describe("remembered exact-description category application", () => {
  it("uses the production composition and preserves all other canonical/source fields", () => {
    const source = record();
    const options = setup([source]);
    const result = applyCategoryRules(options);
    expect(options.findRule).toHaveBeenCalledExactlyOnceWith(
      "household-a",
      "Synthetic Café!",
    );
    expect(options.findCategoryById).toHaveBeenCalledExactlyOnceWith(
      category.id,
    );
    expect(result[0]).toBeInstanceOf(Transaction);
    expect(result[0]).toEqual({ ...source, categoryId: category.id });
    expect(result[0].rawDescription).toBe(source.rawDescription);
    expect(result[0].amount).toBe(source.amount);
    expect(source.categoryId).toBeUndefined();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(applyCategoryRules(options)).toEqual(result);
  });

  it("uses the same exact key across currencies without combining their amounts", () => {
    const first = record();
    const second = record({
      id: "new-usd-record",
      accountId: "account-usd",
      amount: new Money(-4321, "USD"),
    });
    expect(applyCategoryRules(setup([first, second]))).toEqual([
      { ...first, categoryId: category.id },
      { ...second, categoryId: category.id },
    ]);
  });

  it.each([
    "Synthetic Café!\nValue Date 31/02/2040",
    "Synthetic Café!\nValue Date 1/03/2040",
    "Synthetic Café!\nValue date 01/03/2040",
    "Synthetic Café! Value Date 01/03/2040",
    "Synthetic Café!\nValue Date 01/03/2040\nCard 1234",
    "synthetic Café!",
    "Synthetic Café! OTHER",
    "Synthetic Café",
  ])("preserves nonmatching source syntax %j", (rawDescription) => {
    const source = record({ rawDescription });
    const options = setup([source]);
    expect(applyCategoryRules(options)[0]).toBe(source);
    expect(options.findCategoryById).not.toHaveBeenCalled();
  });

  it("supports CRLF metadata without changing the source string", () => {
    const source = record({
      rawDescription: "SQ *Synthetic Café!\r\nValue Date 01/03/2040",
    });
    expect(applyCategoryRules(setup([source]))[0]).toEqual({
      ...source,
      categoryId: category.id,
    });
  });

  it("keeps no-rule behavior and original records unchanged", () => {
    const options = setup();
    options.findRule.mockReturnValue(undefined);
    expect(applyCategoryRules(options)).toEqual(options.transactions);
    expect(applyCategoryRules(options)[0]).toBe(options.transactions[0]);
    expect(options.findCategoryById).not.toHaveBeenCalled();
  });

  it("does not apply another Household's remembered correction", () => {
    const options = { ...setup(), householdId: "household-b" };
    expect(applyCategoryRules(options)[0]).toBe(options.transactions[0]);
    expect(options.findCategoryById).not.toHaveBeenCalled();
  });

  it("preserves an existing explicit category without consulting rules", () => {
    const source = record({ categoryId: "other-purpose" });
    const options = setup([source]);
    expect(applyCategoryRules(options)[0]).toBe(source);
    expect(options.findRule).not.toHaveBeenCalled();
    expect(options.findCategoryById).not.toHaveBeenCalled();
  });

  it.each([undefined, "", " \n\t ", "SQ *"])(
    "does not invent a rule key for absent or empty manual evidence %j",
    (rawDescription) => {
      const source = record({ origin: "manual", rawDescription });
      const options = setup([source]);
      expect(applyCategoryRules(options)[0]).toBe(source);
      expect(options.findRule).not.toHaveBeenCalled();
    },
  );

  it("can categorize a canonical manual record with established source evidence", () => {
    const source = record({ origin: "manual" });
    expect(applyCategoryRules(setup([source]))[0]).toEqual({
      ...source,
      categoryId: category.id,
    });
  });

  it("preserves archived remembered references without making future assignments", () => {
    const options = setup();
    options.findCategoryById.mockReturnValue(
      new Category({ ...category, status: "archived" }),
    );
    expect(applyCategoryRules(options)[0]).toBe(options.transactions[0]);
  });

  it.each([
    { ...rule, householdId: "household-b" },
    { ...rule, normalizedDescription: "Wrong descriptor" },
    { ...rule, categoryId: " " },
  ])(
    "rejects a lookup that returns a different or invalid key",
    (invalidRule) => {
      const options = setup();
      options.findRule.mockReturnValue(invalidRule);
      expect(() => applyCategoryRules(options)).toThrow(
        "Remembered category rule application failed.",
      );
    },
  );

  it.each([
    undefined,
    new Category({ ...category, id: "wrong-category" }),
    { ...category, status: "corrupt" } as unknown as Category,
  ])(
    "fails safely for missing or noncanonical Category references",
    (invalid) => {
      const options = setup();
      options.findCategoryById.mockReturnValue(invalid);
      expect(() => applyCategoryRules(options)).toThrow(
        "Remembered category rule application failed.",
      );
      expect(options.transactions[0].categoryId).toBeUndefined();
    },
  );

  it.each(["findRule", "findCategoryById"] as const)(
    "sanitizes lookup failures from %s without partial input mutation",
    (lookup) => {
      const options = setup([record(), record({ id: "second-record" })]);
      options[lookup].mockImplementationOnce(() => {
        throw new Error("SQL parameters: synthetic private source details");
      });
      try {
        applyCategoryRules(options);
        expect.fail("Expected category application to fail");
      } catch (error) {
        expect(error).toEqual(
          new Error("Remembered category rule application failed."),
        );
        expect(error).not.toHaveProperty("cause");
      }
      expect(options.transactions.every(({ categoryId }) => !categoryId)).toBe(
        true,
      );
    },
  );

  it.each(["", " \n ", null, undefined])(
    "rejects invalid Household context without leaking its value",
    (householdId) => {
      expect(() =>
        applyCategoryRules({
          ...setup(),
          householdId: householdId as string,
        }),
      ).toThrow("Category rule application requires a Household ID.");
    },
  );
});
