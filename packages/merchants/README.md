# packages/merchants

Bank-, database-, and platform-independent merchant-resolution logic for Ledgerase.
The package defines textual normalization and explicit exact alias lookup.

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

Tests check the public contracts and production behavior using synthetic
descriptions. Location/noise suffix removal, broader identity resolution, rules,
category assignment, persistence, and UI remain separate later tasks.

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
