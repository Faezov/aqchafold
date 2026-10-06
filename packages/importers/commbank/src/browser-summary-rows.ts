import type {
  ParsedStatement,
  ParsedStatementRow,
} from "@aqchafold/importers-core";
import type { TextItem } from "pdfjs-serverless";

const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const normalized = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

function tableColumns(items: readonly TextItem[]): TextItem[] | undefined {
  for (const date of items.filter((item) => normalized(item.str) === "date")) {
    const columns = [date];
    for (const name of ["transaction", "debit", "credit", "balance"]) {
      const column = items.find(
        (item) =>
          normalized(item.str) === name &&
          item.transform[4] > columns[columns.length - 1].transform[4] &&
          Math.abs(item.transform[5] - date.transform[5]) <= 2,
      );
      if (!column) break;
      columns.push(column);
    }
    if (columns.length === 5) return columns;
  }
}

function lines(items: readonly TextItem[]): { y: number; items: TextItem[] }[] {
  const result: { y: number; items: TextItem[] }[] = [];
  for (const item of [...items].sort(
    (a, b) => b.transform[5] - a.transform[5],
  )) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.y - item.transform[5]) <= 2)
      last.items.push(item);
    else result.push({ y: item.transform[5], items: [item] });
  }
  for (const line of result)
    line.items.sort((a, b) => a.transform[4] - b.transform[4]);
  return result;
}

