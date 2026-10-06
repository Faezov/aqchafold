/// <reference types="node" />

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";
import { getDocument, type TextItem } from "pdfjs-serverless";
import { describe, expect, it, vi } from "vitest";
import {
  parseBrowserSummaryRows,
  parseDecimalMagnitudeMinor,
} from "./browser-summary-rows";
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
) as {
  headerEvidence: {
    rawBankName: string;
    rawTitle: string;
    rawAccountIdentifier: string;
    rawStatementLabel: string;
    rawPeriod: string;
    rawClosingBalance: string;
  };
  openingBalanceEvidence: {
    page: number;
    tableRow: number;
    rawDate: string;
    rawDescription: string;
    rawBalance: string;
  };
  sourceRows: readonly {
    rawDate: string;
    rawDescription: string;
    rawDebit: string;
    rawCredit: string;
    rawBalance: string;
  }[];
};

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
    expect(statement.metadata.periodStart).toBe("2036-02-01");
    expect(statement.metadata.periodEnd).toBe("2036-02-28");
    expect(statement.metadata.currency).toBeUndefined();
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
        "rawTransactionDate",
        "transactionDate",
        "rawAmount",
        "amount",
        "balance",
        "sourceTransactionId",
      ] as const) {
        expect(row[field]).toBeUndefined();
      }
    }
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.closingBalance?.value).toBeUndefined();
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
    expect(statement.rows.map(({ rawDescription }) => rawDescription)).toEqual([
      "SYNTHETIC MOVEMENT 1",
      "SYNTHETIC MOVEMENT 2",
      "SYNTHETIC MOVEMENT 3",
    ]);
  });

  it("preserves extracted date, description, debit, and balance runs without trimming or collapsing whitespace", async () => {
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
      const description = items.find(
        (item) => item.str === "FIXTURE MARKET EXAMPLEVILLE",
      );
      expect(description).toBeDefined();
      const debit = items.find((item) => item.str === "38.47");
      expect(debit).toBeDefined();
      const balance = items.find((item) => item.str === "$6,368.88");
      expect(balance).toBeDefined();
      // PDF.js coalesces drawing whitespace before yielding runs. This tests the
      // importer boundary directly, preserving the run supplied by extraction.
      const rawDescription = " \tPAYPAL *MiXeD  Café! 東京 e\u0301 \t ";
      const source = items.map((item) =>
        item === date
          ? { ...item, str: " 02  Feb " }
          : item === description
            ? { ...item, str: rawDescription }
            : item === debit
              ? { ...item, str: " 38.47 " }
              : item === balance
                ? { ...item, str: " $6,368.88 " }
                : item,
      );
      const { rows } = parseBrowserSummaryRows([source]);
      expect(rows[0]!.rawPostingDate).toBe(" 02  Feb ");
      expect(rows[0]!.rawText).toContain(" 02  Feb ");
      expect(rows[0]!.postingDate).toBe("2036-02-02");
      expect(rows[0]!.rawDescription).toBe(rawDescription);
      expect(rows[0]!.rawDebit).toBe(" 38.47 ");
      expect(rows[0]!.rawBalance).toBe(" $6,368.88 ");
      expect(rows[0]!.amount).toBeUndefined();
      expect(rows[0]!.warnings.join(" ")).toMatch(/not a valid.*magnitude/i);
      expect(debit!.height).toBeGreaterThan(0);
      const blankSource = items.map((item) =>
        item === debit ? { ...item, str: " " } : item,
      );
      const blankRows = parseBrowserSummaryRows([blankSource]).rows;
      const withoutDebit = parseBrowserSummaryRows([
        items.filter((item) => item !== debit),
      ]).rows;
      expect(blankRows[0]!.rawDebit).toBe(" ");
      expect(blankRows[0]!.rawCredit).toBe("");
      expect(blankRows[0]!.amount).toBeUndefined();
      expect(blankRows[0]!.warnings.join(" ")).toMatch(
        /not a valid.*magnitude/i,
      );
      expect(blankRows[0]!.rawText).toBe(withoutDebit[0]!.rawText);
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
    expect(statement.rows.map(({ rawDescription }) => rawDescription)).toEqual(
      reference.sourceRows.map((_, index) => `SYNTHETIC MOVEMENT ${index + 1}`),
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

describe("CommBank browser Transaction Summary descriptions", () => {
  it("preserves all eleven fixture descriptions without date or financial cells", async () => {
    const statement = await parse(fixture);
    expect(statement.rows).toHaveLength(11);
    expect(statement.rows.map(({ rawDescription }) => rawDescription)).toEqual(
      reference.sourceRows.map(({ rawDescription }) => rawDescription),
    );
    expect(statement.rows[3]!.rawDescription).toBe(
      "Direct Debit SYNTHETIC UTILITIES\n91007382",
    );
    expect(statement.rows[3]!.sourceTransactionId).toBeUndefined();
    for (const [index, row] of statement.rows.entries()) {
      const source = reference.sourceRows[index];
      for (const value of [
        source.rawDate,
        source.rawDebit,
        source.rawCredit,
        source.rawBalance,
      ].filter(Boolean)) {
        expect(row.rawDescription).not.toContain(value);
      }
    }
  });

  it.each(["absent", "empty"])(
    "leaves an %s Transaction cell unresolved with a warning",
    async (variant) => {
      const runs = dateSummary(["02 Feb"]).filter(
        ({ x, y }) => !(x === 110 && y === 460),
      );
      if (variant === "empty") runs.push({ text: "", x: 110, y: 460 });
      const { rows } = await parse(makePdf(runs));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawDescription).toBeUndefined();
      expect(rows[0]!.postingDate).toBe("2036-02-02");
      expect(rows[0]!.warnings.join(" ")).toMatch(/description/i);
      expect(rows[0]!.rawText).toContain("1.00");
    },
  );

  it("leaves conflicting overlapping descriptions unresolved without changing row evidence", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push({ text: "SYNTHETIC ALTERNATIVE", x: 110.5, y: 460.5 });
    const { rows } = await parse(makePdf(runs));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawDescription).toBeUndefined();
    expect(rows[0]!.postingDate).toBe("2036-02-02");
    expect(rows[0]!.rawText).toContain("SYNTHETIC MOVEMENT 1");
    expect(rows[0]!.rawText).toContain("SYNTHETIC ALTERNATIVE");
    expect(rows[0]!.warnings.join(" ")).toMatch(/ambiguous|overlap/i);
  });

  it("collapses a slightly offset identical description layer deterministically", async () => {
    const runs = dateSummary(["02 Feb"]);
    const duplicate = { text: "SYNTHETIC MOVEMENT 1", x: 110.5, y: 460.5 };
    for (const source of [
      [...runs, duplicate],
      [duplicate, ...runs],
    ]) {
      const { rows } = await parse(makePdf(source));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawDescription).toBe("SYNTHETIC MOVEMENT 1");
      expect(rows[0]!.postingDate).toBe("2036-02-02");
    }
  });
});

