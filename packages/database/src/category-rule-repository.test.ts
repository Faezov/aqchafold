/// <reference types="node" />

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CategoryRuleRepository,
  type CategoryRule,
} from "./category-rule-repository";
import * as schema from "./schema";

// Adapt Expo's synchronous boundary over real SQLite and all forward migrations.
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
  return {
    sqlite,
    queries,
    database: drizzle(client as unknown as Parameters<typeof drizzle>[0], {
      schema,
    }),
  };
}

function seed(database: ReturnType<typeof createDatabase>["database"]) {
  database
    .insert(schema.households)
    .values([
      { id: "household-a", label: "Synthetic household A" },
      { id: "household-b", label: "Synthetic household B" },
    ])
    .run();
  database
    .insert(schema.categories)
    .values([
      { id: "category-a", name: "Synthetic purpose A", status: "active" },
      { id: "category-b", name: "Synthetic purpose B", status: "active" },
      {
        id: "category-archived",
        name: "Synthetic archived purpose",
        status: "archived",
      },
    ])
    .run();
}

function rule(patch: Partial<CategoryRule> = {}): CategoryRule {
  return {
    householdId: "household-a",
    normalizedDescription: "Synthetic Descriptor",
    categoryId: "category-a",
    ...patch,
  };
}

let store: ReturnType<typeof createDatabase>;
let repository: CategoryRuleRepository;
beforeEach(() => {
  store = createDatabase();
  seed(store.database);
  repository = new CategoryRuleRepository(store.database);
  store.queries.length = 0;
});
afterEach(() => store.sqlite.close());

