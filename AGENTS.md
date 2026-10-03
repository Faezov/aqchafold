# AqchaFold Agent Instructions

AqchaFold is the development codename for **Ledgerase**, an open-source,
local-first personal and household finance application.

These instructions apply to the entire repository unless a more specific
`AGENTS.md` exists deeper in the directory tree.

---

## 1. Naming

- Repository / development codename: **AqchaFold**
- Public product name: **Ledgerase**
- User-facing text must use **Ledgerase**.
- `AqchaFold` may refer to the internal parsing, normalization, enrichment,
  and financial-data understanding engine.
- Do not rename the project, product, packages, or public identifiers without
  explicit approval.

---

## 2. Project goal

Ledgerase should help individuals and households understand their finances
without requiring them to surrender their raw financial data to a cloud service.

The initial product should be able to:

1. import bank statements,
2. parse them into canonical transactions,
3. verify that imported statements reconcile,
4. normalize and identify merchants,
5. categorize transactions,
6. allow users to review and correct classifications,
7. learn from those corrections,
8. show useful spending and budget views,
9. capture receipts,
10. extract structured information from receipt images.

The first supported bank is CommBank.

The architecture must make additional banks, countries, currencies, and receipt
formats possible without rewriting the core finance logic.

---

## 3. Product principles

Prefer:

- correctness over cleverness,
- explicit behavior over hidden heuristics,
- deterministic logic over unnecessary AI,
- local processing over external processing,
- user control over automatic decisions,
- small reviewable changes over large implementations,
- simple architecture over speculative infrastructure.

The goal is a product that gets installed and used, not an unnecessarily
complex software platform.

---

## 4. Architecture boundaries

### Mobile application

`apps/mobile` is the presentation and platform-integration layer.

It may contain:

- screens,
- navigation,
- UI components,
- mobile permissions,
- document picking,
- camera integration,
- platform adapters.

It must not contain core financial business logic.

React components must not directly implement:

- bank statement parsing,
- transaction reconciliation,
- merchant classification,
- budgeting algorithms,
- receipt interpretation.

### Packages

Reusable business logic belongs under `packages/`.

Expected areas include:

```text
packages/
├── domain/
├── database/
├── importers/
├── merchants/
├── receipts/
├── budgeting/
├── localization/
└── shared/
```

Do not create new packages simply because a future feature might need them.

Create abstractions only when the current implementation benefits from them.

---

## 5. Canonical data boundary

All ingestion methods must eventually produce the same canonical domain objects.

Examples of ingestion sources:

```text
CommBank PDF ───────┐
Bank CSV ───────────┤
Receipt image ──────┼──> Canonical transaction model
Manual entry ───────┤
Future bank API ────┘
```

Finance logic must operate on canonical transactions rather than bank-specific
or OCR-specific structures.

Bank-specific details must not leak into budgeting or UI logic.

---

## 6. Bank importers

Each bank parser must implement the shared importer contract.

Bank-specific code belongs under:

```text
packages/importers/<bank>/
```

For example:

```text
packages/importers/commbank/
```

A bank importer should be responsible for:

- detecting supported statement formats,
- extracting transaction data,
- preserving source provenance,
- determining statement metadata,
- identifying debit and credit amounts,
- calculating or extracting balances,
- reporting parsing uncertainty,
- reconciling the resulting statement.

Do not put CommBank-specific assumptions into shared importer code unless the
behavior is genuinely universal.

---

## 7. Statement reconciliation

Financial imports must be validated whenever sufficient statement information
exists.

For statements containing running balances, verify the relationship between:

```text
previous balance
+ transaction amount
= resulting balance
```

Where opening and closing balances are available, verify the entire imported
statement.

Never silently accept reconciliation failures.

If reconciliation fails:

- preserve the extracted data,
- report the failure clearly,
- mark affected records for review,
- avoid presenting the import as fully verified.

Do not modify financial values merely to force reconciliation.

---

## 8. Financial correctness

### Money

Never use floating-point numbers to represent monetary values.

Use integer minor units plus currency.

Example:

```text
AUD 12.34
```

should be represented conceptually as:

```text
amountMinor = 1234
currency = "AUD"
```

Do not rely on JavaScript floating-point arithmetic for financial calculations.

### Signs

The domain model must define a consistent convention for income and expenses.

Do not introduce multiple sign conventions across importers.

Source-specific debit/credit representations should be converted at the
ingestion boundary.

### Currency

Do not assume all transactions are AUD.

Currency must be represented explicitly where relevant.

Australian support is first, not exclusive.

### Provenance

Preserve enough source information to understand where a transaction came from.

At minimum, imported transactions should retain the original raw transaction
description or a reference to equivalent provenance data.

Never overwrite raw source information with normalized values.

---

## 9. Merchant resolution

Merchant identity and spending category are separate concepts.

Conceptually:

```text
raw bank description
        ↓
normalized description
        ↓
canonical merchant
        ↓
merchant type
        ↓
category
        ↓
budget character
```

For example:

```text
SQ *KAHII Sydney NS AUS
        ↓
KAHII
        ↓
Kahii
        ↓
Cafe
        ↓
Dining & Coffee
        ↓
Discretionary
```

