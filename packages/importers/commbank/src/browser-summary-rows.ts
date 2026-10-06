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

/** Internal two-decimal magnitude parser; converts integer digits, never decimal floats. */
export function parseDecimalMagnitudeMinor(raw: string): number | undefined {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(raw)) return;
  const minor = Number(raw.replace(/[,.]/g, ""));
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function amountCells(
  items: readonly TextItem[],
  debit: TextItem,
  credit: TextItem,
): Pick<ParsedStatementRow, "rawDebit" | "rawCredit" | "warnings"> {
  const boundary = (debit.transform[4] + debit.width + credit.transform[4]) / 2;
  const creditRight = credit.transform[4] + credit.width;
  const creditItems = items.filter(
    (item) =>
      item.transform[4] >= boundary ||
      Math.abs(item.transform[4] + item.width - creditRight) <= 2,
  );
  const warnings: string[] = [];
  const sourceCell = (runs: readonly TextItem[], name: string): string => {
    const unique = runs.filter(
      (item, index) =>
        !runs
          .slice(0, index)
          .some(
            (other) =>
              other.str === item.str &&
              Math.abs(other.transform[4] - item.transform[4]) <= 2,
          ),
    );
    const raw = unique.map((item) => item.str).join(" ");
    if (unique.length < runs.length)
      warnings.push(`Identical overlapping ${name} text runs were collapsed.`);
    if (unique.length > 1)
      warnings.push(
        `The ${name} cell has multiple text runs; its magnitude is ambiguous.`,
      );
    else if (raw && parseDecimalMagnitudeMinor(raw) === undefined)
      warnings.push(
        `The ${name} cell is not a valid safe two-decimal magnitude.`,
      );
    return raw;
  };
  const rawDebit = sourceCell(
    items.filter((item) => !creditItems.includes(item)),
    "Debit",
  );
  const rawCredit = sourceCell(creditItems, "Credit");
  if (Boolean(rawDebit) === Boolean(rawCredit))
    warnings.push(
      "Exactly one Debit or Credit cell must be populated for a movement.",
    );
  return { rawDebit, rawCredit, warnings };
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

/** Bank-specific source rows; Money remains unresolved until currency is established. */
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
    amounts: Pick<ParsedStatementRow, "rawDebit" | "rawCredit" | "warnings">;
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
      // The demonstrated layout places financial cells on the final description line.
      const movementItems = line.items.filter(
        (item) =>
          item.transform[4] >= movementLeft &&
          item.transform[4] < movementRight,
      );
      // Preserve real whitespace-only cell runs without adding PDF.js gap spacers
      // (height 0), or changing the existing rawText/date/description observations.
      movementItems.push(
        ...pages[index].filter(
          (item) =>
            item.str.length > 0 &&
            !item.str.trim() &&
            item.height > 0 &&
            Math.abs(item.transform[5] - line.y) <= 2 &&
            item.transform[4] >= movementLeft &&
            item.transform[4] < movementRight,
        ),
      );
      movementItems.sort((a, b) => a.transform[4] - b.transform[4]);
      // Balance-column presence retains missing-amount rows without interpreting balances.
      const hasBalanceCell =
        (dates.length > 0 || descriptionLines.length > 0) &&
        line.items.some(
          (item) =>
            item.transform[4] >= movementRight &&
            item.transform[4] <= balance.transform[4] + balance.width + 2,
        );
      if (!movementItems.length && !hasBalanceCell) continue;
      records.push({
        page: index + 1,
        dates,
        rawText: text.join("\n"),
        description: description(descriptionLines),
        amounts: amountCells(movementItems, debit, credit),
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
    const rowWarnings: string[] = [
      ...record.description.warnings,
      ...record.amounts.warnings,
    ];
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
      rawDebit: record.amounts.rawDebit,
      rawCredit: record.amounts.rawCredit,
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
