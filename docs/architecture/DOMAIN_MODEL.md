# Ledgerase Domain Model

This document currently defines Money, Transaction, Account, Merchant, Category,
Household, Member, Import, Receipt, and ReceiptItem.

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
effect once duplication is confirmed. No source observation model is defined here.

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

An Account belongs to a Household's local ledger. Its ownership association may
be individual, shared, household-level, or unknown, as described under Household
and Member below. Ledger inclusion does not establish legal ownership or
per-Transaction Member attribution; ownership allocation is deferred.

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
- How will ownership associations and changes over time be represented?
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
- Category assignment rules or budgeting logic.
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

## Category

Category is Ledgerase's canonical, user-visible classification of a Transaction's
economic purpose or nature for the household. Examples include Groceries,
Dining, Transport, Salary, and Utilities; these illustrate meaning rather than
define a complete taxonomy.

Category does not identify a Merchant, interpret an Account balance change,
confirm a transfer or refund, or determine budgeting treatment. It does not
represent an amount, budget limit, or classification rule.

### Identity and user-visible name

Each Category has a stable, unique internal identity and a required, non-empty
user-visible name. Names are editable presentation, not identity keys. Equal
names do not prove that two Categories have the same intended meaning.

### Relationship to Transaction

A Category may be associated with zero or more Transactions. In v0.1, a
Transaction has zero or one established Category association, independently
editable from its Merchant association. Assignments belong to Transactions,
not inherently to Merchants.

Establishing or correcting an assignment preserves Transaction identity, Money,
dates, Account, raw descriptions, and source observations. Category assignment
does not require a resolved Merchant.

### Uncategorized, suggested, and confirmed assignments

Uncategorized is valid: a Transaction with no established Category remains
unclassified. Do not create a fake "Unknown" Category to satisfy the relationship.

Confidence and confirmation describe the assignment, not the Category itself.
Distinguish unresolved assignments, tentative suggestions, assignments established
automatically from sufficient evidence, and user-confirmed decisions. Weak
suggestions remain tentative and visible for review; an automatic assignment
must not be presented as user confirmation.

### Correction precedence and scope

User-confirmed assignments have highest precedence. Later automatic classification
must not silently replace them; conflicting suggestions require visible review.
A deliberate user correction may replace a previous decision.

A correction applies only to its stated scope. Reusing it for other or future
Transactions requires an explicit rule or scope; correcting one purchase must
not universally categorize every similar descriptor or Merchant. No CategoryRule
model or classifier is defined here.

### Independence from Merchant and merchant type

Merchant answers who a Transaction was associated with; Category answers what
it was economically for. The same Merchant may appear under multiple Categories,
and different Merchants may share one Category.

A Costco Transaction may be Groceries or another purpose. An established Costco
Gas purchase may be Transport/Fuel, but neither its name nor its merchant type
constitutes the category decision. Merchant identity and type may later supply
evidence for a suggestion; they never inherently determine the assignment.
Merchant renames, merges, splits, and corrections preserve independent category
decisions unless a separate category correction is deliberately made.

### Independence from budget character

Essential, discretionary, irregular, and work/admin treatment are separate
dimensions, not intrinsic Category identities or mandatory Category properties.
Dining might receive discretionary treatment; Medical might be essential or
irregular; Transport may receive different treatment depending on context.

Such treatment can vary without changing Category identity or the Transaction's
category assignment. Budget and BudgetCharacter are not defined here.

### System-provided and user-created Categories

Categories may originate from a small system-provided starting set or be created
by the user. Both follow the same identity, assignment, and lifecycle semantics.
Origin does not establish an assignment's confidence or authority over user
decisions.

System-provided Categories may be renamed or archived locally. Later default
catalog changes must not silently replace user names or historical assignments.
No comprehensive starting taxonomy or catalog update mechanism is defined here.

### Rename and archive semantics

Renaming changes presentation while preserving identity and historical
associations. It must not disguise a change in economic meaning: a different
purpose should use a distinct Category rather than repurpose an existing one
and reinterpret history.

A Category is active or archived. Archiving removes it from routine future
assignment while preserving its identity and historical references; it must not
erase or reassign Transactions. Referenced Categories must not be destructively
deleted. Reactivation preserves identity, and historical corrections remain
possible without silently reactivating the Category.

### Income, expenses, and Transaction sign

Categories can describe income purposes, such as Salary or Interest, and spending
purposes, such as Groceries or Utilities. They do not impose a required sign on
their associated Transactions.

