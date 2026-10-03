# AqchaFold / Ledgerase Architecture

## 1. Purpose

Ledgerase is a local-first personal and household finance application for Android and iOS.

The first real users are a household importing bank statements and receipts, reviewing ambiguous merchants, and understanding monthly spending. The architecture should make that simple now while leaving room for additional banks, countries, sync, and community-contributed parsers later.

The core principle is:

> **Every input source becomes the same canonical financial model before the UI, budgeting, or reporting layers see it.**

The app should never make UI components understand CommBank PDFs, receipt OCR formats, or bank-specific quirks.

---

## 2. High-level system

```
 Bank PDF / CSV      Receipt photo       Manual entry
       │                  │                   │
       ▼                  ▼                   ▼
 Bank importer       OCR + parser        Input adapter
       │                  │                   │
       └──────────────┬───┴───────────────────┘
                      ▼
              Canonical domain model
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
      Merchant     Category      Validation /
      resolver      engine       reconciliation
          │           │            │
          └───────────┴──────┬─────┘
                             ▼
                         SQLite
                             │
                  ┌──────────┼──────────┐
                  ▼          ▼          ▼
               Budget      Review     Reports /
               engine      queues     dashboards
                             │
                             ▼
                        Mobile UI
```

---

## 3. Architectural boundaries

### `apps/mobile`

The React Native / Expo application.

Responsibilities:

- screens and navigation
- device file/image pickers
- camera integration
- permissions
- platform adapters
- presentation state

Must **not** contain bank-specific parsing logic, merchant categorization rules, or accounting calculations.

---

### `packages/domain`

The canonical business model.

Responsibilities:

- transaction types
- accounts
- households
- merchants
- categories
- imports
- receipts
- budgets
- money / currency primitives
- business invariants

This package should be platform-independent TypeScript and have no dependency on React Native.

---

### `packages/database`

Persistence for canonical domain data.

Responsibilities:

- SQLite schema
- Drizzle models
- migrations
- repositories / queries
- transaction-safe writes

Raw bank- or receipt-specific structures should not leak into the core database schema unless they are stored explicitly as import metadata.

---

### `packages/importers`

Bank and statement ingestion.

```text
packages/importers/
├── core/
│   ├── importer.ts
│   ├── registry.ts
│   ├── detection.ts
│   ├── reconciliation.ts
│   └── types.ts
└── commbank/
    ├── browser-summary.ts
    ├── classic-statement.ts
    ├── normalize.ts
    └── tests/
```

Each bank-specific parser implements a common interface.

Example concept:

```ts
interface StatementImporter {
  id: string;
  detect(input: DocumentInput): Promise<number>;
  parse(input: DocumentInput): Promise<ParsedStatement>;
}
```

The importer registry chooses the best parser based on document structure rather than filename.

CommBank is the first implementation, not a special case in the application architecture.

---

### `packages/merchants`

Merchant identity and enrichment.

Pipeline:

```text
raw bank description
      ↓
normalization
      ↓
canonical merchant candidate
      ↓
user-confirmed rules
      ↓
known merchant rules
      ↓
heuristic suggestion
      ↓
review queue if unresolved
```

Important rule:

> **User-confirmed merchant decisions always override automatic classification.**

Merchant identity and spending category are separate concepts.

Example:

```text
Raw:          SQ *KAHII Sydney NS AUS
Normalized:   KAHII
Merchant:     Kahii
Merchant type:Cafe
Category:     Dining & Coffee
Character:    Discretionary
```

---

### `packages/receipts`

Receipt ingestion and parsing.

Pipeline:

```text
photo
 ↓
image preprocessing
 ↓
OCR adapter
 ↓
OCR document with text + geometry
 ↓
receipt parser
 ↓
merchant / date / total / tax / items
 ↓
validation
 ↓
review if uncertain
```

OCR must sit behind an abstraction so iOS and Android implementations can differ without changing the receipt parser.

The receipt parser should prefer deterministic extraction and arithmetic validation. AI/LLM enrichment may later be added as an optional fallback, not as the only path.

---

### `packages/budgeting`

Budgeting and reporting logic.

Responsibilities:

- monthly totals
- category budgets
- essential vs discretionary vs irregular spending
- household cash flow
- spending trends
- savings calculations

Budget logic consumes canonical transactions only.

---

### `packages/localization`

Country and locale-specific behavior.

Responsibilities may include:

