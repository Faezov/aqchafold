/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import {
  Account,
  Category,
  Household,
  Merchant,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  commbankBrowserSummaryImporter,
  convertCommBankBrowserSummaryToTransactions,
} from "../../importers/commbank/src/index";
import { AccountRepository } from "./account-repository";
import { HouseholdRepository } from "./household-repository";
import { MerchantRepository } from "./merchant-repository";
import * as schema from "./schema";
import { TransactionRepository } from "./transaction-repository";

// Exercise the production Expo Drizzle driver with real SQLite, without loading
// Expo's native module in Node. Only its synchronous SQL boundary is adapted.
function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(
    readFileSync(
      new URL("../drizzle/0000_initial.sql", import.meta.url),
      "utf8",
    ),
  );
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

let store: ReturnType<typeof createDatabase>;
let repository: TransactionRepository;
let source: Awaited<ReturnType<typeof commbankBrowserSummaryImporter.parse>>;
let converted: readonly Transaction[];
const baseline = new Transaction({
  id: "existing-transaction",
  accountId: "confirmed-account",
  postingDate: "2036-01-31",
  amount: new Money(17, "USD"),
  origin: "manual",
});

beforeAll(async () => {
  source = await commbankBrowserSummaryImporter.parse({
    bytes: new Uint8Array(
      readFileSync(
        new URL(
          "../../../fixtures/bank-statements/commbank/browser-summary-01.pdf",
          import.meta.url,
        ),
      ),
    ),
  });
  converted = convertCommBankBrowserSummaryToTransactions(source, {
    accountId: "confirmed-account",
    currency: "USD",
    currencyDecimalPlaces: 2,
    createTransactionId: (row) => `fixture-transaction-${row.position.row}`,
  });
});

beforeEach(() => {
  store = createDatabase();
  new HouseholdRepository(store.database).create(
    new Household({ id: "test-household", label: "Synthetic household" }),
  );
  new AccountRepository(store.database).create(
    new Account({
      id: "confirmed-account",
      householdId: "test-household",
      label: "Synthetic account",
      type: "transaction",
      status: "closed",
      primaryCurrency: "USD",
      ownership: { kind: "household-level" },
    }),
  );
  new MerchantRepository(store.database).create(
    new Merchant({ id: "test-merchant", displayName: "Synthetic merchant" }),
  );
  store.database
    .insert(schema.categories)
    .values(
      new Category({
        id: "test-category",
        name: "Synthetic category",
        status: "archived",
      }),
    )
    .run();
  repository = new TransactionRepository(store.database);
  repository.create(baseline);
  store.queries.length = 0;
});

afterEach(() => store.sqlite.close());

function copy(
  transaction: Transaction,
  patch: Partial<Transaction> = {},
): Transaction {
  return new Transaction({
    ...transaction,
    origin: "imported",
    rawDescription: transaction.rawDescription!,
    ...patch,
  });
}

function boundaries(): string[] {
  return store.queries.filter((query) =>
    /^(begin|commit|rollback)/i.test(query),
  );
}

function storedIds(): string[] {
  return store.sqlite
    .prepare("SELECT id FROM transactions ORDER BY rowid")
    .all()
    .map((row) => row.id as string);
}

function expectRollback(
  records: readonly Transaction[],
  diagnostic?: RegExp,
): void {
  const before = structuredClone(records);
  if (diagnostic)
    expect(() => repository.createMany(records)).toThrow(diagnostic);
  else expect(() => repository.createMany(records)).toThrow();
  expect(boundaries()).toEqual(["begin immediate", "rollback"]);
  expect(storedIds()).toEqual([baseline.id]);
  expect(repository.getById(baseline.id)).toEqual(baseline);
  expect(records).toEqual(before);
}