function calendarDate(raw: string, year: number): string | undefined {
  const match = /^(\d{2})\s+([a-z]{3})$/i.exec(raw.trim());
  if (!match || year < 1 || year > 9999) return;
  const day = Number(match[1]);
  const month = months.indexOf(match[2].toLowerCase()) + 1;
  if (!month) return;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  if (day < 1 || day > length) return;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type DateContext = { year: number; start: string; end: string };

function description(
  sourceLines: readonly (readonly TextItem[])[],
): Pick<ParsedStatementRow, "rawDescription" | "warnings"> {
  if (!sourceLines.length)
    return {
      warnings: [
        "No source transaction description was established for this movement.",
      ],
    };
  let duplicated = false;
  let ambiguous = false;
  const text = sourceLines.map((items) => {
    const runs: TextItem[] = [];
    for (const item of items) {
      if (
        runs.some(
          (run) =>
            run.str === item.str &&
            Math.abs(run.transform[4] - item.transform[4]) <= 2,
        )
      ) {
        duplicated = true;
        continue;
      }
      if (
        runs.some(
          (run) =>
            Math.min(
              run.transform[4] + run.width,
              item.transform[4] + item.width,
            ) -
              Math.max(run.transform[4], item.transform[4]) >
            2,
        )
      )
        ambiguous = true;
      runs.push(item);
    }
    return runs.map((run) => run.str).join(" ");
  });
  if (ambiguous)
    return {
      warnings: [
        "Overlapping Transaction-column text makes the source description ambiguous.",
      ],
    };
  return {
    rawDescription: text.join("\n"),
    warnings: duplicated
      ? [
          "Identical overlapping Transaction-column text runs were collapsed for the description.",
        ]
      : [],
  };
}

function dateContext(
  items: readonly TextItem[],
  openingYears: readonly number[],
): DateContext | undefined {
  const periods = new Set(
    items
      .filter((item) => normalized(item.str) === "period")
      .map((label) =>
        items
          .filter(
            (item) =>
              item.transform[4] > label.transform[4] + label.width &&
              Math.abs(item.transform[5] - label.transform[5]) <= 2,
          )
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((item) => item.str)
          .join(" "),
      ),
  );
  if (periods.size !== 1 || new Set(openingYears).size !== 1) return;
  const period =
    /^(\d{2}\s+[a-z]{3})\s+-\s+(\d{2}\s+[a-z]{3})\s+(\d{4})$/i.exec(
      [...periods][0].trim(),
    );
  if (!period) return;
  const year = Number(period[3]);
  if (year !== openingYears[0]) return;
  const start = calendarDate(period[1], year);
  const end = calendarDate(period[2], year);
  // No rollover is inferred from row order or from a period with an omitted year.
  if (!start || !end || start > end) return;
  return { year, start, end };
}

/** Bank-specific source dates and descriptions; no financial values are interpreted. */
export function parseBrowserSummaryRows(
  pages: readonly (readonly TextItem[])[],
): Pick<ParsedStatement, "rows" | "warnings"> {
  const warnings: string[] = [];
  const openingYears: number[] = [];
  const records: {
    page: number;
    dates: string[];
    rawText: string;
    description: Pick<ParsedStatementRow, "rawDescription" | "warnings">;
  }[] = [];
  const sourcePages = pages.map((items) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (!item.str.trim()) return false;
      const key = JSON.stringify([
        item.transform[4],
        item.transform[5],
        item.str,
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  if (
    sourcePages.some(
      (items, index) =>
        items.length < pages[index].filter((item) => item.str.trim()).length,
    )
  ) {
    warnings.push(
      "Identical overlapping PDF text runs were collapsed for source row extraction.",
    );
  }

  for (const [index, items] of sourcePages.entries()) {
    const columns = tableColumns(items);
    if (!columns) {
      warnings.push(
        `Page ${index + 1} has no supported transaction table; date coverage is partial.`,
      );
      continue;
    }
    const [date, transaction, debit, credit, balance] = columns;
    const body = items.filter(
      (item) =>
        item.transform[5] < date.transform[5] - 2 &&
        item.transform[4] >= date.transform[4] - 2,
    );
    const movementLeft =
      (transaction.transform[4] + transaction.width + debit.transform[4]) / 2;
    const movementRight =
      (credit.transform[4] + credit.width + balance.transform[4]) / 2;
    let dates: string[] = [];
    let text: string[] = [];
    let descriptionLines: TextItem[][] = [];
    for (const line of lines(body)) {
      const opening = line.items.find(
        (item) =>
          item.transform[4] >= transaction.transform[4] - 2 &&
          item.transform[4] < movementLeft &&
          /^(?:\d{4}\s+)?opening balance$/i.test(item.str.trim()),
      );
      if (opening) {
        const year = /^(\d{4})\s+/i.exec(opening.str.trim());
        if (year) openingYears.push(Number(year[1]));
        dates = [];
        text = [];
        descriptionLines = [];
        continue;
      }
      const sourceDates = line.items
        .filter((item) => item.transform[4] < transaction.transform[4] - 2)
        .map((item) => item.str);
      if (sourceDates.length) {
        dates = [...new Set(sourceDates)];
        text = [];
        descriptionLines = [];
      }
      text.push(line.items.map((item) => item.str).join(" "));
      const descriptionItems = line.items.filter(
        (item) =>
          item.transform[4] >= transaction.transform[4] - 2 &&
          item.transform[4] < movementLeft,
      );
      if (descriptionItems.length) descriptionLines.push(descriptionItems);
      // The demonstrated layout places movement cells on the final description line.
      // Presence locates a movement; neither Debit nor Credit values are interpreted.
      if (
        !line.items.some(
          (item) =>
            item.transform[4] >= movementLeft &&
            item.transform[4] < movementRight,
        )
      )
        continue;
      records.push({
        page: index + 1,
        dates,
        rawText: text.join("\n"),
        description: description(descriptionLines),
      });
      dates = [];
      text = [];
      descriptionLines = [];
    }
  }
  const context = dateContext(sourcePages[0], openingYears);
  if (!context)
    warnings.push(
      "The Period and opening-balance year do not establish an unambiguous same-year date range.",
    );
  const rows: ParsedStatementRow[] = records.map((record, index) => {
    const rawPostingDate = record.dates.length
      ? record.dates.join(" ")
      : undefined;
    const rowWarnings: string[] = [...record.description.warnings];
    let postingDate: string | undefined;
    if (rawPostingDate === undefined)
      rowWarnings.push(
        "No source posting date was established for this movement.",
      );
    else if (record.dates.length !== 1)
      rowWarnings.push(
        "The Date cell has multiple text runs; its posting date is ambiguous.",
      );
    else if (!context)
      rowWarnings.push(
        "Posting date year is unresolved from statement context.",
      );
    else {
      const interpreted = calendarDate(rawPostingDate, context.year);
      if (!interpreted)
        rowWarnings.push(
          "The source posting date is not a valid DD Mon Gregorian date.",
        );
      else if (interpreted < context.start || interpreted > context.end)
        rowWarnings.push(
          "The source posting date is outside the evidenced statement period.",
        );
      else postingDate = interpreted;
    }
    return {
      position: { page: record.page, row: index + 1 },
      rawText: record.rawText,
      ...(record.description.rawDescription === undefined
        ? {}
        : { rawDescription: record.description.rawDescription }),
      ...(rawPostingDate === undefined ? {} : { rawPostingDate }),
      ...(postingDate === undefined ? {} : { postingDate }),
      warnings: rowWarnings,
    };
  });
  return { rows, warnings };
}
