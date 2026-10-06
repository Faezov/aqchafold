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

`parse()` currently extracts transaction posting dates, source descriptions,
raw Debit/Credit and running Balance cells, explicit opening/closing evidence,
and demonstrated header metadata.
Positioned Date-column text starts a row; continuation lines remain in its
`rawText` until financial cells identify a movement's final baseline.
Balance-column text can retain a movement with missing Debit/Credit evidence;
the demonstrated layout places financial cells on the final description line.
The explicit OPENING BALANCE entry and rows without movement evidence are excluded
from transaction rows. Movements with missing dates remain separate unresolved
rows. Pages and rows retain document
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

`rawDebit` and `rawCredit` use that final baseline's positioned source runs. Column
boundaries and right-aligned text edges distinguish the cells; the supported table
layout establishes `""` for an empty counterpart. A single run retains its exact
extracted notation. Identical overlapping copies collapse deterministically;
multiple different runs remain joined as evidence with an ambiguity warning.
Both-populated and both-empty cells also warn, without selecting a direction.
Debit represents a later negative movement and Credit a later positive movement.

Unsigned magnitudes require digits (optionally with correctly grouped commas) and
exactly two decimal places. The internal helper removes separators only from a
validation copy and converts integer digits directly to safe integer minor units;
no floating-point dollar arithmetic is used. Invalid notation and unsafe magnitudes
retain their raw evidence with warnings. `rawAmount` is absent for this column format.
The current parser establishes no ISO currency evidence: `$`, bank identity, locale,
and environment do not supply it. A document warning explains why `amount` remains
absent; no default currency or Money instance is introduced.

`rawBalance` uses the positioned Balance-column runs on the movement's final
baseline, preserving `$`, commas, decimals, and extracted whitespace. Missing
cells leave it absent with a row warning. Identical overlapping copies collapse
with a warning; conflicting runs remain joined as raw evidence with an ambiguity
warning. Validation accepts only the demonstrated unsigned dollar-prefixed,
two-decimal notation, using the same integer minor-unit helper. Malformed values
remain unchanged with warnings; unsupported negative formats are not inferred.
No balance is derived from Debit/Credit values, and `balance` remains absent.

The explicit OPENING BALANCE entry becomes separate `openingBalance` evidence,
retaining its `rawValue`, `rawDate`, reconstructed `rawText`, and source position
when established. Its position uses the one-based page and table-entry ordinal,
including opening entries. Its interpreted date uses only the existing validated
date context described below. Header Closing Balance becomes `closingBalance`,
retaining `rawValue` and reconstructed `rawText`. It has no inferred date and never
falls back to the final running balance.

Opening/closing uncertainty produces document warnings. Multiple entries retain
their raw evidence joined with newlines without selecting an entry; ambiguous
opening entries have no chosen position or date. An established label with no
value retains `rawValue: ""` and a missing-value warning. Both balance `value`
fields remain absent because an ISO currency has not been established. Conflicting
overlapping opening labels also leave the new opening date unresolved with a warning.

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
retains the full institution name, source Account Number, and validated Period
boundaries when established. Header values are associated with their labels by
the same baseline and their position to the right. Adjacent source runs are joined
with spaces; each run's characters remain unchanged. Missing, blank, conflicting,
overlapping, or control-character account evidence leaves `accountIdentifier`
absent with a document warning. No account-number length, checksum, or masking
alphabet is inferred from the synthetic identifier.

Metadata `rawText` reconstructs relevant first-page header lines above the table:
bank identity, title/page counter, Account Number, Statement, Period, and Closing
Balance. It retains original extracted runs, including unresolved/conflicting
values. Identical overlapping header copies collapse only for metadata fields,
with a warning; this does not alter row or balance source processing. The existing
Gregorian, same-year range, and opening-year checks interpret Period from this
metadata view. Missing, malformed, conflicting, or cross-year Period evidence
leaves both boundaries absent; transaction dates never supply period boundaries.

`currency`, `accountLabel`, `sourceKind`, and `sourceFormat` remain absent. The
Statement label does not establish a value, and no structured customer identity
is introduced. Dollar notation establishes no ISO currency, so all amount/balance
Money fields remain unresolved. Money construction, merchant/category logic,
canonical conversion, persistence, and importer selection remain deferred.

`reconciliation` records one source-balance check per movement, in document order,
as `{ position, status }`, plus a header `closingBalance` check. Each status is
`"verified"`, `"mismatch"`, or `"unresolved"`; verification is explicit rather than
inferred from missing warnings. The scope is source arithmetic, not whole-import
acceptance, currency proof, or document completeness.

The exact equation is `previous source balance + signed source movement = current
source balance`. The same strict two-decimal validators produce private safe
integer minor units. Exactly one populated valid Debit/Credit cell is required:
Debit is negative and Credit positive. Neither Money nor an ISO currency is needed.
Unsafe sums are rejected before addition; no floating-point dollar arithmetic,
tolerance, rounding, or source repairs are used.

The first movement uses a unique explicit opening entry preceding it. Each later
movement uses the immediately preceding source running balance, regardless of
that previous movement's check outcome. Computed balances are never carried
forward. Missing or invalid current balances affect their own and the next
relation; later independently valid source balances allow checks to resume.
Skipped unsupported table pages similarly interrupt the next baseline, and a
trailing unsupported page leaves the final source balance unestablished.

The closing check compares the unique header value with the final source running
balance independently of movement-check outcomes. It never substitutes an opening
or computed balance. Ambiguous entries/cells, missing or malformed magnitudes,
and unsafe evidence yield `unresolved`, while exact arithmetic disagreement yields
`mismatch`. Nonverified checks add deterministic document warnings identifying
the relation without transaction values; verified checks add no warnings.
