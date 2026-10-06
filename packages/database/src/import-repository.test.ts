/// <reference types="node" />

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import {
  Account,
  Household,
  Import,
  type ImportFingerprint,
  type ImportOptions,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  commbankBrowserSummaryImporter,
  convertCommBankBrowserSummaryToTransactions,
} from "../../importers/commbank/src/index";
import { fingerprintDocumentInput } from "../../importers/core/src/index";
import { AccountRepository } from "./account-repository";
import { HouseholdRepository } from "./household-repository";
import { DuplicateImportError, ImportRepository } from "./import-repository";
import * as schema from "./schema";
import { TransactionRepository } from "./transaction-repository";

// Use the production Expo Drizzle driver against real SQLite. Adapt only the
// synchronous native boundary, and apply every generated forward migration.
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
    for (const entry of journal.entries)
      sqlite.exec(
        readFileSync(
          new URL("../drizzle/" + entry.tag + ".sql", import.meta.url),
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

let store: ReturnType<typeof createDatabase>;
let repository: ImportRepository;
let fixtureBytes: Uint8Array;
let fingerprint: ImportFingerprint;
let converted: readonly Transaction[];
const baseline = new Transaction({
  id: "existing-transaction",
  accountId: "confirmed-account",
  postingDate: "2036-01-31",
  amount: new Money(17, "USD"),
  origin: "manual",
});

function seed(database: ReturnType<typeof createDatabase>["database"]): void {
  new HouseholdRepository(database).create(
    new Household({ id: "test-household", label: "Synthetic household" }),
  );
  new AccountRepository(database).create(
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
  new TransactionRepository(database).create(baseline);
}

beforeAll(async () => {
  fixtureBytes = new Uint8Array(
    readFileSync(
      new URL(
        "../../../fixtures/bank-statements/commbank/browser-summary-01.pdf",
        import.meta.url,
      ),
    ),
  );
  fingerprint = await fingerprintDocumentInput({ bytes: fixtureBytes });
  const parsed = await commbankBrowserSummaryImporter.parse({
    bytes: fixtureBytes,
  });
  converted = convertCommBankBrowserSummaryToTransactions(parsed, {
    accountId: "confirmed-account",
    currency: "USD",
    currencyDecimalPlaces: 2,
    createTransactionId: (row) => "fixture-transaction-" + row.position.row,
  });
});

beforeEach(() => {
  store = createDatabase();
  seed(store.database);
  repository = new ImportRepository(store.database);
  store.queries.length = 0;
});

afterEach(() => store.sqlite.close());

function attempt(id: string, patch: Partial<ImportOptions> = {}): Import {
  return new Import({
    id,
    householdId: "test-household",
    processingStatus: "processing",
    sourceKind: "bank-statement",
    sourceFormat: "pdf",
    originalFilename: "browser-summary-01.pdf",
    displayLabel: "Synthetic import",
    fingerprint,
    parser: {
      id: commbankBrowserSummaryImporter.id,
      version: commbankBrowserSummaryImporter.version,
    },
    confirmedAccountId: "confirmed-account",
    ...patch,
  });
}

function copy(
  record: Transaction,
  patch: Partial<Transaction> = {},
): Transaction {
  return new Transaction({
    ...record,
    origin: "imported",
    rawDescription: record.rawDescription!,
    ...patch,
  });
}

function anotherBatch(
  prefix: string,
  accountId = "confirmed-account",
): Transaction[] {
  return converted.map((record) =>
    copy(record, { id: prefix + record.id, accountId }),
  );
}

function storedIds(): string[] {
  return store.sqlite
    .prepare("SELECT id FROM transactions ORDER BY rowid")
    .all()
    .map((row) => row.id as string);
}

function failure(action: () => void): Error {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected the operation to refuse.");
}

function expectSanitized(error: Error): void {
  expect(error.message).not.toContain(fingerprint.value);
  for (const record of converted)
    expect(error.message).not.toContain(record.rawDescription!);
  expect(error.cause).toBeUndefined();
}

function expectCompletionRollback(records: readonly Transaction[]): void {
  const source = attempt("failing-attempt");
  repository.create(source);
  const before = structuredClone(records);
  store.queries.length = 0;
  const error = failure(() => repository.complete(source.id, records));
  expect(error).not.toBeInstanceOf(DuplicateImportError);
  expectSanitized(error);
  expect(
    store.queries.filter((query) => /^(begin|commit|rollback)/i.test(query)),
  ).toEqual(["begin immediate", "rollback"]);
  expect(storedIds()).toEqual([baseline.id]);
  expect(repository.getById(source.id)).toEqual(source);
  expect(
    repository.findCompleted(source.householdId, fingerprint),
  ).toBeUndefined();
  expect(records).toEqual(before);
}

describe("ImportRepository exact-artifact detection with real SQLite", () => {
  it.each(["pending", "processing", "failed"] as const)(
    "roundtrips a %s attempt without treating it as successfully imported",
    (processingStatus) => {
      const source = attempt("recorded-attempt", {
        processingStatus,
        originalFilename: "source copy.pdf",
        displayLabel: "  Synthetic source label  ",
      });
      const before = structuredClone(source);
      repository.create(source);
      const restored = repository.getById(source.id);
      expect(restored).toBeInstanceOf(Import);
      expect(restored).toEqual(source);
      expect(repository.getById("missing-attempt")).toBeUndefined();
      expect(
        repository.findCompleted(source.householdId, fingerprint),
      ).toBeUndefined();
      expect(source).toEqual(before);
      expect(storedIds()).toEqual([baseline.id]);
    },
  );

  it("records attempts without invented fingerprint, parser, or account context", () => {
    const source = new Import({
      id: "unidentified-attempt",
      householdId: "test-household",
      processingStatus: "failed",
    });
    repository.create(source);
    expect(repository.getById(source.id)).toEqual(source);
    const row = store.database.select().from(schema.imports).get()!;
    expect(row.fingerprintMethod).toBeNull();
    expect(row.fingerprintValue).toBeNull();
    expect(row.parserId).toBeNull();
    expect(row.parserVersion).toBeNull();
    expect(row.confirmedAccountId).toBeNull();
  });

  it("requires atomic completion rather than creating a completed record directly", () => {
    expect(() =>
      repository.create(attempt("bypassed", { processingStatus: "completed" })),
    ).toThrow();
    expect(repository.getById("bypassed")).toBeUndefined();
    expect(storedIds()).toEqual([baseline.id]);
  });

  it("keeps an Import primary-key conflict distinct from an artifact duplicate", () => {
    const source = attempt("same-attempt-id");
    repository.create(source);
    const error = failure(() =>
      repository.create(
        attempt(source.id, { originalFilename: "another source.pdf" }),
      ),
    );
    expect(error).not.toBeInstanceOf(DuplicateImportError);
    expectSanitized(error);
    expect(error.message).not.toContain("another source.pdf");
    expect(repository.getById(source.id)).toEqual(source);
    expect(
      repository.findCompleted(source.householdId, fingerprint),
    ).toBeUndefined();
    expect(storedIds()).toEqual([baseline.id]);
  });

  it("commits completion and all eleven fixture Transactions in one immediate transaction", () => {
    const source = attempt("successful-attempt");
    const sourceBefore = structuredClone(source);
    const recordsBefore = structuredClone(converted);
    repository.create(source);
    store.queries.length = 0;
    repository.complete(source.id, converted);
    expect(
      store.queries.filter((query) =>
        /^(begin|commit|rollback|savepoint)/i.test(query),
      ),
    ).toEqual(["begin immediate", "commit"]);
    const completed = new Import({ ...source, processingStatus: "completed" });
    expect(repository.getById(source.id)).toEqual(completed);
    expect(repository.findCompleted(source.householdId, fingerprint)).toEqual(
      completed,
    );
    expect(storedIds()).toEqual([
      baseline.id,
      ...converted.map(({ id }) => id),
    ]);
    const transactions = new TransactionRepository(store.database);
    expect(converted.map(({ id }) => transactions.getById(id))).toEqual(
      converted,
    );
    expect(converted).toHaveLength(11);
    expect(converted).toEqual(recordsBefore);
    expect(source).toEqual(sourceBefore);
  });

  it.each([
    ["filename", { originalFilename: "another export name.pdf" }],
    ["parser ID", { parser: { id: "another-parser", version: "7" } }],
    [
      "parser version",
      { parser: { id: commbankBrowserSummaryImporter.id, version: "999" } },
    ],
  ] as const)("refuses an exact artifact despite changed %s", (_, patch) => {
    const first = attempt("first-attempt");
    repository.create(first);
    repository.complete(first.id, converted);
    const firstBefore = repository.getById(first.id);
    const second = attempt("second-attempt", patch);
    repository.create(second);
    const error = failure(() =>
      repository.complete(second.id, anotherBatch("second-")),
    );
    expect(error).toBeInstanceOf(DuplicateImportError);
    expectSanitized(error);
    expect(storedIds()).toEqual([
      baseline.id,
      ...converted.map(({ id }) => id),
    ]);
    expect(repository.getById(first.id)).toEqual(firstBefore);
    expect(repository.getById(second.id)).toEqual(second);
    expect(
      converted.map(({ id }) =>
        new TransactionRepository(store.database).getById(id),
      ),
    ).toEqual(converted);
  });

  it("does not use another confirmed Account to bypass the Household artifact guard", () => {
    const first = attempt("first-attempt");
    repository.create(first);
    repository.complete(first.id, converted);
    new AccountRepository(store.database).create(
      new Account({
        id: "another-account",
        householdId: "test-household",
        label: "Another synthetic account",
        type: "savings",
        status: "active",
        primaryCurrency: "USD",
        ownership: { kind: "household-level" },
      }),
    );
    const second = attempt("second-attempt", {
      confirmedAccountId: "another-account",
    });
    repository.create(second);
    expect(() =>
      repository.complete(
        second.id,
        anotherBatch("second-", "another-account"),
      ),
    ).toThrow(DuplicateImportError);
    expect(storedIds()).toEqual([
      baseline.id,
      ...converted.map(({ id }) => id),
    ]);
  });

  it("allows the same fingerprint in a different Household", () => {
    const first = attempt("first-attempt");
    repository.create(first);
    repository.complete(first.id, converted);
    // The local HouseholdRepository intentionally allows only one Household.
    // Seed the second here to verify the independent repository scope.
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
        ownership: { kind: "household-level" },
      }),
    );
    const second = attempt("second-attempt", {
      householdId: "other-household",
      confirmedAccountId: "other-account",
    });
    const other = anotherBatch("other-", "other-account");
    repository.create(second);
    repository.complete(second.id, other);
    expect(repository.findCompleted("test-household", fingerprint)?.id).toBe(
      first.id,
    );
    expect(repository.findCompleted("other-household", fingerprint)?.id).toBe(
      second.id,
    );
    expect(storedIds()).toEqual([
      baseline.id,
      ...converted.map(({ id }) => id),
      ...other.map(({ id }) => id),
    ]);
  });

  it("retains a failed attempt and allows a new retry to complete", () => {
    const first = attempt("failed-attempt");
    repository.create(first);
    repository.fail(first.id);
    const failed = new Import({ ...first, processingStatus: "failed" });
    expect(repository.getById(first.id)).toEqual(failed);
    expect(
      repository.findCompleted(first.householdId, fingerprint),
    ).toBeUndefined();
    const retry = attempt("retry-attempt", { processingStatus: "pending" });
    repository.create(retry);
    repository.complete(retry.id, converted);
    expect(repository.getById(first.id)).toEqual(failed);
    expect(repository.findCompleted(first.householdId, fingerprint)?.id).toBe(
      retry.id,
    );
    expect(storedIds()).toEqual([
      baseline.id,
      ...converted.map(({ id }) => id),
    ]);
  });

  it("does not reuse a failed attempt or downgrade an already completed attempt", () => {
    const failed = attempt("failed-attempt", { processingStatus: "failed" });
    repository.create(failed);
    expect(() => repository.complete(failed.id, converted)).toThrow();
    expect(repository.getById(failed.id)).toEqual(failed);
    const completed = attempt("successful-attempt");
    repository.create(completed);
    repository.complete(completed.id, converted);
    expect(() => repository.fail(completed.id)).toThrow();
    expect(repository.getById(completed.id)?.processingStatus).toBe(
      "completed",
    );
    const retry = attempt("retry-attempt");
    repository.create(retry);
    expect(() => repository.complete(retry.id, anotherBatch("retry-"))).toThrow(
      DuplicateImportError,
    );
    expect(storedIds()).toEqual([
      baseline.id,
      ...converted.map(({ id }) => id),
    ]);
  });

  it("allows byte-different documents with identical financial data and new explicit IDs", async () => {
    const changedBytes = new Uint8Array(fixtureBytes.length + 1);
    changedBytes.set(fixtureBytes);
    changedBytes[fixtureBytes.length] = 10;
    const changedFingerprint = await fingerprintDocumentInput({
      bytes: changedBytes,
    });
    expect(changedFingerprint).not.toEqual(fingerprint);
    const first = attempt("first-attempt");
    repository.create(first);
    repository.complete(first.id, converted);
    const second = attempt("different-artifact", {
      fingerprint: changedFingerprint,
    });
    const sameFinancialData = anotherBatch("different-artifact-");
    repository.create(second);
    repository.complete(second.id, sameFinancialData);
    expect(
      repository.findCompleted(first.householdId, changedFingerprint)?.id,
    ).toBe(second.id);
    for (const [index, record] of sameFinancialData.entries())
      expect(copy(record, { id: converted[index].id })).toEqual(
        converted[index],
      );
    expect(storedIds()).toHaveLength(23);
  });

  it("enforces completed artifact uniqueness in SQLite independently of repository lookup", () => {
    const first = attempt("first-attempt");
    const second = attempt("second-attempt");
    repository.create(first);
    repository.create(second);
    repository.complete(first.id, converted);
    expect(() =>
      store.sqlite
        .prepare(
          "UPDATE imports SET processing_status = 'completed' WHERE id = ?",
        )
        .run(second.id),
    ).toThrow(/UNIQUE constraint/i);
    expect(repository.getById(second.id)).toEqual(second);
    repository.fail(second.id);
    expect(repository.getById(second.id)?.processingStatus).toBe("failed");
    expect(repository.findCompleted(first.householdId, fingerprint)?.id).toBe(
      first.id,
    );
    expect(storedIds()).toEqual([
      baseline.id,
      ...converted.map(({ id }) => id),
    ]);
  });

  it("allows only one completion after two connections both observe no prior completion", () => {
    const directory = mkdtempSync(join(tmpdir(), "ledgerase-import-race-"));
    const filename = join(directory, "ledgerase.db");
    const firstStore = createDatabase(filename);
    const secondStore = createDatabase(filename, false);
    try {
      seed(firstStore.database);
      const firstRepository = new ImportRepository(firstStore.database);
      const secondRepository = new ImportRepository(secondStore.database);
      const first = attempt("first-attempt");
      const second = attempt("second-attempt");
      firstRepository.create(first);
      secondRepository.create(second);
      expect(
        firstRepository.findCompleted(first.householdId, fingerprint),
      ).toBeUndefined();
      expect(
        secondRepository.findCompleted(second.householdId, fingerprint),
      ).toBeUndefined();
      firstRepository.complete(first.id, converted);
      expect(() =>
        secondRepository.complete(second.id, anotherBatch("second-")),
      ).toThrow(DuplicateImportError);
      expect(secondRepository.getById(second.id)).toEqual(second);
      expect(
        secondStore.sqlite
          .prepare(
            "SELECT count(*) AS count FROM imports WHERE processing_status = 'completed'",
          )
          .get()?.count,
      ).toBe(1);
      expect(
        secondStore.sqlite
          .prepare("SELECT count(*) AS count FROM transactions")
          .get()?.count,
      ).toBe(12);
    } finally {
      secondStore.sqlite.close();
      firstStore.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "invalid date",
      (record: Transaction) =>
        ({ ...record, postingDate: "2036-02-30" }) as Transaction,
    ],
    [
      "currency mismatch",
      (record: Transaction) =>
        copy(record, { amount: new Money(record.amount.amountMinor, "AUD") }),
    ],
    [
      "missing Merchant",
      (record: Transaction) => copy(record, { merchantId: "missing-merchant" }),
    ],
    [
      "missing Category",
      (record: Transaction) => copy(record, { categoryId: "missing-category" }),
    ],
    [
      "duplicate batch ID",
      (record: Transaction) => copy(record, { id: converted[0].id }),
    ],
    [
      "existing primary key",
      (record: Transaction) => copy(record, { id: baseline.id }),
    ],
    [
      "manual origin",
      (record: Transaction) => new Transaction({ ...record, origin: "manual" }),
    ],
    [
      "different Account",
      (record: Transaction) => copy(record, { accountId: "missing-account" }),
    ],
  ] as const)(
    "rolls back the batch and completion for a later %s without calling it a duplicate",
    (_, corrupt) => {
      expectCompletionRollback(
        converted.map((record, index) =>
          index === 5 ? corrupt(record) : record,
        ),
      );
    },
  );

  it("rolls back actual foreign-key failures and trigger changes without calling them duplicates", () => {
    store.database
      .insert(schema.merchants)
      .values({ id: "synthetic-merchant", displayName: "Synthetic merchant" })
      .run();
    store.sqlite.exec(
      "CREATE TRIGGER remove_import_merchant BEFORE INSERT ON transactions " +
        "WHEN NEW.id = 'fixture-transaction-6' " +
        "BEGIN DELETE FROM merchants WHERE id = 'synthetic-merchant'; END;",
    );
    expectCompletionRollback(
      converted.map((record, index) =>
        index === 5
          ? copy(record, { merchantId: "synthetic-merchant" })
          : record,
      ),
    );
    expect(
      store.sqlite
        .prepare("SELECT id FROM merchants WHERE id = ?")
        .get("synthetic-merchant")?.id,
    ).toBe("synthetic-merchant");
  });

  it("rolls back every Transaction if the final completed-status update fails", () => {
    store.sqlite.exec(
      "CREATE TRIGGER reject_import_completion BEFORE UPDATE OF processing_status ON imports " +
        "WHEN NEW.processing_status = 'completed' " +
        "BEGIN SELECT RAISE(ABORT, 'Synthetic completion failure'); END;",
    );
    expectCompletionRollback(converted);
  });

  it("records an explicitly empty successful batch and refuses its exact-artifact retry", () => {
    const first = attempt("empty-import");
    repository.create(first);
    repository.complete(first.id, []);
    expect(repository.findCompleted(first.householdId, fingerprint)?.id).toBe(
      first.id,
    );
    const second = attempt("empty-retry");
    repository.create(second);
    expect(() => repository.complete(second.id, [])).toThrow(
      DuplicateImportError,
    );
    expect(repository.getById(second.id)).toEqual(second);
    expect(storedIds()).toEqual([baseline.id]);
  });

  it.each(["fingerprint", "confirmedAccountId"] as const)(
    "refuses completion with missing %s without persisting Transactions",
    (field) => {
      const source = attempt("incomplete-context", { [field]: undefined });
      repository.create(source);
      const error = failure(() => repository.complete(source.id, converted));
      expect(error).not.toBeInstanceOf(DuplicateImportError);
      expectSanitized(error);
      expect(storedIds()).toEqual([baseline.id]);
      expect(repository.getById(source.id)).toEqual(source);
    },
  );

  it("rejects a confirmed Account from another Household and checks again at completion", () => {
    store.database
      .insert(schema.households)
      .values({ id: "other-household", label: "Other synthetic household" })
      .run();
    new AccountRepository(store.database).create(
      new Account({
        id: "foreign-account",
        householdId: "other-household",
        label: "Foreign synthetic account",
        type: "transaction",
        status: "active",
        primaryCurrency: "USD",
        ownership: { kind: "household-level" },
      }),
    );
    expect(() =>
      repository.create(
        attempt("foreign-context", {
          confirmedAccountId: "foreign-account",
        }),
      ),
    ).toThrow();
    expect(repository.getById("foreign-context")).toBeUndefined();
    const source = attempt("changed-context");
    repository.create(source);
    store.sqlite
      .prepare("UPDATE imports SET confirmed_account_id = ? WHERE id = ?")
      .run("foreign-account", source.id);
    const error = failure(() =>
      repository.complete(
        source.id,
        anotherBatch("foreign-", "foreign-account"),
      ),
    );
    expect(error).not.toBeInstanceOf(DuplicateImportError);
    expectSanitized(error);
    expect(storedIds()).toEqual([baseline.id]);
    expect(
      store.sqlite
        .prepare("SELECT processing_status FROM imports WHERE id = ?")
        .get(source.id)?.processing_status,
    ).toBe("processing");
  });

  it.each([
    { method: "SHA-256", value: "a".repeat(64) },
    { method: "sha256", value: "A".repeat(64) },
    { method: "sha256", value: "a".repeat(63) },
    { method: "sha256", value: "g".repeat(64) },
  ])("refuses noncanonical fingerprint evidence", (invalidFingerprint) => {
    expect(() =>
      repository.findCompleted("test-household", invalidFingerprint),
    ).toThrow();
    expect(() =>
      repository.create(
        attempt("invalid-fingerprint", {
          fingerprint: invalidFingerprint,
        }),
      ),
    ).toThrow();
    expect(repository.getById("invalid-fingerprint")).toBeUndefined();
    expect(storedIds()).toEqual([baseline.id]);
  });
});
