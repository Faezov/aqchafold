# Ledgerase Domain Model

This document currently defines the Money and Transaction concepts.

## Money

Money is an immutable value describing an exact signed monetary amount in one
currency. It has no identity beyond its amount and currency.

### Representation and examples

- `amountMinor`: an exact integer count of the currency's minor units. For v0.1,
  use a JavaScript `number` that always satisfies `Number.isSafeInteger(amountMinor)`.
  Never represent Money as fractional major-unit values.
- `currency`: an explicit, validated, uppercase ISO 4217 currency code, such as
  `AUD`. Do not infer currency from a symbol or default it to AUD.

Currency minor-unit scale belongs to currency metadata used for parsing and
formatting. Basic Money arithmetic operates on integer minor units and does not
require that metadata. Two decimal places are not a universal assumption; AUD
uses 100 minor units per dollar.

| Monetary value | amountMinor | currency |
| --- | ---: | --- |
| AUD 12.34 | 1234 | AUD |
| AUD -12.34 | -1234 | AUD |
| AUD 0.00 | 0 | AUD |

### Signs

Money may be positive, negative, or zero. Money itself assigns no inflow/outflow
semantics to these signs. Transaction defines the cash-flow sign convention
below.

### Invariants

- Amount and currency are both required. Negative amounts and zero are valid.
- Amounts and arithmetic results must satisfy `Number.isSafeInteger()`.
  Arithmetic producing a value outside the safe integer range must fail
  explicitly; amounts must never be silently rounded or truncated.
- Invalid or unsupported currency codes must fail explicitly, without
  substitution.
- Addition, subtraction, and ordering require matching currencies. There is no
  implicit conversion or combined total across currencies.
- Zero has one representation per currency; there is no distinct negative zero.

### Equality semantics

Two Money values are equal only when both their signed `amountMinor` and currency
code match. Equality is independent of object identity or display formatting.
1234 minor units in AUD and 1234 minor units in USD are unequal; zero AUD and
zero USD are also unequal.

### Not handled yet

- Exchange rates, currency conversion, or totals across currencies.
- Sub-minor-unit amounts, rounding policies, splitting, or allocation.
- Parsing source text, locale-specific formatting, or source provenance.
- Financial classification, ledger semantics, or other domain models.
- APIs, serialization, or database storage.

### Open questions

Before implementation, decide:

- Which currencies will v0.1 accept, and where will validated minor-unit scale
  metadata come from?

## Transaction

Transaction is the canonical record of one posted financial movement affecting
one account. It is independent of bank layouts and ingestion formats.

### Identity and account relationship

Each Transaction has a stable, unique internal identity and a required reference
to exactly one account. Its identity is separate from bank identifiers, import
identifiers, and duplicate-detection fingerprints. Corrections do not change it.
Two records with equal amounts and dates are not necessarily the same Transaction.

The account relationship identifies which account the movement affects; this
section does not define the Account concept.

### Posting date and transaction date

- Posting date is the calendar date the movement was recorded on the account.
  It is required for a posted Transaction; manual entry supplies it explicitly.
- Transaction date is the calendar date the underlying activity occurred. It is
  optional when unavailable and may differ from the posting date.

Preserve both dates when supplied. Do not silently substitute one for the other
or invent timestamps. Missing or ambiguous posting dates require review before
acceptance; any reconstruction must be recorded in provenance.

### Money amount and sign convention

Each Transaction has one Money amount, including its explicit currency and all
Money invariants. Signs describe cash flow relative to the referenced account:

- Positive: inflow to the account.
- Negative: outflow from the account.
- Zero: neither inflow nor outflow; preserve legitimate zero-value source records.

Importers convert source debit/credit notation at ingestion. For example, an
AUD 12.34 purchase has `amountMinor = -1234`; an incoming AUD 12.34 payment has
`amountMinor = 1234`. Sign alone does not establish income or expense classification.

### Raw description and provenance

Imported Transactions retain the original raw description or a reference to
equivalent locally accessible provenance. Normalized descriptions and user edits
must remain separate from the raw source information.

Provenance must identify the origin and source record, indicate reconstructed
fields, and retain parsing or reconciliation uncertainty for review. Raw document
retention is optional; sensitive provenance must not appear in logs.

### Optional merchant and category relationships

Merchant and category references are independently optional: merchant identity
and spending classification are different decisions. A missing reference means
unresolved or unclassified, not a confirmed match. Uncertain suggestions remain
visible for review, and user-confirmed decisions override automatic suggestions.
Neither related concept is defined here.

### Source and import relationship

Transactions distinguish manual entry from imported origins. A canonical
Transaction may have zero or more source observations/provenance records. A
manual Transaction may have none and retains its manual origin, even if later
matched to imported observations of the same movement.

Each imported observation may identify:

- The import in which the movement was observed.
- A source record locator, such as a row or page.
- A source-provided transaction identifier, when available.
- Parsing/reconstruction metadata, including inferred fields and uncertainty.

Import identity describes an ingestion event, not the financial movement's
identity. Overlapping imports can contribute observations to the same Transaction;
their provenance must be preserved without creating an additional financial
effect once duplication is confirmed. No observation or import model is defined
here.

### Transfers

A confirmed internal transfer moves money between the user's accounts and is
neither income nor spending. Each observed side remains a separate Transaction:
negative on the sending account and positive on the receiving account. A link
may identify counterparts without merging their identities or provenance.

Do not invent an unobserved counterpart or assume both sides post on the same
date. Same-currency principal movements have equal magnitude and opposite signs;
fees remain distinct expenses. Different-currency amounts must not be equated
or converted implicitly. Uncertain transfer matches require review.

### Refunds

An incoming purchase refund is a separate positive Transaction. It reverses
spending economically rather than automatically becoming ordinary income, and
does not rewrite the original negative purchase. A link to the original may
be retained when established; partial or repeated refunds need not equal the
original amount. A positive sign alone does not identify a refund.

### Duplicate and import identity considerations

Bank transaction identifiers must be scoped to their source and account. Import
and row identifiers locate observations, but do not establish uniqueness across
overlapping statements. Matching account, date, amount, and description only
identifies a duplicate candidate: legitimate repeated payments can share them.

Confirmed repeat observations reuse the existing Transaction identity and retain
provenance from all relevant imports without replacing earlier evidence or adding
another financial effect. Ambiguous duplicates must remain available for review
without silent merging, deletion, or claims that the import is fully verified.

### Invariants

- Internal identity, account reference, posting date, and valid Money are required.
- Dates are valid calendar dates; their meanings stay distinct even when equal.
- Signs follow the account-relative convention consistently across sources.
- Imported origin and raw provenance survive normalization and correction.
- Optional relationships never manufacture certainty or override confirmed choices.
- Reconciliation failures and uncertain extracted fields remain explicit, with
  affected records marked for review; amounts must not be changed to force a match.
- Transfer and refund links preserve individual Transaction identities;
  confirmed duplicate sightings refer to the existing identity.

### Not handled yet

- Pending authorizations, scheduled movements, or their lifecycle.
- Account balances, reconciliation algorithms, or bank-specific parsing.
- Split classifications, detailed ledger entries, or reporting algorithms.
- Currency conversion or automatic transfer/refund matching.
- Related domain models, concrete APIs, or database schemas.

### Open questions

- What internal identifier format and source identifier scoping will be used?
- How will transfer/refund links and confirmation or review state be represented?
- Which evidence is sufficient to confirm duplicates across overlapping imports?
- How will the account-relative sign convention map to liability accounts when
  Account is defined?
