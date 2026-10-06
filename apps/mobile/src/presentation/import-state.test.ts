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
const successful = importStateReducer(importing, {
  type: "finished",
  result: { status: "imported", transactionCount: 11 },
  accountLabel: "Everyday",
});

it("snapshots only the successful count, Account label, and optional filename", () => {
  expect(successful).toEqual({
    status: "finished",
    document,
    result: {
      status: "imported",
      transactionCount: 11,
      accountLabel: "Everyday",
      filename: "statement.pdf",
    },
  });
  expect(
    importStateReducer(
      { status: "importing", document: { uri: document.uri } },
      {
        type: "finished",
        result: { status: "imported", transactionCount: 11 },
        accountLabel: "Everyday",
      },
    ),
  ).toEqual({
    status: "finished",
    document: { uri: document.uri },
    result: {
      status: "imported",
      transactionCount: 11,
      accountLabel: "Everyday",
    },
  });
});

it.each(["already-imported", "unsupported", "failed"] as const)(
  "keeps %s distinct and reports no newly imported count or source details",
  (status) => {
    expect(
      importStateReducer(importing, {
        type: "finished",
        result: { status },
        accountLabel: "Everyday",
      }),
    ).toEqual({ status: "finished", document, result: { status } });
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