describe("CategoryRuleRepository with real SQLite", () => {
  it("stores and reads the exact opt-in rule without modifying its input", () => {
    const source = Object.freeze(rule());
    repository.create(source);
    const actual = repository.get(
      source.householdId,
      source.normalizedDescription,
    );
    expect(actual).toEqual(source);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(source).toEqual(rule());
    expect(
      store.sqlite.prepare("SELECT count(*) AS count FROM transactions").get()
        ?.count,
    ).toBe(0);
    expect(
      store.sqlite.prepare("SELECT count(*) AS count FROM merchant_rules").get()
        ?.count,
    ).toBe(0);
  });

  it("preserves case, punctuation, accents, Unicode, and whitespace in exact keys", () => {
    const source = rule({
      normalizedDescription: " \tSyNtHeTiC Café & 東京!\n ",
    });
    repository.create(source);
    expect(
      repository.get(source.householdId, source.normalizedDescription),
    ).toEqual(source);
    expect(
      repository.get(source.householdId, source.normalizedDescription.trim()),
    ).toBeUndefined();
  });

  it.each([
    "synthetic descriptor",
    "SYNTHETIC DESCRIPTOR",
    "Synthetic",
    "Synthetic Descriptor Extra",
    "Extra Synthetic Descriptor",
    " Synthetic Descriptor",
    "Synthetic  Descriptor",
    "",
    " \t\n ",
  ])("does not transform or partially match %j", (description) => {
    repository.create(rule());
    expect(repository.get("household-a", description)).toBeUndefined();
  });

  it("returns undefined for missing keys or Households", () => {
    expect(
      repository.get("household-a", "Unknown synthetic descriptor"),
    ).toBeUndefined();
    expect(
      repository.get("missing-household", "Synthetic Descriptor"),
    ).toBeUndefined();
  });

  it("keeps the same description isolated by Household and permits case-distinct keys", () => {
    const sources = [
      rule(),
      rule({ householdId: "household-b", categoryId: "category-b" }),
      rule({
        normalizedDescription: "synthetic descriptor",
        categoryId: "category-b",
      }),
    ];
    for (const source of sources) repository.create(source);
    for (const source of sources)
      expect(
        repository.get(source.householdId, source.normalizedDescription),
      ).toEqual(source);
  });

  it("keeps an archived target readable without permitting new archived assignments", () => {
    repository.create(rule());
    store.sqlite
      .prepare("UPDATE categories SET status = 'archived' WHERE id = ?")
      .run("category-a");
    expect(repository.get("household-a", "Synthetic Descriptor")).toEqual(
      rule(),
    );
    expect(() =>
      repository.create(
        rule({ normalizedDescription: "Other synthetic descriptor" }),
      ),
    ).toThrow("Category rule creation requires an active Category.");
    expect(() =>
      repository.create(rule({ categoryId: "category-archived" })),
    ).toThrow("Category rule creation requires an active Category.");
    expect(
      store.sqlite.prepare("SELECT count(*) AS count FROM category_rules").get()
        ?.count,
    ).toBe(1);
  });

  it.each(["category-a", "category-b"])(
    "rejects repeated keys targeting %s without overwriting",
    (categoryId) => {
      repository.create(rule());
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => repository.create(rule({ categoryId }))).toThrow(
          "Category rule already exists for this Household and description.",
        );
        expect(repository.get("household-a", "Synthetic Descriptor")).toEqual(
          rule(),
        );
      }
    },
  );

  it.each([
    [
      "householdId",
      "missing-household",
      "Category rule must reference an existing Household.",
    ],
    [
      "categoryId",
      "missing-category",
      "Category rule must reference an existing Category.",
    ],
  ] as const)(
    "rejects missing %s before storing anything",
    (field, id, diagnostic) => {
      expect(() => repository.create(rule({ [field]: id }))).toThrow(
        diagnostic,
      );
      expect(
        store.sqlite
          .prepare("SELECT count(*) AS count FROM category_rules")
          .get()?.count,
      ).toBe(0);
    },
  );

  it.each(["householdId", "normalizedDescription", "categoryId"] as const)(
    "rejects invalid %s before SQL",
    (field) => {
      for (const value of ["", " \t\n ", null, undefined, 123, {}]) {
        expect(() =>
          repository.create({ ...rule(), [field]: value } as CategoryRule),
        ).toThrow(TypeError);
        expect(store.queries).toEqual([]);
      }
    },
  );

  it("rejects nonobject rules and invalid lookup inputs before SQL", () => {
    for (const value of [null, undefined, 123, "rule"])
      expect(() =>
        Reflect.apply(repository.create, repository, [value]),
      ).toThrow(TypeError);
    expect(() => repository.get(" \t", "Synthetic Descriptor")).toThrow(
      TypeError,
    );
    expect(() =>
      Reflect.apply(repository.get, repository, ["household-a", null]),
    ).toThrow(TypeError);
    expect(store.queries).toEqual([]);
  });

  it("enforces uniqueness and non-destructive foreign keys independently in SQLite", () => {
    repository.create(rule());
    const insert = store.sqlite.prepare(
      "INSERT INTO category_rules (household_id, normalized_description, category_id) VALUES (?, ?, ?)",
    );
    expect(() =>
      insert.run("household-a", "Synthetic Descriptor", "category-b"),
    ).toThrow(/UNIQUE constraint/i);
    expect(() =>
      insert.run("missing-household", "Other Descriptor", "category-a"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      insert.run("household-a", "Other Descriptor", "missing-category"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      store.sqlite
        .prepare("DELETE FROM categories WHERE id = ?")
        .run("category-a"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      store.sqlite
        .prepare("DELETE FROM households WHERE id = ?")
        .run("household-a"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(repository.get("household-a", "Synthetic Descriptor")).toEqual(
      rule(),
    );
  });

  it("rejects an ignored insert instead of reporting a remembered rule", () => {
    store.sqlite.exec(
      "CREATE TRIGGER ignore_rule BEFORE INSERT ON category_rules BEGIN SELECT RAISE(IGNORE); END;",
    );
    expect(() => repository.create(rule())).toThrow(
      "Category rule creation must store the supplied rule.",
    );
    expect(
      repository.get("household-a", "Synthetic Descriptor"),
    ).toBeUndefined();
  });

  it.each(["create", "get"] as const)(
    "sanitizes unexpected SQL errors from %s",
    (operation) => {
      store.sqlite.exec("DROP TABLE category_rules;");
      let error: unknown;
      try {
        if (operation === "create") repository.create(rule());
        else repository.get("household-a", "Synthetic Descriptor");
      } catch (caught) {
        error = caught;
      }
      expect(error).toEqual(
        new Error(
          `Category rule ${operation === "create" ? "creation" : "lookup"} failed.`,
        ),
      );
      expect(error).not.toHaveProperty("cause");
    },
  );

  it("rejects a malformed persisted rule safely", () => {
    store.sqlite
      .prepare("INSERT INTO category_rules VALUES (?, ?, ?)")
      .run("household-a", " \t", "category-a");
    expect(() => repository.get("household-a", " \t")).toThrow(
      new Error("Category rule lookup failed."),
    );
  });

  it("rejects corrupted referenced Categories safely", () => {
    repository.create(rule());
    store.sqlite.exec("PRAGMA ignore_check_constraints = ON;");
    store.sqlite
      .prepare("UPDATE categories SET status = ? WHERE id = ?")
      .run("unsupported", "category-a");
    expect(() => repository.get("household-a", "Synthetic Descriptor")).toThrow(
      new Error("Category rule lookup failed."),
    );
    expect(() =>
      repository.create(rule({ normalizedDescription: "Another descriptor" })),
    ).toThrow(new Error("Category rule creation failed."));
  });

  it("rejects dangling persisted references instead of returning an invalid rule", () => {
    store.sqlite.exec("PRAGMA foreign_keys = OFF;");
    store.sqlite
      .prepare("INSERT INTO category_rules VALUES (?, ?, ?)")
      .run("household-a", "Synthetic Descriptor", "missing-category");
    store.sqlite.exec("PRAGMA foreign_keys = ON;");
    expect(() => repository.get("household-a", "Synthetic Descriptor")).toThrow(
      "Category rule must reference an existing Category.",
    );
  });

  it("survives closing and reopening a migrated SQLite file", () => {
    const directory = mkdtempSync(join(tmpdir(), "ledgerase-category-rule-"));
    let fileStore: ReturnType<typeof createDatabase> | undefined;
    try {
      const filename = join(directory, "synthetic.db");
      fileStore = createDatabase(filename);
      seed(fileStore.database);
      new CategoryRuleRepository(fileStore.database).create(rule());
      fileStore.sqlite.close();
      fileStore = undefined;
      fileStore = createDatabase(filename, false);
      expect(
        new CategoryRuleRepository(fileStore.database).get(
          "household-a",
          "Synthetic Descriptor",
        ),
      ).toEqual(rule());
    } finally {
      fileStore?.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
