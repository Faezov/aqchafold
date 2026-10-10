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
import { normalizePaymentProcessorPrefix } from "../../merchants/src/index";
import { AccountRepository } from "./account-repository";
import { HouseholdRepository } from "./household-repository";
import { MerchantRepository } from "./merchant-repository";
import { MerchantRuleRepository } from "./merchant-rule-repository";
import * as schema from "./schema";
import {
  TransactionRepository,
  type TransactionCategoryAssignment,
} from "./transaction-repository";

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
  it("preserves source descriptions through conversion, SQLite, reads and repeated normalization", () => {
    // Keep the tracked multiline row; add only whitespace/Unicode and empty probes.
    const rawDescription = " \tPAYPAL *MiXeD  Café! 東京 e\u0301\nBranch \t\n ";
    const parsed = {
      ...source,
      rows: source.rows.map((row, index) =>
        index < 2
          ? { ...row, rawDescription: index === 0 ? rawDescription : "" }
          : row,
      ),
    };
    const parsedBefore = structuredClone(parsed);
    const records = convertCommBankBrowserSummaryToTransactions(parsed, {
      accountId: "confirmed-account",
      currency: "USD",
      currencyDecimalPlaces: 2,
      createTransactionId: (row) => `source-evidence-${row.position.row}`,
    });
    const recordsBefore = structuredClone(records);
    repository.createMany(records);
    const listed = repository.list();

    for (const [index, record] of records.entries()) {
      const original = parsed.rows[index].rawDescription;
      expect(record.rawDescription).toBe(original);
      expect(
        store.sqlite
          .prepare("SELECT raw_description FROM transactions WHERE id = ?")
          .get(record.id)?.raw_description,
      ).toBe(original);
      expect(repository.getById(record.id)?.rawDescription).toBe(original);
      expect(listed.find(({ id }) => id === record.id)?.rawDescription).toBe(
        original,
      );
    }

    for (const [index, normalizedDescription] of [
      [0, "MiXeD Café! 東京 e\u0301 Branch"],
      [1, ""],
      [3, "Direct Debit SYNTHETIC UTILITIES 91007382"],
    ] as const) {
      const restored = repository.getById(records[index].id)!;
      const original = parsed.rows[index].rawDescription;
      if (restored.rawDescription === undefined)
        throw new Error("Imported source description must remain established.");
      for (let repeat = 0; repeat < 3; repeat++) {
        expect(
          normalizePaymentProcessorPrefix(restored.rawDescription),
        ).toEqual({
          normalizedDescription,
        });
        expect(restored.rawDescription).toBe(original);
      }
      expect(repository.getById(restored.id)).toEqual(records[index]);
    }
    expect(parsed).toEqual(parsedBefore);
    expect(records).toEqual(recordsBefore);
    expect(repository.getById(baseline.id)?.rawDescription).toBeUndefined();
    expect(
      listed.find(({ id }) => id === baseline.id)?.rawDescription,
    ).toBeUndefined();
    expect(
      store.sqlite
        .prepare("SELECT raw_description FROM transactions WHERE id = ?")
        .get(baseline.id)?.raw_description,
    ).toBeNull();
  });

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

