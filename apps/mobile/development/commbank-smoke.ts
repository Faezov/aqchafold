import { commbankBrowserSummaryImporter } from "@aqchafold/importers-commbank";
import { getDocument, type PDFDocumentLoadingTask } from "pdfjs-serverless";

function decodeFixture(value: string | undefined): Uint8Array {
  if (!value) throw new Error("Run the commbank:smoke development launcher.");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function runCommBankSmokeCheck(): Promise<void> {
  const bytes = decodeFixture(
    process.env.EXPO_PUBLIC_LEDGERASE_COMMBANK_SMOKE_PDF,
  );
  const unrelated = decodeFixture(
    process.env.EXPO_PUBLIC_LEDGERASE_COMMBANK_SMOKE_UNRELATED,
  );
  let extractionSucceeded = false;
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
    extractionSucceeded = content.items.some(
      (item) => "str" in item && item.str === "Transaction Summary",
    );
  } catch (error) {
    const reason =
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
    console.error(`[Ledgerase CommBank smoke] extraction failed: ${reason}`);
  } finally {
    await task?.destroy().catch(() => undefined);
  }

  const malformed = Uint8Array.from(
    "%PDF-1.7\nnot a PDF document\n%%EOF",
    (character) => character.charCodeAt(0),
  );
  const fixtureScore = await commbankBrowserSummaryImporter.detect({ bytes });
  const unrelatedScore = await commbankBrowserSummaryImporter.detect({
    bytes: unrelated,
  });
  const malformedScore = await commbankBrowserSummaryImporter.detect({
    bytes: malformed,
  });
  console.info(
    `[Ledgerase CommBank smoke] extraction=${extractionSucceeded} fixture=${fixtureScore} unrelated=${unrelatedScore} malformed=${malformedScore}`,
  );
  if (
    !extractionSucceeded ||
    fixtureScore !== 1 ||
    unrelatedScore !== 0 ||
    malformedScore !== 0
  ) {
    throw new Error("Unexpected CommBank detection smoke result.");
  }
}
