# fixtures/bank-statements/commbank

`browser-summary-01.pdf` is a fully synthetic, selectable-text CommBank
Transaction Summary fixture for Ledgerase. `browser-summary-01.reference.json`
records its intended source cells and evidence. It is hand-authored reference
data, not output from a parser or a set of canonical Transactions.

The layout reference is the [Logan City Council government-hosted CommBank
example](https://www.logan.qld.gov.au/files/assets/public/v/1/residents/documents/an_example_of_a_bank_statement.pdf).
The source index and downloaded original remain under ignored `fixtures/private/`;
no research document is included in this fixture.

The PDF preserves the source's one-page A4 portrait layout, bank/title positions,
parenthesized page counter, and **Date | Transaction | Debit | Credit | Balance**
columns. This example uses separate Debit/Credit columns, unlike the signed
Amount variant mentioned in the archived prototype documentation. It does not
establish support for other Transaction Summary variants.

The header retains demonstrated Account Number, Statement, Period, and Closing
Balance labels. The Statement value stays absent because it is obscured in the
reference. A separate dated entry has a four-digit year followed by **OPENING
BALANCE**; it is balance evidence rather than a financial movement.

Eleven synthetic movements include seven debit rows, four credit rows, repeated
dates, and running balances. Dates use day/month notation without a per-row year;
the period and opening entry supply year evidence. Debit/Credit cells contain
unsigned decimal magnitudes, while balance cells use `$`, thousands separators,
and two decimal places. Empty monetary cells are recorded as empty source cells,
not zero movements. No zero movement or ISO currency code is invented.

One description spans two lines: a synthetic payee description followed by an
invented numeric reference. Its debit and balance align with the continuation
line, as demonstrated in the source. The reference retains that newline; the
numeric continuation is not declared a unique transaction identifier.

The PDF was constructed from scratch using only synthetic customer names,
address text, account/reference identifiers, dates, descriptions, amounts, and
balances. Only fixed bank/format labels and layout characteristics come from
the source. No source page, image, font, annotations, hidden text, or metadata
was copied. Obscured values and noisy overlapping text layers in the public
reference are not reproduced. Exact branding, typography, boilerplate, and other
unverified format variants are outside this fixture's coverage.

Detection, extraction, reconciliation, canonical conversion, and persistence
remain deferred. Keep future real or research statements under `fixtures/private/`.
