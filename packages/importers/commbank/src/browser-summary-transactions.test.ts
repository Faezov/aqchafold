/// <reference types="node" />

import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { Money, Transaction } from "@aqchafold/domain";
import type {
  ParsedStatement,
  ParsedStatementRow,
} from "@aqchafold/importers-core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  commbankBrowserSummaryImporter,
  convertCommBankBrowserSummaryToTransactions,
  type CommBankTransactionConversionContext,
} from "./index";

let statement: ParsedStatement;
const reference = JSON.parse(
  readFileSync(
    new URL(
      "../../../../fixtures/bank-statements/commbank/browser-summary-01.reference.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  sourceRows: readonly { rawDate: string; rawDescription: string }[];
};

beforeAll(async () => {
  const bytes = new Uint8Array(
    readFileSync(
      new URL(
        "../../../../fixtures/bank-statements/commbank/browser-summary-01.pdf",
        import.meta.url,
      ),
    ),
  );
  statement = await commbankBrowserSummaryImporter.parse({ bytes });
});

const context = (): CommBankTransactionConversionContext => ({
  accountId: "confirmed-account",
  currency: "AUD",
  currencyDecimalPlaces: 2,
  createTransactionId: (row) => `transaction-${row.position.row}`,
});

function withRow(
  patch: Partial<ParsedStatementRow>,
  index = 0,
): ParsedStatement {
  return {
    ...statement,
    rows: statement.rows.map((row, position) =>
      position === index ? { ...row, ...patch } : row,
    ),
  };
}

function withChecks(
  patch: Partial<NonNullable<ParsedStatement["reconciliation"]>>,
): ParsedStatement {
  return {
    ...statement,
    reconciliation: { ...statement.reconciliation!, ...patch },
  };
}

function expectRefusal(
  input: ParsedStatement,
  diagnostic: RegExp,
  options: CommBankTransactionConversionContext = context(),
): void {
  const before = structuredClone(input);
  const factory = vi.fn(options.createTransactionId);
  let output: readonly Transaction[] | undefined;
  let error: unknown;
  try {
    output = convertCommBankBrowserSummaryToTransactions(input, {
      ...options,
      createTransactionId: factory,
    });
  } catch (caught) {
    error = caught;
  }
  expect(output).toBeUndefined();
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toMatch(diagnostic);
  expect(message).not.toContain("confirmed-account");
  expect(message).not.toContain("000 000 00000000");
  for (const row of input.rows) {
    if (row.rawDescription) expect(message).not.toContain(row.rawDescription);
    if (row.rawDebit) expect(message).not.toContain(row.rawDebit);
    if (row.rawCredit) expect(message).not.toContain(row.rawCredit);
    if (row.rawBalance) expect(message).not.toContain(row.rawBalance);
  }
  if (input.openingBalance?.rawValue)
    expect(message).not.toContain(input.openingBalance.rawValue);
  if (input.closingBalance?.rawValue)
    expect(message).not.toContain(input.closingBalance.rawValue);
  expect(factory).not.toHaveBeenCalled();
  expect(input).toEqual(before);
}

describe("CommBank browser summary canonical Transaction conversion", () => {
  it.each(["AUD", "USD"])(
    "creates eleven real instances in source order with explicit confirmed %s and caller IDs",
    (currency) => {
      expect(statement.parser).toEqual({
        id: commbankBrowserSummaryImporter.id,
        version: commbankBrowserSummaryImporter.version,
      });
      const before = structuredClone(statement);
      const factory = vi.fn(context().createTransactionId);
      const transactions = convertCommBankBrowserSummaryToTransactions(
        statement,
        { ...context(), currency, createTransactionId: factory },
      );
      expect(transactions).toHaveLength(11);
      expect(transactions.map(({ id }) => id)).toEqual(
        Array.from({ length: 11 }, (_, index) => `transaction-${index + 1}`),
      );
      expect(transactions.map(({ postingDate }) => postingDate)).toEqual([
        "2036-02-02",
        "2036-02-02",
        "2036-02-03",
        "2036-02-03",
        "2036-02-04",
        "2036-02-05",
        "2036-02-05",
        "2036-02-06",
        "2036-02-07",
        "2036-02-07",
        "2036-02-08",
      ]);
      expect(transactions.map(({ rawDescription }) => rawDescription)).toEqual(
        reference.sourceRows.map(({ rawDescription }) => rawDescription),
      );
      expect(transactions.map(({ amount }) => amount.amountMinor)).toEqual([
        -3847, -11283, 128376, -2419, -14562, 9457, -753, 21548, -8341, -5628,
        61239,
      ]);
      for (const [index, transaction] of transactions.entries()) {
        expect(transaction).toBeInstanceOf(Transaction);
        expect(transaction.amount).toBeInstanceOf(Money);
        expect(transaction.amount.currency).toBe(currency);
        expect(transaction.accountId).toBe("confirmed-account");
        expect(transaction.origin).toBe("imported");
        expect(transaction.transactionDate).toBeUndefined();
        expect(transaction.merchantId).toBeUndefined();
        expect(transaction.categoryId).toBeUndefined();
        expect(factory).toHaveBeenNthCalledWith(
          index + 1,
          statement.rows[index],
        );
      }
      expect(factory).toHaveBeenCalledTimes(11);
      expect(transactions[0]).not.toBe(transactions[1]);
      expect(transactions[3]!.rawDescription).toBe(
        "Direct Debit SYNTHETIC UTILITIES\n91007382",
      );
      expect(statement).toEqual(before);
      expect(statement.metadata.currency).toBeUndefined();
      expect(
        statement.rows.every(
          ({ amount, balance }) =>
            amount === undefined && balance === undefined,
        ),
      ).toBe(true);
    },
  );

  it("preserves an established empty description and a distinct optional transaction date", () => {
    const transactions = convertCommBankBrowserSummaryToTransactions(
      withRow({ rawDescription: "", transactionDate: "2036-02-01" }),
      context(),
    );
    expect(transactions[0]!.rawDescription).toBe("");
    expect(transactions[0]!.postingDate).toBe("2036-02-02");
    expect(transactions[0]!.transactionDate).toBe("2036-02-01");
  });

  it.each(["Debit", "Credit"])(
    "preserves a valid zero %s as a canonical zero Transaction",
    (direction) => {
      const balance = statement.openingBalance!.rawValue;
      const row: ParsedStatementRow = {
        ...statement.rows[0],
        rawDebit: direction === "Debit" ? "0.00" : "",
        rawCredit: direction === "Credit" ? "0.00" : "",
        rawBalance: balance,
        rawText: `${statement.rows[0].rawPostingDate} ${statement.rows[0].rawDescription} 0.00 ${balance}`,
      };
      const zeroStatement: ParsedStatement = {
        ...statement,
        rows: [row],
        closingBalance: {
          rawValue: balance,
          rawText: `Closing Balance ${balance}`,
        },
        reconciliation: {
          rows: [{ position: row.position, status: "verified" }],
          closingBalance: "verified",
        },
      };
      const transactions = convertCommBankBrowserSummaryToTransactions(
        zeroStatement,
        context(),
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.amount.amountMinor).toBe(0);
      expect(Object.is(transactions[0]!.amount.amountMinor, -0)).toBe(false);
      expect(transactions[0]!.id).toBe("transaction-1");
    },
  );

  it("refuses missing reconciliation before requesting any IDs", () => {
    expectRefusal({ ...statement, reconciliation: undefined }, /reconcil/i);
  });

  it("refuses empty rows with matching empty checks and forged verified closing status", () => {
    expectRefusal(
      {
        ...statement,
        rows: [],
        reconciliation: { rows: [], closingBalance: "verified" },
      },
      /closing|final|source|balance/i,
    );
  });

  it.each(["mismatch", "unresolved"] as const)(
    "refuses a %s row check",
    (status) => {
      expectRefusal(
        withChecks({
          rows: statement.reconciliation!.rows.map((check, index) =>
            index === 0 ? { ...check, status } : check,
          ),
        }),
        /reconcil|row|verified/i,
      );
    },
  );

  it.each(["mismatch", "unresolved"] as const)(
    "refuses a %s closing check",
    (closingBalance) => {
      expectRefusal(
        withChecks({ closingBalance }),
        /closing|reconcil|verified/i,
      );
    },
  );

  it.each(["missing", "extra"])(
    "refuses %s row-check correspondence",
    (variant) => {
      const rows =
        variant === "missing"
          ? statement.reconciliation!.rows.slice(1)
          : [
              ...statement.reconciliation!.rows,
              statement.reconciliation!.rows[0],
            ];
      expectRefusal(withChecks({ rows }), /reconcil|correspond|row|count/i);
    },
  );

  it("refuses checks reordered against source rows", () => {
    expectRefusal(
      withChecks({ rows: [...statement.reconciliation!.rows].reverse() }),
      /reconcil|position|row|correspond/i,
    );
  });

  it.each(["page", "row"] as const)(
    "refuses a mismatched reconciliation %s position",
    (field) => {
      expectRefusal(
        withChecks({
          rows: statement.reconciliation!.rows.map((check, index) =>
            index === 0
              ? { ...check, position: { ...check.position, [field]: 99 } }
              : check,
          ),
        }),
        /reconcil|position|row|correspond/i,
      );
    },
  );

  it("refuses duplicate source positions even when checks repeat the same position", () => {
    const position = statement.rows[0].position;
    expectRefusal(
      {
        ...statement,
        rows: statement.rows.map((row, index) =>
          index === 1 ? { ...row, position } : row,
        ),
        reconciliation: {
          ...statement.reconciliation!,
          rows: statement.reconciliation!.rows.map((check, index) =>
            index === 1 ? { ...check, position } : check,
          ),
        },
      },
      /position|row|duplicate/i,
    );
  });

  it.each(["postingDate", "rawDescription"] as const)(
    "refuses missing %s even on the final row before requesting IDs",
    (field) => {
      expectRefusal(
        withRow({ [field]: undefined }, 10),
        /date|description|row/i,
      );
    },
  );

  it("identifies the failing source position in a deterministic diagnostic", () => {
    expect(() =>
      convertCommBankBrowserSummaryToTransactions(
        withRow({ postingDate: undefined }, 10),
        context(),
      ),
    ).toThrow(
      "CommBank Transaction conversion refused at page 1, row 11: An established valid posting date is required.",
    );
  });

  it.each(["2036-02-31", "1900-02-29", "2036-2-02", "2036-02-02\n"])(
    "refuses malformed Gregorian posting date %s",
    (postingDate) => {
      expectRefusal(withRow({ postingDate }), /posting|date|row/i);
    },
  );

  it("refuses an invalid supplied transaction date without substituting the posting date", () => {
    expectRefusal(
      withRow({ transactionDate: "2036-02-31" }),
      /transaction|date|row/i,
    );
  });

  it.each([
    ["missing counterpart", { rawCredit: undefined }],
    ["neither populated", { rawDebit: "", rawCredit: "" }],
    ["both populated", { rawDebit: "1.00", rawCredit: "2.00" }],
    ["ambiguous joined values", { rawDebit: "1.00 2.00" }],
    ["malformed comma groups", { rawDebit: "1,23.45" }],
    ["unsafe magnitude", { rawDebit: "90071992547409.92" }],
    ["surrounding whitespace", { rawDebit: " 38.47 " }],
    ["trailing Debit line terminator", { rawDebit: "38.47\n" }],
    ["trailing Credit line terminator", { rawDebit: "", rawCredit: "38.47\n" }],
    ["signed source magnitude", { rawDebit: "-38.47" }],
  ] as const)(
    "refuses %s Debit/Credit evidence without repairing it",
    (_, patch) => {
      expectRefusal(
        withRow({ rawCredit: "", ...patch }, 10),
        /debit|credit|amount|movement|row/i,
      );
    },
  );

  it.each([
    ["blank account", { accountId: " " }],
    ["missing currency", { currency: "" }],
    ["lowercase currency", { currency: "aud" }],
    ["zero decimal scale", { currencyDecimalPlaces: 0 }],
    ["three decimal scale", { currencyDecimalPlaces: 3 }],
    ["missing decimal scale", { currencyDecimalPlaces: undefined }],
  ] as const)("requires explicit valid confirmed context: %s", (_, patch) => {
    expectRefusal(statement, /account|currency|decimal|scale/i, {
      ...context(),
      ...patch,
    } as CommBankTransactionConversionContext);
  });

  it("refuses a conflicting explicit statement currency instead of using an exchange rate", () => {
    expectRefusal(
      { ...statement, metadata: { ...statement.metadata, currency: "USD" } },
      /currency|conflict/i,
    );
  });

  it("refuses unrelated parser output", () => {
    expectRefusal(
      { ...statement, parser: { ...statement.parser, id: "another-parser" } },
      /parser|format|commbank/i,
    );
  });

  it("refuses the correct parser ID with a different version before requesting IDs", () => {
    expectRefusal(
      { ...statement, parser: { ...statement.parser, version: "99.0.0" } },
      /parser|version|provenance/i,
    );
  });

  it.each([
    ["rawDebit", () => withRow({ rawDebit: "38.48" })],
    ["rawCredit", () => withRow({ rawCredit: "1,283.77" }, 2)],
    ["rawBalance", () => withRow({ rawBalance: "$6,368.89" })],
    [
      "openingBalance.rawValue",
      () => ({
        ...statement,
        openingBalance: { ...statement.openingBalance!, rawValue: "$6,407.36" },
      }),
    ],
    [
      "closingBalance.rawValue",
      () => ({
        ...statement,
        closingBalance: { ...statement.closingBalance!, rawValue: "$8,145.23" },
      }),
    ],
  ] as const)(
    "refuses a one-cent change to current %s despite stale verified statuses",
    (_, changed) => {
      const input = changed();
      expect(
        input.reconciliation!.rows.every(({ status }) => status === "verified"),
      ).toBe(true);
      expect(input.reconciliation!.closingBalance).toBe("verified");
      expectRefusal(input, /balance|reconcil|equation|current|source|row/i);
    },
  );

  it.each(["running", "opening", "closing"] as const)(
    "refuses missing, malformed, ambiguous, or unsafe current %s balance evidence",
    (field) => {
      for (const rawValue of [
        undefined,
        "$6,407.3",
        "$6,407.35 $6,407.35",
        "$90071992547409.92",
      ]) {
        const input: ParsedStatement =
          field === "running"
            ? withRow({ rawBalance: rawValue })
            : field === "opening"
              ? {
                  ...statement,
                  openingBalance:
                    rawValue === undefined
                      ? undefined
                      : { ...statement.openingBalance!, rawValue },
                }
              : {
                  ...statement,
                  closingBalance:
                    rawValue === undefined
                      ? undefined
                      : { ...statement.closingBalance!, rawValue },
                };
        expectRefusal(input, /balance|reconcil|equation|current|source|row/i);
      }
    },
  );

  it("refuses an unsafe sum of individually valid current opening and credit magnitudes", () => {
    const balance = "$90071992547409.91";
    const row: ParsedStatementRow = {
      ...statement.rows[0],
      rawDebit: "",
      rawCredit: "0.01",
      rawBalance: balance,
      rawText: `${statement.rows[0].rawPostingDate} ${statement.rows[0].rawDescription} 0.01 ${balance}`,
    };
    expectRefusal(
      {
        ...statement,
        rows: [row],
        openingBalance: { ...statement.openingBalance!, rawValue: balance },
        closingBalance: {
          rawValue: balance,
          rawText: `Closing Balance ${balance}`,
        },
        reconciliation: {
          rows: [{ position: row.position, status: "verified" }],
          closingBalance: "verified",
        },
      },
      /safe|overflow|range|balance|reconcil/i,
    );
  });

  it.each(["blank", "nonstring", "duplicate", "throw"])(
    "refuses %s caller-generated IDs without a partial returned result or sensitive errors",
    (variant) => {
      const factory = vi.fn((row: ParsedStatementRow) => {
        if (row.position.row === 2) {
          if (variant === "blank") return " ";
          if (variant === "nonstring") return undefined as unknown as string;
          if (variant === "duplicate") return "transaction-1";
          throw new Error("PRIVATE_FINANCIAL_CALLBACK_PAYLOAD");
        }
        return `transaction-${row.position.row}`;
      });
      let output: readonly Transaction[] | undefined;
      let error: unknown;
      try {
        output = convertCommBankBrowserSummaryToTransactions(statement, {
          ...context(),
          createTransactionId: factory,
        });
      } catch (caught) {
        error = caught;
      }
      expect(output).toBeUndefined();
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/id|identifier/i);
      expect((error as Error).message).not.toContain(
        "PRIVATE_FINANCIAL_CALLBACK_PAYLOAD",
      );
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect((error as Error).message).not.toContain(
        statement.rows[1]!.rawDescription!,
      );
    },
  );
});
