# AqchaFold / Ledgerase Development Plan

Goal: ship a local-first Ledgerase app that Bulat and Emily can actually
use on Android and iOS.

This file is intentionally sequential.

Work on one small unchecked item at a time.
Do not start later phases early.

---

## 0. Project foundation

- [X] Choose development codename: AqchaFold
- [X] Choose public product name: Ledgerase
- [X] Define high-level architecture
- [X] Add root AGENTS.md
- [X] Create DOMAIN_MODEL.md
- [X] Define Money
- [X] Define Transaction
- [X] Define Account
- [X] Define Merchant
- [X] Define Category
- [X] Define Household and Member
- [X] Define Import
- [X] Define Receipt and `feat(database): add merchant repository`
- [X] Define Budget

Milestone:
We understand the core objects before implementing storage or UI.

---

## 1. Repository bootstrap

- [X] Initialize Git repository
- [X] Initialize pnpm workspace
- [X] Create apps/mobile
- [X] Create packages/domain
- [X] Create packages/database
- [X] Create packages/importers
- [X] Create packages/merchants
- [X] Create packages/receipts
- [X] Create packages/budgeting
- [X] Configure TypeScript
- [X] Configure linting / formatting
- [X] Configure Vitest
- [X] Add private fixture paths to .gitignore
- [X] Verify one test runs successfully

Milestone:
The repository builds and tests, but contains almost no product logic.

---

## 2. Domain foundation

- [X] Implement Money
- [X] Test Money arithmetic and currency invariants
- [X] Implement Transaction
- [X] Test transaction sign convention
- [X] Implement Account
- [X] Implement Merchant
- [X] Implement Category
- [X] Implement Household / Member
- [X] Implement Import model

Milestone:
Core finance concepts exist independently of CommBank, SQLite, and React.

---

## 3. Local database

- [X] Add SQLite
- [X] Add Drizzle
- [X] Define initial schema
- [X] Add first migration
- [X] Create household repository
- [X] Create member repository
- [X] Create account repository
- [X] Create transaction repository
- [X] Create merchant repository
- [X] Test basic persistence
- [X] Verify database works on Android
- [ ] Verify database works on iOS

Milestone:
Ledgerase can persist canonical financial data locally.

---

## 4. First end-to-end statement import

Target:

CommBank PDF
→ parse
→ reconcile
→ canonical transactions
→ SQLite

- [X] Define StatementImporter contract
- [X] Define ParsedStatement result
- [X] Add anonymized CommBank fixture
- [X] Detect CommBank browser Transaction Summary
- [X] Parse transaction dates
- [X] Parse descriptions
- [X] Parse amounts
- [X] Parse balances
- [X] Parse statement metadata
- [X] Reconcile running balances
- [X] Convert parsed rows to canonical Transactions
- [X] Persist imported transactions
- [X] Detect duplicate imports
- [X] Add regression tests

Milestone:
A real CommBank statement can become correct local Ledgerase transactions.

---

## 5. First usable mobile UI

Keep this intentionally ugly/simple.

- [X] Launch Ledgerase on Android
- [X] Create Home screen
- [X] Create Accounts screen
- [X] Create Transactions screen
- [ ] Add document picker
- [ ] Import a CommBank statement from the phone
- [ ] Show import result
- [ ] Show reconciliation status
- [ ] Display imported transactions

Milestone:
Bulat can install Ledgerase, import a statement, and see transactions.

This is the first genuinely usable version.

---

## 6. Merchant resolution

Target:

raw description
→ normalized description
→ merchant
→ category

- [ ] Define merchant normalization interface
- [ ] Normalize payment processor prefixes
- [ ] Normalize obvious location/noise suffixes
- [ ] Preserve original transaction description
- [ ] Implement merchant aliases
- [ ] Implement persistent merchant rules
- [ ] Add confirmed / suggested / unknown status
- [ ] Ensure user-confirmed rules have highest priority
- [ ] Aggregate unknown transactions by merchant
- [ ] Rank review queue by financial importance
- [ ] Create merchant review screen
- [ ] Allow user to confirm a suggestion
- [ ] Allow user to change a category
- [ ] Remember correction permanently

