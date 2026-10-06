import type { StatementImporter } from "@aqchafold/importers-core";
import {
  getDocument,
  type PDFDocumentLoadingTask,
  type TextItem,
} from "pdfjs-serverless";
import { parseBrowserSummaryDates } from "./browser-summary-dates";

function matchesSummaryHeader(items: readonly TextItem[]): boolean {
  // The public reference has duplicated text layers and overlapping OCR runs.
  // Match fixed labels individually so those layers cannot corrupt a joined line.
  const labels = items
    .map((item) => ({
      x: item.transform[4],
      y: item.transform[5],
      text: item.str.replace(/\s+/g, " ").trim().toLowerCase(),
    }))
    .sort((a, b) => a.x - b.x);

  return labels.some((date) => {
    if (date.text !== "date") return false;
    let previousX = date.x;
    for (const text of ["transaction", "debit", "credit", "balance"]) {
      const column = labels.find(
        (label) =>
          label.text === text &&
          label.x > previousX &&
          Math.abs(label.y - date.y) <= 2,
      );
      if (!column) return false;
      previousX = column.x;
    }
    return [
      "commonwealth bank of australia",
      "transaction summary",
      "account number",
      "period",
      "closing balance",
    ].every((text) =>
      labels.some((label) => label.y > date.y && label.text === text),
    );
  });
}

/** Detects only the demonstrated browser summary with separate Debit/Credit columns. */
export const commbankBrowserSummaryImporter: StatementImporter = {
  id: "commbank-browser-transaction-summary",
  version: "0.0.0",
  async detect({ bytes }) {
    const signature = String.fromCharCode(...bytes.subarray(0, 8));
    const trailer = String.fromCharCode(
      ...bytes.subarray(Math.max(0, bytes.length - 1024)),
    );
    if (!signature.startsWith("%PDF-") || !/%%EOF\s*$/.test(trailer)) return 0;

    let task: PDFDocumentLoadingTask | undefined;
    try {
      task = getDocument({
        data: new Uint8Array(bytes),
        disableFontFace: true,
        useSystemFonts: false,
        useWorkerFetch: false,
        stopAtErrors: true,
        verbosity: 0,
      });
      const document = await task.promise;
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item): item is TextItem => "str" in item,
      );
      // Fixed scores keep every successful/declined outcome finite and within [0, 1].
      return matchesSummaryHeader(items) ? 1 : 0;
    } catch {
      return 0;
    } finally {
      await task?.destroy().catch(() => undefined);
    }
  },
  async parse({ bytes }) {
    let task: PDFDocumentLoadingTask | undefined;
    try {
      task = getDocument({
        data: new Uint8Array(bytes),
        disableFontFace: true,
        useSystemFonts: false,
        useWorkerFetch: false,
        stopAtErrors: true,
        verbosity: 0,
      });
      const document = await task.promise;
      const pages: TextItem[][] = [];
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent({
          disableNormalization: true,
        });
        pages.push(
          content.items.filter((item): item is TextItem => "str" in item),
        );
      }
      if (!matchesSummaryHeader(pages[0]))
        throw new Error("Unsupported CommBank Transaction Summary layout.");
      const result = parseBrowserSummaryDates(pages);
      return {
        parser: {
          id: commbankBrowserSummaryImporter.id,
          version: commbankBrowserSummaryImporter.version,
        },
        metadata: { rawText: "" },
        rows: result.rows,
        warnings: [
          "Only transaction posting dates have been parsed; statement metadata and other row fields remain unresolved.",
          ...result.warnings,
        ],
      };
    } catch {
      throw new Error(
        "Unable to parse transaction dates from a supported CommBank Transaction Summary.",
      );
    } finally {
      await task?.destroy().catch(() => undefined);
    }
  },
};
