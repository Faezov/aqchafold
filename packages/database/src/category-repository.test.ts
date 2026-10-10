/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import { Category } from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CategoryRepository } from "./category-repository";
import * as schema from "./schema";

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
  const database = drizzle(client as unknown as Parameters<typeof drizzle>[0], {
    schema,
  });
  return { sqlite, database };
}

let store: ReturnType<typeof createDatabase>;
let repository: CategoryRepository;

beforeEach(() => {
  store = createDatabase();
  repository = new CategoryRepository(store.database);
});
afterEach(() => store.sqlite.close());

describe("CategoryRepository", () => {
  it.each(["active", "archived"] as const)(
    "returns a canonical %s Category without changing its stored text",
    (status) => {
      const category = new Category({
        id: " category-id ",
        name: " Synthetic Category! ",
        status,
      });
      store.database.insert(schema.categories).values(category).run();
      const actual = repository.getById(category.id);
      expect(actual).toEqual(category);
      expect(actual).toBeInstanceOf(Category);
      expect(Object.isFrozen(actual)).toBe(true);
      expect(repository.getById("category-id")).toBeUndefined();
      expect(repository.list()).toEqual([category]);
    },
  );

  it("returns undefined for a missing ID and an empty list before Categories exist", () => {
    expect(repository.getById("missing-category")).toBeUndefined();
    expect(repository.list()).toEqual([]);
  });

  it("lists active and archived Categories deterministically by BINARY name then ID", () => {
    const rows = [
      { id: "category-z", name: "Synthetic A", status: "active" },
      { id: "category-c", name: "synthetic A", status: "active" },
      { id: "category-b", name: "Synthetic B", status: "active" },
      { id: "category-a", name: "Synthetic A", status: "archived" },
    ] as const;
    store.database
      .insert(schema.categories)
      .values([...rows])
      .run();
    const expected = [rows[3], rows[0], rows[2], rows[1]].map(
      (row) => new Category(row),
    );
    expect(repository.list()).toEqual(expected);
    expect(repository.list()).toEqual(expected);
    expect(repository.list().every((value) => value instanceof Category)).toBe(
      true,
    );
  });

  it("rejects empty, blank and nonstring lookup IDs without SQL error details", () => {
    for (const id of ["", " \t\r\n", undefined, null, 123, {}]) {
      expect(() => Reflect.apply(repository.getById, repository, [id])).toThrow(
        new TypeError("Category ID must be a nonblank string."),
      );
    }
  });

  it.each([
    { id: "", name: "Synthetic Category", status: "active" },
    { id: " \t", name: "Synthetic Category", status: "active" },
    { id: "invalid-category", name: " \t", status: "active" },
    {
      id: "invalid-category",
      name: "Synthetic Category",
      status: "unsupported",
    },
  ])("rejects an invalid persisted Category safely", (row) => {
    store.sqlite.exec("PRAGMA ignore_check_constraints = ON;");
    store.sqlite
      .prepare("INSERT INTO categories (id, name, status) VALUES (?, ?, ?)")
      .run(row.id, row.name, row.status);
    // Nonblank ID validation takes precedence for invalid caller inputs.
    if (row.id.trim().length !== 0) {
      expect(() => repository.getById(row.id)).toThrow(
        new Error("Category lookup failed."),
      );
    }
    expect(() => repository.list()).toThrow(
      new Error("Category listing failed."),
    );
  });

  it("sanitizes SQL failures without attaching underlying errors", () => {
    store.sqlite.exec("DROP TABLE categories;");
    for (const [operation, message] of [
      [() => repository.getById("synthetic-id"), "Category lookup failed."],
      [() => repository.list(), "Category listing failed."],
    ] as const) {
      let error: unknown;
      try {
        operation();
      } catch (caught) {
        error = caught;
      }
      expect(error).toEqual(new Error(message));
      expect(error).not.toHaveProperty("cause");
    }
  });
});
