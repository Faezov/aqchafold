# packages/importers/commbank

`commbankBrowserSummaryImporter` implements the shared `StatementImporter` contract
for Ledgerase. Its stable ID is `commbank-browser-transaction-summary`; its version
is `0.0.0`. Detection returns 1 for the demonstrated browser Transaction Summary
family with separate Debit/Credit columns, and 0 otherwise. No filename is used.

The first page must contain the full Commonwealth Bank of Australia identity,
the exact Transaction Summary title, and Account Number, Period, and Closing
Balance labels above an aligned, ordered Date / Transaction / Debit / Credit /
Balance table header. Fixed labels are matched as individual positioned text runs
so duplicated text layers and overlapping OCR in the public example are tolerated.
Only label whitespace and case are normalized for matching.
Other CommBank statements and signed-Amount variants are not supported.

PDF text and positions are inspected locally using pinned
[`pdfjs-serverless`](https://github.com/johannschopplich/pdfjs-serverless), a single
PDF.js/worker bundle with no runtime dependencies. Detection copies input bytes,
disables font rendering, worker resource fetching, and PDF diagnostics,
and releases the document afterward. Non-PDF, truncated, unreadable, and
unsupported content declines safely. It does not inspect financial field values.

The text path uses standard JavaScript streams, TextDecoder, and structuredClone,
which the current Expo runtime provides. The importer uses no Node APIs, file
handles, Expo types, DOM rendering, or external worker files. The dependency's
private one-line patch normalizes explicit null clone options for Expo's installed
structuredClone fallback without changing globals. Node development tools require
Node 22 or newer, as declared by the dependency.

Verified on actual Android 15/API 35 (x86_64 emulator), Expo Go 57.0.9, and Hermes:
without the patch, PDF worker setup throws
`TypeError: Cannot read property 'json' of null` and leaves extraction pending.
With the patch, after clearing Metro and restarting Expo Go, text extraction
succeeds and detection scores are fixture 1, unrelated PDF 0, malformed input 0.
The clone-options regression test covers this observed compatibility requirement.
The opt-in Android smoke launcher is documented in
[the mobile README](../../../apps/mobile/README.md).

The actual ignored government-hosted public reference also detects as 1. Its
duplicated labels and overlapping OCR are covered by a synthetic regression;
committed tests and mobile smoke use only synthetic inputs.

`parse()` currently extracts transaction posting dates and source descriptions.
Positioned Date-column text starts a row; continuation lines remain in its
`rawText` until a nonempty Debit/Credit cell identifies a movement. Values in
those cells are not interpreted.
The demonstrated layout places them on the final description line. The explicit
OPENING BALANCE entry and rows without movement evidence are excluded. Movements
with missing dates remain separate unresolved rows. Pages and rows retain document
order, with one-based page numbers and transaction ordinals; repeated dates remain
distinct. Identical overlapping text runs are collapsed with a document warning.

`rawDescription` uses Transaction-column runs from the same movement block,
excluding Date, Debit, Credit, and Balance cells. Each extracted run is retained
unchanged; runs on a line are joined with spaces and continuation lines with `\n`.
Prefixes such as Credit, Refund, Transfer, and Direct Debit remain source text.
Numeric continuation text remains part of the description, not a transaction ID.
Missing descriptions and conflicting overlapping runs leave `rawDescription`
absent with a row warning. Slightly offset identical overlapping copies collapse
for description output only; `rawText` retains its existing behavior. Blank PDF
text runs do not prove an established empty description, so no empty value is
manufactured from missing evidence.

A row's year is established only when the first-page `DD Mon - DD Mon YYYY` Period
and the explicit opening-balance year agree on a valid same-year range. Gregorian
calendar checks reject impossible dates, including invalid leap days. Missing or
conflicting context, ambiguous Date cells, invalid dates, and dates outside that
range leave `postingDate` unresolved and produce warnings. No current-year fallback
or cross-year rollover is inferred.

`rawPostingDate` retains the extracted Date text without trimming or changing case.
`rawText` reconstructs positioned source runs with spaces and line breaks, including
wrapped descriptions and uninterpreted financial text for later steps. PDF.js text
extraction can coalesce whitespace even with Unicode normalization disabled; these
fields preserve extracted text rather than the PDF drawing instructions. Missing
date evidence leaves `rawPostingDate` absent. The required metadata object currently
contains only `rawText: ""`; a document warning makes the deferred extraction explicit.
Amounts, balances, statement metadata, merchant/category logic, reconciliation,
canonical conversion, persistence, and importer selection remain deferred.
