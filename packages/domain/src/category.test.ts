import { describe, expect, it } from "vitest";
import {
  Category,
  Merchant,
  Money,
  Transaction,
  type CategoryOptions,
} from "./index";

const baseOptions: CategoryOptions = {
  id: "category-1",
  name: "Groceries",
  status: "active",
};

describe("Category", () => {
  it("creates canonical identity and preserves valid strings verbatim", () => {
    const category = new Category({
      id: " category-1 ",
      name: "  Groceries  ",
      status: "active",
    });
    expect(category.id).toBe(" category-1 ");
    expect(category.name).toBe("  Groceries  ");
    expect(category.status).toBe("active");
  });

  it("rejects missing or non-object constructor options", () => {
    for (const options of [undefined, null, 123, "Groceries", true]) {
      expect(() => Reflect.construct(Category, [options])).toThrow(TypeError);
    }
  });

  it.each(["id", "name"] as const)(
    "requires a nonblank string %s without defaults",
    (field) => {
      const missing = { ...baseOptions };
      Reflect.deleteProperty(missing, field);
      expect(() => Reflect.construct(Category, [missing])).toThrow(TypeError);
      for (const value of [undefined, "", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Category, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    },
  );

  it.each(["active", "archived"] as const)("accepts %s status", (status) => {
    expect(new Category({ ...baseOptions, status }).status).toBe(status);
  });

  it("requires an explicit supported status without defaulting to active", () => {
    const missing = { ...baseOptions };
    Reflect.deleteProperty(missing, "status");
    expect(() => Reflect.construct(Category, [missing])).toThrow(TypeError);
    for (const status of [
      undefined,
      null,
      "",
      " active ",
      "Active",
      "deleted",
      123,
    ]) {
      expect(() =>
        Reflect.construct(Category, [{ ...baseOptions, status }]),
      ).toThrow(TypeError);
    }
  });

  it("allows equal names without deriving or merging Category identity", () => {
    const first = new Category({ ...baseOptions, id: "category-a" });
    const second = new Category({ ...baseOptions, id: "category-b" });
    expect(first.name).toBe(second.name);
    expect(first.id).toBe("category-a");
    expect(second.id).toBe("category-b");
    expect(first).not.toBe(second);
  });

  it("preserves identity across renamed snapshots without changing the original", () => {
    const original = new Category(baseOptions);
    const renamed = new Category({ ...original, name: "Food shopping" });
    expect(renamed.id).toBe(original.id);
    expect(renamed.name).toBe("Food shopping");
    expect(original.name).toBe("Groceries");
  });

  it("archives and reactivates snapshots without changing identity or historical references", () => {
    const active = new Category(baseOptions);
    const transaction = new Transaction({
      id: "historical-purchase",
      accountId: "account-1",
      postingDate: "2026-10-05",
      amount: new Money(-1000, "AUD"),
      origin: "manual",
      categoryId: active.id,
    });
    const archived = new Category({ ...active, status: "archived" });
    const reactivated = new Category({ ...archived, status: "active" });
    expect(archived.id).toBe(active.id);
    expect(archived.status).toBe("archived");
    expect(reactivated.id).toBe(active.id);
    expect(reactivated.status).toBe("active");
    expect(active.status).toBe("active");
    expect(transaction.categoryId).toBe(archived.id);
    expect(transaction.amount.amountMinor).toBe(-1000);
  });

  it("allows independent Merchant relationships and purchase/refund signs for a Category", () => {
    const groceries = new Category(baseOptions);
    const fuel = new Category({
      id: "category-2",
      name: "Fuel",
      status: "active",
    });
    const merchant = new Merchant({ id: "costco", displayName: "Costco" });
    const otherMerchant = new Merchant({ id: "market", displayName: "Market" });
    for (const [id, merchantId, categoryId, amountMinor] of [
      ["purchase", merchant.id, groceries.id, -1000],
      ["fuel", merchant.id, fuel.id, -2000],
      ["other-purchase", otherMerchant.id, groceries.id, -1500],
      ["refund", merchant.id, groceries.id, 500],
      ["zero", merchant.id, groceries.id, 0],
    ] as const) {
      const amount = new Money(amountMinor, "AUD");
      const transaction = new Transaction({
        id,
        accountId: "account-1",
        postingDate: "2026-10-05",
        amount,
        origin: "manual",
        merchantId,
        categoryId,
      });
      expect(transaction.merchantId).toBe(merchantId);
      expect(transaction.categoryId).toBe(categoryId);
      expect(transaction.amount).toBe(amount);
      expect(transaction.amount.amountMinor).toBe(amountMinor);
    }
  });

  it("allows uncategorized Transactions without a fake Unknown Category", () => {
    const transaction = new Transaction({
      id: "uncategorized",
      accountId: "account-1",
      postingDate: "2026-10-05",
      amount: new Money(-1000, "AUD"),
      origin: "manual",
      merchantId: "costco",
    });
    expect(transaction.categoryId).toBeUndefined();
    expect(transaction.merchantId).toBe("costco");
  });

  it("exposes only identity, name, and status", () => {
    expect(Object.keys(new Category(baseOptions)).sort()).toEqual([
      "id",
      "name",
      "status",
    ]);
  });

  it("copies fields and prevents runtime mutation, redefinition, and deletion", () => {
    const options = { ...baseOptions };
    const category = new Category(options);
    options.id = "changed-id";
    options.name = "Changed name";
    options.status = "archived";
    for (const field of ["id", "name", "status"] as const) {
      const value = field === "status" ? "archived" : "changed";
      expect(Reflect.set(category, field, value)).toBe(false);
      expect(Reflect.defineProperty(category, field, { value })).toBe(false);
      expect(Reflect.deleteProperty(category, field)).toBe(false);
    }
    expect(Object.isFrozen(category)).toBe(true);
    expect(category.id).toBe(baseOptions.id);
    expect(category.name).toBe(baseOptions.name);
    expect(category.status).toBe(baseOptions.status);
  });
});