Milestone:
Unknown spending decreases as Ledgerase learns the household's merchants.

Target:
<5% of spending remains unknown after normal use.

---

## 7. Basic budgeting

- [ ] Define budget period
- [ ] Define category budget
- [ ] Separate essential spending
- [ ] Separate discretionary spending
- [ ] Separate irregular spending
- [ ] Calculate monthly category totals
- [ ] Calculate income
- [ ] Calculate spending
- [ ] Calculate monthly cash flow
- [ ] Create basic dashboard
- [ ] Create category spending view
- [ ] Create budget vs actual view

Milestone:
Ledgerase answers:

"Where did our money go this month?"

---

## 8. Household usability

- [ ] Allow transaction ownership: Bulat / Emily / household
- [ ] Allow household categories
- [ ] Allow shared budgets
- [ ] Add basic transaction search
- [ ] Add transaction editing
- [ ] Add manual transaction entry
- [ ] Add CSV export
- [ ] Test normal daily use

Milestone:
Bulat and Emily can genuinely use Ledgerase as their household finance tool.

---

## 9. Receipt pipeline

Target:

photo
→ OCR
→ receipt
→ structured data
→ transaction association

- [ ] Define OCR result contract
- [ ] Define Receipt
- [ ] Define ReceiptItem
- [ ] Implement receipt image capture
- [ ] Implement image import
- [ ] Add Android OCR adapter
- [ ] Add iOS OCR adapter
- [ ] Extract merchant
- [ ] Extract purchase date
- [ ] Extract total
- [ ] Extract line items
- [ ] Validate line item sum against total
- [ ] Add receipt review screen
- [ ] Link receipt to transaction
- [ ] Add anonymized receipt fixtures

Milestone:
Photographing a receipt produces useful structured financial information.

---

## 10. Second bank

- [ ] Select second Australian bank
- [ ] Add anonymized fixture
- [ ] Implement importer using existing contract
- [ ] Identify CommBank assumptions that leaked into shared code
- [ ] Refactor only where required
- [ ] Verify both importers pass

Milestone:
The architecture proves it is genuinely bank-independent.

---

## 11. Localization foundation

- [ ] Remove remaining hard-coded AUD assumptions
- [ ] Use locale-aware date formatting
- [ ] Use locale-aware currency formatting
- [ ] Separate Australian-specific bank logic
- [ ] Add locale resources
- [ ] Verify another currency can be represented correctly

Milestone:
Australia is the first supported market, not a hard-coded architectural assumption.

---

## 12. Privacy and release hardening

- [ ] Audit application logs
- [ ] Verify no raw financial data is logged
- [ ] Verify no network transmission occurs unexpectedly
- [ ] Review file retention behavior
- [ ] Add privacy documentation
- [ ] Add import/export backup mechanism
- [ ] Test malformed PDFs
- [ ] Test malformed receipt images
- [ ] Test large statements
- [ ] Test database migration path
- [ ] Test clean install
- [ ] Test upgrade install

Milestone:
Ledgerase is safe enough for daily personal financial use.

---

## 13. Open-source preparation

- [ ] Write public README
- [ ] Add LICENSE
- [ ] Add CONTRIBUTING.md
- [ ] Add fixture contribution documentation
- [ ] Document how to add a bank importer
- [ ] Document how merchant rules work
- [ ] Remove private development artifacts
- [ ] Run secret scan
- [ ] Publish repository

Milestone:
Other people can understand, run, and contribute to Ledgerase.

---

## 14. First public release

- [ ] Create Android release build
- [ ] Create iOS release build
- [ ] Test Android release on physical phone
- [ ] Test iOS release on physical phone
- [ ] Prepare app icon
- [ ] Prepare screenshots
- [ ] Prepare store description
- [ ] Prepare privacy information
- [ ] Publish first beta
- [ ] Use it ourselves for one month
- [ ] Fix actual pain points before adding major features

Success condition:

Ledgerase is used by us regularly rather than merely existing as a codebase.