Positive and negative amounts describe Account balance increases and decreases.
A positive amount may be salary, a refund, reimbursement, transfer, interest, or
correction; a negative amount may be a purchase, fee, transfer, tax, or withdrawal.
Neither sign, including zero, establishes a Category or reporting treatment.
Economic meaning requires evidence or an explicit user decision beyond sign.

### Transfers

A confirmed internal transfer normally has no income/spending Category. Its
transfer meaning remains a separate Transaction distinction, outside Category;
no additional transfer model is introduced.

Exclusion from household income and spending follows that confirmed meaning,
not a category label or absence of one. Removing a Category does not confirm a
transfer, and recognizing a transfer must not silently erase a user-confirmed
assignment. Transfer fees remain distinct expenses that may be categorized.

### Refunds

A known purchase refund remains a separate positive Transaction that reverses
spending, rather than automatically becoming income. When its original purchase
relationship is established, the refund may use or reference that purchase's
Category, allowing the same purpose to describe both purchase and reversal.

The refund's assignment remains independently editable. Its link to a purchase
does not mandate inheritance or propagate later category corrections silently.
With no established purchase or category evidence, the refund may remain
uncategorized. No automatic refund matching or reporting/netting algorithm is
defined here.

### v0.1 hierarchy and split treatment

Categories are flat in v0.1; parent-child relationships and roll-up semantics are
deferred. The current model needs only direct Transaction assignments, without
parent assignment or hierarchy rules.

A Transaction has at most one established Category. Splitting its amount across
multiple Categories is deferred. Mixed purchases may use one explicitly chosen
Category or remain uncategorized; do not invent additional Transactions or
duplicate amounts to simulate split classification.

### Invariants

- Stable identity, a non-empty user-visible name, and active/archived status are required.
- v0.1 Transactions have zero or one established Category association.
- Unknown and tentative suggestions remain distinct from established assignments
  and user confirmation; no placeholder Category is required.
- User-confirmed decisions take precedence within their explicit scope.
- Assignment remains independent of Merchant identity/type, Transaction sign,
  and budget treatment.
- Rename, archive, and reactivation preserve identity and historical associations.
- Category corrections preserve financial facts and raw source evidence.
- Confirmed internal transfers remain neither income nor spending; known refunds
  retain their separate reversal meaning regardless of category assignment.

### Not handled yet

- Categorization algorithms, reusable rule models, confidence thresholds, or review UI.
- Split allocations, category hierarchy, or roll-up/reporting calculations.
- A complete default taxonomy, localized naming policy, or catalog migration scheme.
- Budget/BudgetCharacter, Member attribution, or other related domain models.
- Concrete APIs, persistence schemas, or assignment-history storage formats.

### Open questions

- What internal identifier format and system-origin metadata will be used?
- How will assignment evidence, confirmation, correction scope, and history be
  represented?
- What small default set and localized naming conventions should v0.1 provide?
- How will explicit historical corrections or refunds use archived Categories
  while preserving archive intent and user decisions?

## Household

Household is Ledgerase's local household-finance workspace: the context in which
Accounts, Transactions, Categories, merchant decisions, and later budgeting
decisions are managed together. It need not correspond to a legal family or a
physical household. It does not establish marriage, kinship, residence, tenancy,
tax status, or ownership rights.

### Identity and user-visible label

Each Household has a stable, unique internal identity and a required, non-empty
user-visible name or label. Renaming changes presentation, not identity, financial
history, or existing references. A label is not a legal name or address.

### v0.1 workspace and membership

An initialized v0.1 local data store contains exactly one Household. Its stable
identity remains meaningful independently of this initial cardinality. Household
switching and multiple-household participation are deferred.

A Household has zero or more Members; each Member belongs to exactly one
Household in v0.1. Setup and imports need not wait for named Members. The Household
remains valid with no Members or no active Members; do not fabricate a person to
satisfy membership or ownership. Members are added locally, without authentication
or invitations.

### Financial context and local decisions

Accounts belong to the Household, and their Transactions share that context
through the Account relationship. Local Category choices, merchant confirmations
and corrections, ownership choices, and later budgeting decisions are scoped to
this workspace. Membership does not grant software permissions or make decisions
global to a person, another household, or a remote merchant catalog.

Household does not impose a currency. Different Accounts retain their existing
currencies and Money invariants; membership does not convert amounts or permit
combined totals across currencies. A reporting/default currency is deferred.

### Account inclusion and ownership