describe("CommBank browser Transaction Summary Debit/Credit evidence", () => {
  it("preserves all eleven fixture pairs and their debit/credit direction without assuming currency", async () => {
    const statement = await parse(fixture);
    expect(statement.rows).toHaveLength(11);
    expect(
      statement.rows.map(({ rawDebit, rawCredit }) => ({
        rawDebit,
        rawCredit,
      })),
    ).toEqual(
      reference.sourceRows.map(({ rawDebit, rawCredit }) => ({
        rawDebit,
        rawCredit,
      })),
    );
    expect(
      statement.rows.filter(({ rawDebit }) => rawDebit !== ""),
    ).toHaveLength(7);
    expect(
      statement.rows.filter(({ rawCredit }) => rawCredit !== ""),
    ).toHaveLength(4);
    expect(statement.rows[3]!.rawText).toContain(
      "Direct Debit SYNTHETIC UTILITIES\n91007382",
    );
    expect(statement.rows[3]!.rawDebit).toBe("24.19");
    expect(statement.metadata.periodStart).toBe("2036-02-01");
    expect(statement.metadata.periodEnd).toBe("2036-02-28");
    expect(statement.metadata.currency).toBeUndefined();
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.closingBalance?.value).toBeUndefined();
    for (const row of statement.rows) {
      expect(row.rawAmount).toBeUndefined();
      expect(row.amount).toBeUndefined();
      expect(row.balance).toBeUndefined();
      expect(row.sourceTransactionId).toBeUndefined();
    }
  });

  it("associates a wide right-aligned credit by its column without changing repeated row order", async () => {
    const runs = dateSummary(["02 Feb", "02 Feb"]);
    const credit = runs.find(({ x, y }) => x === 330 && y === 440)!;
    credit.text = "12,345,678.90";
    // Helvetica 10: 63.94-point value ends at the Credit heading's 436.67 edge.
    // Its start is left of the Debit/Credit region split, exercising right alignment.
    credit.x = 372.73;
    const { rows } = await parse(makePdf(runs));
    expect(
      rows.map(({ rawDebit, rawCredit }) => [rawDebit, rawCredit]),
    ).toEqual([
      ["1.00", ""],
      ["", "12,345,678.90"],
    ]);
    expect(rows.map(({ position }) => position.row)).toEqual([1, 2]);
    expect(rows.map(({ postingDate }) => postingDate)).toEqual([
      "2036-02-02",
      "2036-02-02",
    ]);
    expect(rows[1]!.rawDescription).toBe("SYNTHETIC MOVEMENT 2");
  });

  it("preserves both populated cells without choosing a movement amount", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push({ text: "2.00", x: 410, y: 460 });
    const { rows } = await parse(makePdf(runs));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawDebit).toBe("1.00");
    expect(rows[0]!.rawCredit).toBe("2.00");
    expect(rows[0]!.amount).toBeUndefined();
    expect(rows[0]!.warnings.join(" ")).toMatch(/both|exactly one/i);
  });

  it.each(["absent", "empty"])(
    "retains %s Debit/Credit cells when the Balance column establishes a source movement row",
    async (variant) => {
      const runs = dateSummary(["02 Feb"]).filter(
        ({ x, y }) => !(x === 330 && y === 460),
      );
      runs.push({ text: "$100.00", x: 490, y: 460 });
      if (variant === "empty")
        runs.push({ text: "", x: 330, y: 460 }, { text: "", x: 410, y: 460 });
      const { rows } = await parse(makePdf(runs));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawDebit).toBe("");
      expect(rows[0]!.rawCredit).toBe("");
      expect(rows[0]!.postingDate).toBe("2036-02-02");
      expect(rows[0]!.rawDescription).toBe("SYNTHETIC MOVEMENT 1");
      expect(rows[0]!.rawText).toContain("$100.00");
      expect(rows[0]!.rawBalance).toBe("$100.00");
      expect(rows[0]!.amount).toBeUndefined();
      expect(rows[0]!.warnings.join(" ")).toMatch(
        /neither|missing|exactly one/i,
      );
    },
  );

  it.each([
    "1,23.45",
    "1.2",
    "1.234",
    "-1.00",
    "+1.00",
    "$1.00",
    "1e2",
    "12 3.45",
  ])(
    "retains malformed Debit notation %s without repairing it",
    async (raw) => {
      const runs = dateSummary(["02 Feb"]);
      runs.find(({ x, y }) => x === 330 && y === 460)!.text = raw;
      const { rows } = await parse(makePdf(runs));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawDebit).toBe(raw);
      expect(rows[0]!.rawCredit).toBe("");
      expect(rows[0]!.amount).toBeUndefined();
      expect(rows[0]!.rawAmount).toBeUndefined();
      expect(rows[0]!.warnings.join(" ")).toMatch(/not a valid.*magnitude/i);
    },
  );

  it("preserves conflicting overlapping amount evidence deterministically", async () => {
    const runs = dateSummary(["02 Feb"]);
    const conflict = { text: "2.00", x: 330.5, y: 460.5 };
    const evidence: (string | undefined)[] = [];
    for (const source of [
      [...runs, conflict],
      [conflict, ...runs],
    ]) {
      const { rows } = await parse(makePdf(source));
      expect(rows).toHaveLength(1);
      evidence.push(rows[0]!.rawDebit);
      expect(rows[0]!.rawDebit).toContain("1.00");
      expect(rows[0]!.rawDebit).toContain("2.00");
      expect(rows[0]!.rawCredit).toBe("");
      expect(rows[0]!.amount).toBeUndefined();
      expect(rows[0]!.rawText).toContain("1.00");
      expect(rows[0]!.rawText).toContain("2.00");
      expect(rows[0]!.warnings.join(" ")).toMatch(/ambiguous|overlap/i);
    }
    expect(evidence[0]).toBe(evidence[1]);
  });

  it("collapses shifted identical amount copies without changing raw row evidence", async () => {
    const runs = dateSummary(["02 Feb"]);
    const duplicate = { text: "1.00", x: 330.5, y: 460.5 };
    for (const source of [
      [...runs, duplicate],
      [duplicate, ...runs],
    ]) {
      const { rows } = await parse(makePdf(source));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawDebit).toBe("1.00");
      expect(rows[0]!.rawCredit).toBe("");
      expect(rows[0]!.rawText.match(/1\.00/g)).toHaveLength(2);
      expect(rows[0]!.postingDate).toBe("2036-02-02");
    }
  });

  it("converts valid decimal magnitudes directly to exact safe integer hundredths", () => {
    for (const [raw, expected] of [
      ["0.00", 0],
      ["0.01", 1],
      ["38.47", 3847],
      ["1,283.76", 128376],
      ["12,345,678.90", 1234567890],
      ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ] as const) {
      expect(parseDecimalMagnitudeMinor(raw)).toBe(expected);
    }
  });

  it("rejects malformed notation and unsafe integer magnitudes without decimal rounding", () => {
    for (const raw of [
      "",
      "1",
      "1.2",
      "1.234",
      ".01",
      "1,23.45",
      "1234,567.89",
      "1,2345.67",
      "1,,234.56",
      "-1.00",
      "+1.00",
      "$1.00",
      "1e2",
      " 1.00",
      "1.00 ",
      "1.00\n",
      "1.00\r",
      "1 234.56",
      "90071992547409.92",
    ]) {
      expect(parseDecimalMagnitudeMinor(raw)).toBeUndefined();
    }
  });
});

