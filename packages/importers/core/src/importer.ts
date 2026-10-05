import type { ImportParserProvenance } from "@aqchafold/domain";
import type { DocumentInput, ParsedStatement } from "./types";

/** A content-based statement adapter; identity is independent of filenames. */
export interface StatementImporter extends ImportParserProvenance {
  /**
   * Return a finite score in [0, 1]: 0 declines, higher scores are stronger matches.
   * Detection must not mutate input or select an importer on behalf of the caller.
   */
  detect(input: DocumentInput): Promise<number>;

  /**
   * Return source observations, preserving partial extraction and its warnings.
   * Reject unsupported or unreadable inputs explicitly; parsing is not verification.
   */
  parse(input: DocumentInput): Promise<ParsedStatement>;
}