Including an Account in the ledger means its finances are tracked in this context.
It does not prove legal ownership by any or every Member. An individually owned
account may still be included in the shared household-finance workspace.

Ownership associations record Ledgerase's financial understanding and reporting
context, rather than independently verified legal title:

| Association | Conceptual meaning |
| --- | --- |
| Individual | One explicitly associated Member. |
| Shared | An explicit set of at least two distinct Members, without assumed equal shares. |
| Household-level | Explicit treatment at workspace level, without asserting ownership by all Members. |
| Unknown | No established ownership association; uncertainty remains visible. |

Individual/shared Member references must belong to the Account's Household.
Household-level treatment is distinct from unknown ownership and does not require
a Member named "Household." Imported statements must not establish ownership
certainty without supporting evidence or a deliberate user decision; never assign
unknown ownership to the first Member by default. Legal ownership verification
and allocation of ownership shares are outside this definition.

### Invariants

- Stable internal identity and a non-empty user-visible label are required.
- An initialized v0.1 store has exactly one Household, with zero or more Members.
- Accounts, local financial decisions, and referenced Members share the same
  Household context; inclusion and ownership remain distinct.
- Individual/shared associations identify the stated Members; household-level
  and unknown associations do not invent Member identities.
- Rename and membership changes preserve financial history and existing identities.
- Household scope does not change Account currencies or monetary semantics.
- Membership establishes participation, not authentication or software permissions.

### Not handled yet

- Multiple-household stores, workspace switching, or cross-household profiles.
- Authentication, permissions, invitations, synchronization, or remote collaboration.
- Legal/physical household relationships, legal ownership verification, or ownership shares.
- Reporting currency, currency conversion, or whole-workspace deletion/archival.
- Budgets, related domain models, concrete APIs, or persistence schemas.

### Open questions

- What internal identifier format will Household and Member use?
- How will household scope be represented through direct or existing relationships?
- How will explicit ownership changes preserve their prior meaning over time?

## Member

Member is a local finance-domain identity for a person participating in a
Household's finances. It does not represent a login, cloud/device account, legal
relationship, or permission role. Participation alone implies neither ownership
of every included Account nor responsibility for every Transaction.

### Identity and display name

Each Member has a stable, unique internal identity, a required Household
relationship, and a required, non-empty user-visible display name. A familiar
name or nickname is sufficient; a legal name is not required.

Names need not be unique. Equal display names do not establish the same person.
Renaming preserves Member identity and all existing associations; it must not
merge people or reassign financial history.

### Membership lifecycle

Member status is active or archived. Active means available for current
finance participation and routine ownership choices; it is not an access role.
Archiving stops routine new selection while keeping the person identifiable in
existing and historical associations.

Leaving current household finances is represented by archival rather than
destructive deletion when references exist. Reactivation retains the same
identity. Archiving the last active Member does not remove the Household or
assign its Accounts to another person.

### Account ownership and Transaction attribution

A Member may have no Account ownership associations, be individually associated
with an Account, or participate in an explicitly shared association. Existing
associations may retain archived Members; archival does not automatically remove
them or change the Account's ownership meaning.

Account ownership does not establish who made a purchase, who benefited, whose
spending it should be, or whether it was shared spending. Transaction-to-Member
attribution is deferred for the initial v0.1 domain model. The later transaction
ownership feature in PLAN.md can introduce an explicit attribution concept when
needed; no attribution fields or allocation model are defined here.

### Historical preservation

Rename, departure, archival, and reactivation preserve Member identity and
historical Account, ownership, and any future Transaction or Budget references.
They do not erase Transactions or rewrite financial facts or user decisions.

Changing a current ownership association is a separate explicit decision; it
must not silently reinterpret historical ownership or infer past Transaction
attribution. How ownership history is represented remains open.

### Privacy and minimal personal data

Display names and local identities are sufficient for the core model. Do not
require email, username, password, external identity, addresses, birth dates, or
family relationship details.

Household labels, Member names, participation, and ownership information are
private financial context. Keep them local; do not assume they are suitable for
logs, analytics, publication, or external transmission.

### Invariants

- Stable identity, display name, Household relationship, and lifecycle status are required.
- Each Member belongs to the single local Household in v0.1.
- Names are presentation, not identity or proof of duplicate membership.
- Membership and lifecycle status imply neither legal ownership nor access permissions.
- Archived Members remain valid references in existing and historical associations.
- Member changes do not erase history, alter Money, or invent Transaction attribution.
- Unknown or household-level ownership does not require a synthetic Member.

