import { Import } from "@aqchafold/domain";
import type { imports } from "./schema";

export function importToRow(attempt: Import): typeof imports.$inferSelect {
  const validated = new Import(attempt);
  return {
    id: validated.id,
    householdId: validated.householdId,
    processingStatus: validated.processingStatus,
    sourceKind: validated.sourceKind ?? null,
    sourceFormat: validated.sourceFormat ?? null,
    originalFilename: validated.originalFilename ?? null,
    displayLabel: validated.displayLabel ?? null,
    fingerprintMethod: validated.fingerprint?.method ?? null,
    fingerprintValue: validated.fingerprint?.value ?? null,
    parserId: validated.parser?.id ?? null,
    parserVersion: validated.parser?.version ?? null,
    confirmedAccountId: validated.confirmedAccountId ?? null,
  };
}

export function importFromRow(row: typeof imports.$inferSelect): Import {
  if (
    (row.fingerprintMethod === null) !== (row.fingerprintValue === null) ||
    (row.parserId === null) !== (row.parserVersion === null)
  )
    throw new Error("Stored Import evidence pairs must be complete or absent.");
  return new Import({
    id: row.id,
    householdId: row.householdId,
    processingStatus: row.processingStatus,
    sourceKind: row.sourceKind ?? undefined,
    sourceFormat: row.sourceFormat ?? undefined,
    originalFilename: row.originalFilename ?? undefined,
    displayLabel: row.displayLabel ?? undefined,
    fingerprint:
      row.fingerprintMethod === null || row.fingerprintValue === null
        ? undefined
        : { method: row.fingerprintMethod, value: row.fingerprintValue },
    parser:
      row.parserId === null || row.parserVersion === null
        ? undefined
        : { id: row.parserId, version: row.parserVersion },
    confirmedAccountId: row.confirmedAccountId ?? undefined,
  });
}
