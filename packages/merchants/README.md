# packages/merchants

Bank-, database-, and platform-independent merchant-resolution logic for Ledgerase.
The package defines a textual normalization contract and its first production step.

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

Tests check the public contract and production behavior using synthetic
descriptions. Location/noise suffix removal, identity resolution, aliases,
rules, category assignment, persistence, and UI remain separate later tasks.
