import {
  type AccountRepository,
  DuplicateImportError,
  type ImportRepository,
} from "@aqchafold/database";
import { Import } from "@aqchafold/domain";
import {
  commbankBrowserSummaryImporter,
  convertCommBankBrowserSummaryToTransactions,
} from "@aqchafold/importers-commbank";
import {
  fingerprintDocumentInput,
  type ReconciliationStatus,
} from "@aqchafold/importers-core";
import type { SelectedDocument } from "../platform/pick-statement-document";

export type ImportStatementOptions = {
  document: SelectedDocument;
  accountId: string;
  confirmedCurrency: string;
  currencyDecimalPlaces: 2;
  accountRepository: Pick<AccountRepository, "getById">;
  importRepository: Pick<ImportRepository, "create" | "complete" | "fail">;
  readDocumentBytes: (uri: string) => Promise<Uint8Array>;
  createImportId: () => string;
  signal?: AbortSignal;
};

export type ReconciliationSummary = {
  totalRows: number;
  verifiedRows: number;
  closingBalance: ReconciliationStatus;
};

export type ImportStatementResult =
  | {
      status: "imported";
      transactionCount: number;
      reconciliation: ReconciliationSummary;
    }
  | { status: "reconciliation-failed"; reconciliation: ReconciliationSummary }
  | { status: "already-imported" }
  | { status: "unsupported" }
  | { status: "failed" };

/** Coordinates production validation and persistence without exposing diagnostics. */
export async function importStatement({
  document,
  accountId,
  confirmedCurrency,
  currencyDecimalPlaces,
  accountRepository,
  importRepository,
  readDocumentBytes,
  createImportId,
  signal,
}: ImportStatementOptions): Promise<ImportStatementResult> {
  try {
    if (signal?.aborted) return { status: "failed" };
    const input = { bytes: await readDocumentBytes(document.uri) };
    if (signal?.aborted) return { status: "failed" };
    const fingerprint = fingerprintDocumentInput(input);
    const score = await commbankBrowserSummaryImporter.detect(input);
    if (signal?.aborted) return { status: "failed" };
    if (score !== 1) return { status: "unsupported" };
    const parsed = await commbankBrowserSummaryImporter.parse(input);
    if (signal?.aborted) return { status: "failed" };
    const checks = parsed.reconciliation;
    if (!checks) return { status: "failed" };
    const reconciliation: ReconciliationSummary = {
      totalRows: checks.rows.length,
      verifiedRows: checks.rows.filter(({ status }) => status === "verified")
        .length,
      closingBalance: checks.closingBalance,
    };
    if (
      reconciliation.verifiedRows !== reconciliation.totalRows ||
      reconciliation.closingBalance !== "verified"
    )
      return { status: "reconciliation-failed", reconciliation };
    const account = accountRepository.getById(accountId);
    if (!account || account.primaryCurrency !== confirmedCurrency)
      return { status: "failed" };
    const importId = createImportId();
    const transactions = convertCommBankBrowserSummaryToTransactions(parsed, {
      accountId: account.id,
      currency: account.primaryCurrency,
      currencyDecimalPlaces,
      createTransactionId: (row) =>
        `${importId}:transaction:${row.position.page ?? 0}:${row.position.row}`,
    });
    if (signal?.aborted) return { status: "failed" };
    const attempt = new Import({
      id: importId,
      householdId: account.householdId,
      processingStatus: "processing",
      fingerprint,
      parser: parsed.parser,
      confirmedAccountId: account.id,
      ...(document.name?.trim() ? { originalFilename: document.name } : {}),
    });
    importRepository.create(attempt);
    // Creation and completion are synchronous; no navigation/unmount can interleave.
    try {
      importRepository.complete(attempt.id, transactions);
    } catch (error) {
      try {
        importRepository.fail(attempt.id);
      } catch {
        // Preserve the original outcome even if the failed-attempt update fails.
      }
      return error instanceof DuplicateImportError
        ? { status: "already-imported" }
        : { status: "failed" };
    }
    return {
      status: "imported",
      transactionCount: transactions.length,
      reconciliation,
    };
  } catch {
    return { status: "failed" };
  }
}
