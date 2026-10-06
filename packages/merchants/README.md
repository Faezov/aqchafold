# packages/merchants

Bank-, database-, and platform-independent merchant-resolution logic for Ledgerase.
The package currently defines only a textual normalization contract.

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

There is no production normalizer yet. Type tests check the public API; a
test-only whitespace implementation demonstrates the documented policy and source
preservation. Processor-prefix/suffix handling, identity resolution, aliases,
rules, category assignment, persistence, and UI remain separate later tasks.
