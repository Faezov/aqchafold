import type { ImportParserProvenance, Money } from "@aqchafold/domain";

/** Local document content. Callers and importers must not mutate the bytes. */
export type DocumentInput = {
  readonly bytes: Uint8Array;
};

/** One-based source positions, scoped to this document, never financial identity. */
export type StatementSourcePosition = {
  readonly page?: number;
  /** Transaction record ordinal in document order, or a source row for a balance. */
  readonly row: number;
};

/** Document evidence, with no confirmed Ledgerase Account association. */
export type ParsedStatementMetadata = {
  /** Original extracted metadata text, including labels and unresolved values. */
  readonly rawText: string;
  readonly sourceKind?: string;
  readonly sourceFormat?: string;
  readonly institution?: string;
  /** Source identifier as supplied, including masking; not an internal Account ID. */
  readonly accountIdentifier?: string;
  readonly accountLabel?: string;
  /** Explicit currency code only when established; a symbol alone is insufficient. */
  readonly currency?: string;
  /** Evidenced YYYY-MM-DD boundaries, never inferred from the extracted row range. */
  readonly periodStart?: string;
  readonly periodEnd?: string;
};

/** Opening or closing balance evidence; absence is unknown, never zero. */
export type ParsedStatementBalance = {
  readonly rawText: string;
  readonly rawValue: string;
  readonly rawDate?: string;
  readonly position?: StatementSourcePosition;
  readonly date?: string;
  /** Canonical Account balance sign and explicit currency, only when established. */
  readonly value?: Money;
};

/** A source observation, distinct from a canonical Transaction. */
export type ParsedStatementRow = {
  readonly position: StatementSourcePosition;
  /** Original extracted row text, including continuation lines and other values. */
  readonly rawText: string;
  /**
   * Undefined means not established; "" means an established empty description.
   * Established nonempty descriptions preserve exact source text and whitespace.
   */
  readonly rawDescription?: string;
  readonly rawPostingDate?: string;
  readonly rawTransactionDate?: string;
  readonly rawAmount?: string;
  readonly rawDebit?: string;
  readonly rawCredit?: string;
  readonly rawBalance?: string;
  readonly sourceTransactionId?: string;
  /** Valid YYYY-MM-DD dates only when their meaning is established; no fallback. */
  readonly postingDate?: string;
  readonly transactionDate?: string;
  /** Positive increases the canonical Account balance; negative decreases it. */
  readonly amount?: Money;
  /** Canonical running balance after this movement, only when established. */
  readonly balance?: Money;
  /** Explain unresolved, ambiguous, malformed, or reconstructed fields on this row. */
  readonly warnings: readonly string[];
};

/** Outcome of one source-balance relation; unresolved is never a pass or mismatch. */
export type ReconciliationStatus = "verified" | "mismatch" | "unresolved";

/** Source arithmetic only, without proving currency, completeness, or acceptance. */
export type ParsedStatementReconciliation = {
  /** One check per movement in document order, against opening/preceding source balance. */
  readonly rows: readonly {
    readonly position: StatementSourcePosition;
    readonly status: ReconciliationStatus;
  }[];
  /** Explicit closing balance compared with the final source running balance. */
  readonly closingBalance: ReconciliationStatus;
};

/**
 * Source observations and optional balance checks before Account matching,
 * canonical conversion, or persistence. Optional interpreted fields stay absent when unproven;
 * original extracted descriptions, notation, and values must never be overwritten.
 * All evidence and diagnostics are sensitive local data and must not be logged.
 */
export type ParsedStatement = {
  readonly parser: ImportParserProvenance;
  readonly metadata: ParsedStatementMetadata;
  readonly openingBalance?: ParsedStatementBalance;
  readonly closingBalance?: ParsedStatementBalance;
  /** Absent means checks were not performed; present outcomes describe only checked relations. */
  readonly reconciliation?: ParsedStatementReconciliation;
  /** Preserve document order, including unresolved and legitimate zero-value rows. */
  readonly rows: readonly ParsedStatementRow[];
  /** Explain document/metadata/balance uncertainty, reconstruction, and partial coverage. */
  readonly warnings: readonly string[];
};