### Not handled yet

- Transaction attribution, benefit/spending allocation, or ownership percentages.
- Authentication, permission roles, invitations, device identities, or cloud accounts.
- Family/legal relationships, global person profiles, or remote membership.
- Synchronization, detailed membership timelines, concrete APIs, or storage schemas.

### Open questions

- How will archival/reactivation and explicit ownership corrections retain history?
- How should archived Members appear during deliberate historical corrections
  without returning them to routine current selection?

## Import

Import represents one ingestion event in which Ledgerase attempts to interpret an
external financial source and incorporate its observations into the local
Household ledger. It is not the source artifact, a financial movement, or proof
that extracted data is correct. It does not define an importer or parser contract.

### Identity, Household, and timing

Each Import has a stable, unique internal identity and belongs to exactly one
Household. Its identity is independent of source artifact, Account, and Transaction
identities. Re-importing or deliberately reprocessing a source creates a new Import
and preserves the earlier attempt and its evidence.

Account associations and resulting Transactions must share the Import's Household
context. In v0.1, an Import concerns one source artifact. Creation, attempt, and
completion timing may explain ingestion history; these are distinct from source
statement periods and Transaction posting or transaction dates.

### Source artifact and parser provenance

Distinguish source kind, such as a bank statement or exported transaction data,
from format, such as PDF or CSV. Institution and format evidence may be incomplete
or unsupported; Import makes no CommBank-specific assumptions.

An optional original filename or display label helps identify the source to the
user but does not establish artifact identity. A content fingerprint/hash, with
its method identified when available, provides evidence of an exact source repeat.
Missing fingerprints remain explicit. Different bytes may still describe the same
movements; a fingerprint is not a general Transaction duplicate detector.

Retain the identity and version of the source adapter/parser that produced results
when used, so extraction can be explained after parsing behavior changes. Failed
format detection may have no identified parser; do not invent provenance.
Reprocessing retains earlier results and exposes conflicts rather than silently
replacing financial facts or user-confirmed decisions.

### Source Account evidence and matching

Source account/card identifiers, including masked identifiers, account labels,
institution information, and currency are matching evidence, not Ledgerase's
internal Account identity or proof of Member ownership. Preserve uncertainty and
distinguish candidate matches from a confirmed Account association.

A supported v0.1 single-account statement Import has zero or one confirmed Account
association: zero while unknown or ambiguous. No observation can become an
accepted canonical Transaction without its required, confirmed Account context
and compatible Account currency; do not guess an Account or perform implicit FX.

Multi-account sources are outside initial v0.1 support. Preserve their distinct
Account evidence and useful extraction with the limitation explicit; never combine
accounts or select the first to fit this restriction. Future observation-level
Account associations can extend support without redefining Import identity.

### Observations and canonical Transactions

An Import contributes zero or more source observations. Each observed record must
be traceable to its Import, source locator such as page/row/record position, original
extracted text and values, and any source-provided transaction identifier. Keep
reconstructed or inferred fields and their uncertainty distinct from direct
extraction. This establishes provenance requirements, not a SourceObservation model.

An observation may remain unresolved or contribute accepted evidence to a new or
existing canonical Transaction. Extraction does not automatically create a
Transaction. One Transaction may retain observations from multiple Imports;
confirmed repeat observations reuse its identity without another financial effect.
Imported evidence linked to a manual Transaction preserves its manual origin.

### Exact repeats, overlap, and duplicate boundaries

- The same PDF imported twice produces two Imports with evidence of the same
  artifact. A fingerprint match does not establish that either attempt parsed it
  correctly or authorize another financial effect.
- January and January-February statements are different artifacts with potentially
  overlapping movements. Confirmed overlaps retain both Imports' provenance and
  reuse existing Transaction identities.
- Two purchases with the same Account, date, amount, and Merchant may be distinct
  movements. Similar fields provide duplicate candidates, not proof of identity.

Source repetition and Transaction duplication remain separate decisions. Ambiguous
matches stay explicit for review; do not silently merge, delete, or incorporate
them as certain new movements. Parser version changes do not establish a new
financial movement or authorize overwriting prior evidence.

### Processing, incorporation, and review

Processing state distinguishes pending, processing, completed, and failed attempts.
Completed means processing ended normally, not that every record was interpreted,
incorporated, or financially verified. Partial coverage is recorded separately.

Keep the following independently distinguishable:

