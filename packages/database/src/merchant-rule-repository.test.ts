/// <reference types="node" />

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import {
  Account,
  Household,
  Merchant,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizePaymentProcessorPrefix } from "../../merchants/src/index";
import { AccountRepository } from "./account-repository";
import { HouseholdRepository } from "./household-repository";
import { MerchantRepository } from "./merchant-repository";
import {
  MerchantRuleRepository,
  type MerchantRule,
} from "./merchant-rule-repository";
import * as schema from "./schema";
import { TransactionRepository } from "./transaction-repository";

// Adapt only Expo's synchronous native boundary, using every forward migration.
function createDatabase(filename = ":memory:", initialize = true) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  if (initialize) {
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
  }
  const queries: string[] = [];
  const client = {
    prepareSync(query: string) {
      queries.push(query);
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
  return { sqlite, database, queries };
}

function seed(database: ReturnType<typeof createDatabase>["database"]): void {
  new HouseholdRepository(database).create(
    new Household({ id: "household-a", label: "Synthetic household A" }),
  );
  for (const id of ["merchant-a", "merchant-b"])
    new MerchantRepository(database).create(
      new Merchant({ id, displayName: "Synthetic shop" }),
    );
}

function rule(patch: Partial<MerchantRule> = {}): MerchantRule {
  return {
    householdId: "household-a",
    normalizedDescription: "Synthetic Shop",
    merchantId: "merchant-a",
    ...patch,
  };
}

let store: ReturnType<typeof createDatabase>;
let repository: MerchantRuleRepository;

beforeEach(() => {
  store = createDatabase();
  seed(store.database);
  repository = new MerchantRuleRepository(store.database);
  store.queries.length = 0;
});

afterEach(() => store.sqlite.close());

describe("MerchantRuleRepository with real SQLite", () => {
  it("roundtrips an explicit exact mapping without mutating its input", () => {
    const source = Object.freeze(rule());
    const before = structuredClone(source);
    repository.create(source);
    expect(
      repository.get(source.householdId, source.normalizedDescription),
    ).toEqual(source);
    expect(repository.list(source.householdId)).toEqual([source]);
    expect(source).toEqual(before);
  });

  it("preserves whitespace, punctuation, and Unicode in the exact key", () => {
    const source = rule({ normalizedDescription: " \tMiXeD Café & 東京!\n " });
    repository.create(source);
    expect(
      repository.get(source.householdId, source.normalizedDescription),
    ).toEqual(source);
    expect(
      repository.get(source.householdId, "MiXeD Café & 東京!"),
    ).toBeUndefined();
    expect(
      store.sqlite
        .prepare("SELECT normalized_description FROM merchant_rules")
        .get()?.normalized_description,
    ).toBe(source.normalizedDescription);
  });

  it.each([
    "synthetic shop",
    "SYNTHETIC SHOP",
    "Synthetic",
    "Synthetic Shop Extra",
    "Extra Synthetic Shop",
    " Synthetic Shop",
    "Synthetic  Shop",
    "",
    " \t\n ",
  ])("does not transform or partially match lookup %j", (description) => {
    repository.create(rule());
    expect(repository.get("household-a", description)).toBeUndefined();
  });

  it("returns no match for unknown descriptions and Households", () => {
    expect(repository.get("household-a", "Unknown Shop")).toBeUndefined();
    expect(
      repository.get("unknown-household", "Synthetic Shop"),
    ).toBeUndefined();
    expect(repository.list("unknown-household")).toEqual([]);
  });

  it("allows case-distinct keys in one Household", () => {
    const first = rule();
    const second = rule({
      normalizedDescription: "synthetic shop",
      merchantId: "merchant-b",
    });
    repository.create(first);
    repository.create(second);
    expect(
      repository.get(first.householdId, first.normalizedDescription),
    ).toEqual(first);
    expect(
      repository.get(second.householdId, second.normalizedDescription),
    ).toEqual(second);
  });

  it("scopes the same exact description independently to each Household", () => {
    // Seed a second Household without changing the single-local-Household API.
    store.database
      .insert(schema.households)
      .values({ id: "household-b", label: "Synthetic household B" })
      .run();
    const first = rule();
    const second = rule({
      householdId: "household-b",
      merchantId: "merchant-b",
    });
    repository.create(first);
    repository.create(second);
    expect(
      repository.get(first.householdId, first.normalizedDescription),
    ).toEqual(first);
    expect(
      repository.get(second.householdId, second.normalizedDescription),
    ).toEqual(second);
    expect(repository.list(first.householdId)).toEqual([first]);
    expect(repository.list(second.householdId)).toEqual([second]);
  });

  it("lists only one Household's rules in deterministic binary description order", () => {
    const sources = [
      rule({ normalizedDescription: "a Shop" }),
      rule({ normalizedDescription: "Z Shop" }),
      rule({ normalizedDescription: "A Shop" }),
    ];
    for (const source of sources) repository.create(source);
    const expected = [sources[2], sources[1], sources[0]];
    expect(repository.list("household-a")).toEqual(expected);
    expect(repository.list("household-a")).toEqual(expected);
    expect(repository.get("household-a", "A Shop")).toEqual(sources[2]);
    expect(repository.get("household-a", "A Shop")).toEqual(sources[2]);
  });

  it.each(["merchant-a", "merchant-b"])(
    "rejects repeated keys for %s without overwriting or partial state",
    (merchantId) => {
      const source = rule();
      repository.create(source);
      const duplicate = rule({ merchantId });
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => repository.create(duplicate)).toThrow(
          "Merchant rule already exists for this Household and description.",
        );
        expect(repository.list(source.householdId)).toEqual([source]);
      }
    },
  );

  it.each([
    [
      "householdId",
      "missing-household",
      "Merchant rule must reference an existing Household.",
    ],
    [
      "merchantId",
      "missing-merchant",
      "Merchant rule must reference an existing Merchant.",
    ],
  ] as const)(
    "rejects missing %s without storing a partial rule",
    (field, missingId, diagnostic) => {
      expect(() => repository.create(rule({ [field]: missingId }))).toThrow(
        diagnostic,
      );
      expect(repository.list("household-a")).toEqual([]);
      expect(
        store.sqlite
          .prepare("SELECT count(*) AS count FROM merchant_rules")
          .get()?.count,
      ).toBe(0);
    },
  );

  it.each(["householdId", "normalizedDescription", "merchantId"] as const)(
    "rejects blank %s before issuing SQL",
    (field) => {
      for (const value of ["", " \t\n "]) {
        expect(() => repository.create(rule({ [field]: value }))).toThrow(
          TypeError,
        );
        expect(store.queries).toEqual([]);
      }
      expect(repository.list("household-a")).toEqual([]);
    },
  );

  it("validates blank Household IDs for reads before issuing SQL", () => {
    expect(() => repository.get(" \t ", "Synthetic Shop")).toThrow(TypeError);
    expect(() => repository.list("")).toThrow(TypeError);
    expect(store.queries).toEqual([]);
  });

  it("enforces uniqueness and both foreign keys independently in SQLite", () => {
    const source = rule();
    repository.create(source);
    const insert = store.sqlite.prepare(
      "INSERT INTO merchant_rules (household_id, normalized_description, merchant_id) VALUES (?, ?, ?)",
    );
    expect(() =>
      insert.run(
        source.householdId,
        source.normalizedDescription,
        "merchant-b",
      ),
    ).toThrow(/UNIQUE constraint/i);
    expect(() =>
      insert.run("missing-household", "Other Shop", "merchant-a"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      insert.run("household-a", "Other Shop", "missing-merchant"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      store.sqlite
        .prepare("DELETE FROM households WHERE id = ?")
        .run(source.householdId),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      store.sqlite
        .prepare("DELETE FROM merchants WHERE id = ?")
        .run(source.merchantId),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(repository.list(source.householdId)).toEqual([source]);
  });

  it.each(["create", "get", "list"] as const)(
    "sanitizes unexpected SQL errors from %s",
    (operation) => {
      const source = rule({
        normalizedDescription: "Synthetic sensitive description",
      });
      store.sqlite.exec("DROP TABLE merchant_rules;");
      let error: unknown;
      try {
        if (operation === "create") repository.create(source);
        else if (operation === "get")
          repository.get(source.householdId, source.normalizedDescription);
        else repository.list(source.householdId);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(
        source.normalizedDescription,
      );
      expect((error as Error).message).not.toContain(source.householdId);
      expect((error as Error).message).not.toContain(source.merchantId);
      expect((error as Error).message).not.toMatch(
        /select|insert|no such table/i,
      );
      expect((error as Error).cause).toBeUndefined();
    },
  );

  it("does not learn rules from normalized text or apply explicit rules to Transactions", () => {
    new AccountRepository(store.database).create(
      new Account({
        id: "synthetic-account",
        householdId: "household-a",
        label: "Synthetic account",
        type: "transaction",
        status: "active",
        primaryCurrency: "AUD",
        ownership: { kind: "household-level" },
      }),
    );
    const source = new Transaction({
      id: "synthetic-transaction",
      accountId: "synthetic-account",
      postingDate: "2036-01-31",
      amount: new Money(-1200, "AUD"),
      origin: "imported",
      rawDescription: " \tSQ *MiXeD Café & 東京!\r\n ",
    });
    const transactions = new TransactionRepository(store.database);
    transactions.create(source);
    const { normalizedDescription } = normalizePaymentProcessorPrefix(
      source.rawDescription!,
    );
    expect(normalizedDescription).toBe("MiXeD Café & 東京!");
    expect(repository.list("household-a")).toEqual([]);
    const mapping = rule({ normalizedDescription });
    repository.create(mapping);
    expect(repository.get(mapping.householdId, normalizedDescription)).toEqual(
      mapping,
    );
    expect(transactions.getById(source.id)).toEqual(source);
    expect(transactions.getById(source.id)?.merchantId).toBeUndefined();
    expect(
      store.sqlite
        .prepare("SELECT raw_description FROM transactions WHERE id = ?")
        .get(source.id)?.raw_description,
    ).toBe(source.rawDescription);
    expect(source.rawDescription).toBe(" \tSQ *MiXeD Café & 東京!\r\n ");
  });

  it("retains rules after closing and reopening the local SQLite file", () => {
    const directory = mkdtempSync(join(tmpdir(), "ledgerase-merchant-rules-"));
    const filename = join(directory, "ledgerase.db");
    const source = rule();
    try {
      const first = createDatabase(filename);
      try {
        seed(first.database);
        new MerchantRuleRepository(first.database).create(source);
      } finally {
        first.sqlite.close();
      }
      const reopened = createDatabase(filename, false);
      try {
        const restored = new MerchantRuleRepository(reopened.database);
        expect(
          restored.get(source.householdId, source.normalizedDescription),
        ).toEqual(source);
        expect(restored.list(source.householdId)).toEqual([source]);
      } finally {
        reopened.sqlite.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
