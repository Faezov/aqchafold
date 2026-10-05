import { describe, expect, it } from "vitest";
import { Merchant, Money, Transaction } from "./index";

const baseOptions = { id: "merchant-1", displayName: "Costco" };

describe("Merchant", () => {
  it("creates canonical identity and preserves valid strings verbatim", () => {
    const merchant = new Merchant({
      id: " merchant-1 ",
      displayName: "  Costco  ",
    });
    expect(merchant.id).toBe(" merchant-1 ");
    expect(merchant.displayName).toBe("  Costco  ");
  });

  it("rejects missing or non-object constructor options", () => {
    for (const options of [undefined, null, 123, "Costco"]) {
      expect(() => Reflect.construct(Merchant, [options])).toThrow(TypeError);
    }
  });

  it.each(["id", "displayName"] as const)(
    "requires a nonblank string %s without defaults",
    (field) => {
      const missing = { ...baseOptions };
      Reflect.deleteProperty(missing, field);
      expect(() => Reflect.construct(Merchant, [missing])).toThrow(TypeError);
      for (const value of [undefined, "", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Merchant, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    },
  );

  it("allows identical display names without deriving or merging identity", () => {
    const first = new Merchant({ id: "merchant-a", displayName: "Joe's Cafe" });
    const second = new Merchant({
      id: "merchant-b",
      displayName: "Joe's Cafe",
    });
    expect(first.displayName).toBe(second.displayName);
    expect(first.id).toBe("merchant-a");
    expect(second.id).toBe("merchant-b");
    expect(first).not.toBe(second);
  });

  it("preserves identity across renamed snapshots without changing the original", () => {
    const original = new Merchant(baseOptions);
    const renamed = new Merchant({
      id: original.id,
      displayName: "Costco Wholesale",
    });
    expect(renamed.id).toBe(original.id);
    expect(renamed.displayName).toBe("Costco Wholesale");
    expect(original.displayName).toBe("Costco");
  });

  it("exposes only canonical identity and display name", () => {
    expect(Object.keys(new Merchant(baseOptions)).sort()).toEqual([
      "displayName",
      "id",
    ]);
  });

  it("copies input fields and prevents runtime mutation, redefinition, and deletion", () => {
    const options = { ...baseOptions };
    const merchant = new Merchant(options);
    options.id = "changed-id";
    options.displayName = "Changed name";
    for (const field of ["id", "displayName"] as const) {
      expect(Reflect.set(merchant, field, "changed")).toBe(false);
      expect(
        Reflect.defineProperty(merchant, field, { value: "changed" }),
      ).toBe(false);
      expect(Reflect.deleteProperty(merchant, field)).toBe(false);
    }
    expect(merchant.id).toBe(baseOptions.id);
    expect(merchant.displayName).toBe(baseOptions.displayName);
  });

  it("allows one Merchant across independent Categories and Transaction signs", () => {
    const merchant = new Merchant(baseOptions);
    for (const [id, amountMinor, categoryId] of [
      ["purchase", -2000, "groceries"],
      ["fuel", -3000, "fuel"],
      ["refund", 500, "groceries"],
      ["unclassified", -1000, undefined],
    ] as const) {
      const amount = new Money(amountMinor, "AUD");
      const transaction = new Transaction({
        id,
        accountId: "account-1",
        postingDate: "2026-10-05",
        amount,
        origin: "manual",
        merchantId: merchant.id,
        categoryId,
      });
      expect(transaction.merchantId).toBe(merchant.id);
      expect(transaction.categoryId).toBe(categoryId);
      expect(transaction.amount).toBe(amount);
      expect(transaction.amount.amountMinor).toBe(amountMinor);
    }
  });

  it("keeps an unresolved Merchant relationship absent even with a Category", () => {
    const transaction = new Transaction({
      id: "unresolved",
      accountId: "account-1",
      postingDate: "2026-10-05",
      amount: new Money(-1000, "AUD"),
      origin: "manual",
      categoryId: "groceries",
    });
    expect(transaction.merchantId).toBeUndefined();
    expect(transaction.categoryId).toBe("groceries");
  });
});