- Direct extraction versus reconstructed, uncertain, unsupported, or failed fields
  and records.
- Unknown/candidate versus confirmed Account association.
- Unresolved duplicate candidates versus confirmed repeat or distinct movements.
- Reconciliation not checked, unavailable/insufficient evidence, passed, or failed,
  with the checked scope and reasons.
- Observations accepted into new Transactions, linked to existing Transactions,
  or not yet accepted; and outstanding reasons for user review.

Processing completion, incorporation, and a passed balance check must not hide
uncertainty elsewhere. "Imported" never implies complete financial certainty.

### Source periods and balance evidence

Preserve a supplied statement period/date range separately from observed record
coverage. Missing periods, gaps, and incomplete coverage remain explicit; the
earliest and latest extracted dates do not prove a complete source period.

Supplied opening, running, and closing balances remain source evidence associated
with the Import and observations. Retain original notation, currency, relevant
date/source position, and any canonical interpretation or reconstruction. Normalize
source liability notation only with established meaning, preserving the original.

Validated source balances may contribute to Account balance evidence. An imported
closing balance does not automatically become a verified current Account balance.
Missing balance evidence is unknown, not zero.

### Reconciliation and verification

Where sufficient evidence exists, checks can validate:

```text
previous balance + Transaction amount = resulting balance
opening balance + canonical posted movements = closing balance
```

Use canonical Account signs, Money invariants, and the movements within the checked
source scope. Include movements already represented by earlier Imports, not only
newly created Transactions; count each covered movement once for that scope rather
than adding another ledger effect for each observation.

A pass establishes balance agreement only within its evidenced scope. It does not
prove Account matching, completeness beyond that scope, absence of duplicates,
every reconstructed field, or completion of review. Unavailable checks are not
passes. Failures preserve evidence, identify affected scope/records for review,
and remain explicit. Never change amounts, signs, dates, or balances merely to force
reconciliation. No reconciliation algorithm is defined here.

### Partial and failed attempts

An Import may retain usable accepted observations alongside uncertain, unsupported,
or failed records. Do not discard all useful extraction because one record fails,
or present partial results as fully verified. Acceptance must satisfy existing
Transaction invariants and retain relevant verification limitations and review
requirements; processing completion alone is insufficient.

A failed attempt retains available source metadata, observations, and diagnostic
reasons. Failure does not imply nothing was extracted or previously accepted.
A later retry/reprocessing event preserves earlier provenance and does not erase
accepted Transactions. Retry infrastructure and rollback policy are not defined here.

### Retention and privacy

Keeping the original PDF/CSV is optional and local, subject to an explicit retention
choice. Distinguish a retained artifact from one discarded or unavailable. Canonical
records must remain usable without it: preserve explanatory source metadata,
fingerprint when available, record locators, original descriptions/extracted values,
reconstruction evidence, and uncertainty. A fingerprint alone is insufficient.
Discarding the artifact must not discard Transaction provenance; reprocessing the
original requires access to it again.

Treat source files, filenames, local locations, fingerprints, Account evidence,
balances, descriptions, and diagnostics as sensitive local financial data. Keep
them out of ordinary logs, analytics, public fixture filenames, and external
services. Real user sources remain private and outside the repository; synthetic
development fixtures are separate from user Import records.

### Invariants

- Stable Import identity and one Household context are required.
- Attempt identity, source artifact evidence, and financial movement identity remain
  distinct; repeat ingestion does not create another effect for a confirmed movement.
- Accepted Transactions retain their existing Account, date, Money, and identity
  invariants; unresolved observations need not become Transactions.
- Account/Transaction associations cannot silently cross Household boundaries.
- Original evidence survives normalization, reconstruction, duplicate resolution,
  and optional raw artifact disposal.
- Processing, acceptance, uncertainty, Account confirmation, duplicate resolution,
  reconciliation, and review remain distinguishable.
- Partial and failed attempts preserve available evidence and explicit limitations;
  reconciliation is evidence, never permission to repair financial values.

### Not handled yet

- Importer interfaces, parser classes, bank-specific formats, or matching algorithms.
- Duplicate detection/reconciliation algorithms or a full SourceObservation model.
- Receipt ingestion and OCR, budgeting logic, or other processing pipelines.
- Multi-account source processing, retry infrastructure, or concrete rollback policy.
- Database schemas, retention UI, cloud storage, synchronization, or remote processing.

### Open questions

- What identifier and fingerprint methods will be used, and how will unavailable
  artifact identity be represented?
