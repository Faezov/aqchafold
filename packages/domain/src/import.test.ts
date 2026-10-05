import { describe, expect, it } from "vitest";
import { Import, type ImportOptions } from "./index";

const baseOptions: ImportOptions = {
  id: "import-1",
  householdId: "household-1",
  processingStatus: "pending",
};

const sourceMetadata = {
  sourceKind: " bank-statement ",
  sourceFormat: " custom-format ",
  originalFilename: " synthetic statement.csv ",
  displayLabel: " October source ",
};

describe("Import", () => {
  it("creates a minimal pending attempt and preserves supplied IDs verbatim", () => {
    const ingestion = new Import({
      ...baseOptions,
      id: " import-1 ",
      householdId: " household-1 ",
    });
    expect(ingestion.id).toBe(" import-1 ");
    expect(ingestion.householdId).toBe(" household-1 ");
    expect(ingestion.processingStatus).toBe("pending");
    for (const field of [
      "sourceKind",
      "sourceFormat",
      "originalFilename",
      "displayLabel",
      "fingerprint",
      "parser",
      "confirmedAccountId",
    ] as const) {
      expect(ingestion[field]).toBeUndefined();
    }
  });

  it("rejects missing or non-object constructor options", () => {
    for (const options of [undefined, null, 123, "source", true]) {
      expect(() => Reflect.construct(Import, [options])).toThrow(TypeError);
    }
  });

  it.each(["id", "householdId"] as const)(
    "requires a nonblank string %s without defaults",
    (field) => {
      const missing = { ...baseOptions };
      Reflect.deleteProperty(missing, field);
      expect(() => Reflect.construct(Import, [missing])).toThrow(TypeError);
      for (const value of [undefined, "", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Import, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    },
  );

  it.each(["pending", "processing", "completed", "failed"] as const)(
    "accepts explicit %s processing status without requiring evidence",
    (processingStatus) => {
      expect(
        new Import({ ...baseOptions, processingStatus }).processingStatus,
      ).toBe(processingStatus);
    },
  );

  it("requires an explicit supported processing status without defaults", () => {
    const missing = { ...baseOptions };
    Reflect.deleteProperty(missing, "processingStatus");
    expect(() => Reflect.construct(Import, [missing])).toThrow(TypeError);
    for (const processingStatus of [
      undefined,
      null,
      "",
      " pending ",
      "Completed",
      "verified",
      "partial",
      123,
    ]) {
      expect(() =>
        Reflect.construct(Import, [{ ...baseOptions, processingStatus }]),
      ).toThrow(TypeError);
    }
  });

  it("keeps source kind and format independent and open to future evidence", () => {
    for (const [sourceKind, sourceFormat] of [
      ["bank-statement", undefined],
      [undefined, "csv"],
      ["future-source-kind", "future-source-format"],
    ] as const) {
      const ingestion = new Import({
        ...baseOptions,
        sourceKind,
        sourceFormat,
      });
      expect(ingestion.sourceKind).toBe(sourceKind);
      expect(ingestion.sourceFormat).toBe(sourceFormat);
    }
  });

  it("preserves optional source metadata and paired provenance verbatim", () => {
    const ingestion = new Import({
      ...baseOptions,
      ...sourceMetadata,
      fingerprint: { method: " synthetic-hash ", value: " artifact-value " },
      parser: { id: " synthetic-adapter ", version: " custom-version " },
    });
    expect(ingestion).toMatchObject(sourceMetadata);
    expect(ingestion.fingerprint).toEqual({
      method: " synthetic-hash ",
      value: " artifact-value ",
    });
    expect(ingestion.parser).toEqual({
      id: " synthetic-adapter ",
      version: " custom-version ",
    });
  });

  it.each([
    "sourceKind",
    "sourceFormat",
    "originalFilename",
    "displayLabel",
    "confirmedAccountId",
  ] as const)(
    "validates optional %s without substituting defaults",
    (field) => {
      expect(
        new Import({ ...baseOptions, [field]: undefined })[field],
      ).toBeUndefined();
      for (const value of ["", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Import, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    },
  );

  it.each([
    ["fingerprint", { method: "synthetic-hash", value: "artifact-value" }],
    ["parser", { id: "synthetic-adapter", version: "custom-version" }],
  ] as const)(
    "requires complete nonblank %s provenance when supplied",
    (field, evidence) => {
      for (const value of [null, 123, "evidence", [], {}]) {
        expect(() =>
          Reflect.construct(Import, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
      for (const key of Object.keys(evidence)) {
        const missing = { ...evidence };
        Reflect.deleteProperty(missing, key);
        expect(() =>
          Reflect.construct(Import, [{ ...baseOptions, [field]: missing }]),
        ).toThrow(TypeError);
        for (const value of [undefined, "", " \t ", null, 123]) {
          expect(() =>
            Reflect.construct(Import, [
              { ...baseOptions, [field]: { ...evidence, [key]: value } },
            ]),
          ).toThrow(TypeError);
        }
      }
    },
  );

  it("retains available evidence on failed attempts without requiring an Account", () => {
    const ingestion = new Import({
      ...baseOptions,
      ...sourceMetadata,
      processingStatus: "failed",
      fingerprint: { method: "synthetic-hash", value: "artifact-value" },
      parser: { id: "synthetic-adapter", version: "custom-version" },
    });
    expect(ingestion.processingStatus).toBe("failed");
    expect(ingestion).toMatchObject(sourceMetadata);
    expect(ingestion.fingerprint).toEqual({
      method: "synthetic-hash",
      value: "artifact-value",
    });
    expect(ingestion.parser).toEqual({
      id: "synthetic-adapter",
      version: "custom-version",
    });
    expect(ingestion.confirmedAccountId).toBeUndefined();
  });

  it("records only a supplied confirmed Account reference without lookup or guessing", () => {
    const unresolved = new Import({
      ...baseOptions,
      processingStatus: "completed",
    });
    const confirmed = new Import({
      ...baseOptions,
      confirmedAccountId: " account-1 ",
    });
    expect(unresolved.confirmedAccountId).toBeUndefined();
    expect(confirmed.confirmedAccountId).toBe(" account-1 ");
    expect(confirmed.processingStatus).toBe("pending");
  });

  it("keeps repeat ingestion identities distinct despite identical artifact evidence", () => {
    const evidence = {
      originalFilename: "synthetic-repeat.pdf",
      fingerprint: { method: "synthetic-hash", value: "same-artifact" },
    };
    const first = new Import({
      ...baseOptions,
      ...evidence,
      id: "import-a",
      processingStatus: "completed",
    });
    const second = new Import({ ...baseOptions, ...evidence, id: "import-b" });
    expect(first.id).toBe("import-a");
    expect(second.id).toBe("import-b");
    expect(first.householdId).toBe(second.householdId);
    expect(first.originalFilename).toBe(second.originalFilename);
    expect(first.fingerprint).toEqual(second.fingerprint);
    expect(first).not.toBe(second);
    expect(first.processingStatus).toBe("completed");
    expect(second.processingStatus).toBe("pending");
  });

  it("exposes only attempt metadata and does not manufacture verification on completion", () => {
    const ingestion = new Import({
      ...baseOptions,
      processingStatus: "completed",
    });
    expect(Object.keys(ingestion).sort()).toEqual([
      "confirmedAccountId",
      "displayLabel",
      "fingerprint",
      "householdId",
      "id",
      "originalFilename",
      "parser",
      "processingStatus",
      "sourceFormat",
      "sourceKind",
    ]);
    for (const field of [
      "verified",
      "reconciled",
      "accepted",
      "reviewComplete",
    ]) {
      expect(ingestion).not.toHaveProperty(field);
    }
    expect(ingestion.confirmedAccountId).toBeUndefined();
  });

  it("copies and freezes fingerprint and parser provenance against caller and runtime mutation", () => {
    const fingerprint = { method: "synthetic-hash", value: "artifact-value" };
    const parser = { id: "synthetic-adapter", version: "custom-version" };
    const options = { ...baseOptions, fingerprint, parser };
    const ingestion = new Import(options);
    expect(ingestion.fingerprint).not.toBe(fingerprint);
    expect(ingestion.parser).not.toBe(parser);
    fingerprint.method = "changed-method";
    fingerprint.value = "changed-value";
    parser.id = "changed-parser";
    parser.version = "changed-version";
    options.fingerprint = { method: "replacement", value: "replacement" };
    options.parser = { id: "replacement", version: "replacement" };
    for (const evidence of [ingestion.fingerprint, ingestion.parser]) {
      if (evidence === undefined)
        throw new Error("Expected recorded provenance.");
      expect(Object.isFrozen(evidence)).toBe(true);
      for (const field of Object.keys(evidence)) {
        expect(Reflect.set(evidence, field, "changed")).toBe(false);
        expect(
          Reflect.defineProperty(evidence, field, { value: "changed" }),
        ).toBe(false);
        expect(Reflect.deleteProperty(evidence, field)).toBe(false);
      }
    }
    expect(ingestion.fingerprint).toEqual({
      method: "synthetic-hash",
      value: "artifact-value",
    });
    expect(ingestion.parser).toEqual({
      id: "synthetic-adapter",
      version: "custom-version",
    });
  });

  it("copies primitive fields and prevents runtime mutation, redefinition, deletion, and extension", () => {
    const options = {
      ...baseOptions,
      ...sourceMetadata,
      confirmedAccountId: "account-1",
    };
    const ingestion = new Import(options);
    for (const field of [
      "id",
      "householdId",
      "sourceKind",
      "sourceFormat",
      "originalFilename",
      "displayLabel",
      "confirmedAccountId",
    ] as const) {
      options[field] = "changed";
    }
    options.processingStatus = "failed";
    for (const field of Object.keys(ingestion)) {
      expect(Reflect.set(ingestion, field, "changed")).toBe(false);
      expect(
        Reflect.defineProperty(ingestion, field, { value: "changed" }),
      ).toBe(false);
      expect(Reflect.deleteProperty(ingestion, field)).toBe(false);
    }
    expect(Reflect.set(ingestion, "verified", true)).toBe(false);
    expect(Object.isFrozen(ingestion)).toBe(true);
    expect(ingestion).toMatchObject({
      ...baseOptions,
      ...sourceMetadata,
      confirmedAccountId: "account-1",
    });
  });
});