describe("CommBank browser Transaction Summary balance evidence", () => {
  it("preserves eleven running balances and explicit opening/header closing evidence without Money", async () => {
    const statement = await parse(fixture);
    const opening = reference.openingBalanceEvidence;
    expect(statement.rows).toHaveLength(11);
    expect(statement.rows.map(({ rawBalance }) => rawBalance)).toEqual(
      reference.sourceRows.map(({ rawBalance }) => rawBalance),
    );
    expect(statement.openingBalance).toEqual({
      rawValue: opening.rawBalance,
      rawDate: opening.rawDate,
      rawText: `${opening.rawDate} ${opening.rawDescription} ${opening.rawBalance}`,
      position: { page: opening.page, row: opening.tableRow },
      date: "2036-02-01",
    });
    expect(statement.closingBalance).toEqual({
      rawValue: reference.headerEvidence.rawClosingBalance,
      rawText: `Closing Balance ${reference.headerEvidence.rawClosingBalance}`,
    });
    expect(
      statement.rows.every(
        ({ rawText }) => !rawText.includes("OPENING BALANCE"),
      ),
    ).toBe(true);
    for (const row of statement.rows) {
      expect(row.balance).toBeUndefined();
      expect(row.amount).toBeUndefined();
      expect(row.rawAmount).toBeUndefined();
      expect(row.transactionDate).toBeUndefined();
      expect(row.sourceTransactionId).toBeUndefined();
    }
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.closingBalance?.value).toBeUndefined();
    expect(statement.metadata.periodStart).toBe("2036-02-01");
    expect(statement.metadata.periodEnd).toBe("2036-02-28");
    expect(statement.metadata.currency).toBeUndefined();
  });

  it.each(["absent", "empty"])(
    "leaves an %s running Balance cell unresolved with a row warning",
    async (variant) => {
      const runs = dateSummary(["02 Feb"]);
      if (variant === "empty") runs.push({ text: "", x: 490, y: 460 });
      const { rows } = await parse(makePdf(runs));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawBalance).toBeUndefined();
      expect(rows[0]!.balance).toBeUndefined();
      expect(rows[0]!.postingDate).toBe("2036-02-02");
      expect(rows[0]!.rawDebit).toBe("1.00");
      expect(rows[0]!.warnings.join(" ")).toMatch(
        /balance.*missing|no.*balance/i,
      );
    },
  );

  it.each([
    "$1,23.45",
    "$1.2",
    "$1.234",
    "-$1.00",
    "$-1.00",
    "($1.00)",
    "100.00",
    "$90071992547409.92",
  ])(
    "preserves malformed or unsupported Balance notation %s without repair",
    async (raw) => {
      const runs = dateSummary(["02 Feb"]);
      runs.push({ text: raw, x: 490, y: 460 });
      const { rows } = await parse(makePdf(runs));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawBalance).toBe(raw);
      expect(rows[0]!.balance).toBeUndefined();
      expect(rows[0]!.rawText).toContain(raw);
      expect(rows[0]!.warnings.join(" ")).toMatch(
        /balance.*not.*valid|invalid.*balance/i,
      );
    },
  );

  it("preserves conflicting overlapping running balances deterministically without choosing a value", async () => {
    const runs = [
      ...dateSummary(["02 Feb"]),
      { text: "$100.00", x: 490, y: 460 },
    ];
    const conflict = { text: "$200.00", x: 490.5, y: 460.5 };
    const evidence: (string | undefined)[] = [];
    for (const source of [
      [...runs, conflict],
      [conflict, ...runs],
    ]) {
      const { rows } = await parse(makePdf(source));
      expect(rows).toHaveLength(1);
      evidence.push(rows[0]!.rawBalance);
      expect(rows[0]!.rawBalance).toContain("$100.00");
      expect(rows[0]!.rawBalance).toContain("$200.00");
      expect(rows[0]!.balance).toBeUndefined();
      expect(rows[0]!.rawText).toContain("$100.00");
      expect(rows[0]!.rawText).toContain("$200.00");
      expect(rows[0]!.warnings.join(" ")).toMatch(
        /balance.*ambiguous|ambiguous.*balance/i,
      );
    }
    expect(evidence[0]).toBe(evidence[1]);
  });

  it("collapses shifted identical Balance copies while preserving existing raw row text", async () => {
    const runs = [
      ...dateSummary(["02 Feb"]),
      { text: "$100.00", x: 490, y: 460 },
    ];
    const duplicate = { text: "$100.00", x: 490.5, y: 460.5 };
    for (const source of [
      [...runs, duplicate],
      [duplicate, ...runs],
    ]) {
      const { rows } = await parse(makePdf(source));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rawBalance).toBe("$100.00");
      expect(rows[0]!.rawText.match(/\$100\.00/g)).toHaveLength(2);
      expect(rows[0]!.warnings.join(" ")).toMatch(
        /overlapping.*balance|balance.*collapsed/i,
      );
      expect(rows[0]!.balance).toBeUndefined();
    }
  });

  it("preserves multiple explicit opening entries without selecting a date, position, or value", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push(
      { text: "02 Jan", x: 40, y: 470 },
      { text: "2036 OPENING BALANCE", x: 110, y: 470 },
      { text: "$200.00", x: 490, y: 470 },
    );
    const statement = await parse(makePdf(runs));
    expect(statement.rows).toHaveLength(1);
    expect(statement.rows[0]!.postingDate).toBe("2036-02-02");
    expect(statement.openingBalance?.rawValue).toBe("$100.00\n$200.00");
    expect(statement.openingBalance?.rawDate).toBe("01 Jan\n02 Jan");
    expect(statement.openingBalance?.rawText).toContain(
      "01 Jan 2036 OPENING BALANCE $100.00",
    );
    expect(statement.openingBalance?.rawText).toContain(
      "02 Jan 2036 OPENING BALANCE $200.00",
    );
    expect(statement.openingBalance?.date).toBeUndefined();
    expect(statement.openingBalance?.position).toBeUndefined();
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.warnings.join(" ")).toMatch(
      /opening.*ambiguous|ambiguous.*opening/i,
    );
  });

  it("retains conflicting opening Balance runs while interpreting only its independently established date", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push({ text: "$200.00", x: 490.5, y: 480.5 });
    const statement = await parse(makePdf(runs));
    expect(statement.rows).toHaveLength(1);
    expect(statement.openingBalance?.rawValue).toContain("$100.00");
    expect(statement.openingBalance?.rawValue).toContain("$200.00");
    expect(statement.openingBalance?.date).toBe("2036-01-01");
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.warnings.join(" ")).toMatch(
      /opening.*ambiguous|ambiguous.*opening/i,
    );
  });

  it("preserves conflicting opening marker years without changing transaction date interpretation", async () => {
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
      const opening = items.find((item) => item.str === "2036 OPENING BALANCE");
      expect(opening).toBeDefined();
      const transform = [...opening!.transform];
      transform[4] += 0.5;
      transform[5] += 0.5;
      const statement = parseBrowserSummaryRows([
        [...items, { ...opening!, str: "2035 OPENING BALANCE", transform }],
      ]);
      expect(statement.openingBalance?.rawText).toContain(
        "2036 OPENING BALANCE",
      );
      expect(statement.openingBalance?.rawText).toContain(
        "2035 OPENING BALANCE",
      );
      expect(statement.openingBalance?.rawValue).toBe(
        reference.openingBalanceEvidence.rawBalance,
      );
      expect(statement.openingBalance?.date).toBeUndefined();
      expect(statement.warnings.join(" ")).toMatch(
        /opening.*ambiguous|ambiguous.*opening/i,
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
    } finally {
      await task.destroy();
    }
  });

  it("does not interpret an opening date when the existing statement context is unresolved", async () => {
    const statement = await parse(
      makePdf(
        dateSummary(["02 Feb"], "01 Jan - 31 Dec 2036", "2035 OPENING BALANCE"),
      ),
    );
    expect(statement.openingBalance?.rawDate).toBe("01 Jan");
    expect(statement.openingBalance?.rawValue).toBe("$100.00");
    expect(statement.openingBalance?.date).toBeUndefined();
    expect(statement.warnings.join(" ")).toMatch(
      /opening.*date|date.*opening/i,
    );
  });

  it("preserves conflicting header Closing Balance values without choosing or deriving one", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push(
      { text: "$150.00", x: 490, y: 600 },
      { text: "$200.00", x: 490.5, y: 600.5 },
      { text: "$400.00", x: 490, y: 460 },
    );
    const statement = await parse(makePdf(runs));
    expect(statement.closingBalance?.rawValue).toContain("$150.00");
    expect(statement.closingBalance?.rawValue).toContain("$200.00");
    expect(statement.closingBalance?.rawValue).not.toContain("$400.00");
    expect(statement.closingBalance?.rawText).toContain("Closing Balance");
    expect(statement.closingBalance?.date).toBeUndefined();
    expect(statement.closingBalance?.rawDate).toBeUndefined();
    expect(statement.closingBalance?.position).toBeUndefined();
    expect(statement.closingBalance?.value).toBeUndefined();
    expect(statement.warnings.join(" ")).toMatch(
      /closing.*ambiguous|ambiguous.*closing/i,
    );
  });

  it("preserves multiple header Closing Balance entries as ambiguous evidence", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push(
      { text: "$150.00", x: 490, y: 600 },
      { text: "Closing Balance", x: 300, y: 590 },
      { text: "$200.00", x: 490, y: 590 },
    );
    const statement = await parse(makePdf(runs));
    expect(statement.closingBalance?.rawValue).toBe("$150.00\n$200.00");
    expect(statement.closingBalance?.rawText).toBe(
      "Closing Balance $150.00\nClosing Balance $200.00",
    );
    expect(statement.closingBalance?.value).toBeUndefined();
    expect(statement.warnings.join(" ")).toMatch(
      /closing.*ambiguous|ambiguous.*closing/i,
    );
  });

  it("does not substitute the final running balance for a missing header closing value", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push({ text: "$400.00", x: 490, y: 460 });
    const statement = await parse(makePdf(runs));
    expect(statement.rows[0]!.rawBalance).toBe("$400.00");
    expect(statement.closingBalance).toEqual({
      rawValue: "",
      rawText: "Closing Balance",
    });
    expect(statement.warnings.join(" ")).toMatch(
      /closing.*missing|no.*closing|no.*balance/i,
    );
  });
});

