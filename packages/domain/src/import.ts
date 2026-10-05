export type ImportProcessingStatus =
  "pending" | "processing" | "completed" | "failed";

export type ImportFingerprint = {
  readonly method: string;
  readonly value: string;
};

export type ImportParserProvenance = {
  readonly id: string;
  readonly version: string;
};

export type ImportOptions = {
  readonly id: string;
  readonly householdId: string;
  readonly processingStatus: ImportProcessingStatus;
  readonly sourceKind?: string;
  readonly sourceFormat?: string;
  readonly originalFilename?: string;
  readonly displayLabel?: string;
  readonly fingerprint?: ImportFingerprint;
  readonly parser?: ImportParserProvenance;
  readonly confirmedAccountId?: string;
};

/**
 * One ingestion attempt, distinct from its artifact and any financial movement.
 * Processing completion establishes neither acceptance nor financial verification.
 */
export class Import {
  readonly id: string;
  readonly householdId: string;
  readonly processingStatus: ImportProcessingStatus;
  readonly sourceKind?: string;
  readonly sourceFormat?: string;
  // The caller supplies a source filename, without a local filesystem path.
  readonly originalFilename?: string;
  readonly displayLabel?: string;
  readonly fingerprint?: ImportFingerprint;
  readonly parser?: ImportParserProvenance;
  // Same-Household context and compatible Account currency need integration checks.
  readonly confirmedAccountId?: string;

  constructor(options: ImportOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Import options must be an object.");
    }
    validateNonblankString(options.id, "Import ID");
    validateNonblankString(options.householdId, "Household ID");
    if (
      options.processingStatus !== "pending" &&
      options.processingStatus !== "processing" &&
      options.processingStatus !== "completed" &&
      options.processingStatus !== "failed"
    ) {
      throw new TypeError(
        "Import processing status must be pending, processing, completed, or failed.",
      );
    }
    for (const field of [
      "sourceKind",
      "sourceFormat",
      "originalFilename",
      "displayLabel",
      "confirmedAccountId",
    ] as const) {
      if (options[field] !== undefined) {
        validateNonblankString(options[field], `Import ${field}`);
      }
    }

    this.id = options.id;
    this.householdId = options.householdId;
    this.processingStatus = options.processingStatus;
    this.sourceKind = options.sourceKind;
    this.sourceFormat = options.sourceFormat;
    this.originalFilename = options.originalFilename;
    this.displayLabel = options.displayLabel;
    this.fingerprint =
      options.fingerprint === undefined
        ? undefined
        : copyFingerprint(options.fingerprint);
    this.parser =
      options.parser === undefined
        ? undefined
        : copyParserProvenance(options.parser);
    this.confirmedAccountId = options.confirmedAccountId;
    Object.freeze(this);
  }
}

function validateNonblankString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a nonblank string.`);
  }
}

function copyFingerprint(fingerprint: ImportFingerprint): ImportFingerprint {
  if (typeof fingerprint !== "object" || fingerprint === null) {
    throw new TypeError("Import fingerprint must be an object.");
  }
  validateNonblankString(fingerprint.method, "Fingerprint method");
  validateNonblankString(fingerprint.value, "Fingerprint value");
  return Object.freeze({
    method: fingerprint.method,
    value: fingerprint.value,
  });
}

function copyParserProvenance(
  parser: ImportParserProvenance,
): ImportParserProvenance {
  if (typeof parser !== "object" || parser === null) {
    throw new TypeError("Import parser provenance must be an object.");
  }
  validateNonblankString(parser.id, "Parser ID");
  validateNonblankString(parser.version, "Parser version");
  return Object.freeze({ id: parser.id, version: parser.version });
}
