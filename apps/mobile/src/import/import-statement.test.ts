/// <reference path="../../../../packages/database/node_modules/@types/node/index.d.ts" />

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import { Account, Household, Money, Transaction } from "@aqchafold/domain";
import {
  commbankBrowserSummaryImporter,
  convertCommBankBrowserSummaryToTransactions,
} from "@aqchafold/importers-commbank";
import { fingerprintDocumentInput } from "@aqchafold/importers-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountRepository } from "../../../../packages/database/src/account-repository";
import { CategoryRepository } from "../../../../packages/database/src/category-repository";
import { CategoryRuleRepository } from "../../../../packages/database/src/category-rule-repository";
import type { openLedgeraseDatabase } from "../../../../packages/database/src/database";
import { HouseholdRepository } from "../../../../packages/database/src/household-repository";
import {
  DuplicateImportError,
  ImportRepository,
} from "../../../../packages/database/src/import-repository";
import * as schema from "../../../../packages/database/src/schema";
import { TransactionRepository } from "../../../../packages/database/src/transaction-repository";
import {
  importStatement,
  type ImportStatementOptions,
} from "./import-statement";

// Replace only the native-loading barrel with its real repository exports.
vi.mock(
  "@aqchafold/database",
  async () => import("../../../../packages/database/src/import-repository"),
);