describe("CommBank browser Transaction Summary metadata evidence", () => {
  it("preserves demonstrated fixture header metadata without inferring currency or other fields", async () => {
    const statement = await parse(fixture);
    const source = reference.headerEvidence;
    expect(statement.metadata).toEqual({
      rawText: expect.any(String),
      institution: source.rawBankName,
      accountIdentifier: source.rawAccountIdentifier,
      periodStart: "2036-02-01",
      periodEnd: "2036-02-28",
    });
    for (const value of [
      source.rawBankName,
      source.rawTitle,
      "Account Number",
      source.rawAccountIdentifier,
      source.rawStatementLabel,
      "Period",
      source.rawPeriod,
      "Closing Balance",
      source.rawClosingBalance,
    ]) {
      expect(statement.metadata.rawText).toContain(value);
    }
    expect(statement.metadata.rawText).not.toContain("OPENING BALANCE");
    expect(statement.metadata.rawText).not.toContain(
      reference.sourceRows[0].rawDescription,
    );
    expect(statement.rows).toHaveLength(11);
    for (const row of statement.rows) {
      expect(row.amount).toBeUndefined();
      expect(row.balance).toBeUndefined();
    }
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.closingBalance?.value).toBeUndefined();
  });

  it.each(["absent", "blank"])(
    "leaves an %s Account Number value unresolved with its label retained",
    async (variant) => {
      const runs = dateSummary(["02 Feb"]);
      if (variant === "blank") runs.push({ text: " ", x: 410, y: 640 });
      const statement = await parse(makePdf(runs));
      expect(statement.metadata.accountIdentifier).toBeUndefined();
      expect(statement.metadata.rawText).toContain("Account Number");
      expect(statement.warnings.join(" ")).toMatch(
        /account.*missing|no.*account/i,
      );
      expect(statement.rows[0]!.postingDate).toBe("2036-02-02");
    },
  );

  it("preserves adjacent disjoint Account Number runs as one source identifier", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push(
      { text: "000", x: 410, y: 640 },
      { text: "000", x: 440, y: 640 },
      { text: "00000000", x: 470, y: 640 },
    );
    const statement = await parse(makePdf(runs));
    expect(statement.metadata.accountIdentifier).toBe(
      reference.headerEvidence.rawAccountIdentifier,
    );
    expect(statement.metadata.rawText).toContain(
      reference.headerEvidence.rawAccountIdentifier,
    );
  });

  it("retains conflicting Account Number overlays without selecting an identifier", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push(
      { text: "000 000 00000000", x: 410, y: 640 },
      { text: "111 111 11111111", x: 410.5, y: 640.5 },
    );
    const statement = await parse(makePdf(runs));
    expect(statement.metadata.accountIdentifier).toBeUndefined();
    expect(statement.metadata.rawText).toContain("000 000 00000000");
    expect(statement.metadata.rawText).toContain("111 111 11111111");
    expect(statement.warnings.join(" ")).toMatch(
      /account.*ambiguous|ambiguous.*account|account.*conflict/i,
    );
  });

  it("leaves distinct repeated Account Number fields unresolved", async () => {
    const runs = dateSummary(["02 Feb"]);
    runs.push(
      { text: "000 000 00000000", x: 410, y: 640 },
      { text: "Account Number", x: 300, y: 630 },
      { text: "111 111 11111111", x: 410, y: 630 },
    );
    const statement = await parse(makePdf(runs));
    expect(statement.metadata.accountIdentifier).toBeUndefined();
    expect(statement.metadata.rawText).toContain("000 000 00000000");
    expect(statement.metadata.rawText).toContain("111 111 11111111");
    expect(statement.warnings.join(" ")).toMatch(
      /account.*ambiguous|ambiguous.*account|account.*conflict/i,
    );
  });

  it.each([
    "",
    "01 Jan - 31 Dec",
    "31 Feb - 31 Dec 2036",
    "01 Dec - 31 Jan 2036",
    "01 Jan - 31 Dec 0000",
  ])(
    "leaves missing or malformed/cross-year Period evidence unresolved: %s",
    async (period) => {
      const statement = await parse(makePdf(dateSummary(["02 Feb"], period)));
      expect(statement.metadata.periodStart).toBeUndefined();
      expect(statement.metadata.periodEnd).toBeUndefined();
      expect(statement.metadata.rawText).toContain("Period");
      if (period) expect(statement.metadata.rawText).toContain(period);
      expect(statement.warnings.join(" ")).toMatch(/period|date range/i);
    },
  );

  it("keeps conflicting Period values as raw evidence without selecting boundaries", async () => {
    const runs = dateSummary(["02 Feb"], "01 Jan - 31 Dec 2036");
    runs.push({ text: "01 Feb - 28 Feb 2036", x: 365.5, y: 620.5 });
    const statement = await parse(makePdf(runs));
    expect(statement.metadata.periodStart).toBeUndefined();
    expect(statement.metadata.periodEnd).toBeUndefined();
    expect(statement.metadata.rawText).toContain("01 Jan - 31 Dec 2036");
    expect(statement.metadata.rawText).toContain("01 Feb - 28 Feb 2036");
    expect(statement.warnings.join(" ")).toMatch(
      /period.*ambiguous|ambiguous.*period|period.*conflict/i,
    );
  });

  it("requires the existing opening-year agreement before exposing period boundaries", async () => {
    const statement = await parse(
      makePdf(
        dateSummary(["02 Feb"], "01 Jan - 31 Dec 2036", "2035 OPENING BALANCE"),
      ),
    );
    expect(statement.metadata.periodStart).toBeUndefined();
    expect(statement.metadata.periodEnd).toBeUndefined();
    expect(statement.metadata.rawText).toContain("01 Jan - 31 Dec 2036");
    expect(statement.warnings.join(" ")).toMatch(/period|year|date range/i);
  });

  it("uses the evidenced Period boundaries rather than the transaction date range", async () => {
    const statement = await parse(
      makePdf(dateSummary(["03 Feb", "04 Feb"], "01 Feb - 28 Feb 2036")),
    );
    expect(statement.metadata.periodStart).toBe("2036-02-01");
    expect(statement.metadata.periodEnd).toBe("2036-02-28");
    expect(statement.rows.map(({ postingDate }) => postingDate)).toEqual([
      "2036-02-03",
      "2036-02-04",
    ]);
  });

  it("collapses shifted identical metadata overlays without changing existing row/opening date behavior", async () => {
    const runs = dateSummary(["02 Feb"], "01 Feb - 28 Feb 2036");
    runs.push({ text: "000 000 00000000", x: 410, y: 640 });
    const duplicates = [
      { text: "Commonwealth Bank of Australia", x: 40.5, y: 720.5 },
      { text: "000 000 00000000", x: 410.5, y: 640.5 },
      { text: "01 Feb - 28 Feb 2036", x: 365.5, y: 620.5 },
    ];
    for (const source of [
      [...runs, ...duplicates],
      [...duplicates, ...runs],
    ]) {
      const statement = await parse(makePdf(source));
      expect(statement.metadata.institution).toBe(
        reference.headerEvidence.rawBankName,
      );
      expect(statement.metadata.accountIdentifier).toBe(
        reference.headerEvidence.rawAccountIdentifier,
      );
      expect(statement.metadata.periodStart).toBe("2036-02-01");
      expect(statement.metadata.periodEnd).toBe("2036-02-28");
      expect(statement.warnings.join(" ")).toMatch(
        /identical|collapsed|overlapping/i,
      );
      // Existing row/opening context sees both Period runs. Metadata deduplication
      // must remain isolated rather than changing those earlier parsing results.
      expect(statement.rows[0]!.postingDate).toBeUndefined();
      expect(statement.openingBalance?.date).toBeUndefined();
      expect(statement.rows[0]!.rawPostingDate).toBe("02 Feb");
      expect(statement.rows[0]!.rawDescription).toBe("SYNTHETIC MOVEMENT 1");
      expect(statement.rows[0]!.rawDebit).toBe("1.00");
      expect(statement.rows[0]!.rawCredit).toBe("");
      expect(statement.rows[0]!.rawText).toBe(
        "02 Feb SYNTHETIC MOVEMENT 1 1.00",
      );
      expect(statement.openingBalance?.rawValue).toBe("$100.00");
      expect(statement.closingBalance?.rawValue).toBe("");
    }
  });

  it("preserves Account Number whitespace and rejects control-character evidence without repair", async () => {
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
      const account = items.find(
        (item) => item.str === reference.headerEvidence.rawAccountIdentifier,
      );
      expect(account).toBeDefined();
      const raw = " 000  000 00000000 ";
      const statement = parseBrowserSummaryRows([
        items.map((item) => (item === account ? { ...item, str: raw } : item)),
      ]);
      expect(statement.metadata.accountIdentifier).toBe(raw);
      expect(statement.metadata.rawText).toContain(raw);
      const malformed = "000\u0000 000 00000000";
      const invalid = parseBrowserSummaryRows([
        items.map((item) =>
          item === account ? { ...item, str: malformed } : item,
        ),
      ]);
      expect(invalid.metadata.accountIdentifier).toBeUndefined();
      expect(invalid.metadata.rawText).toContain(malformed);
      expect(invalid.warnings.join(" ")).toMatch(
        /account.*invalid|invalid.*account|account.*malformed|account.*control/i,
      );
    } finally {
      await task.destroy();
    }
  });
});

