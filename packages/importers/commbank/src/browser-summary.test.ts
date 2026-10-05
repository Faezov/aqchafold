/// <reference types="node" />

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { commbankBrowserSummaryImporter } from "./browser-summary";

const fixture = new Uint8Array(
  readFileSync(
    new URL(
      "../../../../fixtures/bank-statements/commbank/browser-summary-01.pdf",
      import.meta.url,
    ),
  ),
);

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

  it("rejects parsing explicitly while it remains unavailable", async () => {
    await expect(
      commbankBrowserSummaryImporter.parse({ bytes: fixture }),
    ).rejects.toThrow(/not implemented|unavailable/i);
  });
});
