import {
  Import,
  type ImportFingerprint,
  type Transaction,
} from "@aqchafold/domain";
import { and, eq } from "drizzle-orm";
import type { openLedgeraseDatabase } from "./database";
import { importFromRow, importToRow } from "./import-mapping";
import { accounts, households, imports } from "./schema";
import { insertTransactionBatch } from "./transaction-repository";

/** A completed exact artifact already exists in this Household. */
export class DuplicateImportError extends Error {
  constructor() {
    super(
      "This exact source artifact has already been imported for this Household.",
    );
    this.name = "DuplicateImportError";
  }
}

type ReadDatabase = Pick<ReturnType<typeof openLedgeraseDatabase>, "select">;

/** Attempts and atomic successful incorporation of canonical Transactions. */
export class ImportRepository {
  constructor(
    private readonly database: ReturnType<typeof openLedgeraseDatabase>,
  ) {}

  create(attempt: Import): void {
    const row = importToRow(attempt);
    if (row.processingStatus === "completed")
      throw new Error(
        "Completed Imports require atomic completion with Transactions.",
      );
    if (attempt.fingerprint !== undefined)
      assertFingerprint(attempt.fingerprint);
    try {
      this.database.transaction(
        (database) => {
          assertReferences(database, importFromRow(row));
          database.insert(imports).values(row).run();
        },
        { behavior: "immediate" },
      );
    } catch {
      throw new Error("Import creation failed.");
    }
  }

  getById(id: string): Import | undefined {
    return this.database.transaction((database) => {
      const row = database
        .select()
        .from(imports)
        .where(eq(imports.id, id))
        .get();
      if (row === undefined) return undefined;
      const attempt = importFromRow(row);
      assertReferences(database, attempt);
      return attempt;
    });
  }

  /** A preflight lookup only; complete() repeats it under the write transaction. */
  findCompleted(
    householdId: string,
    fingerprint: ImportFingerprint,
  ): Import | undefined {
    assertFingerprint(fingerprint);
    return this.database.transaction((database) => {
      const row = findCompletedRow(database, householdId, fingerprint);
      if (row === undefined) return undefined;
      const attempt = importFromRow(row);
      assertReferences(database, attempt);
      return attempt;
    });
  }

  /** Insert all Transactions and mark completed, or change neither. */
  complete(id: string, records: readonly Transaction[]): void {
    try {
      this.database.transaction(
        (database) => {
          const row = database
            .select()
            .from(imports)
            .where(eq(imports.id, id))
            .get();
          if (row === undefined)
            throw new Error("Import attempt does not exist.");
          const attempt = importFromRow(row);
          assertFingerprint(attempt.fingerprint);
          if (
            findCompletedRow(database, attempt.householdId, attempt.fingerprint)
          )
            throw new DuplicateImportError();
          if (
            attempt.processingStatus !== "pending" &&
            attempt.processingStatus !== "processing"
          )
            throw new Error("Only active Import attempts can complete.");
          assertReferences(database, attempt);
          if (attempt.confirmedAccountId === undefined)
            throw new Error("Import completion requires a confirmed Account.");
          for (const record of records) {
            if (
              record.origin !== "imported" ||
              record.accountId !== attempt.confirmedAccountId
            )
              throw new Error(
                "Imported Transactions must use the Import's confirmed Account.",
              );
          }
          insertTransactionBatch(database, records);
          database
            .update(imports)
            .set({ processingStatus: "completed" })
            .where(eq(imports.id, id))
            .run();
        },
        { behavior: "immediate" },
      );
    } catch (error) {
      if (error instanceof DuplicateImportError) throw error;
      // Drizzle errors can contain SQL parameters, including raw descriptions.
      throw new Error(
        "Import completion failed; no Transactions were persisted.",
      );
    }
  }

  /** Preserve a failed attempt; retries create a new Import with a new ID. */
  fail(id: string): void {
    this.database.transaction(
      (database) => {
        const row = database
          .select()
          .from(imports)
          .where(eq(imports.id, id))
          .get();
        if (
          row === undefined ||
          (row.processingStatus !== "pending" &&
            row.processingStatus !== "processing")
        )
          throw new Error("Only active Import attempts can fail.");
        database
          .update(imports)
          .set({ processingStatus: "failed" })
          .where(eq(imports.id, id))
          .run();
      },
      { behavior: "immediate" },
    );
  }
}

function assertFingerprint(
  fingerprint: ImportFingerprint | undefined,
): asserts fingerprint is ImportFingerprint {
  if (
    fingerprint?.method !== "sha256" ||
    typeof fingerprint.value !== "string" ||
    !/^[0-9a-f]{64}$/.test(fingerprint.value)
  )
    throw new Error("A canonical SHA-256 artifact fingerprint is required.");
}

function findCompletedRow(
  database: ReadDatabase,
  householdId: string,
  fingerprint: ImportFingerprint,
) {
  return database
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.householdId, householdId),
        eq(imports.fingerprintMethod, fingerprint.method),
        eq(imports.fingerprintValue, fingerprint.value),
        eq(imports.processingStatus, "completed"),
      ),
    )
    .get();
}

function assertReferences(database: ReadDatabase, attempt: Import): void {
  if (
    database
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, attempt.householdId))
      .get() === undefined
  )
    throw new Error("Import must reference an existing Household.");
  if (attempt.confirmedAccountId !== undefined) {
    const account = database
      .select({ householdId: accounts.householdId })
      .from(accounts)
      .where(eq(accounts.id, attempt.confirmedAccountId))
      .get();
    if (account === undefined || account.householdId !== attempt.householdId)
      throw new Error("Import must reference an Account in its Household.");
  }
}