- currency formatting
- date formatting
- bank registry by country
- local merchant metadata
- tax labels
- translation resources

Australia is the first locale, not a global assumption.

---

### `packages/shared`

Small technical utilities shared across packages.

Do not turn this into a dumping ground for domain logic.

---

## 4. Canonical data flow

### Bank statement

```text
CommBank PDF
    ↓
CommBank importer
    ↓
Parsed statement
    ↓
Reconciliation
    ↓
Canonical transactions
    ↓
Merchant resolution
    ↓
Categorization
    ↓
SQLite
    ↓
Budget / review / dashboard
```

### Receipt

```text
Receipt image
    ↓
OCR
    ↓
Receipt parser
    ↓
Structured receipt
    ↓
Merchant resolution
    ↓
Optional transaction matching
    ↓
SQLite
```

---

## 5. Financial correctness rules

These are architectural constraints, not optional implementation details.

### Money

Never store money as floating-point dollars.

```text
$12.34 → 1234 minor units
```

Canonical money values use integer minor units plus an ISO currency code.

### Statement reconciliation

If a statement contains running balances, importers should verify:

```text
previous balance + signed transaction amount = current balance
```

A statement should expose reconciliation status before data is committed.

The application must not silently accept unexplained reconciliation failures.

### Provenance

Canonical transactions retain enough import metadata to answer:

- where did this transaction come from?
- which import created it?
- what was the original description?
- was any field reconstructed?
- was a classification automatic or user-confirmed?

---

## 6. Privacy model

v0.1 is **local-first** and does not require an account or backend.

Default behavior:

- financial records live in local SQLite
- raw bank statements remain local
- receipt photos remain local unless the user explicitly chooses otherwise
- no raw financial data is sent to external services by default
- logs must not contain raw statements, card/account identifiers, or receipt contents

Future sync should synchronize canonical records first; raw source documents should require an explicit design decision and user consent.

---

## 7. Household model

The data model should support a household from the beginning even if v0.1 runs on one device.

Conceptually:

```text
Household
├── Members
├── Accounts
├── Transactions
├── Categories
├── Budgets
└── Merchant rules
```

Do not hard-code a single-user ownership model that would make later shared household sync difficult.

---

## 8. Testing strategy

Parser correctness is fixture-driven.

```text
fixtures/
├── bank-statements/
│   └── commbank/
│       ├── browser-summary-01.pdf
│       ├── browser-summary-01.expected.json
│       ├── classic-01.pdf
│       └── classic-01.expected.json
└── receipts/
    ├── grocery-01.jpg
    ├── grocery-01.expected.json
    └── cafe-01.jpg
```

Never commit real personal bank statements or unredacted receipts.

Private fixtures belong outside version control.

Every importer bug should ideally result in a new anonymized regression fixture.

---

## 9. v0.1 scope

The first shippable version should do only what is necessary to be useful in daily life:

1. Create/open a local household ledger.
2. Import a CommBank statement.
3. Reconcile the import.
4. Normalize and classify merchants.
5. Present a review queue for unresolved merchants.
6. Show monthly spending by category and budget character.
7. Capture a receipt image.
8. Extract at least merchant, date, and total from the receipt.
9. Allow manual correction.

Explicitly out of scope for v0.1:

- bank account APIs / Open Banking
- investment tracking
- tax filing
- AI financial advice
- complex debt planning
- cloud synchronization
- web application
- multi-bank support beyond proving the importer abstraction

---

## 10. Future extension points

The architecture should allow, without redesigning the core:

- ANZ / NAB / Westpac importers
- CSV / OFX / QIF import
- household sync
- encrypted backup
- additional currencies
- community merchant databases
- external merchant enrichment
- advanced receipt line-item parsing
- recurring transaction detection
- subscriptions
- shared expenses and splits
- web/desktop clients

---

## 11. Decision summary

```text
Codename           AqchaFold
Product            Ledgerase
Mobile             React Native + Expo
Language           TypeScript
Workspace          pnpm monorepo
Storage            SQLite
DB layer           Drizzle ORM
Validation         Zod
Testing            Vitest
Architecture       Local-first
Backend v0.1       None
Primary importer   CommBank PDF
Primary OCR path   Native/on-device abstraction
```

The next architecture document should define the canonical domain model: `Household`, `Account`, `Transaction`, `Merchant`, `Category`, `Import`, `Receipt`, and `Budget`.