describe("TransactionRepository.list with real SQLite and the Expo Drizzle driver", () => {
  it("returns an empty list without creating Transactions", () => {
    store.database.delete(schema.transactions).run();
    expect(repository.list()).toEqual([]);
    expect(storedIds()).toEqual([]);
  });

  it("orders newest posting dates first and tied dates by ID, independently of insertion order", () => {
    const newestZ = new Transaction({
      ...baseline,
      id: "z-newest",
      postingDate: "2036-03-02",
      origin: "manual",
    });
    const middle = new Transaction({
      ...baseline,
      id: "middle",
      postingDate: "2036-02-01",
      origin: "manual",
    });
    const newestA = new Transaction({
      ...newestZ,
      id: "a-newest",
      origin: "manual",
    });
    repository.createMany([newestZ, middle, newestA]);
    expect(repository.list()).toEqual([newestA, newestZ, middle, baseline]);
  });

  it("preserves canonical Money, signs, zero, descriptions, currencies and optional references", () => {
    new AccountRepository(store.database).create(
      new Account({
        id: "other-account",
        householdId: "test-household",
        label: "Synthetic other account",
        type: "savings",
        status: "active",
        primaryCurrency: "EUR",
        ownership: { kind: "unknown" },
      }),
    );
    const records = [
      new Transaction({
        ...baseline,
        id: "a-negative",
        amount: new Money(-3847, "USD"),
        origin: "manual",
        rawDescription: "  Original description\nUnchanged  ",
      }),
      copy(converted[0], {
        id: "b-zero",
        postingDate: baseline.postingDate,
        amount: new Money(0, "USD"),
        rawDescription: "",
      }),
      copy(converted[0], {
        id: "c-positive",
        postingDate: baseline.postingDate,
        transactionDate: "2036-01-30",
        amount: new Money(3847, "USD"),
        rawDescription: "SYNTHETIC REFUND",
        merchantId: "test-merchant",
        categoryId: "test-category",
      }),
      new Transaction({
        ...baseline,
        id: "d-other-currency",
        accountId: "other-account",
        amount: new Money(-500, "EUR"),
        origin: "manual",
      }),
    ];
    repository.createMany([...records].reverse());
    const listed = repository.list();
    expect(listed).toEqual([...records, baseline]);
    for (const transaction of listed) {
      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.amount).toBeInstanceOf(Money);
    }
    expect(listed[1].amount.amountMinor).toBe(0);
    expect(listed[1].rawDescription).toBe("");
    expect(listed[4].rawDescription).toBeUndefined();
  });

  it("reads newly persisted Transactions on a subsequent list call", () => {
    expect(repository.list()).toEqual([baseline]);
    const transaction = new Transaction({
      ...baseline,
      id: "new-transaction",
      postingDate: "2036-02-01",
      origin: "manual",
    });
    repository.create(transaction);
    expect(repository.list()).toEqual([transaction, baseline]);
  });

  it.each([
    [
      "malformed posting date",
      "UPDATE transactions SET posting_date = '2036-02-30' WHERE id = 'invalid';",
      /date/i,
    ],
    [
      "missing imported description",
      "PRAGMA ignore_check_constraints = ON; UPDATE transactions SET raw_description = NULL WHERE id = 'invalid';",
      /description/i,
    ],
    [
      "missing Account",
      "PRAGMA foreign_keys = OFF; DELETE FROM accounts;",
      /existing Account/,
    ],
    [
      "mismatched Account currency",
      "UPDATE transactions SET currency = 'AUD' WHERE id = 'invalid';",
      /currency.*Account/i,
    ],
    [
      "missing Merchant",
      "PRAGMA foreign_keys = OFF; DELETE FROM merchants;",
      /existing Merchant/,
    ],
    [
      "missing Category",
      "PRAGMA foreign_keys = OFF; DELETE FROM categories;",
      /existing Category/,
    ],
  ] as const)(
    "rejects %s instead of returning a partial list",
    (_, sql, diagnostic) => {
      repository.create(
        copy(converted[0], {
          id: "invalid",
          postingDate: baseline.postingDate,
          merchantId: "test-merchant",
          categoryId: "test-category",
        }),
      );
      store.sqlite.exec(sql);
      expect(() => repository.list()).toThrow(diagnostic);
    },
  );
});