function reconciledSummary(): TextRun[] {
  return [
    ...dateSummary(["02 Feb", "03 Feb", "04 Feb"]),
    { text: "$97.00", x: 490, y: 600 },
    { text: "$99.00", x: 490, y: 460 },
    { text: "$98.00", x: 490, y: 440 },
    { text: "$97.00", x: 490, y: 420 },
  ];
}

async function fixtureTextItems(): Promise<TextItem[]> {
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
    return content.items.filter((item): item is TextItem => "str" in item);
  } finally {
    await task.destroy();
  }
}

describe("CommBank browser Transaction Summary source running-balance reconciliation", () => {
  it("verifies all eleven fixture equations and explicit closing agreement without constructing Money", async () => {
    const statement = await parse(fixture);
    expect(statement.reconciliation).toEqual({
      rows: statement.rows.map(({ position }) => ({
        position,
        status: "verified",
      })),
      closingBalance: "verified",
    });
    expect(statement.rows).toHaveLength(11);
    for (const [index, row] of statement.rows.entries()) {
      const source = reference.sourceRows[index];
      expect(row.rawPostingDate).toBe(source.rawDate);
      expect(row.rawDescription).toBe(source.rawDescription);
      expect(row.rawDebit).toBe(source.rawDebit);
      expect(row.rawCredit).toBe(source.rawCredit);
      expect(row.rawBalance).toBe(source.rawBalance);
      expect(row.warnings).toEqual([]);
      expect(row.amount).toBeUndefined();
      expect(row.balance).toBeUndefined();
    }
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.closingBalance?.value).toBeUndefined();
    expect(statement.metadata.currency).toBeUndefined();
  });

  it("subtracts source Debit and adds source Credit with exact decimal hundredths", async () => {
    const runs = reconciledSummary();
    runs.find(({ x, y }) => x === 330 && y === 460)!.text = "10.00";
    const credit = runs.find(({ x, y }) => x === 330 && y === 440)!;
    credit.x = 410;
    credit.text = "5.25";
    for (const [y, value] of [
      [460, "$90.00"],
      [440, "$95.25"],
      [420, "$94.25"],
      [600, "$94.25"],
    ] as const)
      runs.find(({ x, y: sourceY }) => x === 490 && sourceY === y)!.text =
        value;
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "verified",
      "verified",
      "verified",
    ]);
    expect(statement.reconciliation?.closingBalance).toBe("verified");
    expect(
      statement.rows.map(({ rawDebit, rawCredit }) => [rawDebit, rawCredit]),
    ).toEqual([
      ["10.00", ""],
      ["", "5.25"],
      ["1.00", ""],
    ]);
  });

  it("treats valid zero magnitudes as established numeric evidence for Credit and Debit relations", async () => {
    const runs = reconciledSummary();
    for (const run of runs) {
      if (run.x === 490 && run.text.startsWith("$")) run.text = "$0.00";
      if (run.x === 330 && run.y < 500) run.text = "0.00";
    }
    runs.find(({ x, y }) => x === 330 && y === 460)!.x = 410;
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "verified",
      "verified",
      "verified",
    ]);
    expect(statement.reconciliation?.closingBalance).toBe("verified");
    expect(
      statement.rows.map(({ rawDebit, rawCredit, rawBalance }) => [
        rawDebit,
        rawCredit,
        rawBalance,
      ]),
    ).toEqual([
      ["", "0.00", "$0.00"],
      ["0.00", "", "$0.00"],
      ["0.00", "", "$0.00"],
    ]);
    for (const row of statement.rows) {
      expect(row.amount).toBeUndefined();
      expect(row.balance).toBeUndefined();
    }
    expect(statement.openingBalance?.rawValue).toBe("$0.00");
    expect(statement.closingBalance?.rawValue).toBe("$0.00");
    expect(statement.openingBalance?.value).toBeUndefined();
    expect(statement.closingBalance?.value).toBeUndefined();
    expect(statement.metadata.currency).toBeUndefined();
  });

  it("reports a one-cent movement mismatch without repairing source values or cascading into later rows", async () => {
    const runs = reconciledSummary();
    runs.find(({ x, y }) => x === 330 && y === 460)!.text = "1.01";
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "mismatch",
      "verified",
      "verified",
    ]);
    expect(statement.reconciliation?.closingBalance).toBe("verified");
    expect(statement.rows[0]!.rawDebit).toBe("1.01");
    expect(statement.rows[0]!.rawBalance).toBe("$99.00");
    expect(statement.rows[0]!.rawText).toContain("1.01 $99.00");
    expect(statement.rows[0]!.warnings).toEqual([]);
    expect(statement.warnings.join(" ")).toMatch(
      /running balance reconciliation mismatch at page 1, row 1/i,
    );
    expect(statement.rows[1]!.warnings).toEqual([]);
  });

  it("uses each previous source balance after a changed balance, then recovers when source equations agree", async () => {
    const runs = reconciledSummary();
    runs.find(({ x, y }) => x === 490 && y === 460)!.text = "$99.01";
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "mismatch",
      "mismatch",
      "verified",
    ]);
    expect(statement.rows[0]!.rawBalance).toBe("$99.01");
    expect(statement.rows[1]!.rawBalance).toBe("$98.00");
    expect(statement.reconciliation?.closingBalance).toBe("verified");
  });

  it.each(["missing", "malformed", "both populated", "conflicting overlap"])(
    "leaves %s movement evidence unresolved without losing the next source baseline",
    async (variant) => {
      let runs = reconciledSummary();
      if (variant === "missing")
        runs = runs.filter(({ x, y }) => !(x === 330 && y === 460));
      else if (variant === "malformed")
        runs.find(({ x, y }) => x === 330 && y === 460)!.text = "1.2";
      else
        runs.push({
          text: "2.00",
          x: variant === "both populated" ? 410 : 330.5,
          y: variant === "both populated" ? 460 : 460.5,
        });
      const statement = await parse(makePdf(runs));
      expect(
        statement.reconciliation?.rows.map(({ status }) => status),
      ).toEqual(["unresolved", "verified", "verified"]);
      expect(statement.reconciliation?.closingBalance).toBe("verified");
      expect(statement.rows[0]!.rawBalance).toBe("$99.00");
      expect(statement.rows[0]!.warnings.length).toBeGreaterThan(0);
      expect(statement.rows[1]!.warnings).toEqual([]);
    },
  );

  it.each(["missing", "malformed", "conflicting overlap"])(
    "leaves %s source balance evidence and its next equation unresolved, then recovers",
    async (variant) => {
      let runs = reconciledSummary();
      if (variant === "missing")
        runs = runs.filter(({ x, y }) => !(x === 490 && y === 460));
      else if (variant === "malformed")
        runs.find(({ x, y }) => x === 490 && y === 460)!.text = "$99.0";
      else runs.push({ text: "$99.01", x: 490.5, y: 460.5 });
      const statement = await parse(makePdf(runs));
      expect(
        statement.reconciliation?.rows.map(({ status }) => status),
      ).toEqual(["unresolved", "unresolved", "verified"]);
      expect(statement.reconciliation?.closingBalance).toBe("verified");
      expect(statement.rows[0]!.warnings.length).toBeGreaterThan(0);
      expect(statement.rows[1]!.warnings).toEqual([]);
      expect(statement.warnings.join(" ")).toMatch(
        /running balance reconciliation unresolved at page 1, row 2/i,
      );
      expect(statement.rows[2]!.warnings).toEqual([]);
    },
  );

  it.each(["missing", "multiple entries", "conflicting overlap"])(
    "does not select %s opening evidence as the first baseline",
    async (variant) => {
      let runs = reconciledSummary();
      if (variant === "missing") runs = runs.filter(({ y }) => y !== 480);
      else if (variant === "multiple entries")
        runs.push(
          { text: "02 Jan", x: 40, y: 470 },
          { text: "2036 OPENING BALANCE", x: 110, y: 470 },
          { text: "$100.00", x: 490, y: 470 },
        );
      else runs.push({ text: "$101.00", x: 490.5, y: 480.5 });
      const statement = await parse(makePdf(runs));
      expect(
        statement.reconciliation?.rows.map(({ status }) => status),
      ).toEqual(["unresolved", "verified", "verified"]);
      expect(statement.reconciliation?.closingBalance).toBe("verified");
      expect(statement.warnings.join(" ")).toMatch(
        /running balance reconciliation unresolved at page 1, row 1/i,
      );
      if (variant !== "missing")
        expect(statement.rows[0]!.warnings).toEqual([]);
    },
  );

  it("leaves conflicting opening labels unresolved while the next source balance can verify", async () => {
    const runs = reconciledSummary();
    runs.push({ text: "2035 OPENING BALANCE", x: 110.5, y: 480.5 });
    const statement = await parse(makePdf(runs));
    expect(statement.openingBalance?.rawValue).toBe("$100.00");
    expect(statement.openingBalance?.rawText).toContain("2036 OPENING BALANCE");
    expect(statement.openingBalance?.rawText).toContain("2035 OPENING BALANCE");
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "unresolved",
      "verified",
      "verified",
    ]);
    expect(statement.rows[0]!.rawBalance).toBe("$99.00");
    expect(statement.rows[1]!.rawBalance).toBe("$98.00");
    expect(statement.reconciliation?.closingBalance).toBe("verified");
    expect(statement.warnings.join(" ")).toMatch(
      /running balance reconciliation unresolved at page 1, row 1/i,
    );
  });

  it("does not use an opening entry appearing after the first movement as a retrospective baseline", async () => {
    const runs = reconciledSummary().map((run) =>
      run.y === 480 ? { ...run, y: 450 } : run,
    );
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "unresolved",
      "verified",
      "verified",
    ]);
    expect(statement.openingBalance?.rawValue).toBe("$100.00");
    expect(statement.reconciliation?.closingBalance).toBe("verified");
  });

  it.each(["missing", "multiple entries", "conflicting overlap"])(
    "leaves %s closing evidence unresolved while row equations remain verified",
    async (variant) => {
      let runs = reconciledSummary();
      if (variant === "missing")
        runs = runs.filter(({ x, y }) => !(x === 490 && y === 600));
      else if (variant === "multiple entries")
        runs.push(
          { text: "Closing Balance", x: 300, y: 590 },
          { text: "$97.00", x: 490, y: 590 },
        );
      else runs.push({ text: "$97.01", x: 490.5, y: 600.5 });
      const statement = await parse(makePdf(runs));
      expect(
        statement.reconciliation?.rows.map(({ status }) => status),
      ).toEqual(["verified", "verified", "verified"]);
      expect(statement.reconciliation?.closingBalance).toBe("unresolved");
      expect(statement.warnings.join(" ")).toMatch(/closing/i);
    },
  );

  it("reports a one-cent header closing mismatch without changing verified row equations", async () => {
    const runs = reconciledSummary();
    runs.find(({ x, y }) => x === 490 && y === 600)!.text = "$97.01";
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "verified",
      "verified",
      "verified",
    ]);
    expect(statement.reconciliation?.closingBalance).toBe("mismatch");
    expect(statement.closingBalance?.rawValue).toBe("$97.01");
    expect(statement.rows[2]!.rawBalance).toBe("$97.00");
    expect(statement.warnings.join(" ")).toMatch(
      /closing balance reconciliation mismatch/i,
    );
    expect(statement.rows.every(({ warnings }) => warnings.length === 0)).toBe(
      true,
    );
  });

  it("continues verifying numerically identical shifted overlays after deterministic source collapse", async () => {
    const runs = reconciledSummary();
    runs.push(
      { text: "$100.00", x: 490.5, y: 480.5 },
      { text: "1.00", x: 330.5, y: 460.5 },
      { text: "$99.00", x: 490.5, y: 460.5 },
      { text: "$97.00", x: 490.5, y: 600.5 },
    );
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "verified",
      "verified",
      "verified",
    ]);
    expect(statement.reconciliation?.closingBalance).toBe("verified");
    expect(statement.rows[0]!.rawBalance).toBe("$99.00");
    expect(statement.rows[0]!.rawDebit).toBe("1.00");
    expect(statement.rows[0]!.rawText.match(/\$99\.00/g)).toHaveLength(2);
  });

  it("does not block independent numeric agreement on unresolved date, description, or account metadata", async () => {
    const runs = reconciledSummary().filter(
      ({ x, y }) => !((x === 40 || x === 110) && y === 460),
    );
    const statement = await parse(makePdf(runs));
    expect(statement.rows[0]!.postingDate).toBeUndefined();
    expect(statement.rows[0]!.rawDescription).toBeUndefined();
    expect(statement.metadata.accountIdentifier).toBeUndefined();
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "verified",
      "verified",
      "verified",
    ]);
    expect(statement.reconciliation?.closingBalance).toBe("verified");
  });

  it.each(["Debit", "running balance", "opening balance", "closing balance"])(
    "does not use unsafe %s magnitudes in an equation",
    async (variant) => {
      const runs = reconciledSummary();
      const y =
        variant === "opening balance"
          ? 480
          : variant === "closing balance"
            ? 600
            : 460;
      const x = variant === "Debit" ? 330 : 490;
      runs.find((run) => run.x === x && run.y === y)!.text =
        `${variant === "Debit" ? "" : "$"}90071992547409.92`;
      const statement = await parse(makePdf(runs));
      expect(
        statement.reconciliation?.rows.map(({ status }) => status),
      ).toEqual(
        variant === "running balance"
          ? ["unresolved", "unresolved", "verified"]
          : variant === "closing balance"
            ? ["verified", "verified", "verified"]
            : ["unresolved", "verified", "verified"],
      );
      expect(statement.reconciliation?.closingBalance).toBe(
        variant === "closing balance" ? "unresolved" : "verified",
      );
    },
  );

  it("leaves a credit sum exceeding the safe integer range unresolved instead of comparing rounded values", async () => {
    const runs = reconciledSummary();
    runs.find(({ x, y }) => x === 490 && y === 480)!.text =
      "$90071992547409.91";
    const credit = runs.find(({ x, y }) => x === 330 && y === 460)!;
    credit.text = "0.01";
    credit.x = 410;
    for (const [y, text] of [
      [460, "$90071992547409.91"],
      [440, "$90071992547408.91"],
      [420, "$90071992547407.91"],
      [600, "$90071992547407.91"],
    ] as const)
      runs.find(({ x, y: sourceY }) => x === 490 && sourceY === y)!.text = text;
    const statement = await parse(makePdf(runs));
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual([
      "unresolved",
      "verified",
      "verified",
    ]);
    expect(statement.reconciliation?.closingBalance).toBe("verified");
    expect(statement.rows[0]!.warnings).toEqual([]);
    expect(statement.warnings.join(" ")).toMatch(/safe|overflow|range/i);
    expect(statement.rows[0]!.rawCredit).toBe("0.01");
    expect(statement.rows[0]!.rawBalance).toBe("$90071992547409.91");
  });

  it("leaves closing agreement unresolved when no transaction row supplies a final running balance", async () => {
    const runs = dateSummary([]);
    runs.push({ text: "$100.00", x: 490, y: 600 });
    const statement = await parse(makePdf(runs));
    expect(statement.rows).toEqual([]);
    expect(statement.reconciliation).toEqual({
      rows: [],
      closingBalance: "unresolved",
    });
  });

  it("leaves closing agreement unresolved when a trailing unsupported page may contain later movements", async () => {
    const statement = parseBrowserSummaryRows([await fixtureTextItems(), []]);
    expect(statement.reconciliation?.rows.map(({ status }) => status)).toEqual(
      Array(11).fill("verified"),
    );
    expect(statement.reconciliation?.closingBalance).toBe("unresolved");
    expect(statement.warnings.join(" ")).toMatch(/page 2|partial|coverage/i);
  });

  it("does not bridge an unsupported middle page, then resumes from new source balances", async () => {
    const items = await fixtureTextItems();
    const opening = items.find((item) => item.str === "2036 OPENING BALANCE");
    expect(opening).toBeDefined();
    const laterPage = items.filter(
      (item) => Math.abs(item.transform[5] - opening!.transform[5]) > 2,
    );
    const statement = parseBrowserSummaryRows([items, [], laterPage]);
    expect(statement.rows).toHaveLength(22);
    expect(
      statement.reconciliation?.rows.slice(0, 11).map(({ status }) => status),
    ).toEqual(Array(11).fill("verified"));
    expect(
      statement.reconciliation?.rows.slice(11).map(({ status }) => status),
    ).toEqual(["unresolved", ...Array(10).fill("verified")]);
    expect(statement.reconciliation?.rows[11]!.position).toEqual({
      page: 3,
      row: 12,
    });
    expect(statement.reconciliation?.closingBalance).toBe("verified");
  });
});
