/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import { Account, Household, type AccountOptions } from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AccountRepository } from "./account-repository";
import { HouseholdRepository } from "./household-repository";
import { createLocalAccount } from "./local-account-setup";
import * as schema from "./schema";

// Production Expo Drizzle driver and real SQLite, adapting only the native boundary.
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
      readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8"),
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
  const database = drizzle(client as unknown as Parameters<typeof drizzle>[0], {
    schema,
  });
  return { sqlite, database };
}

let store: ReturnType<typeof createDatabase>;
let households: HouseholdRepository;
let accounts: AccountRepository;
const household = new Household({
  id: "household",
  label: " Explicit household ",
});
const accountOptions: AccountOptions = {
  id: "account",
  householdId: household.id,
  label: " Explicit account ",
  type: "savings",
  status: "active",
  primaryCurrency: "USD",
  ownership: { kind: "unknown" },
};

beforeEach(() => {
  store = createDatabase();
  households = new HouseholdRepository(store.database);
  accounts = new AccountRepository(store.database);
});
afterEach(() => store.sqlite.close());

function expectEmptyStore() {
  expect(households.get()).toBeUndefined();
  expect(accounts.list()).toEqual([]);
}

it("discovers an empty store and atomically creates canonical Household and Account fields", () => {
  expectEmptyStore();
  const account = new Account(accountOptions);
  createLocalAccount(store.database, { account, newHousehold: household });
  expect(households.get()).toEqual(household);
  expect(households.get()).toBeInstanceOf(Household);
  expect(accounts.getById(account.id)).toEqual(account);
  expect(accounts.getById(account.id)).toBeInstanceOf(Account);
  expect(accounts.list()).toEqual([account]);
});

it.each([
  ["currency", { primaryCurrency: "aud" }],
  ["label", { label: " " }],
  ["type", { type: "unsupported" }],
  ["ownership", { ownership: { kind: "unsupported" } }],
] as const)("invalid Account %s persists neither entity", (_, invalid) => {
  expect(() =>
    createLocalAccount(store.database, {
      account: { ...accountOptions, ...invalid } as Account,
      newHousehold: household,
    }),
  ).toThrow("Local account setup failed.");
  expectEmptyStore();
});

it("rejects a blank new Household label without creating an Account", () => {
  expect(() =>
    createLocalAccount(store.database, {
      account: new Account(accountOptions),
      newHousehold: { id: household.id, label: " " },
    }),
  ).toThrow("Local account setup failed.");
  expectEmptyStore();
});

it("reuses the existing Household when creating an additional Account", () => {
  const first = new Account(accountOptions);
  createLocalAccount(store.database, {
    account: first,
    newHousehold: household,
  });
  const second = new Account({
    ...accountOptions,
    id: "second-account",
    label: "Second account",
    type: "cash",
    primaryCurrency: "GBP",
    ownership: { kind: "household-level" },
  });
  createLocalAccount(store.database, { account: second });
  expect(households.get()).toEqual(household);
  expect(store.database.select().from(schema.households).all()).toHaveLength(1);
  expect(accounts.list()).toEqual([first, second]);
});

it("replaying the same creation IDs cannot duplicate setup records", () => {
  const context = {
    account: new Account(accountOptions),
    newHousehold: household,
  };
  createLocalAccount(store.database, context);
  expect(() => createLocalAccount(store.database, context)).toThrow(
    "Local account setup failed.",
  );
  expect(store.database.select().from(schema.households).all()).toHaveLength(1);
  expect(accounts.list()).toEqual([context.account]);
});

it("rolls back the new Household when the final Account insert fails", () => {
  store.sqlite.exec(
    "CREATE TRIGGER reject_account BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'Synthetic private SQL diagnostic'); END;",
  );
  expect(() =>
    createLocalAccount(store.database, {
      account: new Account(accountOptions),
      newHousehold: household,
    }),
  ).toThrow(/^Local account setup failed\.$/);
  expectEmptyStore();
});

it("requires explicit Household context in an empty store", () => {
  expect(() =>
    createLocalAccount(store.database, {
      account: new Account(accountOptions),
    }),
  ).toThrow("Local account setup failed.");
  expectEmptyStore();
});

it("rejects mismatched new Household and Account IDs before writes", () => {
  expect(() =>
    createLocalAccount(store.database, {
      account: new Account({ ...accountOptions, householdId: "other" }),
      newHousehold: household,
    }),
  ).toThrow("Local account setup failed.");
  expectEmptyStore();
});

it("does not create another Household for an Account in conflicting context", () => {
  households.create(household);
  expect(() =>
    createLocalAccount(store.database, {
      account: new Account({ ...accountOptions, householdId: "other" }),
      newHousehold: new Household({ id: "other", label: "Other household" }),
    }),
  ).toThrow("Local account setup failed.");
  expect(households.get()).toEqual(household);
  expect(store.database.select().from(schema.households).all()).toHaveLength(1);
  expect(accounts.list()).toEqual([]);
});

it("Household discovery and setup reject a malformed multi-Household store", () => {
  store.sqlite.exec(
    "INSERT INTO households VALUES ('household', 'Synthetic household'), ('other', 'Synthetic other household');",
  );
  expect(() => households.get()).toThrow(
    "Local store contains multiple Households.",
  );
  expect(() =>
    createLocalAccount(store.database, {
      account: new Account(accountOptions),
    }),
  ).toThrow("Local account setup failed.");
  expect(store.database.select().from(schema.accounts).all()).toEqual([]);
  expect(store.database.select().from(schema.households).all()).toHaveLength(2);
});