describe("explicit Transaction category assignment", () => {
  const categorized = new Transaction({
    id: "categorized-transaction",
    accountId: baseline.accountId,
    postingDate: "2400-03-01",
    transactionDate: "2400-02-29",
    amount: new Money(-1234, "USD"),
    origin: "imported",
    rawDescription: " \tSynthetic Café!\r\nRetained evidence ",
    merchantId: "test-merchant",
    categoryId: "test-category",
  });
  const assignment: TransactionCategoryAssignment = Object.freeze({
    householdId: "test-household",
    transactionIds: Object.freeze([baseline.id, categorized.id]),
    categoryId: "active-category",
  });
  const rows = () =>
    store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all();
  const updates = () =>
    store.queries.filter((query) => /^update /i.test(query));

  beforeEach(() => {
    store.database
      .insert(schema.categories)
      .values(
        new Category({
          id: assignment.categoryId,
          name: "Active synthetic category",
          status: "active",
        }),
      )
      .run();
    repository.create(categorized);
    store.queries.length = 0;
  });

  it("assigns and replaces only category_id, persists on re-read, and leaves rules and unselected rows unchanged", () => {
    const unselected = new Transaction({
      ...baseline,
      id: "unselected",
      origin: "manual",
    });
    repository.create(unselected);
    store.sqlite.exec(
      readFileSync(
        new URL("../drizzle/0002_merchant_rules.sql", import.meta.url),
        "utf8",
      ),
    );
    const rules = new MerchantRuleRepository(store.database);
    const rule = {
      householdId: assignment.householdId,
      normalizedDescription: "Synthetic Café!",
      merchantId: "test-merchant",
    };
    rules.create(rule);
    const before = rows();
    const sources = [baseline, categorized, unselected].map((value) => ({
      ...value,
    }));
    store.queries.length = 0;

    repository.assignCategory(assignment);

    expect(boundaries()).toEqual(["begin immediate", "commit"]);
    expect(updates()).toHaveLength(2);
    expect(rows()).toEqual(
      before.map((row) =>
        assignment.transactionIds.includes(row.id as string)
          ? { ...row, category_id: assignment.categoryId }
          : row,
      ),
    );
    const reread = new TransactionRepository(store.database);
    expect(reread.getById(baseline.id)).toEqual(
      new Transaction({
        ...baseline,
        categoryId: assignment.categoryId,
        origin: "manual",
      }),
    );
    expect(reread.getById(categorized.id)).toEqual(
      new Transaction({
        ...categorized,
        categoryId: assignment.categoryId,
        origin: "imported",
        rawDescription: categorized.rawDescription!,
      }),
    );
    expect(reread.getById(unselected.id)).toEqual(unselected);
    expect([baseline, categorized, unselected]).toEqual(sources);
    expect(rules.list(assignment.householdId)).toEqual([rule]);
    expect(assignment.transactionIds).toEqual([baseline.id, categorized.id]);
  });

  it("rejects a later missing Transaction before any update", () => {
    const before = rows();
    expect(() =>
      repository.assignCategory({
        ...assignment,
        transactionIds: [baseline.id, "missing-transaction"],
      }),
    ).toThrow("Category assignment requires existing Transactions.");
    expect(boundaries()).toEqual(["begin immediate", "rollback"]);
    expect(updates()).toEqual([]);
    expect(rows()).toEqual(before);
  });

  it("rejects a later foreign-Household Transaction and keeps globally modeled Categories usable independently", () => {
    store.database
      .insert(schema.households)
      .values({ id: "other-household", label: "Other synthetic household" })
      .run();
    new AccountRepository(store.database).create(
      new Account({
        id: "other-account",
        householdId: "other-household",
        label: "Other synthetic account",
        type: "transaction",
        status: "active",
        primaryCurrency: "USD",
        ownership: { kind: "unknown" },
      }),
    );
    const foreign = new Transaction({
      ...baseline,
      id: "other-transaction",
      accountId: "other-account",
      origin: "manual",
    });
    repository.create(foreign);
    const before = rows();
    store.queries.length = 0;
    expect(() =>
      repository.assignCategory({
        ...assignment,
        transactionIds: [baseline.id, foreign.id],
      }),
    ).toThrow(
      "Category assignment requires Transactions in the supplied Household.",
    );
    expect(updates()).toEqual([]);
    expect(rows()).toEqual(before);
    repository.assignCategory({
      ...assignment,
      householdId: "other-household",
      transactionIds: [foreign.id],
    });
    expect(repository.getById(foreign.id)?.categoryId).toBe(
      assignment.categoryId,
    );
    expect(repository.getById(baseline.id)).toEqual(baseline);
  });

  it("accepts explicit same-Household IDs across currencies without changing Money", () => {
    new AccountRepository(store.database).create(
      new Account({
        id: "aud-account",
        householdId: assignment.householdId,
        label: "Synthetic AUD account",
        type: "transaction",
        status: "active",
        primaryCurrency: "AUD",
        ownership: { kind: "unknown" },
      }),
    );
    const aud = new Transaction({
      ...baseline,
      id: "aud-transaction",
      accountId: "aud-account",
      amount: new Money(-2345, "AUD"),
      origin: "manual",
    });
    repository.create(aud);
    repository.assignCategory({
      ...assignment,
      transactionIds: [baseline.id, aud.id],
    });
    expect(repository.getById(aud.id)).toEqual(
      new Transaction({
        ...aud,
        categoryId: assignment.categoryId,
        origin: "manual",
      }),
    );
    expect(repository.getById(baseline.id)?.amount).toEqual(baseline.amount);
    expect(repository.getById(categorized.id)).toEqual(categorized);
  });

  it.each([
    ["missing-category", "Category assignment requires an existing Category."],
    ["test-category", "Category assignment requires an active Category."],
  ])(
    "rejects unavailable target %s without changing existing archived references",
    (categoryId, message) => {
      const before = rows();
      expect(() =>
        repository.assignCategory({ ...assignment, categoryId }),
      ).toThrow(message);
      expect(updates()).toEqual([]);
      expect(rows()).toEqual(before);
      expect(repository.getById(categorized.id)).toEqual(categorized);
    },
  );

  it.each(["householdId", "categoryId"] as const)(
    "validates %s before SQL",
    (field) => {
      for (const value of ["", " \t\n ", null, undefined, 42]) {
        expect(() =>
          repository.assignCategory({
            ...assignment,
            [field]: value,
          } as unknown as TransactionCategoryAssignment),
        ).toThrow(TypeError);
        expect(store.queries).toEqual([]);
      }
    },
  );

  it.each([
    ["empty", []],
    ["duplicate", [baseline.id, baseline.id]],
    ["blank", [baseline.id, " \t "]],
    ["non-string", [baseline.id, 42]],
    ["missing", undefined],
    ["null", null],
    ["string", baseline.id],
  ])("rejects %s Transaction IDs before SQL", (_, transactionIds) => {
    expect(() =>
      repository.assignCategory({
        ...assignment,
        transactionIds,
      } as unknown as TransactionCategoryAssignment),
    ).toThrow(TypeError);
    expect(store.queries).toEqual([]);
  });

  it.each([null, undefined, 42, "assignment"])(
    "rejects non-object request %j before SQL",
    (input) => {
      expect(() =>
        repository.assignCategory(
          input as unknown as TransactionCategoryAssignment,
        ),
      ).toThrow(TypeError);
      expect(store.queries).toEqual([]);
    },
  );

  it("preserves exact opaque IDs without trimming or text normalization", () => {
    const categoryId = " active-category ";
    store.database
      .insert(schema.categories)
      .values(
        new Category({
          id: categoryId,
          name: "Another synthetic category",
          status: "active",
        }),
      )
      .run();
    const transaction = new Transaction({
      ...baseline,
      id: " transaction-id ",
      origin: "manual",
    });
    repository.create(transaction);
    repository.assignCategory({
      ...assignment,
      categoryId,
      transactionIds: [transaction.id],
    });
    expect(repository.getById(transaction.id)?.categoryId).toBe(categoryId);
    expect(repository.getById("transaction-id")).toBeUndefined();
  });

  it.each(["ABORT", "IGNORE"] as const)(
    "rolls back the whole batch when a later write raises %s",
    (failure) => {
      const before = rows();
      store.sqlite.exec(`
      CREATE TRIGGER fail_category_update BEFORE UPDATE OF category_id ON transactions
      WHEN NEW.id = 'categorized-transaction'
      BEGIN SELECT RAISE(${failure === "ABORT" ? "ABORT, 'synthetic secret SQL details'" : "IGNORE"}); END;
    `);
      let caught: unknown;
      try {
        repository.assignCategory(assignment);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(
        failure === "ABORT"
          ? "Transaction category assignment failed."
          : "Category assignment must update every supplied Transaction.",
      );
      expect((caught as Error).cause).toBeUndefined();
      expect(boundaries()).toEqual(["begin immediate", "rollback"]);
      expect(updates()).toHaveLength(2);
      expect(rows()).toEqual(before);
    },
  );

  it("rejects invalid stored Category status safely", () => {
    store.sqlite.exec(
      "PRAGMA ignore_check_constraints = ON; UPDATE categories SET status = 'invalid-status' WHERE id = 'active-category';",
    );
    const before = rows();
    expect(() => repository.assignCategory(assignment)).toThrow(
      "Transaction category assignment failed.",
    );
    expect(updates()).toEqual([]);
    expect(rows()).toEqual(before);
  });

  it("rejects corrupt Transaction evidence instead of silently repairing it", () => {
    store.sqlite.exec(
      "UPDATE transactions SET posting_date = '2400-02-30' WHERE id = 'categorized-transaction';",
    );
    const before = rows();
    expect(() => repository.assignCategory(assignment)).toThrow(
      "Transaction category assignment failed.",
    );
    expect(updates()).toEqual([]);
    expect(rows()).toEqual(before);
  });
});
