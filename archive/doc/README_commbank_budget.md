# CommBank PDF -> structured budget

This tool parses the original text-based Commonwealth Bank PDF directly and writes:

- `<statement>_structured_budget.xlsx`
- `<statement>_structured_budget_transactions.csv`

It supports both common CommBank layouts:

1. Classic eStatement: `Date | Transaction | Debit | Credit | Balance`
2. Browser Transaction Summary: `Date | Transaction details | Amount | Balance`

The browser version can contain full dates such as `01 Jun 2026`, signed amounts such as `-$7.10`, and a statement range embedded in text such as `01/06/26-08/09/26`. The parser handles those directly; `--year` should normally not be required.

## Conda setup

```bash
conda env create -f environment.yml
conda activate commbank-budget
```

Or create the environment manually:

```bash
conda create -n commbank-budget python=3.12 -y
conda activate commbank-budget
python -m pip install pymupdf XlsxWriter
```

## Run

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf
```

Optional output name:

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf -o budget.xlsx
```

CSV only:

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf --csv-only
```

Debug the extracted PDF layout:

```bash
python statement_to_budget_pdf.py TransactionSummary.pdf --debug-text debug.txt
```

The debug file reports a detected layout of either `kind='signed'` (browser Transaction Summary) or `kind='split'` (classic eStatement).

## Safety / correctness

The script does not use OCR, upload the PDF, or call a network service. It uses the PDF text layer and coordinates. Every transaction amount is cross-checked against the running balance. If the amount is missing it can reconstruct it from the balance; if the statement cannot be reconciled, the script stops rather than silently producing a bad budget.

Wrapped merchant names are joined into the main Description field, while lines such as `Card xx...`, `Value Date: ...`, PayID/booking references, and reference codes are stored in Details.
