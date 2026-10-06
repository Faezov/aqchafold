import { expect, it } from "vitest";
import type { ImportStatementResult } from "../import/import-statement";
import { importStateReducer, type ImportState } from "./import-state";

const document = {
  uri: "content://provider/private-document",
  name: "statement.pdf",
  mimeType: "application/pdf",
  size: 5471,
};
const importing: ImportState = { status: "importing", document };
const reconciliation = {
  totalRows: 11,
  verifiedRows: 11,
  closingBalance: "verified" as const,
};
const successful = importStateReducer(importing, {
  type: "finished",
  result: { status: "imported", transactionCount: 11, reconciliation },
  accountLabel: "Everyday",
});

it("snapshots only the successful count, Account label, and optional filename", () => {
  expect(successful).toEqual({
    status: "finished",
    document,
    result: {
      status: "imported",
      transactionCount: 11,
      reconciliation,
      accountLabel: "Everyday",
      filename: "statement.pdf",
    },
  });
  expect(
    importStateReducer(
      { status: "importing", document: { uri: document.uri } },
      {
        type: "finished",
        result: { status: "imported", transactionCount: 11, reconciliation },
        accountLabel: "Everyday",
      },
    ),
  ).toEqual({
    status: "finished",
    document: { uri: document.uri },
    result: {
      status: "imported",
      transactionCount: 11,
      reconciliation,
      accountLabel: "Everyday",
    },
  });
});

it.each(["already-imported", "unsupported", "failed"] as const)(
  "keeps %s distinct and reports no newly imported count or source details",
  (status) => {
    expect(
      importStateReducer(importStateReducer(successful, { type: "started" }), {
        type: "finished",
        result: { status, reconciliation } as ImportStatementResult,
        accountLabel: "Everyday",
      }),
    ).toEqual({ status: "finished", document, result: { status } });
  },
);

it("copies reconciliation counts independently of the Transaction count", () => {
  const checks = {
    totalRows: 3,
    verifiedRows: 3,
    closingBalance: "verified" as const,
  };
  const state = importStateReducer(importing, {
    type: "finished",
    result: {
      status: "imported",
      transactionCount: 11,
      reconciliation: checks,
    },
    accountLabel: "Everyday",
  });
  expect(state).toMatchObject({
    result: { transactionCount: 11, reconciliation: checks },
  });
});

it("snapshots an explicit unverified outcome without success details", () => {
  const checks = {
    totalRows: 11,
    verifiedRows: 10,
    closingBalance: "mismatch" as const,
  };
  expect(
    importStateReducer(importing, {
      type: "finished",
      result: { status: "reconciliation-failed", reconciliation: checks },
      accountLabel: "Everyday",
    }),
  ).toEqual({
    status: "finished",
    document,
    result: { status: "reconciliation-failed", reconciliation: checks },
  });
});

it.each(["imported", "reconciliation-failed"] as const)(
  "snapshots only summary primitives for %s without raw values or shared mutation",
  (status) => {
    const checks = {
      ...reconciliation,
      rawBalance: "private source balance",
      warnings: ["private source diagnostic"],
      rows: [{ position: { page: 1, row: 1 }, rawText: "private row" }],
    };
    const state = importStateReducer(importing, {
      type: "finished",
      result: { status, transactionCount: 11, reconciliation: checks },
      accountLabel: "Everyday",
    });
    expect(state.status).toBe("finished");
    if (state.status !== "finished" || !("reconciliation" in state.result))
      throw new Error("Expected a reconciliation snapshot.");
    expect(state.result.reconciliation).toEqual(reconciliation);
    expect(state.result.reconciliation).not.toBe(checks);
    checks.verifiedRows = 0;
    expect(state.result.reconciliation.verifiedRows).toBe(11);
  },
);

it("selecting a new document clears the old result and returns to ready", () => {
  const next = {
    uri: "content://provider/another-document",
    name: "another.pdf",
  };
  expect(
    importStateReducer(successful, { type: "document-picked", document: next }),
  ).toEqual({
    status: "ready",
    document: next,
  });
});

it("picker cancellation preserves selection and the prior result", () => {
  expect(
    importStateReducer(successful, { type: "document-picked", document: null }),
  ).toBe(successful);
});

it("a new attempt clears the previous result before processing", () => {
  expect(importStateReducer(successful, { type: "started" })).toEqual(
    importing,
  );
});

it("does not start without a document or accept an unsolicited completion", () => {
  const ready: ImportState = { status: "ready", document: null };
  expect(importStateReducer(ready, { type: "started" })).toBe(ready);
  expect(
    importStateReducer(ready, {
      type: "finished",
      result: { status: "failed" },
      accountLabel: "Everyday",
    }),
  ).toBe(ready);
});

it("does not copy exception diagnostics or financial fields into a final result", () => {
  const result = {
    status: "failed",
    error: "Private SQL and statement diagnostics",
    accountId: "account-id",
    householdId: "household-id",
    fingerprint: "private-fingerprint",
    rawDescription: "private-source",
    amountMinor: 1234,
  } as ImportStatementResult;
  expect(
    importStateReducer(importing, {
      type: "finished",
      result,
      accountLabel: "Everyday",
    }),
  ).toEqual({ status: "finished", document, result: { status: "failed" } });
});