Do not collapse these stages into one opaque string-matching function.

### Merchant precedence

Merchant resolution should prefer, in order:

1. user-confirmed rules,
2. known persistent merchant rules,
3. strong deterministic merchant matches,
4. heuristic suggestions,
5. unknown / needs review.

User-confirmed classifications always override automatic suggestions.

Do not silently replace a confirmed user decision with a later heuristic.

### Unknown merchants

Do not force every merchant into a category.

If there is insufficient evidence:

```text
merchant = unresolved
category = unknown
needsReview = true
```

is preferable to a confident-looking incorrect result.

Review queues should prioritize financially meaningful unknown merchants rather
than requiring users to classify every trivial transaction.

---

## 10. Receipt processing

Receipt processing is a separate ingestion pipeline.

Conceptually:

```text
image
  ↓
image preparation
  ↓
OCR
  ↓
recognized text + positions
  ↓
receipt interpretation
  ↓
structured receipt
  ↓
canonical finance data
```

OCR and receipt interpretation are different responsibilities.

OCR recognizes text.

Receipt interpretation determines concepts such as:

- merchant,
- purchase date,
- total,
- tax,
- payment method,
- line items.

Do not treat raw OCR text as trusted structured financial data.

### Receipt validation

Where possible, validate extracted receipt values.

For example:

```text
sum(line items) ≈ receipt total
```

Allow for taxes, discounts, rounding, deposits, tips, or other legitimate
differences.

Uncertain receipt fields should be exposed for user review rather than silently
accepted.

---

## 11. OCR abstraction

Receipt OCR must sit behind a platform abstraction.

Core receipt logic must not depend directly on a particular OCR vendor.

Platform-specific implementations may later use technologies such as:

- Apple Vision,
- Google ML Kit,
- another local OCR engine.

The rest of the application should consume a common OCR result structure.

---

## 12. Local-first architecture

Ledgerase is local-first.

For v0.1:

- use local storage,
- use SQLite for application data,
- do not require an account,
- do not require a backend,
- do not introduce cloud synchronization.

A backend may be introduced later only through an explicit architecture decision.

Do not add:

- Supabase,
- Firebase,
- authentication infrastructure,
- remote databases,
- telemetry services,
- cloud document processing,

unless explicitly requested and documented.

---

## 13. Privacy

Financial information is highly sensitive.

Do not log:

- raw bank statement contents,
- raw receipt contents,
- account numbers,
- card numbers,
- addresses,
- personally identifying financial information,
- full transaction histories.

Do not transmit financial data externally without explicit architecture and UI
support.

Raw bank statements and receipt images should remain local by default.

Prefer derived structured data over retaining raw documents when practical,
while allowing users to explicitly choose retention behavior.

Never commit real user financial data to the repository.

---

## 14. Fixtures

Use anonymized or synthetic fixtures for development and tests.

Expected structure:

```text
fixtures/
├── bank-statements/
│   └── commbank/
└── receipts/
```

A parser fixture should ideally include:

```text
input
expected structured output
```

Private local fixtures must not be committed.

Use `.gitignore` where necessary for directories such as:

```text
fixtures/private/
```

Never create sanitized fixtures by merely masking a few account digits while
leaving other personally identifying transaction information intact.

---

## 15. Testing

Every bank parser change requires test coverage.

Every parser bug fix should receive a regression test when practical.

Tests should verify meaningful behavior, including:

- transaction count,
- dates,
- amounts,
- descriptions,
- opening balance,
- closing balance,
- reconciliation,
- malformed input handling.

Avoid tests that merely reproduce implementation details.

Merchant matching tests should cover:

- normalization,
- precedence,
- confirmed user overrides,
- ambiguous matches,
- unknown merchants.

Financial calculations should include edge cases involving:

- negative amounts,
- refunds,
- transfers,
- zero values,
- multiple currencies where relevant,
- rounding boundaries.

---

## 16. Development workflow

This project is developed incrementally and optimized for human review.

### One conceptual change at a time

Each implementation task should represent one understandable conceptual change.

Examples of good task scope:

```text
Define Money type
```

```text
Add Transaction domain model
```

```text
Implement CommBank browser-statement detection
```

```text
Add merchant normalization for Square descriptors
```

Examples of poor task scope:

```text
Build the whole finance engine
```

```text
Implement transactions, database, repository, UI and importer
```

### Keep changes small

Prefer:

- the smallest implementation satisfying the current task,
- fewer than roughly 5 modified files when practical,
- fewer than roughly 200 changed lines per iteration when practical.

These are guidelines, not absolute limits.

If a task genuinely requires a larger change, explain why before implementing it.

### Do not expand scope

Do not:

- implement adjacent features unless explicitly requested,
- perform opportunistic refactors,
- redesign unrelated existing code,
- add speculative infrastructure,
- add abstractions solely for hypothetical future needs,
- automatically proceed to the next logical feature.

When the requested task is complete, stop.

---

## 17. Before coding

For non-trivial work, first provide a short implementation plan.

State:

1. what will change,
2. which files will be created or modified,
3. any important design decisions,
4. any ambiguity that affects implementation,
5. what tests will be added or updated.