- How will processing coverage, check scopes, acceptance, and review reasons be
  represented without collapsing them into one status?
- What explicit review/acceptance policy should apply to partial or unreconciled data?
- What local raw-source retention default should v0.1 offer, and how will parser
  conflicts and deliberate corrections retain their history?

## Receipt

Receipt is Ledgerase's canonical structured record of one receipt or purchase/refund
document within a Household. It is evidence describing a commercial event, not an
Account-affecting Transaction, payment, or global product catalog. A cash receipt,
a receipt captured before card posting, or an unmatched document remains useful.

### Identity and Household scope

Each Receipt has a stable, unique internal identity and belongs to exactly one
Household. Identity is independent of source files, extraction attempts, document
numbers, and Transaction identity. ReceiptItems inherit this context through their
parent. Merchant and Transaction links must stay within the same Household context.

### Source artifacts, extraction, and provenance

One Receipt may have multiple source artifacts: photos, front/back images, pages,
or other representations of the same document. Preserve their source order and locators;
Receipt identity is not one image's identity.

Distinguish source artifacts, OCR/extraction evidence, and interpreted canonical
fields. OCR text is evidence, not established financial facts. Retain artifact/page/
position references, original extracted text and values, the OCR/extractor/parser
identity and version when used, and inferred/reconstructed fields with uncertainty.
No OCRRun model or concrete processing pipeline is defined here.

Re-running extraction or changing an engine adds traceable evidence; it does not
automatically create another Receipt or commercial event, recreate established
items, or overwrite user corrections. Receipt ingestion remains separate from the
statement Import boundary; no required Import relationship is introduced.

### Merchant evidence and date/time

Raw merchant names, addresses, and descriptor variants remain evidence separate
from normalized text and canonical Merchant identity. In v0.1, a Receipt has zero
or one established Merchant relationship. Weak candidates remain unresolved or
tentative; resolution never replaces raw evidence or inherently assigns Category.

Receipt date/time describes the commercial event shown on the document, not
capture time, extraction time, or Transaction posting date. Date, time, and timezone
may be absent or ambiguous; retain the available precision and uncertainty rather
than inventing midnight, a timezone, or a complete timestamp. Such evidence may
later support matching or Transaction date evidence, but never silently replaces
a Transaction's posting date.

### Currency and evidenced monetary fields

v0.1 uses one established currency per Receipt, shared by all accepted Receipt and
ReceiptItem Money fields. Currency may remain unresolved while source text is
preserved; "$" does not establish AUD. Accepted monetary fields require explicit
currency and all Money safe-integer invariants. True multi-currency receipts are
deferred; conflicting currency evidence requires review, not implicit conversion.

Subtotal, tax, tip, fees, discounts, deposits, rounding/loyalty adjustments, and
grand total are optional evidenced receipt-level components. Missing is unknown,
not zero. Preserve their labels, numeric signs, and whether they are additional,
reducing, or already included in another amount; unresolved roles remain explicit.
Payment method, card suffix, tender, change, or gift-card payment may be retained
as matching evidence, without Payment/Tender or ReceiptAdjustment models.

### Monetary signs and document kind

Receipt amounts describe the document's monetary presentation and component
meaning, not changes to an Account balance. Interpreted Money preserves evidenced
numeric signs, including explicit negative values and zero. Do not negate or take
absolute values merely to imitate a linked Transaction or force a total formula.

A purchase total of AUD 42.50 is 4250 minor units even when its linked card
Transaction is -4250. A refund document may show a positive refund magnitude or
an explicitly negative credit; preserve that presentation. Purchase, refund/return,
or unresolved document kind requires separate evidence, not sign alone. A refund
Receipt is not automatically income or a newly created refund Transaction.

A source-labelled positive discount can reduce the payable total without changing
its recorded sign. An already signed reduction must not be subtracted twice.
Component roles and inclusion evidence govern arithmetic interpretation.

### Transaction linking

A Receipt has zero or one established linked Transaction in v0.1. Candidate links
remain distinguishable from established links and user confirmation. A Receipt
may remain unmatched without losing its identity or useful evidence; it need not
supply an Account or create a Transaction to be retained.

A Transaction may have multiple Receipt evidence links. This does not create
additional financial effects, prove the documents are distinct, or allocate the
payment among them. Linking multiple Transactions to one Receipt, split tender,
multiple charges, and partial-refund allocations remain deferred; preserve such
source evidence and incomplete linkage rather than forcing a complete match.

