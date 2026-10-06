/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import {
  Account,
  Household,
  Member,
  type AccountOptions,
} from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountRepository } from "./account-repository";
import { HouseholdRepository } from "./household-repository";
import { MemberRepository } from "./member-repository";
import * as schema from "./schema";

// Exercise the production Expo Drizzle driver with real SQLite. Only Expo's
// synchronous native SQL boundary is adapted for Node, as in repository tests.
function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(
    readFileSync(
      new URL("../drizzle/0000_initial.sql", import.meta.url),
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
  const database = drizzle(client as unknown as Parameters<typeof drizzle>[0], {
    schema,
  });
  return { sqlite, database };
}

let store: ReturnType<typeof createDatabase>;
let repository: AccountRepository;

beforeEach(() => {
  store = createDatabase();
  new HouseholdRepository(store.database).create(
    new Household({ id: "household", label: "Synthetic household" }),
  );
  const members = new MemberRepository(store.database);
  for (const [id, status] of [
    ["member-a", "active"],
    ["member-b", "archived"],
  ] as const) {
    members.create(
      new Member({ id, householdId: "household", displayName: id, status }),
    );
  }
  repository = new AccountRepository(store.database);
});

afterEach(() => store.sqlite.close());

function createAccount(options: Partial<AccountOptions> = {}): Account {
  const account = new Account({
    id: "account",
    householdId: "household",
    label: "Synthetic account",
    type: "transaction",
    status: "active",
    primaryCurrency: "AUD",
    ownership: { kind: "household-level" },
    ...options,
  });
  repository.create(account);
  return account;
}

describe("AccountRepository.list with real SQLite and the Expo Drizzle driver", () => {
  it("returns an empty list without creating Accounts", () => {
    expect(repository.list()).toEqual([]);
    expect(store.database.select().from(schema.accounts).all()).toEqual([]);
  });

  it("lists canonical fields, ownership, currencies and closed Accounts in stable label/ID order", () => {
    const other = createAccount({ id: "z", label: "Zulu", type: "other" });
    const savings = createAccount({
      id: "same-b",
      label: "Same label",
      type: "savings",
      status: "closed",
      primaryCurrency: "USD",
      ownership: { kind: "unknown" },
    });
    const individual = createAccount({
      id: "individual",
      label: "Individual",
      type: "credit-card",
      primaryCurrency: "GBP",
      ownership: { kind: "individual", memberId: "member-b" },
    });
    const shared = createAccount({
      id: "same-a",
      label: "Same label",
      primaryCurrency: "USD",
      ownership: { kind: "shared", memberIds: ["member-b", "member-a"] },
    });
    const cash = createAccount({ id: "cash", label: "  Cash  ", type: "cash" });
    const listed = repository.list();
    expect(listed).toEqual([cash, individual, shared, savings, other]);
    expect(listed.every((account) => account instanceof Account)).toBe(true);
    expect(listed[2].ownership).toEqual(shared.ownership);
  });

  it("reads newly persisted Accounts on a subsequent list call", () => {
    expect(repository.list()).toEqual([]);
    const account = createAccount();
    expect(repository.list()).toEqual([account]);
  });

  it.each([
    [
      "malformed Account label",
      "UPDATE accounts SET label = ' ' WHERE id = 'invalid';",
      /label/i,
    ],
    [
      "missing Household",
      "PRAGMA foreign_keys = OFF; DELETE FROM households;",
      /existing Household/,
    ],
    [
      "malformed Household label",
      "UPDATE households SET label = ' ';",
      /label/i,
    ],
    [
      "incomplete shared ownership",
      "DELETE FROM account_members WHERE account_id = 'invalid' AND member_id = 'member-a';",
      /at least two/,
    ],
    [
      "noncontiguous ownership order",
      "UPDATE account_members SET member_order = 2 WHERE account_id = 'invalid' AND member_order = 1;",
      /contiguous/,
    ],
    [
      "missing ownership Member",
      "PRAGMA foreign_keys = OFF; DELETE FROM members WHERE id = 'member-b';",
      /missing Member/,
    ],
    [
      "ownership Member from another Household",
      "INSERT INTO households VALUES ('other', 'Synthetic other household'); UPDATE members SET household_id = 'other' WHERE id = 'member-b';",
      /another Household/,
    ],
  ] as const)(
    "rejects %s instead of returning a partial list",
    (_, sql, diagnostic) => {
      createAccount({ id: "valid", label: "A valid account" });
      createAccount({
        id: "invalid",
        label: "Z invalid account",
        ownership: { kind: "shared", memberIds: ["member-b", "member-a"] },
      });
      store.sqlite.exec(sql);
      expect(() => repository.list()).toThrow(diagnostic);
    },
  );
});
