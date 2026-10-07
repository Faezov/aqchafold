# packages/merchants

Bank-, database-, and platform-independent merchant-resolution logic for Ledgerase.
The package defines textual normalization, explicit exact alias lookup, and
merchant-resolution outcome states.

`MerchantDescriptionNormalizer` is a pure, deterministic, synchronous callable:

```ts
(rawDescription: string) => MerchantNormalizationResult
// MerchantNormalizationResult: { readonly normalizedDescription: string }
```

The input is an established raw description, including a genuinely empty string.
If a manual Transaction has no description (`undefined`), the caller skips
normalization; absence must not be silently converted into empty source evidence.
The caller retains the original `Transaction.rawDescription` unchanged, including
all whitespace. The result is separate derived text, never a replacement for
source evidence, a canonical Merchant identity, or a Category assignment.
Equal normalized descriptions do not prove equal Merchants.

For CommBank, source description evidence is assembled from unchanged extracted
Transaction-column runs, with spaces between runs and newlines between lines;
it is not a byte-for-byte representation of the PDF. Once established on a
`ParsedStatementRow`, the string passes unchanged through canonical conversion,
the frozen `Transaction`, SQLite `raw_description`, and repository reads.
Imported descriptions are required strings, including legitimate `""` values.
Manual absence remains `undefined`, represented only as SQL `NULL` in storage.
Callers pass an established string to normalization and keep its result separate;
the current app and repositories do not automatically invoke normalization.

The output policy trims surrounding ECMAScript whitespace (`\s`) and collapses
internal whitespace runs to one ASCII space. Case, accents, and punctuation in
retained text are preserved; no case folding or Unicode normalization is implied.
Empty or whitespace-only input yields `""`. Empty output is valid when no candidate
text remains and must not be replaced with an invented merchant name.

Later textual steps can consume a previous result's `normalizedDescription`
directly while the caller keeps the original source separately. No composition
framework, provenance copy, version, confidence, or transformation metadata is
needed for this contract; nothing is cached or persisted here. Derived text
remains sensitive local financial data and must not be logged or transmitted.

`normalizePaymentProcessorPrefix` implements `MerchantDescriptionNormalizer`.
It normalizes whitespace first, then strips one leading `SQ *` or `PAYPAL *`
wrapper. Processor tokens match ASCII case-insensitively. A space before the
literal `*` is required after whitespace normalization; a space afterward is
optional. Supported forms are `SQ *MERCHANT`, `SQ * MERCHANT`,
`PAYPAL *MERCHANT`, and `PAYPAL * MERCHANT`. Prefix-only input yields `""`.
`SQ*`, `PAYPAL*`, `PP*`, other separators, and other processor tokens are
unsupported and receive only whitespace normalization.

Matching is anchored at the beginning, never in the middle/end or as a substring.
Removal happens once: `SQ *PAYPAL *Shop` yields `PAYPAL *Shop`, retaining the
second wrapper. The remaining case, accents, punctuation, and location/suffix
text are preserved. For example, ` SQ *EXAMPLE SHOP Sydney NS AUS ` yields
`EXAMPLE SHOP Sydney NS AUS`, still only a textual candidate.

`MerchantAlias` is an explicit identity mapping with readonly
`normalizedDescription: string` and `merchantId: string` fields. Aliases operate
after textual normalization, not as another normalization rule:

```ts
resolveMerchantAlias(
  normalizedDescription: string,
  aliases: readonly MerchantAlias[],
): string | undefined
```

Lookup is pure, synchronous, deterministic, and uses exact, case-sensitive string
equality. It does not trim, normalize Unicode, or perform partial/fuzzy matching.
Empty or unmatched descriptions return `undefined`. Both alias fields must be
nonblank strings; whitespace is checked only for validation and never removed.
The whole supplied collection is validated before lookup, even for empty queries:
invalid fields throw `TypeError`, identical mappings are tolerated, and one exact
description mapped to different IDs throws `Error` regardless of ordering or
lookup text. Ambiguous mappings cannot silently select an ID.

The returned opaque ID comes only from the caller's explicit mapping; normalization
alone does not identify a Merchant. Lookup does not verify that ID against a
repository or change Transactions, categories, or confirmation status. Aliases
are not persisted yet, and no built-in merchant catalog or aliases exist.

Household-scoped durable mappings use the separate
[MerchantRuleRepository](../database/README.md) in `packages/database`. The pure
alias contract and resolver remain independent of SQLite.

`MerchantResolution` is a readonly discriminated union describing one resolution
outcome, not a property of Merchant identity. The same Merchant can participate in
different states in different contexts:

- `confirmed`: authoritative identity confirmation, with a nonblank `merchantId`.
- `suggested`: an unconfirmed candidate with a nonblank `merchantId`, requiring
  user or other authoritative confirmation.
- `unknown`: no established candidate, with no `merchantId` in the returned object.

`confirmedMerchant(merchantId)`, `suggestedMerchant(merchantId)`, and
`unknownMerchant()` construct frozen, deterministic outcomes. The ID helpers
validate nonblank strings and preserve opaque IDs exactly; invalid IDs throw
`TypeError`. Calling `confirmedMerchant` expresses confirmation already established
by the caller; these helpers do not discover identities or verify authority.
The unknown union branch uses `merchantId?: never` to reject accidental string
identities in structural assignments; the helper itself returns only `status`.

The state constructors do not choose sources or look up Merchants. Outcomes contain
no descriptions, categories, or source metadata; constructing them performs no
normalization, lookup, persistence, or assignment.

`resolveMerchantIdentity({ confirmedMerchantId?, suggestedMerchantId? })` is the
pure synchronous priority resolver, returning `MerchantResolution`:

`user-confirmed persistent rule > suggestion > unknown`

