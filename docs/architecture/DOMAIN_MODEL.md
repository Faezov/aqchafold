# Ledgerase Domain Model

This document currently defines Money, Transaction, Account, and Merchant.

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
semantics to these signs. Transaction defines signs by their effect on the
referenced Account's canonical balance.

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
Money invariants. Signs describe the effect on the referenced Account's canonical
balance:

- Positive: increases the canonical balance.
- Negative: decreases the canonical balance.
- Zero: leaves the canonical balance unchanged; preserve legitimate zero-value
  source records.

Importers convert source debit/credit notation to this convention at ingestion.
For example, an AUD 12.34 purchase has `amountMinor = -1234`; an incoming
AUD 12.34 payment has `amountMinor = 1234`.

Income, expense, transfer, refund, purchase, and repayment are separate economic
classifications and must not be inferred from sign alone.

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
Merchant and Category are separate domain concepts defined independently from
Transaction.

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
- Signs describe canonical Account balance changes consistently across sources.
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

## Account

Account represents a tracked place where the user holds money or owes money in
Ledgerase. It groups posted Transactions and provides the context for their
currency and balance meaning. It need not be provided by a bank.

### Identity and user-visible label

Each Account has a stable, unique internal identity and a required, non-empty
user-visible name or label. Labels are editable and need not be unique. Renaming
an account or changing its source identifiers does not change its identity or
its Transaction relationships.

### Institution and external identifiers

An Account may reference its financial institution conceptually, without assuming
CommBank or any particular country. Cash accounts need no institution. This
section does not define an Institution model or require an institution registry.

Optional external identifiers may help associate imported statements with an
Account. They are scoped to their institution/source and may be absent, masked,
ambiguous, or changed. Account numbers, card numbers, and source identifiers must
not serve as the internal identity. Ambiguous account matches require review;
source identifiers remain sensitive local provenance.

### Account type

Type describes the account's role, not a mandatory balance sign.

| Type | Meaning |
| --- | --- |
| Transaction/checking | Everyday deposits, payments, and transfers. |
| Savings | Money held primarily for saving. |
| Credit card / liability | Amounts owed, with possible repayments or credit balances. |
| Cash | Physical cash tracked through manual or other evidenced entries. |
| Other | An unfamiliar type whose original label is retained for review. |

Add explicit types when an implemented use case needs them. Do not force unknown
source types into an existing type or infer their balance meaning from the label.

### Ownership and household relationship

An Account belongs conceptually to the local household ledger. Ownership may be
individual or shared, and must not assume a single signed-in user. This states
relationships only; Household, Member, and ownership allocation are not defined
here.

### Status

An Account is active or closed. Closure preserves identity, history, and known
balances; it neither deletes Transactions nor implies a zero balance. Historical
imports and corrections remain possible for closed accounts. Unexpected activity
after closure requires review.

### Currency and Transaction relationship

Each Account has one explicit primary currency. In v0.1, every canonical
Transaction amount and balance for that Account must use that currency. An
Account can have zero or more Transactions; each Transaction references exactly
one Account, including each observed side of a transfer.

A foreign-currency purchase may retain its original amount in provenance, but
its canonical Transaction uses the evidenced posted amount in account currency.
If that amount is unavailable or the currencies conflict, preserve the extracted
data and report the issue for review; do not invent an exchange rate or silently
accept a mixed-currency posting. Different Accounts may use different currencies.
Multi-currency accounts are deferred.

### Balance semantics

A canonical posted balance is Money representing the user's signed financial
position in the Account:

- Positive: money held or value owed to the user.
- Negative: money owed by the user; its magnitude is the debt amount.
- Zero: neither a credit position nor debt.

Transaction amount signs describe changes to the canonical balance; balance signs
describe the resulting financial position. For a complete sequence of same-currency
posted movements:

```text
previous balance + signed Transaction amount = resulting balance
```

This equation applies to asset and liability accounts with the same sign
semantics. A negative purchase decreases the canonical balance: it reduces funds
or credit and may create or increase debt. A positive card repayment or refund
increases the balance: it reduces debt or adds credit. Economic classification
must be established separately from the sign's balance effect.

Examples below use AUD integer minor units:

| Account / movement | Previous balance | Transaction amount | Resulting balance |
| --- | ---: | ---: | ---: |
| Checking purchase | 10000 | -2000 | 8000 |
| Credit-card purchase | -10000 | -2000 | -12000 |
| Credit-card repayment | -12000 | 5000 | -7000 |
| Credit-card overpayment | -1000 | 1500 | 500 |