describe("TransactionRepository with real SQLite and the Expo Drizzle driver", () => {
  it("atomically roundtrips all eleven converted fixture movements without changing source data", () => {
    const sourceBefore = structuredClone(source);
    const convertedBefore = structuredClone(converted);
    repository.createMany(converted);
    expect(boundaries()).toEqual(["begin immediate", "commit"]);
    const restored = converted.map(({ id }) => repository.getById(id)!);
    expect(restored).toHaveLength(11);
    expect(restored).toEqual(converted);
    expect(restored.map(({ amount }) => amount.amountMinor)).toEqual([
      -3847, -11283, 128376, -2419, -14562, 9457, -753, 21548, -8341, -5628,
      61239,
    ]);
    for (const [index, transaction] of restored.entries()) {
      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.amount).toBeInstanceOf(Money);
      expect(transaction.amount.currency).toBe("USD");
      expect(transaction.accountId).toBe("confirmed-account");
      expect(transaction.postingDate).toBe(source.rows[index].postingDate);
      expect(transaction.rawDescription).toBe(
        source.rows[index].rawDescription,
      );
      expect(transaction.origin).toBe("imported");
    }
    expect(
      store.database
        .select()
        .from(schema.transactions)
        .all()
        .slice(1)
        .every(
          ({ transactionDate, merchantId, categoryId }) =>
            transactionDate === null &&
            merchantId === null &&
            categoryId === null,
        ),
    ).toBe(true);
    expect(source).toEqual(sourceBefore);
    expect(converted).toEqual(convertedBefore);
    expect(source.metadata.currency).toBeUndefined();
  });

  it("inserts in supplied order, observed through an explicit SQLite rowid order", () => {
    const records = [...converted].reverse();
    repository.createMany(records);
    expect(storedIds()).toEqual([baseline.id, ...records.map(({ id }) => id)]);
  });

  it("preserves manual absence, imported empty descriptions, zero and signed amounts", () => {
    const records = [
      new Transaction({
        ...baseline,
        id: "manual-negative",
        origin: "manual",
        amount: new Money(-1, "USD"),
      }),
      copy(converted[0], {
        id: "imported-zero",
        rawDescription: "",
        amount: new Money(0, "USD"),
      }),
      copy(converted[0], {
        id: "imported-positive",
        amount: new Money(1, "USD"),
      }),
    ];
    repository.createMany(records);
    expect(records.map(({ id }) => repository.getById(id))).toEqual(records);
    expect(
      store.sqlite
        .prepare("SELECT raw_description FROM transactions WHERE id = ?")
        .get("manual-negative")?.raw_description,
    ).toBeNull();
    expect(
      store.sqlite
        .prepare("SELECT raw_description FROM transactions WHERE id = ?")
        .get("imported-zero")?.raw_description,
    ).toBe("");
  });

  it("keeps an empty batch a strict SQL no-op", () => {
    repository.createMany([]);
    expect(store.queries).toEqual([]);
    expect(storedIds()).toEqual([baseline.id]);
  });

  it("allows batch references to a closed Account, existing Merchant, and archived Category", () => {
    const records = [
      copy(converted[0], {
        transactionDate: "2036-02-01",
        merchantId: "test-merchant",
        categoryId: "test-category",
      }),
      copy(converted[1], { categoryId: "test-category" }),
    ];
    repository.createMany(records);
    expect(boundaries()).toEqual(["begin immediate", "commit"]);
    expect(records.map(({ id }) => repository.getById(id))).toEqual(records);
  });

  it.each([
    [
      "invalid domain date",
      (transaction: Transaction) =>
        ({ ...transaction, postingDate: "2036-02-30" }) as Transaction,
      /date/i,
    ],
    [
      "missing imported description",
      (transaction: Transaction) =>
        ({ ...transaction, rawDescription: undefined }) as Transaction,
      /description/i,
    ],
    [
      "missing Account",
      (transaction: Transaction) =>
        copy(transaction, { accountId: "missing-account" }),
      /existing Account/,
    ],
    [
      "mismatched currency",
      (transaction: Transaction) =>
        copy(transaction, {
          amount: new Money(transaction.amount.amountMinor, "AUD"),
        }),
      /currency.*Account/i,
    ],
    [
      "missing Merchant",
      (transaction: Transaction) =>
        copy(transaction, { merchantId: "missing-merchant" }),
      /existing Merchant/,
    ],
    [
      "missing Category",
      (transaction: Transaction) =>
        copy(transaction, { categoryId: "missing-category" }),
      /existing Category/,
    ],
  ] as const)(
    "rolls back earlier inserts when a later record has %s",
    (_, corrupt, diagnostic) => {
      const records = converted.map((transaction, index) =>
        index === 5 ? corrupt(transaction) : transaction,
      );
      expectRollback(records, diagnostic);
    },
  );

  it("rolls back duplicate primary keys within the batch without merging records", () => {
    const records = converted.map((transaction, index) =>
      index === 5 ? copy(transaction, { id: converted[0].id }) : transaction,
    );
    expectRollback(records);
  });

  it("rolls back on an already-persisted primary key without changing existing records", () => {
    repository.create(converted[5]);
    store.queries.length = 0;
    expect(() => repository.createMany(converted)).toThrow();
    expect(boundaries()).toEqual(["begin immediate", "rollback"]);
    expect(storedIds()).toEqual([baseline.id, converted[5].id]);
    expect(repository.getById(converted[5].id)).toEqual(converted[5]);
    expect(repository.getById(baseline.id)).toEqual(baseline);
  });

  it("rolls back a real foreign-key failure after reference validation, including trigger changes", () => {
    const records = converted.map((transaction, index) =>
      index === 5
        ? copy(transaction, { merchantId: "test-merchant" })
        : transaction,
    );
    store.sqlite.exec(`
      CREATE TRIGGER remove_batch_merchant BEFORE INSERT ON transactions
      WHEN NEW.id = 'fixture-transaction-6'
      BEGIN DELETE FROM merchants WHERE id = 'test-merchant'; END;
    `);
    expectRollback(records);
    expect(
      new MerchantRepository(store.database).getById("test-merchant"),
    ).toEqual(
      new Merchant({ id: "test-merchant", displayName: "Synthetic merchant" }),
    );
  });

  it("preserves single-record create with a closed Account and archived Category references", () => {
    const transaction = copy(converted[0], {
      transactionDate: "2036-02-01",
      merchantId: "test-merchant",
      categoryId: "test-category",
    });
    repository.create(transaction);
    expect(boundaries()).toEqual(["begin immediate", "commit"]);
    expect(repository.getById(transaction.id)).toEqual(transaction);
  });

  it("keeps single-record invalid-domain rejection before SQL execution", () => {
    const invalid = {
      ...converted[0],
      postingDate: "2036-02-30",
    } as Transaction;
    expect(() => repository.create(invalid)).toThrow(/date/i);
    expect(store.queries).toEqual([]);
    expect(storedIds()).toEqual([baseline.id]);
  });

  it("keeps single-record reference validation and rollback", () => {
    const invalid = copy(converted[0], { accountId: "missing-account" });
    expect(() => repository.create(invalid)).toThrow(/existing Account/);
    expect(boundaries()).toEqual(["begin immediate", "rollback"]);
    expect(storedIds()).toEqual([baseline.id]);
  });
});