const { drizzle } = createRequire(
  new URL("../../../../packages/database/package.json", import.meta.url),
)("drizzle-orm/expo-sqlite/driver") as {
  drizzle: (
    client: unknown,
    options: { schema: typeof schema },
  ) => ReturnType<typeof openLedgeraseDatabase>;
};

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const journal = JSON.parse(
    readFileSync(
      new URL(
        "../../../../packages/database/drizzle/meta/_journal.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries)
    sqlite.exec(
      readFileSync(
        new URL(
          `../../../../packages/database/drizzle/${tag}.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  // Production Expo Drizzle driver, real SQLite, test-only native boundary adapter.
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
  const database = drizzle(client, { schema });
  return { sqlite, database };
}

const bytes = new Uint8Array(
  readFileSync(
    new URL(
      "../../../../fixtures/bank-statements/commbank/browser-summary-01.pdf",
      import.meta.url,
    ),
  ),
);
let store: ReturnType<typeof createDatabase>;
let options: ImportStatementOptions;
let transactions: TransactionRepository;
let imports: ImportRepository;

beforeEach(() => {
  store = createDatabase();
  new HouseholdRepository(store.database).create(
    new Household({ id: "household", label: "Synthetic household" }),
  );
  const accounts = new AccountRepository(store.database);
  accounts.create(
    new Account({
      id: "account",
      householdId: "household",
      label: "Confirmed USD account",
      type: "transaction",
      status: "active",
      primaryCurrency: "USD",
      ownership: { kind: "household-level" },
    }),
  );
  transactions = new TransactionRepository(store.database);
  imports = new ImportRepository(store.database);
  let attempt = 0;
  options = {
    document: {
      uri: "content://provider/opaque-document",
      name: "statement.pdf",
    },
    accountId: "account",
    confirmedCurrency: "USD",
    currencyDecimalPlaces: 2,
    accountRepository: accounts,
    categoryRepository: new CategoryRepository(store.database),
    categoryRuleRepository: new CategoryRuleRepository(store.database),
    importRepository: imports,
    readDocumentBytes: vi.fn(async () => bytes),
    createImportId: () => `attempt-${++attempt}`,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  store.sqlite.close();
});

function expectNoPersistence() {
  expect(transactions.list()).toEqual([]);
  expect(store.sqlite.prepare("SELECT id FROM imports").all()).toEqual([]);
}

it("imports exact selected bytes as eleven canonical Transactions and a completed Import", async () => {
  const original = bytes.slice();
  expect(transactions.list()).toEqual([]);
  expect(await importStatement(options)).toEqual({
    status: "imported",
    transactionCount: 11,
    reconciliation: {
      totalRows: 11,
      verifiedRows: 11,
      closingBalance: "verified",
    },
  });
  expect(options.readDocumentBytes).toHaveBeenCalledExactlyOnceWith(
    options.document.uri,
  );
  expect(bytes).toEqual(original);
  expect(imports.getById("attempt-1")).toMatchObject({
    householdId: "household",
    confirmedAccountId: "account",
    processingStatus: "completed",
    originalFilename: "statement.pdf",
    fingerprint: fingerprintDocumentInput({ bytes: original }),
    parser: { id: "commbank-browser-transaction-summary", version: "0.0.0" },
  });
  const persisted = transactions.list();
  expect(persisted).toHaveLength(11);
  expect(persisted.map(({ id }) => id)).toEqual(
    [11, 10, 9, 8, 6, 7, 5, 3, 4, 1, 2].map(
      (row) => `attempt-1:transaction:1:${row}`,
    ),
  );
  for (const transaction of persisted) {
    expect(transaction).toBeInstanceOf(Transaction);
    expect(transaction.accountId).toBe("account");
    expect(transaction.amount.currency).toBe("USD");
    expect(transaction.origin).toBe("imported");
    expect(transaction.categoryId).toBeUndefined();
  }
});

it("refuses an identical artifact with another filename and preserves a failed retry", async () => {
  expect(await importStatement(options)).toEqual({
    status: "imported",
    transactionCount: 11,
    reconciliation: {
      totalRows: 11,
      verifiedRows: 11,
      closingBalance: "verified",
    },
  });
  const before = transactions.list();
  expect(
    await importStatement({
      ...options,
      document: { ...options.document, name: "renamed-copy.pdf" },
    }),
  ).toEqual({ status: "already-imported" });
  expect(transactions.list()).toEqual(before);
  expect(imports.getById("attempt-1")?.processingStatus).toBe("completed");
  expect(imports.getById("attempt-2")).toMatchObject({
    processingStatus: "failed",
    originalFilename: "renamed-copy.pdf",
    fingerprint: imports.getById("attempt-1")?.fingerprint,
  });
});

it("declines unsupported bytes without creating an attempt", async () => {
  expect(
    await importStatement({
      ...options,
      readDocumentBytes: async () => new Uint8Array([1, 2, 3]),
    }),
  ).toEqual({ status: "unsupported" });
  expectNoPersistence();
});

it("refuses an unreconciled supported statement before creating an attempt", async () => {
  const changed = bytes.slice();
  const closing = "($8,145.22)";
  const offset = Buffer.from(changed).indexOf(closing);
  expect(offset).toBeGreaterThan(0);
  // Change only the final digit of the header balance; PDF object offsets stay valid.
  changed[offset + closing.length - 2] = "3".charCodeAt(0);
  const parsed = await commbankBrowserSummaryImporter.parse({ bytes: changed });
  expect(parsed.reconciliation?.closingBalance).toBe("mismatch");
  expect(
    await importStatement({
      ...options,
      readDocumentBytes: async () => changed,
    }),
  ).toEqual({
    status: "reconciliation-failed",
    reconciliation: {
      totalRows: 11,
      verifiedRows: 11,
      closingBalance: "mismatch",
    },
  });
  expectNoPersistence();
});

it.each([
  { debit: "38.48", status: "mismatch" },
  { debit: "38.4x", status: "unresolved" },
] as const)(
  "reports $status row checks from a supported PDF without importing",
  async ({ debit, status }) => {
    const changed = bytes.slice();
    const offset = Buffer.from(changed).indexOf("(38.47)");
    expect(offset).toBeGreaterThan(0);
    changed.set(new TextEncoder().encode(debit), offset + 1);
    const parsed = await commbankBrowserSummaryImporter.parse({
      bytes: changed,
    });
    expect(parsed.reconciliation?.rows[0].status).toBe(status);
    expect(
      await importStatement({
        ...options,
        readDocumentBytes: async () => changed,
      }),
    ).toEqual({
      status: "reconciliation-failed",
      reconciliation: {
        totalRows: 11,
        verifiedRows: 10,
        closingBalance: "verified",
      },
    });
    expectNoPersistence();
  },
);

it("reports unresolved closing evidence without treating verified rows as a successful import", async () => {
  const changed = bytes.slice();
  const closing = "($8,145.22)";
  const offset = Buffer.from(changed).indexOf(closing);
  expect(offset).toBeGreaterThan(0);
  changed[offset + closing.length - 2] = "x".charCodeAt(0);
  const parsed = await commbankBrowserSummaryImporter.parse({ bytes: changed });
  expect(parsed.reconciliation?.closingBalance).toBe("unresolved");
  expect(
    await importStatement({
      ...options,
      readDocumentBytes: async () => changed,
    }),
  ).toEqual({
    status: "reconciliation-failed",
    reconciliation: {
      totalRows: 11,
      verifiedRows: 11,
      closingBalance: "unresolved",
    },
  });
  expectNoPersistence();
});

it("counts the explicit reconciliation checks instead of source rows and copies no source details", async () => {
  const parsed = await commbankBrowserSummaryImporter.parse({ bytes });
  expect(parsed.rows).toHaveLength(11);
  vi.spyOn(commbankBrowserSummaryImporter, "parse").mockResolvedValueOnce({
    ...parsed,
    reconciliation: {
      rows: [
        { position: { page: 1, row: 1 }, status: "verified" },
        { position: { page: 1, row: 2 }, status: "unresolved" },
      ],
      closingBalance: "verified",
    },
    warnings: ["Sensitive source contents must not appear in the result"],
  });
  expect(await importStatement(options)).toEqual({
    status: "reconciliation-failed",
    reconciliation: {
      totalRows: 2,
      verifiedRows: 1,
      closingBalance: "verified",
    },
  });
  expectNoPersistence();
});

it("returns a generic failure if the parser performed no reconciliation", async () => {
  const parsed = await commbankBrowserSummaryImporter.parse({ bytes });
  vi.spyOn(commbankBrowserSummaryImporter, "parse").mockResolvedValueOnce({
    ...parsed,
    reconciliation: undefined,
  });
  expect(await importStatement(options)).toEqual({ status: "failed" });
  expectNoPersistence();
});

it("still lets the converter reject incomplete verified checks without reporting success", async () => {
  const parsed = await commbankBrowserSummaryImporter.parse({ bytes });
  vi.spyOn(commbankBrowserSummaryImporter, "parse").mockResolvedValueOnce({
    ...parsed,
    reconciliation: {
      rows: parsed.reconciliation!.rows.slice(1),
      closingBalance: "verified",
    },
  });
  expect(await importStatement(options)).toEqual({ status: "failed" });
  expectNoPersistence();
});

it("returns no reconciliation or conversion diagnostics if verified checks cannot produce canonical Transactions", async () => {
  const parsed = await commbankBrowserSummaryImporter.parse({ bytes });
  vi.spyOn(commbankBrowserSummaryImporter, "parse").mockResolvedValueOnce({
    ...parsed,
    rows: parsed.rows.map((row, index) =>
      index === 0 ? { ...row, postingDate: undefined } : row,
    ),
  });
  expect(await importStatement(options)).toEqual({ status: "failed" });
  expectNoPersistence();
});

it.each([
  { accountId: "missing", confirmedCurrency: "USD" },
  { accountId: "account", confirmedCurrency: "AUD" },
])(
  "refuses missing or changed Account confirmation: %j",
  async (confirmation) => {
    expect(await importStatement({ ...options, ...confirmation })).toEqual({
      status: "failed",
    });
    expectNoPersistence();
  },
);

it("honors abort after byte loading before touching repositories", async () => {
  const controller = new AbortController();
  const readAccount = vi.spyOn(options.accountRepository, "getById");
  expect(
    await importStatement({
      ...options,
      signal: controller.signal,
      readDocumentBytes: async () => {
        controller.abort();
        return bytes;
      },
    }),
  ).toEqual({ status: "failed" });
  expect(readAccount).not.toHaveBeenCalled();
  expectNoPersistence();
});

it("does not read a document when already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    await importStatement({ ...options, signal: controller.signal }),
  ).toEqual({ status: "failed" });
  expect(options.readDocumentBytes).not.toHaveBeenCalled();
  expectNoPersistence();
});

it("honors abort before writes even after the Account was read", async () => {
  const controller = new AbortController();
  expect(
    await importStatement({
      ...options,
      signal: controller.signal,
      createImportId: () => {
        controller.abort();
        return "aborted-attempt";
      },
    }),
  ).toEqual({ status: "failed" });
  expectNoPersistence();
});

it("rolls back completion failures, preserves existing Transactions, and marks the attempt failed", async () => {
  const existing = new Transaction({
    id: "attempt-1:transaction:1:11",
    accountId: "account",
    postingDate: "2036-01-31",
    origin: "manual",
    amount: new Money(17, "USD"),
  });
  transactions.create(existing);
  expect(await importStatement(options)).toEqual({ status: "failed" });
  expect(transactions.list()).toEqual([existing]);
  expect(imports.getById("attempt-1")?.processingStatus).toBe("failed");
});

it("does not classify a DuplicateImportError from byte loading as a completion duplicate", async () => {
  expect(
    await importStatement({
      ...options,
      readDocumentBytes: async () => {
        throw new DuplicateImportError();
      },
    }),
  ).toEqual({ status: "failed" });
  expectNoPersistence();
});

it("returns only the failure discriminator when file loading throws sensitive text", async () => {
  expect(
    await importStatement({
      ...options,
      readDocumentBytes: async () => {
        throw new Error(
          "content://private-provider/statement.pdf: synthetic financial source contents",
        );
      },
    }),
  ).toEqual({ status: "failed" });
  expectNoPersistence();
});

it("returns no database diagnostics or success facts when completion throws", async () => {
  vi.spyOn(imports, "complete").mockImplementationOnce(() => {
    throw new Error(
      "SQL failure for household private-household, account private-account, raw source contents",
    );
  });
  expect(await importStatement(options)).toEqual({ status: "failed" });
  expect(transactions.list()).toEqual([]);
  expect(imports.getById("attempt-1")?.processingStatus).toBe("failed");
});

function rememberSyntheticCategory(
  normalizedDescription = "Synthetic Café!",
  householdId = "household",
) {
  store.sqlite
    .prepare("INSERT INTO categories (id, name, status) VALUES (?, ?, ?)")
    .run("purpose-id", "Invented purpose", "active");
  new CategoryRuleRepository(store.database).create({
    householdId,
    normalizedDescription,
    categoryId: "purpose-id",
  });
}

async function withSyntheticDescriptions(descriptions: readonly string[]) {
  const parsed = await commbankBrowserSummaryImporter.parse({ bytes });
  const synthetic = {
    ...parsed,
    rows: parsed.rows.map((row, index) =>
      index < descriptions.length
        ? { ...row, rawDescription: descriptions[index] }
        : row,
    ),
  };
  vi.spyOn(commbankBrowserSummaryImporter, "parse").mockResolvedValue(
    synthetic,
  );
  return convertCommBankBrowserSummaryToTransactions(synthetic, {
    accountId: "account",
    currency: "USD",
    currencyDecimalPlaces: 2,
    createTransactionId: (row) =>
      `attempt-1:transaction:${row.position.page ?? 0}:${row.position.row}`,
  });
}

it("applies remembered categories before atomic completion using the production normalization composition", async () => {
  rememberSyntheticCategory();
  const source = await withSyntheticDescriptions([
    "  PAYPAL *Synthetic   Café!\nValue Date 01/03/2040",
    "SQ *Synthetic Café!\r\nValue Date 01/03/2040",
    "Synthetic Café!\nValue Date 31/02/2040",
    "Synthetic Café! Value Date 01/03/2040",
    "Synthetic Café!\nValue date 01/03/2040",
    "synthetic Café!",
    "Different synthetic description",
  ]);
  const existing = new Transaction({
    id: "existing-history",
    accountId: "account",
    postingDate: "2040-03-02",
    amount: new Money(-987, "USD"),
    merchantId: undefined,
    categoryId: "purpose-id",
    origin: "manual",
    rawDescription: "PAYPAL *Synthetic Café!",
  });
  transactions.create(existing);
  expect(await importStatement(options)).toMatchObject({ status: "imported" });
  for (const [index, transaction] of source.entries()) {
    expect(
      new TransactionRepository(store.database).getById(transaction.id),
    ).toEqual({
      ...transaction,
      categoryId: index < 2 ? "purpose-id" : undefined,
    });
    expect(transaction.categoryId).toBeUndefined();
  }
  expect(transactions.getById(existing.id)).toEqual(existing);
  expect(imports.getById("attempt-1")?.processingStatus).toBe("completed");
  expect(store.sqlite.prepare("SELECT * FROM merchant_rules").all()).toEqual(
    [],
  );
  expect(
    new CategoryRuleRepository(store.database).get(
      "household",
      "Synthetic Café!",
    ),
  ).toEqual({
    householdId: "household",
    normalizedDescription: "Synthetic Café!",
    categoryId: "purpose-id",
  });
});

it("derives remembered-rule Household scope from the confirmed Account", async () => {
  rememberSyntheticCategory();
  await withSyntheticDescriptions(["PAYPAL *Synthetic Café!"]);
  // Adversarial isolation fixture: normal v0.1 setup permits one Household only.
  store.sqlite
    .prepare("INSERT INTO households (id, label) VALUES (?, ?)")
    .run("other-household", "Other synthetic household");
  new AccountRepository(store.database).create(
    new Account({
      id: "other-account",
      householdId: "other-household",
      label: "Other USD account",
      type: "transaction",
      status: "active",
      primaryCurrency: "USD",
      ownership: { kind: "household-level" },
    }),
  );
  expect(await importStatement(options)).toMatchObject({ status: "imported" });
  expect(
    await importStatement({ ...options, accountId: "other-account" }),
  ).toMatchObject({ status: "imported" });
  expect(transactions.getById("attempt-1:transaction:1:1")?.categoryId).toBe(
    "purpose-id",
  );
  expect(transactions.getById("attempt-2:transaction:1:1")).toMatchObject({
    accountId: "other-account",
    categoryId: undefined,
  });
});

it("keeps archived remembered references readable and skips them for future import assignment", async () => {
  rememberSyntheticCategory();
  await withSyntheticDescriptions(["PAYPAL *Synthetic Café!"]);
  store.sqlite
    .prepare("UPDATE categories SET status = ? WHERE id = ?")
    .run("archived", "purpose-id");
  expect(await importStatement(options)).toMatchObject({ status: "imported" });
  expect(
    transactions.list().every(({ categoryId }) => categoryId === undefined),
  ).toBe(true);
  expect(
    new CategoryRuleRepository(store.database).get(
      "household",
      "Synthetic Café!",
    )?.categoryId,
  ).toBe("purpose-id");
});

it("retains atomic rollback when a remembered-category import batch fails after earlier inserts", async () => {
  rememberSyntheticCategory();
  await withSyntheticDescriptions(["PAYPAL *Synthetic Café!"]);
  const existing = new Transaction({
    id: "attempt-1:transaction:1:11",
    accountId: "account",
    postingDate: "2040-03-02",
    origin: "manual",
    rawDescription: "Existing synthetic history",
    amount: new Money(17, "USD"),
  });
  transactions.create(existing);
  expect(await importStatement(options)).toEqual({ status: "failed" });
  expect(transactions.list()).toEqual([existing]);
  expect(imports.getById("attempt-1")?.processingStatus).toBe("failed");
  expect(
    new CategoryRuleRepository(store.database).get(
      "household",
      "Synthetic Café!",
    )?.categoryId,
  ).toBe("purpose-id");
});

it.each(["rule", "category"] as const)(
  "sanitizes remembered %s lookup failures before any Import or Transaction writes",
  async (lookup) => {
    rememberSyntheticCategory();
    await withSyntheticDescriptions(["PAYPAL *Synthetic Café!"]);
    const fail = () => {
      throw new Error(
        "SQL parameters containing synthetic financial source details",
      );
    };
    if (lookup === "rule")
      vi.spyOn(options.categoryRuleRepository, "get").mockImplementation(fail);
    else
      vi.spyOn(options.categoryRepository, "getById").mockImplementation(fail);
    expect(await importStatement(options)).toEqual({ status: "failed" });
    expectNoPersistence();
  },
);

it("rejects a missing canonical remembered Category before persistence", async () => {
  rememberSyntheticCategory();
  await withSyntheticDescriptions(["PAYPAL *Synthetic Café!"]);
  vi.spyOn(options.categoryRepository, "getById").mockReturnValue(undefined);
  expect(await importStatement(options)).toEqual({ status: "failed" });
  expectNoPersistence();
});