An overdrawn asset account can be negative; an overpaid credit card can be
positive. Type does not change automatically when a balance crosses zero.
A card repayment transfer is negative on the paying account and positive on the
card account; it is not income or new spending.

Sources may present debt as a positive "amount owed." Importers normalize that
notation to a negative canonical balance while preserving the original evidence.
An uncertain source balance meaning requires review, not a guessed sign change.
User-facing debt labels may show its magnitude without changing canonical values.

### Known and derived balances

A known balance needs an as-of date or source position, provenance, and explicit
verification status. An Account may have no known balance; unknown is not zero.
The latest observed statement balance is not necessarily a current balance.

A derived balance requires an evidenced opening balance and a complete,
deduplicated sequence of subsequent posted Transactions through the stated
position. Partial history or failed reconciliation must remain visible and must
not be presented as a verified current balance. Available funds and credit
limits are separate from the posted balance.

### Invariants

- Stable identity, non-empty label, type, status, and primary currency are required.
- All posted amounts and balances obey Money's safe-integer and currency rules.
- v0.1 Transactions and balances match their Account's primary currency.
- Balance meaning and arithmetic are consistent across asset and liability types.
- Neither account type nor status imposes a fixed balance sign or a zero balance.
- External identifiers and labels do not establish internal identity by themselves.
- Ownership relationships, source evidence, and historical Transactions survive
  renaming and closure.
- Missing baselines, ambiguous source meanings, and reconciliation failures remain
  explicit; financial values must not be altered to make balances agree.

### Not handled yet

- Multi-currency accounts, currency conversion, or totals across currencies.
- Available balances, pending holds, credit limits, interest schedules, or debt planning.
- Bank connections, institution metadata management, or account matching algorithms.
- Ownership shares, permissions, synchronization, or related domain models.
- Balance storage strategy, reconciliation algorithms, concrete APIs, or schemas.

### Open questions

- What internal identifier format and external identifier scoping will be used?
- How will known balances, their as-of positions, and verification be represented?
- How will individual/shared ownership be expressed when Household and Member
  are defined?
- How will confirmed closure and late postings be recorded without losing history?

## Merchant

Merchant is Ledgerase's canonical identity for an established commercial merchant
or recognizable organizational payee or payer. This includes retailers, service
providers (including sole traders acting commercially), utilities, government
agencies, and employers, irrespective of Transaction sign.

It does not represent a transaction description, spending Category, ownership,
or every possible counterparty. Generic personal contacts and the user's own
accounts are outside this boundary; no separate Counterparty model is defined.

### Identity and canonical display name

Each Merchant has a stable, unique internal identity and a required, non-empty
canonical display name. Names need not be unique and do not establish identity.
Renaming the display label or adding an alias preserves Merchant identity and
does not rewrite historical Transactions. External identifiers, if retained,
are supporting evidence rather than the internal identity.

### Relationship to Transaction and Category

A Merchant can be associated with zero or more Transactions. A Transaction may
have no established Merchant relationship; tentative candidates must remain
distinguishable from an accepted identity match.

Merchant identity never inherently assigns a Category. Identifying Costco does
not determine whether a purchase was groceries, fuel, pharmacy, or something
else. Establishing or correcting a Merchant must not silently change a
Transaction's independent category decision or financial facts.

### Descriptors and canonical identity

- Raw transaction description: the original source evidence retained by
  Transaction and its provenance; it is never replaced by resolution results.
- Normalized descriptor: a derived representation that can aid comparison while
  retaining a link to its source. It can be ambiguous and is not an identity key.
- Canonical Merchant: the established entity referenced by a stable internal
  identity, with a separate display name.

Conceptually: raw descriptor → normalized descriptor → candidate or confirmed
Merchant. This describes distinct meanings, not a concrete resolver pipeline.
Neither normalization nor similar normalized text proves that two observations
refer to the same Merchant.

### Aliases and known descriptor variants

A Merchant may have known name or descriptor variants. Aliases retain their
supporting evidence and any relevant source or context; they need not be unique
across Merchants. Adding a variant does not prove every occurrence matches,
automatically merge entities, or retroactively reassign Transactions.
Ambiguous variants remain available for review.

### Confidence, confirmation, and unknowns

Confidence and confirmation describe a Transaction/descriptor-to-Merchant
association supported by evidence, not blanket certainty about every sighting
of a Merchant. Distinguish an unresolved association, a tentative suggestion,
an identification supported automatically by evidence, and a user-confirmed
decision. An automatic match must not be presented as user confirmation.

