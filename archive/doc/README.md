# CommBank PDF -> structured budget

This version works **directly from the original CommBank eStatement PDF**.
It does not upload the statement anywhere and it does not call any web service.

## Install

```bash
python -m pip install pymupdf XlsxWriter
```

## Run

```bash
python statement_to_budget_pdf.py Statement.pdf
```

By default this creates:

- `Statement_structured_budget.xlsx`
- `Statement_structured_budget_transactions.csv`

Choose another output name:

```bash
python statement_to_budget_pdf.py Statement.pdf -o budget.xlsx
```

Password-protected PDF:

```bash
python statement_to_budget_pdf.py Statement.pdf --password 'YOUR_PASSWORD'
```

CSV only:

```bash
python statement_to_budget_pdf.py Statement.pdf --csv-only
```

## What the parser does

1. Reads the PDF text layer with PyMuPDF.
2. Finds the `Date | Transaction | Debit | Credit | Balance` header using text coordinates.
3. Uses those x-coordinates to reconstruct the five table columns on every page.
4. Joins continuation lines such as `Card xx....`, `Value Date ...`, and reference IDs to the correct transaction.
5. Reads debit, credit, and running balance.
6. Recalculates every transaction amount against the running balance.
7. Refuses to finish if the statement does not reconcile to its closing balance.
8. Categorizes merchants and builds the Excel budget/dashboard.

This is much safer than parsing a PDF-to-ODS dump because the original PDF still
contains the column positions.

## Workbook sheets

- **Dashboard** - high-level income/budget view and chart
- **Transactions** - clean, filterable transaction table
- **Monthly Summary** - monthly income, spending, transfers and net cash flow
- **Budget** - actual category spending vs suggested caps
- **Review** - uncategorized merchants and any reconstructed/mismatched rows
- **Assumptions** - parser and budgeting assumptions
- **Lists** - category dropdown values

## Customize categories

Open `statement_to_budget_pdf.py` and edit `CATEGORY_RULES` near the top.
Rules are checked from top to bottom.

Example:

```python
("Groceries", ["coles ", "woolworths", "aldi"]),
```

## Customize the budget

Edit `BUDGET_CAPS` near the top:

```python
BUDGET_CAPS = {
    "Housing - Rent": 3683,
    "Groceries": 550,
    "Dining & Coffee": 650,
    # ...
}
```

## If a CommBank layout changes

Generate a local layout-debug file:

```bash
python statement_to_budget_pdf.py Statement.pdf --csv-only --debug-text debug.txt
```

`debug.txt` shows the extracted text lines and whether the five transaction
columns were detected on each page. **It can contain transaction descriptions**,
so treat it like financial data.

## Scanned PDFs / screenshots

The parser intentionally does not use OCR. Use the original downloaded CommBank
eStatement where you can select/copy the text. This avoids OCR mistakes in money
amounts and account balances.

## Privacy

Everything runs locally on your computer. The script itself contains no network
code and does not transmit the PDF, transaction list, or budget anywhere.
