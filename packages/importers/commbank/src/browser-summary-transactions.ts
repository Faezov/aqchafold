import { Money, Transaction } from "@aqchafold/domain";
import type {
  ParsedStatement,
  ParsedStatementRow,
  StatementSourcePosition,
} from "@aqchafold/importers-core";
import { commbankBrowserSummaryImporter } from "./browser-summary";
import {
  isGregorianCalendarDate,
  parseDollarBalanceMinor,
  parseSignedDebitCreditMinor,
} from "./browser-summary-rows";

/** Caller-confirmed Account association; source identifiers do not supply it. */
export type CommBankTransactionConversionContext = {
  readonly accountId: string;
  readonly currency: string;
  /** This pipeline supports confirmed currencies with two minor-unit decimals. */
  readonly currencyDecimalPlaces: 2;
  /** Supply a canonical ID once per source row; do not mutate the source row. */
  readonly createTransactionId: (row: ParsedStatementRow) => string;
};

function refuse(reason: string, position?: StatementSourcePosition): never {
  const location = position
    ? ` at ${position.page === undefined ? "" : `page ${position.page}, `}row ${position.row}`
    : "";
  throw new Error(
    `CommBank Transaction conversion refused${location}: ${reason}`,
  );
}

/** All-or-nothing conversion of reconciled browser-summary source observations. */
export function convertCommBankBrowserSummaryToTransactions(
  statement: ParsedStatement,
  context: CommBankTransactionConversionContext,
): readonly Transaction[] {
  const { accountId, currency, currencyDecimalPlaces, createTransactionId } =
    context;
  if (
    statement.parser.id !== commbankBrowserSummaryImporter.id ||
    statement.parser.version !== commbankBrowserSummaryImporter.version
  )
    refuse("Unsupported parser identity or version.");
  if (typeof accountId !== "string" || !accountId.trim())
    refuse("A confirmed canonical Account ID is required.");
  if (currencyDecimalPlaces !== 2)
    refuse("A confirmed two-decimal Account currency is required.");
  try {
    new Money(0, currency);
  } catch {
    refuse("A valid confirmed Account currency is required.");
  }
  if (
    statement.metadata.currency !== undefined &&
    statement.metadata.currency !== currency
  )
    refuse("Source currency conflicts with the confirmed Account currency.");
  if (typeof createTransactionId !== "function")
    refuse("A caller-supplied Transaction ID factory is required.");

  const reconciliation = statement.reconciliation;
  if (!reconciliation) refuse("Statement reconciliation is required.");
  if (reconciliation.rows.length !== statement.rows.length)
    refuse("Reconciliation row count does not match the source rows.");
  if (reconciliation.closingBalance !== "verified")
    refuse("Closing balance reconciliation must be verified.");

  const positions = new Set<string>();
  // Validate every row before invoking the caller's ID factory.
  const prepared = statement.rows.map((row, index) => {
    const { position } = row;
    if (
      !Number.isSafeInteger(position.row) ||
      position.row < 1 ||
      (position.page !== undefined &&
        (!Number.isSafeInteger(position.page) || position.page < 1))
    )
      refuse("A valid source position is required.");
    const key = JSON.stringify([position.page, position.row]);
    if (positions.has(key))
      refuse("Source positions must be distinct.", position);
    positions.add(key);
    const check = reconciliation.rows[index];
    if (
      check.position.page !== position.page ||
      check.position.row !== position.row
    )
      refuse(
        "Reconciliation position does not match the source row.",
        position,
      );
    if (check.status !== "verified")
      refuse("Row reconciliation must be verified.", position);
    if (!isGregorianCalendarDate(row.postingDate))
      refuse("An established valid posting date is required.", position);
    if (typeof row.rawDescription !== "string")
      refuse("An established raw description is required.", position);
    if (
      row.transactionDate !== undefined &&
      !isGregorianCalendarDate(row.transactionDate)
    )
      refuse("The established transaction date must be valid.", position);
    const signedMinor = parseSignedDebitCreditMinor(
      row.rawDebit,
      row.rawCredit,
    );
    if (signedMinor === undefined)
      refuse("Valid unambiguous Debit/Credit evidence is required.", position);
    const previousMinor = parseDollarBalanceMinor(
      index === 0
        ? statement.openingBalance?.rawValue
        : statement.rows[index - 1].rawBalance,
    );
    const currentMinor = parseDollarBalanceMinor(row.rawBalance);
    if (previousMinor === undefined || currentMinor === undefined)
      refuse(
        "Valid unambiguous current source balances are required.",
        position,
      );
    if (
      signedMinor > 0 &&
      previousMinor > Number.MAX_SAFE_INTEGER - signedMinor
    )
      refuse(
        "Current source balance arithmetic exceeds the safe integer range.",
        position,
      );
    if (previousMinor + signedMinor !== currentMinor)
      refuse("Current source running balance no longer reconciles.", position);
    return {
      row,
      postingDate: row.postingDate,
      rawDescription: row.rawDescription,
      transactionDate: row.transactionDate,
      amount: new Money(signedMinor, currency),
    };
  });

  const finalMinor = parseDollarBalanceMinor(
    statement.rows[statement.rows.length - 1]?.rawBalance,
  );
  const closingMinor = parseDollarBalanceMinor(
    statement.closingBalance?.rawValue,
  );
  if (finalMinor === undefined || closingMinor === undefined)
    refuse(
      "Valid unambiguous current closing and final source balances are required.",
    );
  if (finalMinor !== closingMinor)
    refuse("Current source closing balance no longer reconciles.");

  const ids = new Set<string>();
  const transactions = prepared.map((entry) => {
    let id: string;
    try {
      id = createTransactionId(entry.row);
    } catch {
      refuse("The Transaction ID factory failed.", entry.row.position);
    }
    if (typeof id !== "string" || !id.trim())
      refuse(
        "The Transaction ID factory must supply a nonblank ID.",
        entry.row.position,
      );
    if (ids.has(id))
      refuse(
        "The Transaction ID factory supplied a duplicate ID.",
        entry.row.position,
      );
    ids.add(id);
    return new Transaction({
      id,
      accountId,
      postingDate: entry.postingDate,
      ...(entry.transactionDate === undefined
        ? {}
        : { transactionDate: entry.transactionDate }),
      rawDescription: entry.rawDescription,
      amount: entry.amount,
      origin: "imported",
    });
  });
  return transactions;
}