Unknown is valid: with insufficient evidence, retain no established Merchant
relationship and make uncertainty visible for review. Do not create a catch-all
"Unknown" Merchant or promote a weak candidate to a confirmed identity. One
confirmed association does not confirm all similar descriptors or aliases.

### User confirmation and correction precedence

User-confirmed identity decisions have highest precedence. Later automatic
identification must not silently replace them; conflicting evidence requires
visible review. A deliberate user correction can replace an earlier decision.

A correction applies to its stated scope. Applying it to other Transactions or
future descriptor variants requires an explicit reusable scope, rather than
silently treating one confirmation as universal. This is a domain requirement;
no MerchantRule model or matching algorithm is defined here.

### Chains, outlets, services, and intermediaries

Use the level of identity supported by evidence: a chain/brand, a particular
outlet, or a distinct service. Brand-only evidence must not invent a location.
Shared branding must not collapse independently established outlets or services.
`COSTCO` and `COSTCO GAS` must not be merged merely because the names are similar;
preserve the service distinction until their intended identity scope is established.

Suburb, terminal, order, and location fragments may be noise or distinguishing
evidence. They are not universally disposable. Preserve them in source provenance
even when a normalized descriptor omits them.

PayPal, Square, Stripe, or HungryPanda may appear as intermediaries. Their names
alone do not establish the underlying seller. Keep intermediary evidence in
provenance and leave that seller unresolved when unknown. A processor or platform
can itself be the Merchant when evidence identifies it as the relevant provider,
such as for its own service fee. The role depends on the observed transaction.

### Merge and split semantics

A merge corrects duplicate Merchant identities only when evidence establishes
the same entity at the same intended scope. It retains a surviving identity and
traceability of the previous identities and affected associations. Similar names,
aliases, or shared branding alone are insufficient. Changes affecting confirmed
user decisions require explicit review and correction.

A split corrects an overly broad or mistaken grouping by establishing distinct
identities and reassigning only associations supported by evidence or explicit
user decisions. Uncertain associations remain unresolved for review; they must
not be distributed by guesswork. Preserve the history of the correction.

Merges and splits may deliberately change Merchant associations, but preserve
Transaction identities, amounts, dates, Accounts, raw descriptions, source
observations, and independent category decisions. Renaming is neither a merge
nor a split.

### Optional metadata and merchant type

Optional metadata may include a trading/legal name, website, country, established
location or service label, brand affiliation, or scoped external identifier.
Retain the source and uncertainty of such metadata; none is required to create
an established Merchant identity or permits inventing missing details.

An optional merchant type describes the entity, such as cafe, retailer, utility,
public agency, or employer. It may be unknown and must not dictate a Transaction's
Category, budget treatment, or economic classification. No type taxonomy,
institution hierarchy, or automatic enrichment service is defined here.

### Privacy and provenance

Merchant associations, variants, confirmations, and corrections must retain
enough evidence to explain their origin without replacing Transaction provenance.
Financially derived aliases, locations, and confirmation history remain local;
they must not be assumed safe for publication, logging, or external transmission.
Avoid copying account/card identifiers or complete financial descriptions into
canonical names or public merchant metadata.

### Invariants

- Stable internal identity and a non-empty canonical display name are required.
- Names, aliases, and external identifiers alone do not prove identity or uniqueness.
- Raw source evidence survives normalization, confirmation, correction, and merging.
- Unresolved and tentative associations remain distinguishable from established
  matches and user-confirmed decisions.
- User-confirmed identity takes precedence within its explicit scope.
- Identity and merchant type remain independent of Transaction Category and sign.
- Presentation changes do not change identity or reassign historical Transactions.
- Merge/split corrections retain traceability and preserve financial facts and
  independent category decisions.

### Not handled yet

- Resolver algorithms, confidence thresholds, MerchantRule structures, or review UI.
- Category definitions, category assignment, or budgeting logic.
- A general counterparty/contact model or formal brand/outlet/service hierarchy.
- Remote merchant catalogs, enrichment, synchronization, or shared alias publication.
- Concrete APIs, database schemas, or correction-history storage formats.

### Open questions

- What internal identifier format and external identifier scoping will be used?
- How will association evidence, confirmation scope, and conflicting corrections
  be represented?
- Which brand/outlet/service relationships need representation in v0.1?
- How will merge history, surviving identities, and split reassignment remain
  traceable without losing prior user decisions?
