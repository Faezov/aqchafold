/// <reference types="node" />

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";
import { getDocument, type TextItem } from "pdfjs-serverless";
import { describe, expect, it, vi } from "vitest";
import { parseBrowserSummaryDates } from "./browser-summary-dates";
import { commbankBrowserSummaryImporter } from "./browser-summary";

const fixture = new Uint8Array(
  readFileSync(
    new URL(
      "../../../../fixtures/bank-statements/commbank/browser-summary-01.pdf",
      import.meta.url,
    ),
  ),
);
const reference = JSON.parse(
  readFileSync(
    new URL(
      "../../../../fixtures/bank-statements/commbank/browser-summary-01.reference.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { sourceRows: readonly { rawDate: string }[] };

type TextRun = { text: string; x: number; y: number };
const header: TextRun[] = [
  { text: "Commonwealth Bank of Australia", x: 40, y: 720 },
  { text: "Transaction Summary", x: 300, y: 680 },
  { text: "Account Number", x: 300, y: 640 },
  { text: "Period", x: 300, y: 620 },
  { text: "Closing Balance", x: 300, y: 600 },
  ...["Date", "Transaction", "Debit", "Credit", "Balance"].map(
    (text, index) => ({ text, x: [40, 110, 330, 410, 490][index], y: 500 }),
  ),
];

// Real PDF objects, compressed content, and hex text exercise extraction itself.
function makePdf(runs: readonly TextRun[]): Uint8Array {
  const commands = runs
    .map(
      ({ text, x, y }) =>
        `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm <${Buffer.from(text).toString("hex")}> Tj ET`,
    )
    .join("\n");
  const stream = deflateSync(commands);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([
      Buffer.from(
        `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
      ),
      stream,
      Buffer.from("\nendstream"),
    ]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    );
  }
  const xrefOffset = Buffer.concat(chunks).length;
  const entries = offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  chunks.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${entries}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}

const detect = (bytes: Uint8Array) =>
  commbankBrowserSummaryImporter.detect({ bytes });

describe("CommBank browser Transaction Summary detection", () => {
  it("recognizes the committed synthetic fixture", async () => {
    expect(await detect(fixture)).toBe(1);
  });

  it("reads compressed PDF content and hex-encoded text", async () => {
    expect(await detect(makePdf(header))).toBe(1);
  });

  it("recognizes duplicate text layers with overlapping OCR fragments", async () => {
    const runs = [
      ...header,
      ...header,
      ...header,
      ...header,
      { text: "Commonwealth", x: 40.5, y: 720.5 },
      { text: "Bank of Australia", x: 105, y: 720.5 },
      { text: "Transaction", x: 300.5, y: 680.5 },
      { text: "Summary", x: 357, y: 680.5 },
      { text: "Account", x: 300.5, y: 640.5 },
      { text: "Number", x: 337, y: 640.5 },
      { text: "Closing", x: 300.5, y: 600.5 },
      { text: "Balance", x: 335, y: 600.5 },
    ];
    expect(await detect(makePdf(runs))).toBe(1);
  });

  it("supports clone polyfills that reject explicit null options", async () => {
    const clone = globalThis.structuredClone;
    const spy = vi
      .spyOn(globalThis, "structuredClone")
      .mockImplementation((value, options) => {
        if (options === null)
          throw new TypeError("Clone options cannot be null.");
        return clone(value, options);
      });
    try {
      expect(await detect(fixture)).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("declines an unrelated readable PDF", async () => {
    expect(
      await detect(makePdf([{ text: "SYNTHETIC RECEIPT", x: 40, y: 720 }])),
    ).toBe(0);
  });

  it.each(header.map(({ text }) => text))(
    "declines when the required %s signal is absent",
    async (missing) => {
      expect(
        await detect(makePdf(header.filter(({ text }) => text !== missing))),
      ).toBe(0);
    },
  );

  it.each([
    ["Commonwealth Bank of Australia", "Another Bank of Australia"],
    ["Transaction Summary", "Account Statement"],
  ])("declines %s replaced by %s", async (original, replacement) => {
    const runs = header.map((run) => ({
      ...run,
      text: run.text === original ? replacement : run.text,
    }));
    expect(await detect(makePdf(runs))).toBe(0);
  });

  it("declines the unsupported signed Amount column variant", async () => {
    const runs = header.filter(
      ({ text }) => text !== "Debit" && text !== "Credit",
    );
    runs.push({ text: "Amount", x: 380, y: 500 });
    expect(await detect(makePdf(runs))).toBe(0);
  });

  it.each(["wrong order", "different baselines", "metadata below table"])(
    "declines structurally invalid signals: %s",
    async (variant) => {
      const runs = header.map((run) => ({ ...run }));
      if (variant === "wrong order") {
        runs.find(({ text }) => text === "Debit")!.x = 440;
      } else if (variant === "different baselines") {
        runs.find(({ text }) => text === "Debit")!.y = 520;
      } else {
        runs.find(({ text }) => text === "Period")!.y = 450;
      }
      expect(await detect(makePdf(runs))).toBe(0);
    },
  );

  it.each([
    new Uint8Array(),
    new Uint8Array([0, 255, 1, 127]),
    new Uint8Array(Buffer.from(header.map(({ text }) => text).join("\n"))),
    new Uint8Array(Buffer.from("%PDF-1.7\nnot a PDF document\n%%EOF")),
    fixture.slice(0, 150),
  ])("declines malformed or non-PDF bytes safely", async (bytes) => {
    const score = await detect(bytes);
    expect(score).toBe(0);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("preserves the input and its surrounding byte buffer", async () => {
    const backing = new Uint8Array(fixture.length + 8);
    backing.set(fixture, 4);
    const before = backing.slice();
    expect(await detect(backing.subarray(4, fixture.length + 4))).toBe(1);
    expect(backing).toEqual(before);
  });
});

function dateSummary(
  dates: readonly string[],
  period = "01 Jan - 31 Dec 2036",
  opening = "2036 OPENING BALANCE",
): TextRun[] {
  return [
    ...header,
    { text: period, x: 365, y: 620 },
    { text: period.slice(0, 6), x: 40, y: 480 },
    { text: opening, x: 110, y: 480 },
    { text: "$100.00", x: 490, y: 480 },
    ...dates.flatMap((text, index) => {
      const y = 460 - index * 20;
      return [
        { text, x: 40, y },
        { text: `SYNTHETIC MOVEMENT ${index + 1}`, x: 110, y },
        { text: "1.00", x: 330, y },
      ];
    }),
  ];
}

const parse = (bytes: Uint8Array) =>
  commbankBrowserSummaryImporter.parse({ bytes });

describe("CommBank browser Transaction Summary posting dates", () => {
  it("preserves eleven source movements in document order with dates from 2036", async () => {
    const statement = await parse(fixture);
    expect(statement.rows).toHaveLength(11);
    expect(statement.rows.map(({ rawPostingDate }) => rawPostingDate)).toEqual(
      reference.sourceRows.map(({ rawDate }) => rawDate),
    );
    expect(statement.rows.map(({ postingDate }) => postingDate)).toEqual([
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
    expect(statement.rows.map(({ position }) => position)).toEqual(
      Array.from({ length: 11 }, (_, index) => ({ page: 1, row: index + 1 })),
    );
    expect(
      statement.rows.every(
        ({ rawText }) => !rawText.includes("OPENING BALANCE"),
      ),
    ).toBe(true);
    expect(statement.metadata).toEqual({ rawText: "" });
    expect(statement.warnings.length).toBeGreaterThan(0);
  });

  it("retains continuation and source-cell evidence without resolving later fields", async () => {
    const statement = await parse(fixture);
    expect(statement.rows[3]!.rawText).toContain(
      "Direct Debit SYNTHETIC UTILITIES\n91007382",
    );
    expect(statement.rows[3]!.rawText).toContain("24.19");
    expect(statement.rows[3]!.rawText).toContain("$7,515.62");
    for (const row of statement.rows) {
      for (const field of [
        "rawDescription",
        "rawTransactionDate",
        "transactionDate",
        "rawAmount",
        "rawDebit",
        "rawCredit",
        "rawBalance",
        "amount",
        "balance",
        "sourceTransactionId",
      ] as const) {
        expect(row[field]).toBeUndefined();
      }
    }
    expect(statement.openingBalance).toBeUndefined();
    expect(statement.closingBalance).toBeUndefined();
  });

  it("keeps repeated dates separate and does not reorder dates", async () => {
    const statement = await parse(
      makePdf(dateSummary(["03 Feb", "02 Feb", "02 Feb"])),
    );
    expect(statement.rows.map(({ postingDate }) => postingDate)).toEqual([
      "2036-02-03",
      "2036-02-02",
      "2036-02-02",
    ]);
    expect(statement.rows.map(({ position }) => position.row)).toEqual([
      1, 2, 3,
    ]);
  });

  it("preserves an extracted date run without trimming or collapsing its whitespace", async () => {
    const task = getDocument({
      data: new Uint8Array(fixture),
      verbosity: 0,
      disableFontFace: true,
      useSystemFonts: false,
    });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const content = await page.getTextContent({ disableNormalization: true });
      const items = content.items.filter(
        (item): item is TextItem => "str" in item,
      );
      const date = items.find((item) => item.str === "02 Feb");
      expect(date).toBeDefined();
      // PDF.js coalesces drawing whitespace before yielding runs. This tests the
      // importer boundary directly, preserving the run supplied by extraction.
      const source = items.map((item) =>
        item === date ? { ...item, str: " 02  Feb " } : item,
      );
      const { rows } = parseBrowserSummaryDates([source]);
      expect(rows[0]!.rawPostingDate).toBe(" 02  Feb ");
      expect(rows[0]!.rawText).toContain(" 02  Feb ");
      expect(rows[0]!.postingDate).toBe("2036-02-02");
    } finally {
      await task.destroy();
    }
  });

  it("retains conflicting date-cell runs unresolved with an ambiguity warning", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push({ text: "03 Feb", x: 40, y: 460 });
    const { rows } = await parse(makePdf(runs));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawPostingDate).toContain("02 Feb");
    expect(rows[0]!.rawPostingDate).toContain("03 Feb");
    expect(rows[0]!.postingDate).toBeUndefined();
    expect(rows[0]!.warnings.join(" ")).toMatch(/ambiguous/i);
  });

  it("collapses overlapping duplicate source layers without merging repeated movements", async () => {
    const runs = dateSummary(
      reference.sourceRows.map(({ rawDate }) => rawDate),
    );
    const statement = await parse(makePdf([...runs, ...runs]));
    expect(statement.rows).toHaveLength(11);
    expect(statement.rows.map(({ rawPostingDate }) => rawPostingDate)).toEqual(
      reference.sourceRows.map(({ rawDate }) => rawDate),
    );
    expect(statement.warnings.join(" ")).toMatch(/overlapping/i);
  });

  it.each(["31 Feb", "00 Feb", "02 Xxx", "not a date"])(
    "retains malformed movement date %s unresolved with a warning",
    async (rawDate) => {
      const { rows } = await parse(makePdf(dateSummary([rawDate])));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawPostingDate).toBe(rawDate);
      expect(rows[0]!.postingDate).toBeUndefined();
      expect(rows[0]!.warnings.length).toBeGreaterThan(0);
    },
  );

  it.each(["absent", "empty"])(
    "retains a movement with an %s Date cell unresolved",
    async (variant) => {
      const runs = dateSummary(["02 Feb"]).filter(
        ({ x, y }) => !(x === 40 && y === 460),
      );
      if (variant === "empty") runs.push({ text: "", x: 40, y: 460 });
      const { rows } = await parse(makePdf(runs));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawPostingDate).toBeUndefined();
      expect(rows[0]!.postingDate).toBeUndefined();
      expect(rows[0]!.rawText).toContain("SYNTHETIC MOVEMENT 1");
      expect(rows[0]!.position).toEqual({ page: 1, row: 1 });
      expect(rows[0]!.warnings.length).toBeGreaterThan(0);
    },
  );

  it("keeps a missing-date movement separate from the preceding dated movement", async () => {
    const runs = dateSummary(["02 Feb", "03 Feb"]).filter(
      ({ x, y }) => !(x === 40 && y === 440),
    );
    const { rows } = await parse(makePdf(runs));
    expect(rows).toHaveLength(2);
    expect(rows.map(({ position }) => position)).toEqual([
      { page: 1, row: 1 },
      { page: 1, row: 2 },
    ]);
    expect(rows[0]!.postingDate).toBe("2036-02-02");
    expect(rows[0]!.rawText).not.toContain("SYNTHETIC MOVEMENT 2");
    expect(rows[1]!.rawPostingDate).toBeUndefined();
    expect(rows[1]!.postingDate).toBeUndefined();
    expect(rows[1]!.rawText).toContain("SYNTHETIC MOVEMENT 2");
    expect(rows[1]!.rawText).not.toContain("SYNTHETIC MOVEMENT 1");
    expect(rows[1]!.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    [2036, true],
    [2035, false],
    [1900, false],
    [2000, true],
  ])("validates Gregorian leap day for %s", async (year, valid) => {
    const { rows } = await parse(
      makePdf(
        dateSummary(
          ["29 Feb"],
          `01 Jan - 31 Dec ${year}`,
          `${year} OPENING BALANCE`,
        ),
      ),
    );
    expect(rows[0]!.postingDate).toBe(valid ? `${year}-02-29` : undefined);
    if (!valid) expect(rows[0]!.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    ["01 Jan - 31 Dec", "OPENING BALANCE"],
    ["01 Jan - 31 Dec 2036", "2035 OPENING BALANCE"],
    ["31 Feb - 31 Dec 2036", "2036 OPENING BALANCE"],
    ["01 Dec - 31 Jan 2036", "2036 OPENING BALANCE"],
  ])(
    "leaves missing, conflicting, malformed, or cross-year context unresolved: %s",
    async (period, opening) => {
      const statement = await parse(
        makePdf(dateSummary(["02 Feb"], period, opening)),
      );
      expect(statement.rows).toHaveLength(1);
      expect(statement.rows[0]!.postingDate).toBeUndefined();
      expect(
        statement.rows[0]!.warnings.length + statement.warnings.length,
      ).toBeGreaterThan(0);
    },
  );

  it("leaves dates outside the evidenced period unresolved", async () => {
    const { rows } = await parse(
      makePdf(dateSummary(["01 Mar"], "01 Feb - 28 Feb 2036")),
    );
    expect(rows[0]!.rawPostingDate).toBe("01 Mar");
    expect(rows[0]!.postingDate).toBeUndefined();
    expect(rows[0]!.warnings.length).toBeGreaterThan(0);
  });

  it("excludes a date-like nonmovement entry without Debit/Credit source cells", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push(
      { text: "03 Feb", x: 40, y: 430 },
      { text: "SYNTHETIC FOOTER", x: 110, y: 430 },
    );
    const { rows } = await parse(makePdf(runs));
    expect(rows).toHaveLength(1);
  });

  it.each([
    new Uint8Array([1, 2, 3]),
    makePdf([{ text: "SYNTHETIC RECEIPT", x: 40, y: 720 }]),
  ])(
    "rejects unreadable or unsupported documents explicitly",
    async (bytes) => {
      await expect(parse(bytes)).rejects.toThrow();
    },
  );
});
