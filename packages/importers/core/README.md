# packages/importers/core

Bank-independent, platform-independent statement importer contracts for Ledgerase.

`StatementImporter` exposes a stable `id` and `version`,
`detect(input: DocumentInput): Promise<number>`, and
`parse(input: DocumentInput): Promise<ParsedStatement>`.
Detection scores are finite numbers from 0 (decline) to 1 (strongest match),
allowing multiple importers to assess the same content. Selection and tie handling
belong to a later registry. Filenames do not participate in this contract.

`DocumentInput` carries local document bytes as `Uint8Array`. No platform file
handles, PDF library types, or extraction implementation are required here.
Importers must leave the bytes unchanged so other importers can assess them.

`ParsedStatement` retains parser identity/version, raw metadata, optional source
account/currency/period evidence, opening/closing balances, source transaction
rows in document order, and warnings. Raw descriptions, date strings, monetary
notation, and source positions remain separate from optional interpreted dates
and `Money` values. Missing or ambiguous fields stay unresolved; warnings explain
uncertainty, reconstruction, or partial coverage. All evidence is sensitive local
data and must not appear in logs.

`ParsedStatementRow.rawDescription` is optional: `undefined` means extraction is
not established, `""` means an established genuinely empty source description,
and a nonempty string is the established exact source description.

`ParsedStatement.reconciliation` is optional: absence means source-balance checks
were not performed. `ParsedStatementReconciliation` contains an ordered `rows`
array of `{ position, status }` and a `closingBalance` status. Each
`ReconciliationStatus` is `"verified"`, `"mismatch"`, or `"unresolved"`; an
unavailable check is never a pass or an arithmetic mismatch. Row positions
identify the movement checked against the opening or preceding source balance.
The closing check compares explicit closing evidence with the final source
running balance. Warnings explain nonverified checks without exposing values.

These outcomes establish source arithmetic only within each checked relation,
not currency, Account matching, document completeness, or acceptance. Validated
source magnitudes can be checked without constructing `Money` or assuming an ISO
currency. All source evidence remains unchanged.

`fingerprintDocumentInput(input: DocumentInput): ImportFingerprint` hashes the exact
original byte view using SHA-256, returning `{ method: "sha256", value }` with a
64-character lowercase hexadecimal value. The portable `@noble/hashes` SHA-256
implementation requires no Node, native, or platform crypto API. Input bytes are
unchanged. Filenames, parser provenance, parsed evidence, and canonical Transactions
do not participate. Hash before processing the original input; changed exports have
different fingerprints even when their financial contents look identical.

The existing domain package supplies `Money`, `ImportParserProvenance`, and
`ImportFingerprint` through type-only imports. Parsed results are neither persisted
`Import` objects nor canonical `Transaction` objects and contain no confirmed
Account association. Parsing alone
does not imply verification or acceptance; source checks have explicit outcomes.
Bank-specific detection, extraction, and arithmetic live in the concrete importer.
Duplicate lookup and atomic successful completion belong to the database Import
repository, scoped to a Household. A fingerprint establishes exact-artifact
evidence only; it does not identify an Account or a statement, prove extraction, or
detect overlapping or similar Transactions. Canonical conversion belongs to the
concrete importer; persistence and importer selection are separate concerns.