Do not modify architecture without explicit approval.

If the task is narrow and unambiguous, avoid unnecessary planning ceremony.

---

## 18. After coding

After completing a task, report:

- files changed,
- what was implemented,
- tests added,
- tests run,
- whether they passed,
- unresolved questions,
- any known limitations,
- the next smallest logical step.

Do not automatically implement that next step.

---

## 19. Existing code

Read relevant existing code before modifying it.

Prefer extending established repository patterns over creating parallel systems.

Do not rewrite working code merely because another implementation appears
cleaner.

Preserve existing behavior unless the requested change intentionally modifies it.

If existing code conflicts with architecture documentation, call out the
conflict rather than silently choosing one.

---

## 20. Dependencies

Avoid unnecessary dependencies.

Before introducing a new runtime dependency:

1. explain what problem it solves,
2. check whether the repository already has a suitable solution,
3. prefer small, maintained, well-understood packages,
4. consider privacy and platform implications,
5. avoid dependencies for trivial functionality.

Do not add a major framework or service without explicit approval.

Development-only dependencies may still require explanation if they materially
change the toolchain.

---

## 21. Code quality

Prefer code that is:

- explicit,
- readable,
- typed,
- testable,
- deterministic.

Avoid:

- clever abstractions,
- deeply nested generic types,
- unnecessary metaprogramming,
- large functions with multiple responsibilities,
- duplicated financial logic,
- hidden global state.

Public package APIs should be deliberate.

Keep platform-specific code isolated from portable domain logic.

---

## 22. Error handling

Errors involving financial correctness should be explicit.

Do not silently recover from conditions that could alter financial meaning.

Examples requiring explicit treatment:

- statement reconciliation failure,
- malformed monetary value,
- unsupported statement layout,
- duplicate import uncertainty,
- ambiguous merchant rule precedence,
- corrupted database migration.

User-facing errors should explain what happened without exposing sensitive raw
financial data.

---

## 23. Documentation

High-level architecture belongs in:

```text
ARCHITECTURE.md
```

Detailed architecture documentation belongs under:

```text
docs/architecture/
```

Examples:

```text
docs/architecture/
├── DOMAIN_MODEL.md
├── IMPORT_PIPELINE.md
├── MERCHANT_RESOLUTION.md
└── RECEIPT_PIPELINE.md
```

Important architectural decisions belong under:

```text
docs/adr/
```

Use ADRs for decisions with meaningful long-term consequences.

Do not create ADRs for trivial implementation details.

---

## 24. Architecture changes

An implementation should not silently change established architecture.

If a change would alter a major architectural decision, first explain:

- the existing design,
- why it is insufficient,
- the proposed change,
- benefits,
- costs,
- migration implications.

Wait for approval before making the architecture change.

---

## 25. Database changes

Database schema changes must be deliberate.

Do not edit existing migrations after they have become part of normal development
history unless explicitly instructed.

Prefer forward migrations.

Schema design must follow the canonical domain model rather than mirror the
shape of one bank's input format.

Bank-specific fields should not dominate generic transaction storage.

---

## 26. Localization

Do not assume:

- Australia is the only country,
- AUD is the only currency,
- English is the only language,
- CommBank is the only financial institution,
- Australian date formats are universal.

Australia is the first supported locale.

Localization concerns should remain separate from core financial logic where
practical.

---

## 27. Security

Treat financial inputs as untrusted data.

Be cautious when handling:

- PDFs,
- images,
- imported CSV files,
- filenames,
- OCR output,
- external merchant metadata.

Do not execute content derived from imported financial documents.

Avoid dynamically evaluating imported text.

Do not expose secrets or private paths through logs or error messages.

---

## 28. Git discipline

Keep changes easy to review and revert.

Prefer commits representing one conceptual change.

Before declaring a task complete, inspect:

```bash
git status
git diff
```

Do not commit:

- generated build artifacts unless required,
- private financial documents,
- secrets,
- credentials,
- temporary debug output,
- unrelated changes.

Do not rewrite unrelated git history.

---

## 29. v0.1 scope

For v0.1, prefer the smallest implementation that allows a household to:

1. create a local household,
2. import a CommBank statement,
3. parse it into canonical transactions,
4. verify statement reconciliation,
5. resolve known merchants,
6. review uncertain merchant classifications,
7. remember user corrections,
8. inspect spending by useful categories,
9. define a basic budget,
10. capture a receipt,
11. extract useful receipt information.

Do not expand v0.1 into:

- investment tracking,
- tax preparation,
- lending,
- credit scoring,
- automated financial advice,
- bank API integrations,
- cryptocurrency tracking,
- complex forecasting,
- social features,
- cloud synchronization,

unless the project scope is explicitly changed.

---

## 30. Definition of done

A task is not complete merely because code was generated.

A change is done when:

- it satisfies the requested scope,
- relevant tests pass,
- financial invariants remain valid,
- privacy constraints are respected,
- architecture boundaries are preserved,
- no unrelated changes were introduced,
- the diff is understandable to a human reviewer.

When those conditions are met, stop and report the result.
