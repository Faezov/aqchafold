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

These are type declarations only. The existing domain package supplies `Money`
and `ImportParserProvenance` through type-only imports; there is no new third-party
dependency. Results are neither persisted `Import` objects nor canonical
`Transaction` objects and contain no confirmed Account association. Parsing does
not establish reconciliation or acceptance. Concrete detection/parsing,
reconciliation, canonical conversion, persistence, and PDF integration are deferred.