Every v0.1 persistent rule represents an authoritative household correction: the
Household explicitly confirmed that exact normalized description maps to the
Merchant. Callers obtain that Household-specific rule separately and pass its ID
as `confirmedMerchantId`. An alias or other unconfirmed candidate supplies
`suggestedMerchantId`; exact alias matching by itself is not user confirmation.
A valid confirmed ID wins even when the suggestion names a different Merchant.
No conflict error is raised merely because valid IDs disagree.

Both supplied IDs are validated before selection, in confirmed-then-suggested
order. An invalid suggestion throws `TypeError` even when confirmation would win;
malformed caller state is not hidden by priority. `undefined` means absent;
otherwise IDs must be nonblank strings and are preserved exactly. The result is
frozen and deterministic. The resolver imports no database code, applies nothing
to Transactions, and does not create or overwrite rules. Actual user confirmation
UI and automatic application to Transactions arrive later.

`aggregateUnknownMerchantObservations(observations)` accepts readonly
`UnknownMerchantObservation` records containing `transactionId` and
`normalizedDescription`. Callers supply only observations whose resolution is
`unknown`; confirmed and suggested outcomes do not belong here. The function
accepts no Transactions and performs no normalization, alias/rule lookup, or
resolution-priority decisions.

Each `UnknownMerchantGroup` contains `normalizedDescription`, readonly
`transactionIds`, and `transactionCount`. It is a review aggregation keyed by
exact, case-sensitive description text, NOT a canonical Merchant. Equal text
does not prove Merchant identity, and no Merchant ID or record is invented.
Whitespace, case, Unicode, and punctuation are preserved exactly; no trimming,
Unicode normalization, similarity matching, or fuzzy grouping occurs.

Both input fields must be nonblank strings; invalid fields/observations throw
`TypeError`. Empty candidate text must be deliberately omitted by the caller,
never grouped under a placeholder. Every duplicate transaction ID throws `Error`,
whether its descriptions agree or conflict, so a Transaction cannot count twice.
An empty input returns an empty frozen array.

Groups are sorted by description ascending, and IDs within each group are sorted
ascending using ordinary JavaScript UTF-16 string ordering, without locale or
numeric comparison. Ordering is independent of input order. The outer array,
group objects, and ID arrays are frozen; caller arrays and records stay unchanged.
No persistence or Transaction assignment happens here. Financial totals and
ranking are provided only by the separate currency-scoped layer below.

`rankUnknownMerchantReviewQueues(observations)` accepts readonly
`UnknownMerchantFinancialObservation` records: the existing observation fields
plus canonical `amountMinor` and `currency`. Callers still supply only unknown
outcomes. Basic textual aggregation remains independent of amounts and currency.
The ranker reuses its validation globally and its grouping within each currency.

The readonly result contains one `UnknownMerchantReviewQueue` per currency, with
`currency` and readonly `groups`. Each `RankedUnknownMerchantGroup` extends the
textual group with `spendingMinor`: the exact integer sum of positive magnitudes
of negative canonical amounts. Financial importance currently means total
canonical outflow, not an economic spending classification. Positive credits and
refunds are not netted against outflow; positive and zero observations remain in
IDs/counts while contributing zero. No fractional major-unit arithmetic is used.

Grouping is exact and case-sensitive by description within each currency. The
same description in different currencies remains financially separate. Amounts
from different currencies are never summed or compared. There is no FX conversion
or global financial ranking. Currency queues are listed by code ascending only
for presentation.
Within one queue, groups sort by `spendingMinor` descending, then
`transactionCount` descending, then description ascending using ordinary JS
string ordering. Transaction IDs retain the aggregation API's lexical ordering.

Amounts must be safe integers (`RangeError` otherwise). Currency must contain
exactly three uppercase ASCII letters (`TypeError` otherwise), matching Money's
current structural validation without an invented currency registry. Blank fields
and duplicate IDs, including across currencies, follow the aggregation contract.
Accumulation is checked before each addition; an unsafe group total throws
`RangeError` rather than rounding. No combined monetary queue total is computed.

All output layers are frozen and input strings/records stay unchanged. These
remain review candidates, not Merchant identities. Ranking performs no
normalization, persistence, resolution, or Transaction assignment. The merchant
review UI is the next separate step.

Tests check the public contracts and production behavior using synthetic
descriptions. Location/noise suffix removal, broader identity resolution, category
assignment, and UI remain separate later tasks.

There are currently no production location/noise suffix-removal rules. The
[tracked CommBank reference](../../fixtures/bank-statements/commbank/browser-summary-01.reference.json)
contains 11 transaction descriptions. The suffix candidates are bare
`EXAMPLEVILLE` in `FIXTURE MARKET EXAMPLEVILLE` and the numeric continuation in
`Direct Debit SYNTHETIC UTILITIES\n91007382`. The fixture README describes an
invented numeric reference, but neither candidate establishes syntax that reliably
separates merchant identity text from discardable text for arbitrary descriptions.
The importer preserves that continuation as description evidence.

The architecture example `SQ *KAHII Sydney NS AUS` illustrates an intended result;
it does not define an unambiguous suffix format. City names (including `Sydney`
or `EXAMPLEVILLE`), state abbreviations, country names/codes, numeric tokens,
and arbitrary terminal words are deliberately retained, whether at the end or
in the middle. Such fragments may distinguish merchants, outlets, or services;
`Sydney Tools` must stay intact. No fixture-specific hardcoded removals are added.

Suffix normalization cannot yet be marked complete. It needs tracked evidence or
a documented structured format distinguishing removable suffixes from identity
text. Until then, processor-prefix normalization remains the only production
step and owns whitespace normalization. There is no suffix function, duplicate
whitespace implementation, or additional composition layer.
