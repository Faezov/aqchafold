/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import {
  Account,
  Household,
  Import,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { expect, it } from "vitest";
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

// Match repository integration conventions: production Expo Drizzle driver,
// real SQLite, and only a test-only adaptation of the synchronous native boundary.
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

it("imports the synthetic CommBank PDF through SQLite and refuses an exact-artifact retry", async () => {
  const fixtureDirectory = new URL(
    "../../../fixtures/bank-statements/commbank/",
    import.meta.url,
  );
  const input = {
    bytes: new Uint8Array(
      readFileSync(new URL("browser-summary-01.pdf", fixtureDirectory)),
    ),
  };
  const originalBytes = input.bytes.slice();
  const reference = JSON.parse(
    readFileSync(
      new URL("browser-summary-01.reference.json", fixtureDirectory),
      "utf8",
    ),
  ) as {
    headerEvidence: { rawPeriod: string };
    sourceRows: {
      tableRow: number;
      rawDate: string;
      rawDescription: string;
      rawDebit: string;
      rawCredit: string;
      rawBalance: string;
    }[];
  };
  const store = createDatabase();
  try {
    const household = new Household({
      id: "pipeline-household",
      label: "Synthetic household",
    });
    new HouseholdRepository(store.database).create(household);
    // The PDF does not establish ISO currency. This is explicitly confirmed caller context.
    const account = new Account({
      id: "pipeline-account",
      householdId: household.id,
      label: "Synthetic confirmed account",
      type: "transaction",
      status: "active",
      primaryCurrency: "USD",
      ownership: { kind: "household-level" },
    });
    new AccountRepository(store.database).create(account);

    const fingerprint = fingerprintDocumentInput(input);
    expect(await commbankBrowserSummaryImporter.detect(input)).toBe(1);
    const parsed = await commbankBrowserSummaryImporter.parse(input);
    expect(parsed.rows).toHaveLength(11);
    expect(
      parsed.rows.map((row) => ({
        tableRow: row.position.row + 1,
        rawDate: row.rawPostingDate,
        rawDescription: row.rawDescription,
        rawDebit: row.rawDebit,
        rawCredit: row.rawCredit,
        rawBalance: row.rawBalance,
      })),
    ).toEqual(reference.sourceRows);
    expect(parsed.reconciliation).toEqual({
      rows: reference.sourceRows.map(({ tableRow }) => ({
        position: { page: 1, row: tableRow - 1 },
        status: "verified",
      })),
      closingBalance: "verified",
    });
    expect(parsed.metadata.currency).toBeUndefined();
    const parsedBefore = structuredClone(parsed);
    const context = {
      accountId: account.id,
      currency: account.primaryCurrency,
      currencyDecimalPlaces: 2 as const,
      createTransactionId: (row: (typeof parsed.rows)[number]) =>
        `pipeline-transaction-${row.position.row}`,
    };
    const canonical = convertCommBankBrowserSummaryToTransactions(
      parsed,
      context,
    );
    expect(canonical).toHaveLength(11);
    const expectedIds = reference.sourceRows.map(
      ({ tableRow }) => `pipeline-transaction-${tableRow - 1}`,
    );
    expect(canonical.map(({ id }) => id)).toEqual(expectedIds);
    const year = reference.headerEvidence.rawPeriod.slice(-4);
    for (const [index, transaction] of canonical.entries()) {
      const source = reference.sourceRows[index];
      // Fixture decimal magnitudes have two fractional digits; compare integer hundredths.
      const magnitude = BigInt(
        (source.rawDebit || source.rawCredit).replace(/[,.]/g, ""),
      );
      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.amount).toBeInstanceOf(Money);
      expect(transaction).toMatchObject({
        id: expectedIds[index],
        accountId: account.id,
        postingDate: `${year}-02-${source.rawDate.slice(0, 2)}`,
        rawDescription: source.rawDescription,
        origin: "imported",
        amount: {
          amountMinor: Number(source.rawDebit ? -magnitude : magnitude),
          currency: account.primaryCurrency,
        },
      });
      expect(transaction.transactionDate).toBeUndefined();
      expect(transaction.merchantId).toBeUndefined();
      expect(transaction.categoryId).toBeUndefined();
    }

    const imports = new ImportRepository(store.database);
    const transactions = new TransactionRepository(store.database);
    const attempt = new Import({
      id: "pipeline-import",
      householdId: household.id,
      processingStatus: "processing",
      originalFilename: "browser-summary-01.pdf",
      displayLabel: "Synthetic statement",
      fingerprint,
      parser: parsed.parser,
      confirmedAccountId: account.id,
    });
    imports.create(attempt);
    store.queries.length = 0;
    imports.complete(attempt.id, canonical);
    expect(
      store.queries.filter((query) =>
        /^(begin|commit|rollback|savepoint)/i.test(query),
      ),
    ).toEqual(["begin immediate", "commit"]);
    const completed = imports.getById(attempt.id);
    expect(completed).toBeInstanceOf(Import);
    expect(completed).toEqual(
      new Import({ ...attempt, processingStatus: "completed" }),
    );
    const readIds = () =>
      store.sqlite
        .prepare("SELECT id FROM transactions ORDER BY rowid")
        .all()
        .map((row) => row.id as string);
    expect(readIds()).toEqual(expectedIds);
    expect(readIds().map((id) => transactions.getById(id))).toEqual(canonical);

    const retryFingerprint = fingerprintDocumentInput({
      bytes: input.bytes.slice(),
    });
    expect(retryFingerprint).toEqual(fingerprint);
    const retry = new Import({
      ...attempt,
      id: "pipeline-retry",
      originalFilename: "renamed-copy.pdf",
      displayLabel: "Another source label",
      fingerprint: retryFingerprint,
      parser: { id: parsed.parser.id, version: "different-provenance-version" },
    });
    imports.create(retry);
    expect(imports.findCompleted(household.id, retryFingerprint)).toEqual(
      completed,
    );
    const retryTransactions = convertCommBankBrowserSummaryToTransactions(
      parsed,
      {
        ...context,
        createTransactionId: (row) => `retry-transaction-${row.position.row}`,
      },
    );
    store.queries.length = 0;
    expect(() => imports.complete(retry.id, retryTransactions)).toThrow(
      DuplicateImportError,
    );
    expect(
      store.queries.filter((query) =>
        /^(begin|commit|rollback|savepoint)/i.test(query),
      ),
    ).toEqual(["begin immediate", "rollback"]);
    expect(imports.getById(retry.id)).toEqual(retry);
    expect(imports.getById(attempt.id)).toEqual(completed);
    expect(readIds()).toEqual(expectedIds);
    expect(readIds().map((id) => transactions.getById(id))).toEqual(canonical);

    // Byte identity only: this changed artifact is never submitted to the parser.
    const changedBytes = originalBytes.slice();
    changedBytes[0] ^= 1;
    const changedFingerprint = fingerprintDocumentInput({
      bytes: changedBytes,
    });
    expect(changedFingerprint).not.toEqual(fingerprint);
    expect(
      imports.findCompleted(household.id, changedFingerprint),
    ).toBeUndefined();
    expect(input.bytes).toEqual(originalBytes);
    expect(parsed).toEqual(parsedBefore);
  } finally {
    store.sqlite.close();
  }
});