Merchant, event date/time, total, and payment details may support a link but are
not proof by themselves. A link preserves both identities and must not change
Transaction amount, Account, posting date, source provenance, or user-confirmed
Merchant/Category merely to improve agreement. Conflicting amounts, dates,
Merchants, or currencies remain explicit for review; do not guess an exchange
rate or propagate Receipt corrections into Transaction facts or classifications.

### Duplicate artifacts and documents

A fingerprint may help recognize identical artifact bytes but does not define
Receipt identity. Two photos of the same physical document may have different
fingerprints; two documents with the same Merchant/date/total may be legitimate.

Confirmed repeated capture of the same document can reuse Receipt identity while
preserving all relevant extraction provenance. Similar fields establish duplicate
candidates only. Keep uncertainty visible and avoid silent merging, deletion, or
creation of another financial effect. No duplicate-matching algorithm is defined.

### Partial interpretation and correction precedence

A Receipt may have zero or more ReceiptItems, with no established Merchant, date,
currency, total, or Transaction link. Retain useful evidence without manufacturing
missing fields. A total-only extraction does not imply complete item coverage.

Keep extraction/interpretation progress and coverage, field uncertainty, arithmetic
validation, Merchant resolution, Transaction linkage, and user review/confirmation
distinguishable. Completed extraction or one passed check does not mean the entire
Receipt is verified. Failed or partial extraction preserves usable evidence.

Users may deliberately correct Merchant, date/time, total, and item fields.
Preserve original source/OCR values separately from interpreted and corrected
values, with their origin and confirmation. Confidence applies to the field or
association, not blanket certainty about the document. Later automatic extraction
must not silently override user corrections; conflicts require review. Corrections
apply within their explicit scope and do not create universal merchant/category
rules or automatically change linked Transaction decisions.

### Arithmetic validation

Validate only relationships supported by available evidence: item line amounts,
subtotal, explicit discounts/adjustments, taxes, tips/fees, and grand total.
Do not assume item sums equal the total. Included tax must not be added again,
nor embedded discounts applied twice. Tender/change and payment lines, subtotal
lines, and tax summaries must not automatically become merchandise ReceiptItems.

Missing components or unknown roles make a full check unavailable or partial;
an independently supported subtotal check may still agree. Record checked scope,
coverage, agreement/mismatch, and limitations separately. Where source rounding
is evidenced, preserve it; do not invent adjustments or tolerances to force a pass.
All monetary arithmetic must preserve Money's exactness and overflow rules.

A mismatch may reflect OCR errors, missed lines, unsupported layouts, adjustments,
or unusual source formatting. Preserve evidence and review reasons; never alter
extracted monetary values merely to reconcile. Agreement establishes only that
check's arithmetic, not Merchant identity, OCR accuracy, date, Transaction linkage,
or completion of user review.

### Retention and privacy

Original images/files remain local by default; retention or disposal follows a
local user choice. Preserve artifact metadata/fingerprints when available, source
locators, extractor provenance, original extracted text/values, reconstructed
fields, uncertainty, and corrections even when artifacts are discarded. Structured
Receipt data must not depend on permanent raw-file retention; a hash alone is not
explanatory provenance. Re-extraction requires access to the source again.

Receipt/OCR evidence may reveal card fragments, loyalty/member or order IDs,
names, addresses, phone/tax identifiers, location, and health-related purchases.
Treat all such content as sensitive local financial data. Keep it out of ordinary
logs, analytics, public fixtures, and external services. Development fixtures are
synthetic or fully anonymized; real household images/OCR are not repository data.

### Invariants

- Stable identity and exactly one Household are required; missing interpreted
  fields or items do not invalidate useful evidence.
- Receipt, artifacts/extraction, and linked Transactions have independent identities.
- Established monetary fields obey Money and share the one Receipt currency in v0.1.
- Receipt signs and document kind remain independent of Account balance-change signs.
- v0.1 Merchant and Transaction relationships are each optional and at most one;
  links preserve Household scope and Transaction facts and confirmed decisions.
- Original evidence, uncertainty, and deliberate corrections survive re-extraction
  and optional artifact disposal; unknown values are never fabricated.
- Extraction, validation, resolution, linkage, and user confirmation remain distinct.

### Not handled yet

