# Ledgerase Domain Model

This document currently defines Money, Transaction, Account, Merchant, Category,
Household, and Member.

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
