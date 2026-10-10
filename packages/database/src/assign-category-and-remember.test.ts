/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import { Account, Money, Transaction } from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountRepository } from "./account-repository";
import {
  assignCategoryAndRemember,
  type RememberedTransactionCategoryAssignment,
} from "./assign-category-and-remember";
import { CategoryRuleRepository } from "./category-rule-repository";
import * as schema from "./schema";
import { TransactionRepository } from "./transaction-repository";

// Adapt Expo's synchronous boundary over real SQLite and all forward migrations.
function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const journal = JSON.parse(
    readFileSync(
      new URL("../drizzle/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  ) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries)
    sqlite.exec(
      readFileSync(
        new URL("../drizzle/" + tag + ".sql", import.meta.url),
        "utf8",
      ),
    );
  const client = {
    prepareSync(query: string) {
      const statement = sqlite.prepare(query);
      return {
        executeSync(params: readonly SQLInputValue[]) {
          const result = statement.run(...params);
          return {
            changes: Number(result.changes),
            lastInsertRowId: Number(result.lastInsertRowid),
          };
        },
        executeForRawResultSync(params: readonly SQLInputValue[]) {
          statement.setReturnArrays(true);
          return { getAllSync: () => statement.all(...params) };
        },
      };
    },
  };
  return {
    sqlite,
    database: drizzle(client as unknown as Parameters<typeof drizzle>[0], {
      schema,
    }),
  };
}

function assignment(
  patch: Partial<RememberedTransactionCategoryAssignment> = {},
): RememberedTransactionCategoryAssignment {
  return {
    householdId: "household-a",
    transactionIds: ["selected-a", "selected-b"],
    normalizedDescription: "Synthetic Descriptor",
    categoryId: "category-target",
    ...patch,
  };
}

let store: ReturnType<typeof createDatabase>;
let transactions: TransactionRepository;
let rules: CategoryRuleRepository;

beforeEach(() => {
  store = createDatabase();
  store.database
    .insert(schema.households)
    .values([
      { id: "household-a", label: "Synthetic household A" },
      { id: "household-b", label: "Synthetic household B" },
    ])
    .run();
  store.database
    .insert(schema.categories)
    .values([
      { id: "category-target", name: "Synthetic target", status: "active" },
      { id: "category-existing", name: "Synthetic existing", status: "active" },
      {
        id: "category-archived",
        name: "Synthetic archived",
        status: "archived",
      },
    ])
    .run();
  store.database
    .insert(schema.merchants)
    .values({ id: "merchant-a", displayName: "Synthetic merchant" })
    .run();
  const accounts = new AccountRepository(store.database);
  for (const householdId of ["household-a", "household-b"])
    accounts.create(
      new Account({
        id: "account-" + householdId,
        householdId,
        label: "Synthetic account",
        type: "transaction",
        status: "active",
        primaryCurrency: "AUD",
        ownership: { kind: "household-level" },
      }),
    );
  transactions = new TransactionRepository(store.database);
  for (const [id, householdId, categoryId] of [
    ["selected-a", "household-a", undefined],
    ["selected-b", "household-a", "category-existing"],
    ["unselected", "household-a", undefined],
    ["foreign", "household-b", undefined],
  ] as const)
    transactions.create(
      new Transaction({
        id,
        accountId: "account-" + householdId,
        postingDate: "2400-03-01",
        transactionDate: "2400-02-29",
        amount: new Money(-1200, "AUD"),
        origin: "imported",
        merchantId: "merchant-a",
        categoryId,
        rawDescription:
          "PAYPAL * Synthetic Descriptor\r\nValue Date 29/02/2400",
      }),
    );
  rules = new CategoryRuleRepository(store.database);
});
afterEach(() => store.sqlite.close());

describe("assignCategoryAndRemember", () => {
  it("atomically changes only the selected category fields and stores exactly one future rule", () => {
    const before = transactions.list();
    const input = Object.freeze({
      ...assignment(),
      transactionIds: Object.freeze(["selected-a", "selected-b"]),
    });
    assignCategoryAndRemember(store.database, input);
    const reloaded = new TransactionRepository(store.database).list();
    expect(reloaded).toEqual(
      before.map((transaction) =>
        input.transactionIds.includes(transaction.id)
          ? { ...transaction, categoryId: input.categoryId }
          : transaction,
      ),
    );
    expect(rules.get(input.householdId, input.normalizedDescription)).toEqual({
      householdId: input.householdId,
      normalizedDescription: input.normalizedDescription,
      categoryId: input.categoryId,
    });
    expect(
      rules.get("household-b", input.normalizedDescription),
    ).toBeUndefined();
    expect(
      store.sqlite.prepare("SELECT count(*) AS count FROM merchant_rules").get()
        ?.count,
    ).toBe(0);
    expect(input).toEqual(assignment());
  });

  it.each(["category-target", "category-existing"])(
    "rejects an existing rule for %s without changing either write",
    (categoryId) => {
      const input = assignment();
      const existing = {
        householdId: input.householdId,
        normalizedDescription: input.normalizedDescription,
        categoryId,
      };
      rules.create(existing);
      const before = transactions.list();
      expect(() => assignCategoryAndRemember(store.database, input)).toThrow(
        new Error("Remembered category assignment failed."),
      );
      expect(transactions.list()).toEqual(before);
      expect(rules.get(input.householdId, input.normalizedDescription)).toEqual(
        existing,
      );
    },
  );

  it.each([
    { transactionIds: ["selected-a", "foreign"] },
    { transactionIds: ["selected-a", "missing-transaction"] },
    { transactionIds: ["selected-a", "selected-a"] },
    { transactionIds: [] },
    { transactionIds: ["selected-a", " \t"] },
    { categoryId: "missing-category" },
    { categoryId: "category-archived" },
    { normalizedDescription: " \t" },
    { householdId: "missing-household" },
  ])(
    "rolls back the rule and all assignments for invalid context %j",
    (patch) => {
      const before = transactions.list();
      expect(() =>
        assignCategoryAndRemember(store.database, assignment(patch)),
      ).toThrow(new Error("Remembered category assignment failed."));
      expect(transactions.list()).toEqual(before);
      expect(
        store.sqlite
          .prepare("SELECT count(*) AS count FROM category_rules")
          .get()?.count,
      ).toBe(0);
    },
  );

  it("rolls back a created rule and the earlier category update when a later update fails", () => {
    const before = transactions.list();
    store.sqlite.exec(
      "CREATE TRIGGER fail_later_category BEFORE UPDATE OF category_id ON transactions WHEN OLD.id = 'selected-b' BEGIN SELECT RAISE(ABORT, 'Synthetic internal SQL details'); END;",
    );
    let error: unknown;
    try {
      assignCategoryAndRemember(store.database, assignment());
    } catch (caught) {
      error = caught;
    }
    expect(error).toEqual(new Error("Remembered category assignment failed."));
    expect(error).not.toHaveProperty("cause");
    expect(transactions.list()).toEqual(before);
    expect(rules.get("household-a", "Synthetic Descriptor")).toBeUndefined();
  });

  it("rejects a suppressed rule insert without assigning current Transactions", () => {
    const before = transactions.list();
    store.sqlite.exec(
      "CREATE TRIGGER ignore_rule BEFORE INSERT ON category_rules BEGIN SELECT RAISE(IGNORE); END;",
    );
    expect(() =>
      assignCategoryAndRemember(store.database, assignment()),
    ).toThrow(new Error("Remembered category assignment failed."));
    expect(transactions.list()).toEqual(before);
    expect(rules.get("household-a", "Synthetic Descriptor")).toBeUndefined();
  });

  it("leaves ordinary explicit category assignment independent of future learning", () => {
    const input = assignment();
    transactions.assignCategory(input);
    expect(transactions.getById("selected-a")?.categoryId).toBe(
      input.categoryId,
    );
    expect(
      rules.get(input.householdId, input.normalizedDescription),
    ).toBeUndefined();
  });
});
