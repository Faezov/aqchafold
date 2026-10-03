# CommBank PDF → structured budget (v4)

This version adds a persistent merchant-rule layer so merchant decisions live in a small CSV instead of in the Python source.

## Environment

```bash
conda create -n commbank-budget python=3.12 -y
conda activate commbank-budget
python -m pip install pymupdf XlsxWriter
```

## Run

Put these files beside your statement:

```text
statement_to_budget_pdf.py
merchant_rules.csv
TransactionSummary.pdf
```

Then run:

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf
```

Outputs:

```text
TransactionSummary_structured_budget.xlsx
TransactionSummary_structured_budget_transactions.csv
TransactionSummary_structured_budget_merchant_review.csv
merchant_rules.csv
```

If `merchant_rules.csv` does not exist, the script creates a starter one automatically beside the PDF.

## Merchant rules workflow

`merchant_rules.csv` is the persistent source of truth. Its columns are:

- `enabled` — `1` or `0`
- `priority` — higher numbers win when multiple rules match
- `match_type` — `contains`, `exact`, or `regex`
- `pattern` — case-insensitive pattern to match against description + details
- `canonical_name` — clean merchant name shown in reports
- `category` — e.g. `Transport`, `Dining & Coffee`, `Shopping`
- `budget_character` — `Essential`, `Discretionary`, `Irregular`, `Work/Admin`, or `Unknown`
- `status` — normally `confirmed` or `suggested`
- `notes` — anything useful to remember

Example:

```csv
enabled,priority,match_type,pattern,canonical_name,category,budget_character,status,notes
1,210,contains,TFNSW OPAL,Transport for NSW,Transport,Essential,confirmed,Opal fare
1,190,contains,KAHII,Kahii,Dining & Coffee,Discretionary,suggested,Confirm merchant
1,220,contains,AIRBNB,Airbnb,Travel,Irregular,confirmed,Accommodation
```

Rules marked `suggested` are applied, but they stay on the **Merchant Review** sheet until you change them to `confirmed`.

## Review workflow

The workbook now separates two kinds of review:

- **Merchant Review** — one row per merchant, aggregated by transaction count and total spend. Unmatched and suggested merchants appear here.
- **Parser Review** — only rows where PDF extraction required reconstruction or had a mismatch.
- **Merchant Rules** — a snapshot of the CSV rules actually used for this run.

This means a merchant such as KAHII appears once with its count/total instead of appearing as many separate transactions.

## Budget character

Category and budget character are deliberately separate:

- `Essential` — rent, groceries, utilities, ordinary transport, health
- `Discretionary` — dining, shopping, beauty, entertainment
- `Irregular` — travel and large one-off expenses
- `Work/Admin` — professional, education, exam, printing/admin costs
- `Unknown` — needs review

The dashboard shows spending split by these characters, so irregular or professional expenses do not get confused with normal lifestyle burn.

## Useful options

Custom rules location:

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf --rules ~/budget/merchant_rules.csv
```

CSV outputs only:

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf --csv-only
```

Debug a changed PDF layout:

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf --debug-text debug.txt
```

## Rule precedence

1. Income / transfer system rules
2. Highest-priority enabled merchant rule
3. Generic built-in fallback category rules
4. `Other` / `Unknown`

Edit the CSV, rerun the script, and all historical transactions in that statement are reclassified consistently.