- OCR APIs/runs, image processing, receipt parsing, duplicate or matching algorithms.
- ReceiptAdjustment, Payment/Tender, Product/catalog, or Budget models.
- Multi-currency documents, split tender, payment allocation, or refund matching.
- Categorization, transaction splits, tax accounting, or inventory management.
- Correction-history schemas, database schemas, retention UI, or remote processing.

### Open questions

- What identifier, artifact fingerprint, and extraction-history representations
  will preserve document identity across repeat captures and reprocessing?
- How will component roles, field evidence, check scopes, confirmation, and conflicts
  be represented without an overloaded status?
- What local retention defaults and review policy should apply to partial or
  arithmetically inconsistent documents and proposed Transaction links?

## ReceiptItem

ReceiptItem is one structured purchased/returned line item within a Receipt.
It records what that document says, not a canonical Product or financial movement.
Its meaning and Household context depend on its parent Receipt.

### Identity, parent, and ordering

Each ReceiptItem has a stable identity unique within exactly one parent Receipt,
sufficient for corrections and future references. Source line number, description,
SKU, and amount are not identity keys. Reordering display or re-running extraction
must not silently merge, recreate, or reidentify established items.

Preserve source sequence and artifact/page/line/region positions where available,
separately from display order. Missing or ambiguous positions remain explicit;
do not invent precise geometry or silently discard unreadable lines.

### Raw evidence and description

Retain raw source/OCR text, values, locators, extractor provenance, and reconstruction
or uncertainty evidence. A user-visible, normalized, or corrected description is
separate from the original. Descriptions may be absent or unreadable; equal text
does not establish the same item, product, or identity.

Useful partial lines such as "BANANAS" or "BANANAS 1.240kg" may be retained without
a price. Do not invent missing fields to make an item look complete.

### Optional quantity, prices, and source identifiers

Quantity is an optional exact count or measure with its evidenced unit/pricing
basis, such as count or kilograms. It is not Money. Preserve decimal quantity text,
units, and ambiguity; do not casually assume binary floating-point accuracy.
Its concrete numeric representation remains open.

Unit price and line amount/total are independently optional Money fields when
established, using the Receipt currency and all Money invariants. Missing amounts
are unknown, not zero; missing quantity is not one. A source unit price finer than
currency minor units stays in provenance rather than being silently rounded into
Money. Preserve directly evidenced line totals, including negative return lines,
rather than replacing them with quantity multiplied by price.

Quantity/price checks require established units, pricing basis, adjustments, and
any evidenced rounding. An unavailable check does not invalidate a directly
evidenced line amount. No quantity arithmetic or rounding policy is defined here.

An optional SKU/product code or source item identifier is contextual source
metadata, not a global product identity or the ReceiptItem's internal identity.
No Product, Inventory, or catalog relationship is introduced.

### Uncertainty, corrections, and other relationships

Description, quantity, unit price, and line amount may each remain unresolved or
have different confidence/confirmation. User corrections preserve original evidence
and item identity; later automatic interpretation must not silently replace them.
Receipt validation does not confirm every item field. Correcting or removing a
spurious interpreted line must preserve its evidence and correction traceability,
not silently destroy source history.

The parent Receipt supplies optional Merchant context; v0.1 introduces no separate
ReceiptItem Merchant or Category assignment. Items may later provide evidence for
category suggestions or splits, but do not inherently classify a Transaction,
override confirmed Merchant/Category decisions, or bypass v0.1's single Category
and deferred split boundaries. Item provenance shares the Receipt's privacy rules.

### Invariants

- Stable identity within one parent Receipt is required; Household context is inherited.
- Source ordering/positions and raw evidence remain distinct from identity and display.
- Descriptions, quantities, prices, line amounts, and source codes may be unresolved.
- Accepted monetary fields match Receipt currency and obey Money; quantities remain
  separate exact count/measure evidence.
- Reordering, re-extraction, and correction preserve identity, source evidence,
  and deliberate user decisions.
- Item text or codes establish neither global Product identity nor Category.
- ReceiptItem creation or correction does not itself create a financial movement.

### Not handled yet

- Product/catalog identities, inventory, or item-level Merchant/Category assignment.
- Categorization, transaction splits, quantity arithmetic, or rounding policies.
- Extraction algorithms, concrete numeric types, APIs, or persistence schemas.

### Open questions

- What item identifier and correspondence evidence will preserve identity across
  re-extraction, reordered lines, and corrections to spurious or missing items?
- What exact quantity/unit representation and future sub-minor-unit price support
  are needed, without changing current Money semantics?
- How will item corrections and removal from the interpreted result preserve history?
