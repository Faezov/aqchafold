#!/usr/bin/env python3
"""
CommBank statement -> clean transactions + budget workbook (v3).

Primary workflow:
    Statement.pdf  ->  structured_budget.xlsx + transactions.csv

The PDF parser uses the statement's text layer and the x/y coordinates of the
Date / Transaction / Debit / Credit / Balance columns. It does NOT upload the
statement anywhere and does not use OCR or any network service.

Install once:
    python -m pip install pymupdf XlsxWriter

Run:
    python statement_to_budget_pdf.py Statement.pdf

Optional:
    python statement_to_budget_pdf.py Statement.pdf -o my_budget.xlsx
    python statement_to_budget_pdf.py Statement.pdf --password 'pdf-password'
    python statement_to_budget_pdf.py Statement.pdf --csv-only
    python statement_to_budget_pdf.py Statement.pdf --debug-text debug_pdf_layout.txt

Notes:
- Supports both common CommBank text-based layouts:
  1) Date / Transaction / Debit / Credit / Balance (classic eStatement)
  2) Date / Transaction details / Amount / Balance (browser Transaction Summary)
- If a PDF is only scanned images, download the original eStatement instead;
  this script intentionally does not OCR bank statements.
- Every transaction is reconciled against the running balance. If the parse
  does not reconcile, the script fails loudly instead of silently budgeting
  incorrect values.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import math
import re
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, Optional

# -----------------------------------------------------------------------------
# USER-EDITABLE SETTINGS
# -----------------------------------------------------------------------------

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
MONTH_NUM = {m: i + 1 for i, m in enumerate(MONTHS)}
MONTH_RE = "(?:" + "|".join(MONTHS) + ")"

# Categories are checked top-to-bottom. Add merchant fragments as you learn them.
CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("Housing - Rent", ["deft real estate"]),
    ("Bank Fees", ["international transaction fee", "atm withdrawal fee", "non cba atm withdrawal fee"]),
    ("Cash Withdrawal", ["wdl atm", "atm cashcard"]),
    ("Utilities & Phone", ["energyaustralia", "telstra services", "dodo services", "tello mobile"]),
    ("Fitness & Memberships", ["crunch fitness", "mbaudpayments"]),
    ("Travel", [
        "thaiair", "jetstar", "meriton suites", "klook travel", "chalet hotels",
        "hillary step treks", "hotel bayberry", "indianvisaonline", "pokhara",
        "kathmandu kt", "bangalore", "mumbai ma", " hms host services ind",
        "fabindia", "swiggy", "raz*swiggy", "pyu*swiggy", "kk mc blore",
    ]),
    ("Health & Pharmacy", [
        "chemist warehouse", "medical", "pharmacy", "nexgen pharma", "specsavers",
        "health care", "greencare clinics", "warringah medical", "med cntr pharmacy",
        "gu health d/dbt",
    ]),
    ("Transport", [
        "transportfornsw", "uber *trip", "taxi transact", "ampol", "linkt avis",
        "bp nth manly", "bp jindabyne", "bp fyshwick", "united dee why", "fantasea",
    ]),
    ("Groceries", [
        "coles ", "woolworths", "iga ", "flannerys", "fruit market", "authentic bazaar",
        "mao s asian", "mao sheng", "sreekrish", "hfm mona vale", "tiyeb store",
        "w retail group", "farmers fresh", "kippax supermarket",
    ]),
    ("Home & Household", [
        "ikea", "temple & webster", "planoak", "alliance pest", "bubble box laundry", "4p - bonsai",
    ]),
    ("Beauty & Personal Care", [
        "gin amber beauty", "beautyfacia", "massageluxe", "fragrancenet", "the j room hair",
        "lashes by krissy", "jeevi brow", "barber", "l occitane", "lush qvb", "above cut",
    ]),
    ("Government & Admin", ["service nsw", "northern beaches counc", "post dee why", "post qvb"]),
    ("Subscriptions & Donations", ["netflix", "wikimedia"]),
    ("Entertainment & Experiences", [
        "scenic world", "museum of victoria", "melbourne zoo", "tickets*world", "world of w",
    ]),
    ("Shopping", [
        "amazon au", "kmart", "reject shop", "tk maxx", "h&m", "muji retail", "cotton on",
        "lululemon", "ebay", "the iconic", "sp lifely", "anaconda", "arcteryx", "macpac",
        "kathmandu pty", "rainbow bags", "strandbags", "uniqlo", "deiji studios", "jb hi fi",
        "cos sydney", "sp mij aus", "ess boardstore", "pop mart", "big w",
    ]),
    ("Dining & Coffee", [
        "espresso", "cafe", "coffee", "sushi", "subway", "guzman", "mcdonald", "kfc",
        "bakery", "canele", "salumerie", "bar luca", "pizza", "grill", "kebab", "chatime",
        "gong cha", "machi machi", "upper crust", "deli", "restaurant", "chicken", "tea ",
        "molly tea", "bambolina", "chargrill", "food", "dough", "bakers delight", "sacrebleu",
        "totaler", "viet vibe", "mumbai express", "north indian flavour", "cafe moni",
        "hero sushi", "lune", "luneberger", "corretto", "ambis chai", "chinatown country",
        "johnnygio", "babette", "love food", "bite*", "bourke street bakery", "reddy express",
        "stitch coffee", "spresso", "leible", "petit loulou", "samsam", "kyiv social",
        "wingmill", "kano zephyr", "mamak", "sky bar", "stockmans", "burek", "maeve chocolate",
        "parami", "old school kafey", "panino paradiso", "dragon hot pot", "gojima", "flappy",
        "mappen", "royal copenhagen", "pnut asian", "liquor", "shady pines", "skittle lane",
        "dickson taphouse", "hello harry", "next door", "sig-caf", "destination roll", "otogo",
        "salsas", "m4mezze", "grind house", "sandwich", "hunger valley", "edition roasters",
        "dula group", "south dowling", "sana mediterranean", "momo bar", "phenthai", "sal's",
    ]),
]

# These are your current suggested monthly caps. Edit at any time.
BUDGET_CAPS = {
    "Housing - Rent": 3683,
    "Groceries": 550,
    "Dining & Coffee": 650,
    "Utilities & Phone": 350,
    "Transport": 450,
    "Fitness & Memberships": 354,
    "Health & Pharmacy": 400,
    "Shopping": 600,
    "Beauty & Personal Care": 150,
    "Home & Household": 250,
    "Entertainment & Experiences": 100,
    "Subscriptions & Donations": 15,
    "Bank Fees": 20,
    "Government & Admin": 50,
    "Travel": 400,
    "Cash Withdrawal": 0,
    "Other": 250,
}

BUDGET_COMMENTS = {
    "Housing - Rent": "Fortnightly $1,700 normalized to 26 payments / 12 months.",
    "Groceries": "Baseline allowance for supermarket / grocery spending.",
    "Dining & Coffee": "A controllable category; target is below the observed run-rate.",
    "Utilities & Phone": "Smooths irregular billing months.",
    "Transport": "Allows for Opal/Uber/fuel/taxis.",
    "Fitness & Memberships": "Approximately current recurring run-rate.",
    "Health & Pharmacy": "Buffer for pharmacy/medical variability.",
    "Shopping": "Main discretionary reduction target.",
    "Beauty & Personal Care": "Use as a monthly cap / sinking fund.",
    "Home & Household": "Sinking fund for irregular household purchases.",
    "Entertainment & Experiences": "Monthly leisure allowance.",
    "Subscriptions & Donations": "Recurring subscriptions/donations.",
    "Bank Fees": "Aim to minimize international/ATM fees.",
    "Government & Admin": "Small sinking fund for irregular admin charges.",
    "Travel": "Sinking fund; travel months can be much higher.",
    "Cash Withdrawal": "Prefer recategorizing cash once you know what it paid for.",
    "Other": "Buffer for merchants not yet confidently categorized.",
}

ALL_CATEGORIES = list(BUDGET_CAPS) + [
    "Transfer Out",
    "Transfer In",
    "Income - Recurring Direct Credit",
    "Income - Refund/Reimbursement",
    "Income - Other Credit",
]

# -----------------------------------------------------------------------------
# DATA TYPES
# -----------------------------------------------------------------------------

DATE_CELL_RE = re.compile(rf"^(\d{{1,2}})\s+({MONTH_RE})(?:\s+(20\d{{2}}))?$", re.I)
MONEY_RE = re.compile(r"(?<!\d)(?:\(\s*)?(?:(?:-\s*)?\$\s*|-\s*|\$\s*)?\d[\d,]*\.\d{2}(?:\s*\))?(?:\s*(?:CR|DR))?(?!\d)", re.I)


@dataclass
class StatementPeriod:
    start: date
    end: date


@dataclass
class Transaction:
    date: date
    description: str
    details: str = ""
    debit: Optional[float] = None
    credit: Optional[float] = None
    amount: Optional[float] = None
    balance: Optional[float] = None
    category: str = "Other"
    parse_status: str = "High confidence"
    source_page: int = 0
    raw: str = ""


@dataclass
class RawRow:
    day: int
    month: int
    year: Optional[int]
    description: str
    details: list[str] = field(default_factory=list)
    debit: Optional[float] = None
    credit: Optional[float] = None
    balance: Optional[float] = None
    page: int = 0
    raw_lines: list[str] = field(default_factory=list)


@dataclass
class ColumnLayout:
    """Detected transaction-table geometry for one CommBank PDF layout.

    kind == "split":  Date | Transaction | Debit | Credit | Balance
    kind == "signed": Date | Transaction details | Amount | Balance
    """

    kind: str
    date_x: float
    transaction_x: float
    balance_x: float
    header_y: float
    amount_x: Optional[float] = None
    debit_x: Optional[float] = None
    credit_x: Optional[float] = None

    @property
    def anchors(self) -> list[float]:
        # These are LEFT EDGES of the detected header words, not centers.
        # CommBank's Transaction details column is much wider than Date/Amount,
        # so midpoint boundaries would incorrectly steal the tail of merchant names.
        if self.kind == "signed":
            assert self.amount_x is not None
            return [self.date_x, self.transaction_x, self.amount_x, self.balance_x]
        assert self.debit_x is not None and self.credit_x is not None
        return [self.date_x, self.transaction_x, self.debit_x, self.credit_x, self.balance_x]

    @property
    def boundaries(self) -> list[float]:
        # A new column begins at the left edge of its header.
        return self.anchors[1:]


# -----------------------------------------------------------------------------
# GENERAL HELPERS
# -----------------------------------------------------------------------------


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def parse_money(text: str | None) -> Optional[float]:
    if not text:
        return None
    matches = list(MONEY_RE.finditer(text))
    if not matches:
        return None
    token = matches[-1].group(0).strip()
    negative = False
    upper = token.upper()
    if upper.endswith(" DR") or upper.endswith("DR"):
        negative = True
    if token.startswith("(") and token.endswith(")"):
        negative = True
    if "-" in token:
        negative = True
    numeric = re.sub(r"[^0-9.]", "", token)
    if not numeric:
        return None
    value = float(numeric)
    return -value if negative else value


def parse_period(text: str) -> Optional[StatementPeriod]:
    """Parse the period from either classic or browser CommBank statements.

    Supported examples include:
      - Period 19 Jun - 29 Sep 2018
      - 05 Dec 2025 - 30 Apr 2026
      - transactions from 01/06/26-08/09/26
      - transactions from 01/06/2026 - 08/09/2026
    """
    flat = normalize_space(text.replace("–", "-").replace("—", "-"))

    # Classic textual month format.
    pat = re.compile(
        rf"(?:Statement\s+)?Period\s*[:]?\s*"
        rf"(\d{{1,2}})\s+({MONTH_RE})(?:\s+(20\d{{2}}))?\s*-\s*"
        rf"(\d{{1,2}})\s+({MONTH_RE})\s+(20\d{{2}})",
        re.I,
    )
    m = pat.search(flat)
    if not m:
        pat = re.compile(
            rf"(\d{{1,2}})\s+({MONTH_RE})(?:\s+(20\d{{2}}))?\s*-\s*"
            rf"(\d{{1,2}})\s+({MONTH_RE})\s+(20\d{{2}})",
            re.I,
        )
        m = pat.search(flat)
    if m:
        sd, sm, sy, ed, em, ey = m.groups()
        sm_num = MONTH_NUM[sm.title()]
        em_num = MONTH_NUM[em.title()]
        end_year = int(ey)
        start_year = int(sy) if sy else (end_year - 1 if sm_num > em_num else end_year)
        return StatementPeriod(
            date(start_year, sm_num, int(sd)),
            date(end_year, em_num, int(ed)),
        )

    # Browser Transaction Summary format, e.g.:
    # "a list of transactions from 01/06/26-08/09/26."
    numeric = re.compile(
        r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{2,4})\s*-\s*"
        r"(\d{1,2})/(\d{1,2})/(\d{2,4})(?!\d)"
    )
    m = numeric.search(flat)
    if m:
        sd, sm, sy, ed, em, ey = m.groups()

        def year4(s: str) -> int:
            y = int(s)
            return 2000 + y if len(s) == 2 else y

        return StatementPeriod(
            date(year4(sy), int(sm), int(sd)),
            date(year4(ey), int(em), int(ed)),
        )
    return None

def month_keys_between(start: date, end: date) -> list[str]:
    out = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append(f"{y:04d}-{m:02d}")
        if m == 12:
            y += 1
            m = 1
        else:
            m += 1
    return out


def complete_calendar_months(period: Optional[StatementPeriod], transactions: list[Transaction]) -> list[str]:
    if not transactions:
        return []
    all_months = sorted({tx.date.strftime("%Y-%m") for tx in transactions})
    if not period:
        return all_months[1:-1] if len(all_months) >= 3 else all_months

    complete = []
    for key in month_keys_between(period.start, period.end):
        y, m = map(int, key.split("-"))
        month_start = date(y, m, 1)
        month_end = date(y, m, calendar.monthrange(y, m)[1])
        if period.start <= month_start and month_end <= period.end:
            complete.append(key)
    return complete or all_months


# -----------------------------------------------------------------------------
# PDF PARSING
# -----------------------------------------------------------------------------


def load_pymupdf():
    try:
        import pymupdf
        return pymupdf
    except ImportError as exc:
        raise RuntimeError(
            "PyMuPDF is required for PDF input. Install it with:\n"
            "    python -m pip install pymupdf"
        ) from exc


def cluster_words(words: list[tuple], tolerance: float = 2.6) -> list[list[tuple]]:
    """Cluster PyMuPDF word tuples into visual lines by y-center."""
    usable = [w for w in words if len(w) >= 5 and str(w[4]).strip()]
    usable.sort(key=lambda w: (((w[1] + w[3]) / 2), w[0]))
    groups: list[dict] = []
    for w in usable:
        yc = (w[1] + w[3]) / 2
        if groups and abs(yc - groups[-1]["yc"]) <= tolerance:
            groups[-1]["words"].append(w)
            n = len(groups[-1]["words"])
            groups[-1]["yc"] = (groups[-1]["yc"] * (n - 1) + yc) / n
        else:
            groups.append({"yc": yc, "words": [w]})
    out = []
    for g in groups:
        g["words"].sort(key=lambda w: w[0])
        out.append(g["words"])
    return out


def _header_token(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def detect_layout(lines: list[list[tuple]]) -> Optional[ColumnLayout]:
    """Detect either of the two CommBank transaction-table layouts."""
    for words in lines:
        found: dict[str, float] = {}
        for w in words:
            token = _header_token(str(w[4]))
            if token in {"date", "transaction", "debit", "credit", "amount", "balance"}:
                found.setdefault(token, float(w[0]))

        # New browser / Transaction Summary layout:
        # Date | Transaction details | Amount | Balance
        if all(k in found for k in ("date", "transaction", "amount", "balance")):
            xs = [found[k] for k in ("date", "transaction", "amount", "balance")]
            if xs == sorted(xs):
                y = sum((float(w[1]) + float(w[3])) / 2 for w in words) / len(words)
                return ColumnLayout(
                    kind="signed",
                    date_x=found["date"],
                    transaction_x=found["transaction"],
                    amount_x=found["amount"],
                    balance_x=found["balance"],
                    header_y=y,
                )

        # Classic eStatement layout:
        # Date | Transaction | Debit | Credit | Balance
        if all(k in found for k in ("date", "transaction", "debit", "credit", "balance")):
            xs = [found[k] for k in ("date", "transaction", "debit", "credit", "balance")]
            if xs == sorted(xs):
                y = sum((float(w[1]) + float(w[3])) / 2 for w in words) / len(words)
                return ColumnLayout(
                    kind="split",
                    date_x=found["date"],
                    transaction_x=found["transaction"],
                    debit_x=found["debit"],
                    credit_x=found["credit"],
                    balance_x=found["balance"],
                    header_y=y,
                )
    return None


def words_to_fields(words: list[tuple], layout: ColumnLayout) -> list[str]:
    """Bucket a visual PDF line into fields using the detected x coordinates."""
    boundaries = layout.boundaries
    buckets = [[] for _ in layout.anchors]
    for w in words:
        xc = (float(w[0]) + float(w[2])) / 2
        idx = 0
        while idx < len(boundaries) and xc >= boundaries[idx]:
            idx += 1
        buckets[idx].append((float(w[0]), str(w[4])))
    return [normalize_space(" ".join(t for _, t in sorted(bucket))) for bucket in buckets]


def is_boilerplate(text: str) -> bool:
    t = text.lower()
    phrases = [
        "commonwealth bank of australia", "transaction summary", "account number",
        "statement period", "24 hours a day", "please check that the entries",
        "proceeds of cheques", "here's your account information", "here’s your account information",
        "australian credit licence", "abn ", "smart access", "dear ",
        "created ", "while this letter is accurate", "we're not responsible",
        "we’re not responsible", "transaction summary v", "account name", "account type",
        "date opened", "bsb",
    ]
    return any(p in t for p in phrases)



def looks_like_transaction_metadata(text: str) -> bool:
    """True for continuation lines that are metadata rather than merchant text."""
    t = normalize_space(text)
    low = t.lower()
    prefixes = (
        "card ", "value date", "booking reference", "payid ", "cash out",
        "reference ", "ref ", "bpay", "osko", "receipt ", "terminal ",
    )
    if low.startswith(prefixes):
        return True
    # CommBank often puts a bank/reference identifier on its own continuation line.
    if re.fullmatch(r"\d{6,}", t):
        return True
    if re.fullmatch(r"[A-Za-z0-9_-]{8,}", t) and any(ch.isdigit() for ch in t):
        return True
    return False

def pdf_debug_dump(path: Path, password: Optional[str], out_path: Path) -> None:
    pymupdf = load_pymupdf()
    doc = pymupdf.open(path)
    if doc.needs_pass:
        if not password or not doc.authenticate(password):
            raise RuntimeError("PDF is password protected; pass --password.")
    with out_path.open("w", encoding="utf-8") as fh:
        for pno, page in enumerate(doc, start=1):
            fh.write(f"\n===== PAGE {pno} =====\n")
            lines = cluster_words(page.get_text("words", sort=True))
            layout = detect_layout(lines)
            fh.write(f"Detected layout: {layout}\n")
            for words in lines:
                y = sum((w[1] + w[3]) / 2 for w in words) / len(words)
                txt = " ".join(str(w[4]) for w in words)
                if layout and y > layout.header_y:
                    fields = words_to_fields(words, layout)
                    fh.write(f"y={y:8.2f}  fields={fields!r}  raw={txt}\n")
                else:
                    fh.write(f"y={y:8.2f}  {txt}\n")


def parse_pdf(
    path: Path,
    password: Optional[str] = None,
    year_hint: Optional[int] = None,
) -> tuple[list[Transaction], float, float, Optional[StatementPeriod], int]:
    pymupdf = load_pymupdf()
    doc = pymupdf.open(path)
    if doc.needs_pass:
        if not password:
            raise RuntimeError("PDF is password protected. Re-run with --password '...'.")
        if not doc.authenticate(password):
            raise RuntimeError("Incorrect PDF password.")

    page_texts = [page.get_text("text", sort=True) for page in doc]
    total_chars = sum(len(t.strip()) for t in page_texts)
    if total_chars < max(100, len(doc) * 40):
        raise RuntimeError(
            "This PDF appears to have no usable text layer (possibly a scanned/image PDF). "
            "Use the original CommBank eStatement / Transaction Summary PDF rather than a scan or screenshot."
        )

    whole_text = "\n".join(page_texts)
    period = parse_period(whole_text)

    # Prefer the detected statement period. Otherwise infer from any full dated row,
    # then from an OPENING BALANCE line, then from --year.
    full_date_year_match = re.search(
        rf"\b\d{{1,2}}\s+{MONTH_RE}\s+(20\d{{2}})\b", whole_text, re.I
    )
    opening_year_match = re.search(r"\b(20\d{2})\s+OPENING\s+BALANCE\b", whole_text, re.I)
    start_year = (
        period.start.year if period else
        int(full_date_year_match.group(1)) if full_date_year_match else
        int(opening_year_match.group(1)) if opening_year_match else
        year_hint
    )
    if start_year is None:
        raise RuntimeError(
            "Could not infer the statement year. Pass --year YYYY. "
            "This should normally be unnecessary for browser Transaction Summary PDFs because the rows contain the year."
        )

    raw_rows: list[RawRow] = []
    opening_balance: Optional[float] = None
    closing_summary: Optional[float] = None
    last_layout: Optional[ColumnLayout] = None

    # Some classic statements show a separate summary closing balance outside the table.
    for text in page_texts:
        for line in text.splitlines():
            if "closing balance" in line.lower():
                val = parse_money(line)
                if val is not None:
                    closing_summary = val

    for pno, page in enumerate(doc, start=1):
        lines = cluster_words(page.get_text("words", sort=True))
        detected = detect_layout(lines)
        layout = detected or last_layout
        if layout is None:
            continue
        if detected is not None:
            last_layout = detected
            layout = detected

        current: Optional[RawRow] = None
        page_height = float(page.rect.height)

        for words in lines:
            y = sum((float(w[1]) + float(w[3])) / 2 for w in words) / len(words)
            if y <= layout.header_y + 2.0:
                continue
            # Footer location varies with page size; ignore the bottom ~30 points.
            if y >= page_height - 30:
                continue

            fields = words_to_fields(words, layout)
            full_line = normalize_space(" ".join(str(w[4]) for w in words))
            if not full_line or is_boilerplate(full_line):
                continue

            if layout.kind == "signed":
                date_text, tx_text, amount_text, balance_text = fields
                signed_amount = parse_money(amount_text)
                debit = -signed_amount if signed_amount is not None and signed_amount < 0 else None
                credit = signed_amount if signed_amount is not None and signed_amount >= 0 else None
            else:
                date_text, tx_text, debit_text, credit_text, balance_text = fields
                debit = parse_money(debit_text)
                credit = parse_money(credit_text)

            dm = DATE_CELL_RE.match(date_text)
            if dm:
                explicit_year = int(dm.group(3)) if dm.group(3) else None
                current = RawRow(
                    day=int(dm.group(1)),
                    month=MONTH_NUM[dm.group(2).title()],
                    year=explicit_year,
                    description=tx_text.strip(),
                    debit=debit,
                    credit=credit,
                    balance=parse_money(balance_text),
                    page=pno,
                    raw_lines=[full_line],
                )
                raw_rows.append(current)
            elif current is not None:
                # Card xx..., Value Date..., reference numbers and wrapped merchant text.
                continuation = tx_text.strip()
                if continuation:
                    if current.details or looks_like_transaction_metadata(continuation):
                        current.details.append(continuation)
                    else:
                        # Wrapped merchant/location text (for example a trailing "AUS")
                        # belongs in the clean description, not in metadata.
                        current.description = normalize_space(current.description + " " + continuation)
                if current.debit is None and debit is not None:
                    current.debit = debit
                if current.credit is None and credit is not None:
                    current.credit = credit
                if current.balance is None:
                    current.balance = parse_money(balance_text)
                current.raw_lines.append(full_line)

    if not raw_rows:
        raise RuntimeError(
            "No transaction rows were found. Supported CommBank headers are either:\n"
            "  Date | Transaction | Debit | Credit | Balance\n"
            "or\n"
            "  Date | Transaction details | Amount | Balance\n"
            "Run with --debug-text debug.txt and inspect the 'Detected layout' lines if this still fails."
        )

    # Assign years. Browser Transaction Summary rows already contain YYYY; classic
    # statements may only contain day+month and therefore need rollover logic.
    current_year = start_year
    last_month: Optional[int] = None
    dated_rows: list[tuple[date, RawRow]] = []
    for rr in raw_rows:
        if rr.year is not None:
            current_year = rr.year
        elif last_month is not None and rr.month < last_month:
            current_year += 1
        last_month = rr.month
        dated_rows.append((date(current_year, rr.month, rr.day), rr))

    txs: list[Transaction] = []
    closing_row_balance: Optional[float] = None

    for d, rr in dated_rows:
        desc_upper = rr.description.upper()
        if "OPENING BALANCE" in desc_upper:
            if rr.balance is not None:
                opening_balance = rr.balance
            continue
        if "CLOSING BALANCE" in desc_upper:
            if rr.balance is not None:
                closing_row_balance = rr.balance
            continue

        txs.append(Transaction(
            date=d,
            description=normalize_space(rr.description),
            details=normalize_space(" | ".join(rr.details)),
            debit=rr.debit,
            credit=rr.credit,
            balance=rr.balance,
            source_page=rr.page,
            raw=" | ".join(rr.raw_lines),
        ))

    if not txs:
        raise RuntimeError("Only opening/closing rows were found; no transactions were parsed.")

    # Browser Transaction Summary does not necessarily print an OPENING BALANCE row.
    # Infer it from: first running balance - first signed transaction amount.
    first = txs[0]
    first_explicit: Optional[float] = None
    if first.debit is not None or first.credit is not None:
        first_explicit = round((first.credit or 0.0) - (first.debit or 0.0), 2)
    if opening_balance is None and first.balance is not None and first_explicit is not None:
        opening_balance = round(first.balance - first_explicit, 2)
    if opening_balance is None:
        raise RuntimeError(
            "Could not determine the opening balance. The first parsed transaction must contain "
            "both an amount and a running balance if the PDF has no explicit OPENING BALANCE row."
        )

    expected_closing = closing_row_balance if closing_row_balance is not None else closing_summary

    # Reconcile every row. Running balance is the authoritative fallback.
    previous = opening_balance
    reconstructed = 0
    for tx in txs:
        explicit = None
        if tx.debit is not None or tx.credit is not None:
            explicit = round((tx.credit or 0.0) - (tx.debit or 0.0), 2)
        balance_delta = round(tx.balance - previous, 2) if tx.balance is not None else None

        if explicit is not None and balance_delta is not None:
            if abs(explicit - balance_delta) <= 0.011:
                tx.amount = explicit
            else:
                tx.amount = balance_delta
                tx.parse_status = (
                    f"Amount mismatch: PDF amount {explicit:.2f}, "
                    f"balance delta {balance_delta:.2f}; used balance"
                )
                reconstructed += 1
        elif balance_delta is not None:
            tx.amount = balance_delta
            tx.parse_status = "Amount reconstructed from running balance"
            reconstructed += 1
        elif explicit is not None:
            tx.amount = explicit
            tx.balance = round(previous + explicit, 2)
            tx.parse_status = "Balance reconstructed from amount"
            reconstructed += 1
        else:
            raise RuntimeError(
                f"Cannot determine amount for {tx.date.isoformat()} {tx.description!r} "
                f"on page {tx.source_page}."
            )

        if tx.amount < 0:
            tx.debit = -tx.amount
            tx.credit = 0.0
        else:
            tx.debit = 0.0
            tx.credit = tx.amount

        assert tx.balance is not None
        previous = tx.balance
        tx.category = categorize(tx)

    if expected_closing is None:
        # Browser Transaction Summary normally has the authoritative running balance
        # in the last transaction row rather than a separate closing summary.
        expected_closing = txs[-1].balance
    assert expected_closing is not None

    if abs(previous - expected_closing) > 0.011:
        raise RuntimeError(
            f"Statement did not reconcile: parsed closing ${previous:,.2f}, "
            f"statement closing ${expected_closing:,.2f}. Run with --debug-text to inspect the PDF layout."
        )

    if period is None:
        period = StatementPeriod(txs[0].date, txs[-1].date)

    return txs, round(opening_balance, 2), round(expected_closing, 2), period, reconstructed


# -----------------------------------------------------------------------------
# CATEGORIZATION
# -----------------------------------------------------------------------------


def categorize(tx: Transaction) -> str:
    d = tx.description.lower()
    amount = tx.amount or 0.0

    if amount > 0:
        if "direct credit" in d and any(k in d for k in ["ato", "grand united", "refund"]):
            return "Income - Refund/Reimbursement"
        if d.startswith("return") or "refund purchase" in d or "refund" in d:
            return "Income - Refund/Reimbursement"
        if "transfer from" in d or "fast transfer from" in d or "cash deposit" in d:
            return "Transfer In"
        if "direct credit" in d or "salary" in d or "wages" in d:
            return "Income - Recurring Direct Credit"
        return "Income - Other Credit"

    if d.startswith("imt ") or "transfer to " in d or d.startswith("fast transfer to") or "transfer to other bank" in d:
        return "Transfer Out"

    for category, fragments in CATEGORY_RULES:
        if any(fragment in d for fragment in fragments):
            return category
    return "Other"


# -----------------------------------------------------------------------------
# OUTPUT
# -----------------------------------------------------------------------------


def compute_workbook_cache(
    records: list[Transaction],
    complete_months: list[str],
) -> dict:
    """
    Pre-compute values that are also written as Excel formulas.

    XlsxWriter cannot calculate formulas itself, so without cached formula
    results Excel/LibreOffice charts initially see zeros. Supplying the cached
    results keeps formulas editable/recalculable while making the workbook and
    charts populated immediately on first open.
    """
    all_months = sorted({tx.date.strftime("%Y-%m") for tx in records})

    monthly: dict[str, dict[str, float]] = {}
    for month_key in all_months:
        month_rows = [tx for tx in records if tx.date.strftime("%Y-%m") == month_key]
        recurring = sum((tx.credit or 0.0) for tx in month_rows if tx.category == "Income - Recurring Direct Credit")
        refunds_other = sum(
            (tx.credit or 0.0)
            for tx in month_rows
            if tx.category in {"Income - Refund/Reimbursement", "Income - Other Credit"}
        )
        transfer_in = sum((tx.credit or 0.0) for tx in month_rows if tx.category == "Transfer In")
        transfer_out = sum((tx.debit or 0.0) for tx in month_rows if tx.category == "Transfer Out")
        spending = sum((tx.debit or 0.0) for tx in month_rows if tx.category != "Transfer Out")
        net = recurring + refunds_other + transfer_in - spending - transfer_out
        monthly[month_key] = {
            "recurring": recurring,
            "refunds_other": refunds_other,
            "transfer_in": transfer_in,
            "spending": spending,
            "transfer_out": transfer_out,
            "net": net,
        }

    category_month: dict[str, dict[str, float]] = {}
    category_average: dict[str, float] = {}
    for category in BUDGET_CAPS:
        category_month[category] = {}
        for month_key in complete_months:
            category_month[category][month_key] = sum(
                (tx.debit or 0.0)
                for tx in records
                if tx.date.strftime("%Y-%m") == month_key and tx.category == category
            )
        values = list(category_month[category].values())
        category_average[category] = (sum(values) / len(values)) if values else 0.0

    recurring_values = [
        monthly[m]["recurring"]
        for m in complete_months
        if m in monthly
    ]
    income_baseline = statistics.median(recurring_values) if recurring_values else 0.0

    month_budget_totals = {
        month_key: sum(category_month[category].get(month_key, 0.0) for category in BUDGET_CAPS)
        for month_key in complete_months
    }
    average_total = sum(category_average.values())
    cap_total = float(sum(BUDGET_CAPS.values()))
    delta_total = cap_total - average_total
    savings = income_baseline - cap_total
    savings_rate = savings / income_baseline if income_baseline else 0.0

    return {
        "all_months": all_months,
        "monthly": monthly,
        "category_month": category_month,
        "category_average": category_average,
        "income_baseline": income_baseline,
        "month_budget_totals": month_budget_totals,
        "average_total": average_total,
        "cap_total": cap_total,
        "delta_total": delta_total,
        "savings": savings,
        "savings_rate": savings_rate,
    }


def write_transactions_csv(records: list[Transaction], out_path: Path) -> None:
    with out_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow([
            "Date", "Description", "Details", "Category", "Amount_AUD", "Debit_AUD",
            "Credit_AUD", "Statement_Balance_AUD", "Month", "Parse_Status", "Source_Page", "Raw_Text",
        ])
        for tx in records:
            writer.writerow([
                tx.date.isoformat(), tx.description, tx.details, tx.category,
                f"{tx.amount:.2f}", f"{tx.debit:.2f}", f"{tx.credit:.2f}",
                f"{tx.balance:.2f}", tx.date.strftime("%Y-%m"), tx.parse_status,
                tx.source_page, tx.raw,
            ])


def write_xlsx(
    records: list[Transaction],
    opening: float,
    closing: float,
    period: Optional[StatementPeriod],
    reconstructed_count: int,
    source_name: str,
    out_path: Path,
) -> None:
    try:
        import xlsxwriter
        from xlsxwriter.utility import xl_col_to_name
    except ImportError as exc:
        raise RuntimeError(
            "XlsxWriter is required for Excel output. Install it with:\n"
            "    python -m pip install XlsxWriter"
        ) from exc

    wb = xlsxwriter.Workbook(out_path)
    wb.set_calc_mode("auto")

    dark = "#17324D"
    dark2 = "#244A66"
    light = "#EAF1F6"
    white = "#FFFFFF"
    yellow = "#FFF2CC"
    red = "#FCE8E6"

    fmt_title = wb.add_format({"bold": True, "font_color": white, "bg_color": dark, "font_size": 16})
    fmt_header = wb.add_format({"bold": True, "font_color": white, "bg_color": dark2, "align": "center", "valign": "vcenter", "text_wrap": True})
    fmt_money = wb.add_format({"num_format": '$#,##0.00;[Red]($#,##0.00);-'})
    fmt_percent = wb.add_format({"num_format": "0.0%"})
    fmt_date = wb.add_format({"num_format": "yyyy-mm-dd"})
    fmt_wrap = wb.add_format({"text_wrap": True})
    fmt_warn = wb.add_format({"bg_color": yellow, "text_wrap": True})
    fmt_review = wb.add_format({"bg_color": red, "text_wrap": True})
    fmt_section = wb.add_format({"bold": True, "font_color": white, "bg_color": dark2})
    fmt_kpi_label = wb.add_format({"bg_color": light, "bold": True})
    fmt_kpi_value = wb.add_format({"bg_color": light, "num_format": '$#,##0.00;[Red]($#,##0.00);-'})
    fmt_total = wb.add_format({"bold": True, "bg_color": light, "num_format": '$#,##0.00;[Red]($#,##0.00);-'})

    # Lists
    ws_lists = wb.add_worksheet("Lists")
    ws_lists.write(0, 0, "Category", fmt_header)
    for row, category in enumerate(ALL_CATEGORIES, start=1):
        ws_lists.write(row, 0, category)
    ws_lists.set_column("A:A", 36)

    # Transactions
    ws_tx = wb.add_worksheet("Transactions")
    headers = [
        "Date", "Description", "Details", "Category", "Amount (AUD)", "Debit (AUD)",
        "Credit (AUD)", "Statement Balance (AUD)", "Month", "Parse Status", "Source Page", "Raw PDF text",
    ]
    for col, h in enumerate(headers):
        ws_tx.write(0, col, h, fmt_header)

    for row, tx in enumerate(records, start=1):
        ws_tx.write_datetime(row, 0, datetime.combine(tx.date, datetime.min.time()), fmt_date)
        ws_tx.write(row, 1, tx.description)
        ws_tx.write(row, 2, tx.details, fmt_wrap)
        ws_tx.write(row, 3, tx.category)
        ws_tx.write_number(row, 4, tx.amount or 0.0, fmt_money)
        ws_tx.write_number(row, 5, tx.debit or 0.0, fmt_money)
        ws_tx.write_number(row, 6, tx.credit or 0.0, fmt_money)
        ws_tx.write_number(row, 7, tx.balance or 0.0, fmt_money)
        ws_tx.write(row, 8, tx.date.strftime("%Y-%m"))
        status_fmt = fmt_warn if tx.parse_status != "High confidence" else None
        ws_tx.write(row, 9, tx.parse_status, status_fmt)
        ws_tx.write_number(row, 10, tx.source_page)
        ws_tx.write(row, 11, tx.raw, fmt_wrap)

    last_excel_row = len(records) + 1
    ws_tx.data_validation(1, 3, len(records), 3, {
        "validate": "list",
        "source": f"=Lists!$A$2:$A${len(ALL_CATEGORIES)+1}",
    })
    ws_tx.add_table(0, 0, len(records), len(headers) - 1, {
        "name": "TransactionsTable",
        "columns": [{"header": h} for h in headers],
    })
    ws_tx.freeze_panes(1, 0)
    ws_tx.set_column("A:A", 12)
    ws_tx.set_column("B:B", 42)
    ws_tx.set_column("C:C", 34)
    ws_tx.set_column("D:D", 30)
    ws_tx.set_column("E:H", 18)
    ws_tx.set_column("I:I", 11)
    ws_tx.set_column("J:J", 42)
    ws_tx.set_column("K:K", 11)
    ws_tx.set_column("L:L", 55)

    # Compute summary values once in Python. They are used as cached results
    # for Excel formulas, which makes charts populate immediately even before
    # the spreadsheet application performs a recalculation.
    complete = complete_calendar_months(period, records)
    cache = compute_workbook_cache(records, complete)
    all_months = cache["all_months"]

    # Monthly Summary
    ws_month = wb.add_worksheet("Monthly Summary")
    month_headers = [
        "Month", "Recurring Direct Credit (AUD)", "Refunds / Other Income (AUD)",
        "Transfer In (AUD)", "Spending excl. Transfer Out (AUD)", "Transfer Out (AUD)",
        "Net Cash Flow (AUD)",
    ]
    for c, h in enumerate(month_headers):
        ws_month.write(0, c, h, fmt_header)

    for r, month_key in enumerate(all_months, start=1):
        excel_r = r + 1
        mcache = cache["monthly"][month_key]
        ws_month.write(r, 0, month_key)
        ws_month.write_formula(r, 1,
            f'=SUMIFS(Transactions!$G$2:$G${last_excel_row},Transactions!$I$2:$I${last_excel_row},$A{excel_r},Transactions!$D$2:$D${last_excel_row},"Income - Recurring Direct Credit")',
            fmt_money, mcache["recurring"])
        ws_month.write_formula(r, 2,
            f'=SUMIFS(Transactions!$G$2:$G${last_excel_row},Transactions!$I$2:$I${last_excel_row},$A{excel_r},Transactions!$D$2:$D${last_excel_row},"Income - Refund/Reimbursement")+'
            f'SUMIFS(Transactions!$G$2:$G${last_excel_row},Transactions!$I$2:$I${last_excel_row},$A{excel_r},Transactions!$D$2:$D${last_excel_row},"Income - Other Credit")',
            fmt_money, mcache["refunds_other"])
        ws_month.write_formula(r, 3,
            f'=SUMIFS(Transactions!$G$2:$G${last_excel_row},Transactions!$I$2:$I${last_excel_row},$A{excel_r},Transactions!$D$2:$D${last_excel_row},"Transfer In")',
            fmt_money, mcache["transfer_in"])
        ws_month.write_formula(r, 4,
            f'=SUMIFS(Transactions!$F$2:$F${last_excel_row},Transactions!$I$2:$I${last_excel_row},$A{excel_r})-'
            f'SUMIFS(Transactions!$F$2:$F${last_excel_row},Transactions!$I$2:$I${last_excel_row},$A{excel_r},Transactions!$D$2:$D${last_excel_row},"Transfer Out")',
            fmt_money, mcache["spending"])
        ws_month.write_formula(r, 5,
            f'=SUMIFS(Transactions!$F$2:$F${last_excel_row},Transactions!$I$2:$I${last_excel_row},$A{excel_r},Transactions!$D$2:$D${last_excel_row},"Transfer Out")',
            fmt_money, mcache["transfer_out"])
        ws_month.write_formula(
            r, 6, f"=B{excel_r}+C{excel_r}+D{excel_r}-E{excel_r}-F{excel_r}",
            fmt_money, mcache["net"]
        )

    ws_month.freeze_panes(1, 0)
    ws_month.set_column("A:A", 12)
    ws_month.set_column("B:G", 24)

    # Budget
    ws_budget = wb.add_worksheet("Budget")
    ws_budget.merge_range("A1:I1", "Suggested Monthly Budget", fmt_title)
    ws_budget.write("A2", "Recurring-income baseline", fmt_kpi_label)

    month_to_summary_row = {m: i + 2 for i, m in enumerate(all_months)}
    income_refs = [f"'Monthly Summary'!B{month_to_summary_row[m]}" for m in complete if m in month_to_summary_row]
    if income_refs:
        ws_budget.write_formula(
            "B2", "=MEDIAN(" + ",".join(income_refs) + ")", fmt_kpi_value,
            cache["income_baseline"]
        )
    else:
        ws_budget.write_number("B2", 0, fmt_kpi_value)

    budget_headers = ["Category"] + complete + ["Average", "Suggested Cap", "Cap vs Avg", "Comment"]
    header_row = 3
    for c, h in enumerate(budget_headers):
        ws_budget.write(header_row, c, h, fmt_header)

    start_row = header_row + 1
    for rr, (category, cap) in enumerate(BUDGET_CAPS.items(), start=start_row):
        ws_budget.write(rr, 0, category)
        for j, month_key in enumerate(complete, start=1):
            excel_rr = rr + 1
            ws_budget.write_formula(
                rr, j,
                f'=SUMIFS(Transactions!$F$2:$F${last_excel_row},Transactions!$I$2:$I${last_excel_row},"{month_key}",Transactions!$D$2:$D${last_excel_row},$A{excel_rr})',
                fmt_money, cache["category_month"][category].get(month_key, 0.0)
            )
        avg_col = 1 + len(complete)
        cap_col = avg_col + 1
        delta_col = cap_col + 1
        comment_col = delta_col + 1
        excel_rr = rr + 1
        if complete:
            first_col = xl_col_to_name(1)
            last_col = xl_col_to_name(len(complete))
            ws_budget.write_formula(
                rr, avg_col, f"=AVERAGE({first_col}{excel_rr}:{last_col}{excel_rr})",
                fmt_money, cache["category_average"][category]
            )
        else:
            ws_budget.write_number(rr, avg_col, 0, fmt_money)
        ws_budget.write_number(rr, cap_col, cap, fmt_money)
        avg_letter = xl_col_to_name(avg_col)
        cap_letter = xl_col_to_name(cap_col)
        ws_budget.write_formula(
            rr, delta_col, f"={cap_letter}{excel_rr}-{avg_letter}{excel_rr}",
            fmt_money, cap - cache["category_average"][category]
        )
        ws_budget.write(rr, comment_col, BUDGET_COMMENTS.get(category, ""), fmt_wrap)

    total_row = start_row + len(BUDGET_CAPS)
    ws_budget.write(total_row, 0, "TOTAL MONTHLY SPEND", fmt_total)
    for c in range(1, 1 + len(complete) + 3):
        col_letter = xl_col_to_name(c)
        if 1 <= c <= len(complete):
            cached_total = cache["month_budget_totals"].get(complete[c - 1], 0.0)
        elif c == 1 + len(complete):
            cached_total = cache["average_total"]
        elif c == 2 + len(complete):
            cached_total = cache["cap_total"]
        else:
            cached_total = cache["delta_total"]
        ws_budget.write_formula(
            total_row, c, f"=SUM({col_letter}{start_row+1}:{col_letter}{total_row})",
            fmt_total, cached_total
        )

    avg_col = 1 + len(complete)
    cap_col = avg_col + 1
    cap_col_letter = xl_col_to_name(cap_col)
    savings_row = total_row + 3
    ws_budget.write(savings_row, 0, "Budget outcome", fmt_section)
    ws_budget.write(savings_row + 1, 0, "Income baseline")
    ws_budget.write_formula(savings_row + 1, 1, "=$B$2", fmt_money, cache["income_baseline"])
    ws_budget.write(savings_row + 2, 0, "Suggested monthly spend")
    ws_budget.write_formula(savings_row + 2, 1, f"={cap_col_letter}{total_row+1}", fmt_money, cache["cap_total"])
    ws_budget.write(savings_row + 3, 0, "Implied monthly savings")
    ws_budget.write_formula(
        savings_row + 3, 1, f"=B{savings_row+2}-B{savings_row+3}", fmt_money, cache["savings"]
    )
    ws_budget.write(savings_row + 4, 0, "Savings rate")
    ws_budget.write_formula(
        savings_row + 4, 1, f"=IFERROR(B{savings_row+4}/B{savings_row+2},0)", fmt_percent,
        cache["savings_rate"]
    )

    ws_budget.freeze_panes(4, 0)
    ws_budget.set_column(0, 0, 30)
    ws_budget.set_column(1, max(1, len(complete) + 3), 15)
    ws_budget.set_column(max(1, len(complete) + 4), max(1, len(complete) + 4), 50)

    # Review sheet: make it obvious which merchants / parser rows need human attention.
    ws_review = wb.add_worksheet("Review")
    review_headers = ["Date", "Description", "Category", "Amount", "Parse Status", "Page", "Why shown"]
    for c, h in enumerate(review_headers):
        ws_review.write(0, c, h, fmt_header)
    review_row = 1
    for tx in records:
        reasons = []
        if tx.category == "Other":
            reasons.append("Uncategorized merchant")
        if tx.parse_status != "High confidence":
            reasons.append("Parser reconstruction / mismatch")
        if not reasons:
            continue
        ws_review.write_datetime(review_row, 0, datetime.combine(tx.date, datetime.min.time()), fmt_date)
        ws_review.write(review_row, 1, tx.description)
        ws_review.write(review_row, 2, tx.category)
        ws_review.write_number(review_row, 3, tx.amount or 0.0, fmt_money)
        ws_review.write(review_row, 4, tx.parse_status, fmt_warn if tx.parse_status != "High confidence" else None)
        ws_review.write_number(review_row, 5, tx.source_page)
        ws_review.write(review_row, 6, "; ".join(reasons), fmt_review if tx.category == "Other" else fmt_warn)
        review_row += 1
    ws_review.freeze_panes(1, 0)
    ws_review.set_column("A:A", 12)
    ws_review.set_column("B:B", 46)
    ws_review.set_column("C:C", 28)
    ws_review.set_column("D:D", 16)
    ws_review.set_column("E:E", 48)
    ws_review.set_column("F:F", 8)
    ws_review.set_column("G:G", 34)

    # Assumptions
    ws_a = wb.add_worksheet("Assumptions")
    ws_a.merge_range("A1:D1", "Parsing & budgeting assumptions", fmt_title)
    period_text = f"{period.start.isoformat()} to {period.end.isoformat()}" if period else "Not detected"
    assumptions = [
        ("Source", source_name, "Parser", "PyMuPDF text + coordinate columns; no OCR / no network"),
        ("Statement period", period_text, "Complete budget months", ", ".join(complete)),
        ("Opening balance", opening, "Closing balance", closing),
        ("Transactions", len(records), "Reconstructed / mismatched rows", reconstructed_count),
        ("Reconciliation", "Every amount is checked against the running balance.", "Failure mode", "Workbook is not written if the statement does not reconcile."),
        ("Income baseline", "Direct Credit / salary / wages are recurring income unless identified as refunds.", "Transfers", "Transfers and cash deposits are kept separate from recurring income."),
        ("Categories", "Merchant categories are heuristic and editable in Transactions column D.", "Permanent rules", "Edit CATEGORY_RULES near the top of this script."),
        ("Budget", "Suggested caps are editable near the top of this script.", "Partial months", "Only complete calendar months are used when the statement period allows it."),
    ]
    for r, row in enumerate(assumptions, start=2):
        for c, value in enumerate(row):
            fmt = fmt_money if isinstance(value, float) else fmt_wrap
            ws_a.write(r, c, value, fmt)
    ws_a.set_column("A:A", 24)
    ws_a.set_column("B:B", 62)
    ws_a.set_column("C:C", 26)
    ws_a.set_column("D:D", 62)

    # Dashboard
    ws_d = wb.add_worksheet("Dashboard")
    ws_d.merge_range("A1:H1", "Personal Budget Dashboard", fmt_title)
    ws_d.write("A3", "Period", fmt_kpi_label)
    ws_d.write("B3", period_text, fmt_kpi_label)
    ws_d.write("A4", "Transactions", fmt_kpi_label)
    ws_d.write_number("B4", len(records), fmt_kpi_label)
    ws_d.write("A5", "Opening balance", fmt_kpi_label)
    ws_d.write_number("B5", opening, fmt_kpi_value)
    ws_d.write("A6", "Closing balance", fmt_kpi_label)
    ws_d.write_number("B6", closing, fmt_kpi_value)
    ws_d.write("A7", "Rows needing parser reconstruction", fmt_kpi_label)
    ws_d.write_number("B7", reconstructed_count, fmt_kpi_label)

    ws_d.write("D3", "Recurring income baseline", fmt_kpi_label)
    ws_d.write_formula("E3", "=Budget!B2", fmt_kpi_value, cache["income_baseline"])
    ws_d.write("D4", "Suggested monthly budget", fmt_kpi_label)
    total_cap_cell = f"{cap_col_letter}{total_row+1}"
    ws_d.write_formula("E4", f"=Budget!{total_cap_cell}", fmt_kpi_value, cache["cap_total"])
    ws_d.write("D5", "Implied monthly savings", fmt_kpi_label)
    ws_d.write_formula("E5", "=E3-E4", fmt_kpi_value, cache["savings"])
    ws_d.write("D6", "Implied savings rate", fmt_kpi_label)
    ws_d.write_formula("E6", "=IFERROR(E5/E3,0)", fmt_percent, cache["savings_rate"])

    chart = wb.add_chart({"type": "column"})
    if all_months:
        chart.add_series({
            "name": "Recurring Income",
            "categories": ["Monthly Summary", 1, 0, len(all_months), 0],
            "values": ["Monthly Summary", 1, 1, len(all_months), 1],
        })
        chart.add_series({
            "name": "Spending",
            "categories": ["Monthly Summary", 1, 0, len(all_months), 0],
            "values": ["Monthly Summary", 1, 4, len(all_months), 4],
        })
    chart.set_title({"name": "Monthly recurring income vs spending"})
    chart.set_legend({"position": "bottom"})
    ws_d.insert_chart("A10", chart, {"x_scale": 1.45, "y_scale": 1.25})

    # Category-level view: observed average vs target cap. Formula cells have
    # cached numeric results, so this chart is populated immediately as well.
    budget_chart = wb.add_chart({"type": "bar"})
    budget_first_excel = start_row + 1
    budget_last_excel = total_row
    avg_excel_col = avg_col
    cap_excel_col = cap_col
    budget_chart.add_series({
        "name": "Observed monthly average",
        "categories": ["Budget", budget_first_excel - 1, 0, budget_last_excel - 1, 0],
        "values": ["Budget", budget_first_excel - 1, avg_excel_col, budget_last_excel - 1, avg_excel_col],
    })
    budget_chart.add_series({
        "name": "Suggested cap",
        "categories": ["Budget", budget_first_excel - 1, 0, budget_last_excel - 1, 0],
        "values": ["Budget", budget_first_excel - 1, cap_excel_col, budget_last_excel - 1, cap_excel_col],
    })
    budget_chart.set_title({"name": "Average spend vs suggested cap"})
    budget_chart.set_legend({"position": "bottom"})
    budget_chart.set_y_axis({"reverse": True})
    ws_d.insert_chart("G10", budget_chart, {"x_scale": 1.35, "y_scale": 1.65})

    ws_d.set_column("A:A", 30)
    ws_d.set_column("B:B", 24)
    ws_d.set_column("D:D", 28)
    ws_d.set_column("E:E", 18)

    # Make Dashboard the first visible tab even though it was written last.
    ws_d.activate()
    wb.close()


def default_output(input_path: Path) -> Path:
    return input_path.with_name(input_path.stem + "_structured_budget.xlsx")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse classic CommBank eStatements or browser Transaction Summary PDFs into clean transactions and a budget workbook."
    )
    parser.add_argument("input", type=Path, help="CommBank statement PDF")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output .xlsx path")
    parser.add_argument("--csv", type=Path, default=None, help="Clean transaction CSV path")
    parser.add_argument("--csv-only", action="store_true", help="Write only CSV (no XlsxWriter needed)")
    parser.add_argument("--password", default=None, help="Password for a protected statement PDF")
    parser.add_argument("--year", type=int, default=None, help="Fallback starting year if the PDF period cannot be inferred")
    parser.add_argument("--debug-text", type=Path, default=None, help="Write extracted PDF lines / detected headers for troubleshooting")
    args = parser.parse_args()

    if not args.input.exists():
        parser.error(f"Input does not exist: {args.input}")
    if args.input.suffix.lower() != ".pdf":
        parser.error("This version expects a .pdf statement. Use the earlier ODS parser for .ods dumps.")

    if args.debug_text:
        pdf_debug_dump(args.input, args.password, args.debug_text)

    records, opening, closing, period, reconstructed = parse_pdf(
        args.input, password=args.password, year_hint=args.year
    )

    output = args.output or default_output(args.input)
    csv_path = args.csv or output.with_name(output.stem + "_transactions.csv")
    write_transactions_csv(records, csv_path)

    if not args.csv_only:
        write_xlsx(
            records, opening, closing, period, reconstructed,
            source_name=args.input.name, out_path=output,
        )

    print(f"Transactions: {len(records)}")
    print(f"Opening balance: ${opening:,.2f}")
    print(f"Closing balance: ${closing:,.2f}")
    if period:
        print(f"Statement period: {period.start.isoformat()} to {period.end.isoformat()}")
    print(f"Rows reconstructed / mismatched: {reconstructed}")
    print(f"Clean CSV: {csv_path}")
    if not args.csv_only:
        print(f"Budget workbook: {output}")
    return 0



# =============================================================================
# V4: PERSISTENT MERCHANT RULES + MERCHANT-LEVEL REVIEW
# =============================================================================

BUDGET_CHARACTERS = [
    "Essential", "Discretionary", "Irregular", "Work/Admin",
    "Unknown", "Transfer", "Income",
]

EXTRA_CATEGORIES = ["Education & Professional"]
ALL_CATEGORIES_V4 = list(dict.fromkeys(ALL_CATEGORIES + EXTRA_CATEGORIES))

CATEGORY_CHARACTER_DEFAULTS = {
    "Housing - Rent": "Essential",
    "Groceries": "Essential",
    "Dining & Coffee": "Discretionary",
    "Utilities & Phone": "Essential",
    "Transport": "Essential",
    "Fitness & Memberships": "Discretionary",
    "Health & Pharmacy": "Essential",
    "Shopping": "Discretionary",
    "Beauty & Personal Care": "Discretionary",
    "Home & Household": "Essential",
    "Entertainment & Experiences": "Discretionary",
    "Subscriptions & Donations": "Discretionary",
    "Bank Fees": "Essential",
    "Government & Admin": "Irregular",
    "Travel": "Irregular",
    "Cash Withdrawal": "Unknown",
    "Other": "Unknown",
    "Education & Professional": "Work/Admin",
    "Transfer Out": "Transfer",
    "Transfer In": "Transfer",
    "Income - Recurring Direct Credit": "Income",
    "Income - Refund/Reimbursement": "Income",
    "Income - Other Credit": "Income",
}


@dataclass
class MerchantRule:
    enabled: bool
    priority: int
    match_type: str
    pattern: str
    canonical_name: str
    category: str
    budget_character: str
    status: str = "confirmed"
    notes: str = ""
    order: int = 0


# Starter rules are intentionally easy to edit in merchant_rules.csv.
# "suggested" rows are applied, but remain visible in Merchant Review until
# you change their status to "confirmed" (or disable/delete them).
DEFAULT_MERCHANT_RULE_ROWS = [
    # Transport
    (1, 220, "contains", "COSTCO GAS", "Costco Gas", "Transport", "Essential", "confirmed", "Fuel"),
    (1, 210, "contains", "TFNSW OPAL", "Transport for NSW", "Transport", "Essential", "confirmed", "Opal fare"),
    (1, 210, "contains", "TRANSPORTFORNSW", "Transport for NSW", "Transport", "Essential", "confirmed", "Opal / tap fare"),
    (1, 200, "contains", "13CABS", "13cabs", "Transport", "Essential", "confirmed", "Taxi"),
    (1, 200, "contains", "TAXIPAY", "Taxi", "Transport", "Essential", "confirmed", "Taxi"),
    (1, 200, "contains", "BP LAUDERDALE", "BP", "Transport", "Essential", "confirmed", "Fuel"),
    (1, 200, "contains", "AUTO DYNAMICS", "Auto Dynamics", "Transport", "Irregular", "confirmed", "Vehicle maintenance"),
    (1, 200, "contains", "OPUSPARK", "OpusPark", "Transport", "Essential", "confirmed", "Parking"),
    (1, 200, "contains", "SYDNEY OLYMPIC PARK P5", "Sydney Olympic Park Parking", "Transport", "Irregular", "confirmed", "Parking"),

    # Dining / coffee / delivery
    (1, 200, "contains", "HUNGRYPANDA", "HungryPanda", "Dining & Coffee", "Discretionary", "confirmed", "Food delivery"),
    (1, 200, "contains", "UBER *EATS", "Uber Eats", "Dining & Coffee", "Discretionary", "confirmed", "Food delivery"),
    (1, 200, "contains", "DOORDASH", "DoorDash", "Dining & Coffee", "Discretionary", "confirmed", "Food delivery"),
    (1, 190, "contains", "KAHII", "Kahii", "Dining & Coffee", "Discretionary", "suggested", "Recurring ~$7 purchases; confirm merchant"),
    (1, 190, "contains", "FLYING HAT", "Flying Hat", "Dining & Coffee", "Discretionary", "suggested", "Recurring small purchases; confirm merchant"),
    (1, 190, "contains", "BARREL BELOW", "Barrel Below", "Dining & Coffee", "Discretionary", "suggested", "Recurring ~$4 purchases; confirm merchant"),
    (1, 190, "contains", "COZY & BREW", "Cozy & Brew", "Dining & Coffee", "Discretionary", "confirmed", "Cafe / coffee"),
    (1, 180, "contains", "BETTYS BURGERS", "Betty's Burgers", "Dining & Coffee", "Discretionary", "confirmed", "Restaurant"),
    (1, 180, "contains", "KRISPY KREME", "Krispy Kreme", "Dining & Coffee", "Discretionary", "confirmed", "Food"),
    (1, 180, "contains", "GIRDLERS", "Girdlers", "Dining & Coffee", "Discretionary", "confirmed", "Cafe"),
    (1, 180, "contains", "BARE NAKED BOWLS", "Bare Naked Bowls", "Dining & Coffee", "Discretionary", "confirmed", "Food"),
    (1, 180, "contains", "STOCK MARKET KITCH", "Stock Market Kitchen", "Dining & Coffee", "Discretionary", "confirmed", "Food"),

    # Grocery / convenience
    (1, 200, "contains", "ALDI STORES", "ALDI", "Groceries", "Essential", "confirmed", "Groceries"),
    (1, 170, "contains", "COSTCO WHOLESALE", "Costco", "Groceries", "Essential", "suggested", "Costco can be mixed; review if needed"),
    (1, 170, "contains", "COSTCO AUBURN", "Costco", "Groceries", "Essential", "suggested", "Costco can be mixed; review if needed"),

    # Shopping / apparel
    (1, 200, "contains", "REBEL ", "Rebel", "Shopping", "Discretionary", "confirmed", "Sporting goods"),
    (1, 200, "contains", "ASOS", "ASOS", "Shopping", "Discretionary", "confirmed", "Clothing"),
    (1, 200, "contains", "THREDUP", "ThredUp", "Shopping", "Discretionary", "confirmed", "Clothing"),
    (1, 200, "contains", "ON SPORTSWEAR", "On", "Shopping", "Discretionary", "confirmed", "Apparel / footwear"),
    (1, 200, "contains", "ADIDAS", "Adidas", "Shopping", "Discretionary", "confirmed", "Apparel / footwear"),
    (1, 200, "contains", "DEPOP", "Depop", "Shopping", "Discretionary", "confirmed", "Clothing marketplace"),
    (1, 200, "contains", "THE-ICONIC", "The Iconic", "Shopping", "Discretionary", "confirmed", "Shopping"),
    (1, 200, "contains", "THE ICONIC", "The Iconic", "Shopping", "Discretionary", "confirmed", "Shopping"),
    (1, 200, "contains", "TEMU", "Temu", "Shopping", "Discretionary", "confirmed", "Shopping"),
    (1, 200, "contains", "PATAGONIA", "Patagonia", "Shopping", "Discretionary", "confirmed", "Apparel"),
    (1, 200, "contains", "MILLIGRAM", "Milligram", "Shopping", "Discretionary", "confirmed", "Stationery / shopping"),

    # Health / beauty
    (1, 210, "contains", "LAVERTY PATHOLOGY", "Laverty Pathology", "Health & Pharmacy", "Essential", "confirmed", "Pathology"),
    (1, 210, "contains", "RAINBOWMEDICINE", "Rainbow Medicine", "Health & Pharmacy", "Essential", "confirmed", "Medical"),
    (1, 210, "contains", "QUEEN AND BOURKE PHARM", "Queen & Bourke Pharmacy", "Health & Pharmacy", "Essential", "confirmed", "Pharmacy"),
    (1, 200, "contains", "BEAUTYFASCIA", "BeautyFascia", "Beauty & Personal Care", "Discretionary", "confirmed", "Beauty"),
    (1, 200, "contains", "AUSTRALIANSKINCLINICS", "Australian Skin Clinics", "Beauty & Personal Care", "Discretionary", "confirmed", "Beauty / skin"),
    (1, 190, "contains", "THINK AGAIN LASER", "Think Again Laser", "Beauty & Personal Care", "Irregular", "suggested", "Confirm whether cosmetic or medical"),
    (1, 180, "contains", "CUTS AVENUE", "Cuts Avenue", "Beauty & Personal Care", "Discretionary", "suggested", "Likely hair / personal care"),

    # Travel / accommodation
    (1, 220, "contains", "AIRBNB", "Airbnb", "Travel", "Irregular", "confirmed", "Accommodation"),
    (1, 210, "contains", "AIRPORTRENTALS", "AirportRentals.com", "Travel", "Irregular", "confirmed", "Rental car / travel"),
    (1, 210, "contains", "MANTRA 2 BOND", "Mantra", "Travel", "Irregular", "confirmed", "Accommodation"),
    (1, 210, "contains", "SEALINK TASMANIA", "SeaLink Tasmania", "Travel", "Irregular", "confirmed", "Travel / ferry"),

    # Education / professional / admin
    (1, 220, "contains", "IELTS", "IELTS", "Education & Professional", "Work/Admin", "confirmed", "Exam / professional admin"),
    (1, 220, "contains", "THE UNI OF SYDNEY", "University of Sydney", "Education & Professional", "Work/Admin", "confirmed", "University expense"),
    (1, 220, "contains", "WORLDWIDE INTERPRETERS", "Worldwide Interpreters", "Education & Professional", "Work/Admin", "suggested", "Confirm personal vs professional/admin"),
    (1, 220, "contains", "OZBARCODES", "OzBarcodes", "Education & Professional", "Work/Admin", "suggested", "Professional/business-like expense"),
    (1, 220, "contains", "GS1 US", "GS1 US", "Education & Professional", "Work/Admin", "suggested", "Professional/business-like expense"),
    (1, 220, "contains", "KWIK KOPY", "Kwik Kopy", "Education & Professional", "Work/Admin", "suggested", "Printing; confirm personal vs professional"),

    # Subscriptions / digital
    (1, 210, "contains", "AMZNPRIMEA", "Amazon Prime", "Subscriptions & Donations", "Discretionary", "confirmed", "Amazon Prime"),
    (1, 190, "contains", "GOOGLE CLAUDE BY ANTH", "Claude", "Subscriptions & Donations", "Discretionary", "suggested", "Likely Claude subscription; confirm"),

    # Recreation / government
    (1, 200, "contains", "NSW NATIONAL PARKS", "NSW National Parks", "Entertainment & Experiences", "Irregular", "confirmed", "Recreation"),
    (1, 200, "contains", "SNSW*NSW PARKS", "NSW National Parks", "Entertainment & Experiences", "Irregular", "confirmed", "Recreation"),
    (1, 180, "contains", "DEE WHY LIBRARY", "Dee Why Library", "Government & Admin", "Irregular", "suggested", "Library fee / printing"),
]


def _truthy(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def write_default_merchant_rules(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow([
            "enabled", "priority", "match_type", "pattern", "canonical_name",
            "category", "budget_character", "status", "notes",
        ])
        writer.writerows(DEFAULT_MERCHANT_RULE_ROWS)


def load_merchant_rules(path: Path) -> list[MerchantRule]:
    rules: list[MerchantRule] = []
    with path.open("r", newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        required = {"enabled", "priority", "match_type", "pattern", "canonical_name", "category", "budget_character", "status", "notes"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise RuntimeError(f"Merchant rules file is missing columns: {', '.join(sorted(missing))}")
        for order, row in enumerate(reader):
            pattern = (row.get("pattern") or "").strip()
            if not pattern:
                continue
            match_type = (row.get("match_type") or "contains").strip().lower()
            if match_type not in {"contains", "exact", "regex"}:
                raise RuntimeError(f"Unsupported match_type {match_type!r} for rule {pattern!r}")
            category = (row.get("category") or "Other").strip()
            budget_character = (row.get("budget_character") or CATEGORY_CHARACTER_DEFAULTS.get(category, "Unknown")).strip()
            if budget_character not in BUDGET_CHARACTERS:
                raise RuntimeError(f"Unsupported budget_character {budget_character!r} for rule {pattern!r}")
            rules.append(MerchantRule(
                enabled=_truthy(row.get("enabled", "1")),
                priority=int((row.get("priority") or "100").strip()),
                match_type=match_type,
                pattern=pattern,
                canonical_name=(row.get("canonical_name") or "").strip(),
                category=category,
                budget_character=budget_character,
                status=(row.get("status") or "confirmed").strip().lower(),
                notes=(row.get("notes") or "").strip(),
                order=order,
            ))
    rules.sort(key=lambda r: (-r.priority, r.order))
    return rules


def merchant_signature(description: str) -> str:
    """Create a stable-ish merchant label for aggregating unmatched rows."""
    s = normalize_space(description)
    s = re.sub(r"^(?:SQ\s*\*|LSP\*|ZLR\*|SMP\*|DD\s*\*|LS\s+|SP\s+)", "", s, flags=re.I)
    s = re.sub(r"\b(?:NSW|NS|VIC|VI|QLD|SA|WA|TAS|TA|ACT|NT)\b", " ", s, flags=re.I)
    s = re.sub(r"\b(?:AUSTRALIA|AUS|AU|USA|US)\b", " ", s, flags=re.I)
    s = re.sub(r"\b\d{7,}\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -_*.")
    return s or normalize_space(description)


def _rule_matches(rule: MerchantRule, tx: Transaction) -> bool:
    if not rule.enabled:
        return False
    haystack = normalize_space(f"{tx.description} {tx.details}")
    if rule.match_type == "contains":
        return rule.pattern.casefold() in haystack.casefold()
    if rule.match_type == "exact":
        return rule.pattern.casefold() == tx.description.casefold()
    try:
        return re.search(rule.pattern, haystack, flags=re.I) is not None
    except re.error as exc:
        raise RuntimeError(f"Invalid regex in merchant rule {rule.pattern!r}: {exc}") from exc


def apply_merchant_rules(records: list[Transaction], rules: list[MerchantRule]) -> None:
    """Apply system flow rules first, then persistent merchant rules, then fallbacks."""
    for tx in records:
        d = tx.description.lower()
        amount = tx.amount or 0.0
        tx.merchant = merchant_signature(tx.description)
        tx.rule_match = ""
        tx.rule_status = "system"

        # Money-flow categories are not merchant choices and intentionally win.
        if amount > 0:
            if "direct credit" in d and any(k in d for k in ["ato", "grand united", "refund"]):
                tx.category = "Income - Refund/Reimbursement"
            elif d.startswith("return") or "refund purchase" in d or "refund" in d:
                tx.category = "Income - Refund/Reimbursement"
            elif "transfer from" in d or "fast transfer from" in d or "cash deposit" in d:
                tx.category = "Transfer In"
            elif "direct credit" in d or "salary" in d or "wages" in d:
                tx.category = "Income - Recurring Direct Credit"
            else:
                tx.category = "Income - Other Credit"
            tx.budget_character = CATEGORY_CHARACTER_DEFAULTS[tx.category]
            tx.merchant = merchant_signature(tx.description)
            continue

        if d.startswith("imt ") or "transfer to " in d or d.startswith("fast transfer to") or "transfer to other bank" in d:
            tx.category = "Transfer Out"
            tx.budget_character = "Transfer"
            continue

        matched: Optional[MerchantRule] = None
        for rule in rules:
            if _rule_matches(rule, tx):
                matched = rule
                break

        if matched is not None:
            tx.category = matched.category
            tx.budget_character = matched.budget_character or CATEGORY_CHARACTER_DEFAULTS.get(matched.category, "Unknown")
            tx.merchant = matched.canonical_name or merchant_signature(tx.description)
            tx.rule_match = f"{matched.match_type}:{matched.pattern}"
            tx.rule_status = matched.status or "confirmed"
            continue

        # Generic built-in rules remain a safety net; permanent user decisions
        # belong in merchant_rules.csv rather than in the Python source.
        fallback_match = ""
        fallback_category = "Other"
        for category, fragments in CATEGORY_RULES:
            fragment = next((fragment for fragment in fragments if fragment in d), None)
            if fragment is not None:
                fallback_category = category
                fallback_match = fragment
                break
        tx.category = fallback_category
        tx.budget_character = CATEGORY_CHARACTER_DEFAULTS.get(fallback_category, "Unknown")
        tx.rule_match = f"fallback:{fallback_match}" if fallback_match else ""
        tx.rule_status = "fallback" if fallback_category != "Other" else "unmatched"


def merchant_review_rows(records: list[Transaction]) -> list[dict]:
    groups: dict[str, list[Transaction]] = defaultdict(list)
    for tx in records:
        if (tx.amount or 0.0) >= 0:
            continue
        status = getattr(tx, "rule_status", "unmatched")
        character = getattr(tx, "budget_character", "Unknown")
        if tx.category == "Other" or status in {"unmatched", "suggested"} or character == "Unknown":
            groups[getattr(tx, "merchant", merchant_signature(tx.description))].append(tx)

    out = []
    for merchant, rows in groups.items():
        spend_values = [tx.debit or 0.0 for tx in rows]
        categories = sorted({tx.category for tx in rows})
        characters = sorted({getattr(tx, "budget_character", "Unknown") for tx in rows})
        statuses = sorted({getattr(tx, "rule_status", "unmatched") for tx in rows})
        matches = sorted({getattr(tx, "rule_match", "") for tx in rows if getattr(tx, "rule_match", "")})
        examples = []
        for tx in rows:
            if tx.description not in examples:
                examples.append(tx.description)
            if len(examples) >= 3:
                break
        reasons = []
        if "unmatched" in statuses or any(tx.category == "Other" for tx in rows):
            reasons.append("No confirmed merchant rule")
        if "suggested" in statuses:
            reasons.append("Suggested rule — confirm or edit")
        if "Unknown" in characters:
            reasons.append("Budget character unknown")
        out.append({
            "merchant": merchant,
            "transactions": len(rows),
            "total_spend": sum(spend_values),
            "median_spend": statistics.median(spend_values) if spend_values else 0.0,
            "average_spend": statistics.mean(spend_values) if spend_values else 0.0,
            "first_seen": min(tx.date for tx in rows),
            "last_seen": max(tx.date for tx in rows),
            "category": ", ".join(categories),
            "budget_character": ", ".join(characters),
            "rule_status": ", ".join(statuses),
            "rule_match": ", ".join(matches),
            "examples": " | ".join(examples),
            "why_review": "; ".join(reasons),
        })
    out.sort(key=lambda x: (-x["total_spend"], -x["transactions"], x["merchant"].casefold()))
    return out


def write_merchant_review_csv(records: list[Transaction], out_path: Path) -> None:
    rows = merchant_review_rows(records)
    with out_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow([
            "Merchant", "Transactions", "Total_Spend_AUD", "Median_AUD", "Average_AUD",
            "First_Seen", "Last_Seen", "Current_Category", "Budget_Character",
            "Rule_Status", "Rule_Match", "Example_Descriptions", "Why_Review",
        ])
        for row in rows:
            writer.writerow([
                row["merchant"], row["transactions"], f'{row["total_spend"]:.2f}',
                f'{row["median_spend"]:.2f}', f'{row["average_spend"]:.2f}',
                row["first_seen"].isoformat(), row["last_seen"].isoformat(), row["category"],
                row["budget_character"], row["rule_status"], row["rule_match"],
                row["examples"], row["why_review"],
            ])


def compute_workbook_cache(records: list[Transaction], complete_months: list[str]) -> dict:
    all_months = sorted({tx.date.strftime("%Y-%m") for tx in records})
    monthly: dict[str, dict[str, float]] = {}
    for month_key in all_months:
        month_rows = [tx for tx in records if tx.date.strftime("%Y-%m") == month_key]
        recurring = sum((tx.credit or 0.0) for tx in month_rows if tx.category == "Income - Recurring Direct Credit")
        refunds_other = sum((tx.credit or 0.0) for tx in month_rows if tx.category in {"Income - Refund/Reimbursement", "Income - Other Credit"})
        transfer_in = sum((tx.credit or 0.0) for tx in month_rows if tx.category == "Transfer In")
        transfer_out = sum((tx.debit or 0.0) for tx in month_rows if tx.category == "Transfer Out")
        chars = {}
        for character in ["Essential", "Discretionary", "Irregular", "Work/Admin", "Unknown"]:
            chars[character] = sum(
                (tx.debit or 0.0) for tx in month_rows
                if getattr(tx, "budget_character", "Unknown") == character
            )
        spending = sum(chars.values())
        net = recurring + refunds_other + transfer_in - spending - transfer_out
        monthly[month_key] = {
            "recurring": recurring,
            "refunds_other": refunds_other,
            "transfer_in": transfer_in,
            "essential": chars["Essential"],
            "discretionary": chars["Discretionary"],
            "irregular": chars["Irregular"],
            "work_admin": chars["Work/Admin"],
            "unknown": chars["Unknown"],
            "spending": spending,
            "transfer_out": transfer_out,
            "net": net,
        }

    category_month: dict[str, dict[str, float]] = {}
    category_average: dict[str, float] = {}
    for category in BUDGET_CAPS:
        category_month[category] = {}
        for month_key in complete_months:
            category_month[category][month_key] = sum(
                (tx.debit or 0.0) for tx in records
                if tx.date.strftime("%Y-%m") == month_key and tx.category == category
            )
        values = list(category_month[category].values())
        category_average[category] = (sum(values) / len(values)) if values else 0.0

    recurring_values = [monthly[m]["recurring"] for m in complete_months if m in monthly]
    income_baseline = statistics.median(recurring_values) if recurring_values else 0.0
    core_month_values = [
        monthly[m]["essential"] + monthly[m]["discretionary"]
        for m in complete_months if m in monthly
    ]
    core_spend_average = statistics.mean(core_month_values) if core_month_values else 0.0
    irregular_values = [monthly[m]["irregular"] for m in complete_months if m in monthly]
    irregular_average = statistics.mean(irregular_values) if irregular_values else 0.0
    unknown_values = [monthly[m]["unknown"] for m in complete_months if m in monthly]
    unknown_average = statistics.mean(unknown_values) if unknown_values else 0.0

    month_budget_totals = {
        month_key: sum(category_month[category].get(month_key, 0.0) for category in BUDGET_CAPS)
        for month_key in complete_months
    }
    average_total = sum(category_average.values())
    cap_total = float(sum(BUDGET_CAPS.values()))
    delta_total = cap_total - average_total
    savings = income_baseline - cap_total
    savings_rate = savings / income_baseline if income_baseline else 0.0

    return {
        "all_months": all_months,
        "monthly": monthly,
        "category_month": category_month,
        "category_average": category_average,
        "income_baseline": income_baseline,
        "core_spend_average": core_spend_average,
        "irregular_average": irregular_average,
        "unknown_average": unknown_average,
        "month_budget_totals": month_budget_totals,
        "average_total": average_total,
        "cap_total": cap_total,
        "delta_total": delta_total,
        "savings": savings,
        "savings_rate": savings_rate,
    }


def write_transactions_csv(records: list[Transaction], out_path: Path) -> None:
    with out_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow([
            "Date", "Description", "Details", "Merchant", "Category", "Budget_Character",
            "Rule_Status", "Rule_Match", "Amount_AUD", "Debit_AUD", "Credit_AUD",
            "Statement_Balance_AUD", "Month", "Parse_Status", "Source_Page", "Raw_Text",
        ])
        for tx in records:
            writer.writerow([
                tx.date.isoformat(), tx.description, tx.details,
                getattr(tx, "merchant", merchant_signature(tx.description)), tx.category,
                getattr(tx, "budget_character", "Unknown"), getattr(tx, "rule_status", ""),
                getattr(tx, "rule_match", ""), f"{(tx.amount or 0.0):.2f}",
                f"{(tx.debit or 0.0):.2f}", f"{(tx.credit or 0.0):.2f}",
                f"{(tx.balance or 0.0):.2f}", tx.date.strftime("%Y-%m"), tx.parse_status,
                tx.source_page, tx.raw,
            ])


def write_xlsx(
    records: list[Transaction],
    opening: float,
    closing: float,
    period: Optional[StatementPeriod],
    reconstructed_count: int,
    source_name: str,
    out_path: Path,
    rules: Optional[list[MerchantRule]] = None,
    rules_path: Optional[Path] = None,
) -> None:
    try:
        import xlsxwriter
        from xlsxwriter.utility import xl_col_to_name
    except ImportError as exc:
        raise RuntimeError(
            "XlsxWriter is required for Excel output. Install it with:\n"
            "    python -m pip install XlsxWriter"
        ) from exc

    rules = rules or []
    review_rows = merchant_review_rows(records)
    complete = complete_calendar_months(period, records)
    cache = compute_workbook_cache(records, complete)
    all_months = cache["all_months"]

    wb = xlsxwriter.Workbook(out_path)
    wb.set_calc_mode("auto")

    dark = "#17324D"
    dark2 = "#244A66"
    light = "#EAF1F6"
    white = "#FFFFFF"
    yellow = "#FFF2CC"
    red = "#FCE8E6"
    green = "#E2F0D9"

    fmt_title = wb.add_format({"bold": True, "font_color": white, "bg_color": dark, "font_size": 16})
    fmt_header = wb.add_format({"bold": True, "font_color": white, "bg_color": dark2, "align": "center", "valign": "vcenter", "text_wrap": True})
    fmt_money = wb.add_format({"num_format": '$#,##0.00;[Red]($#,##0.00);-'})
    fmt_percent = wb.add_format({"num_format": "0.0%"})
    fmt_date = wb.add_format({"num_format": "yyyy-mm-dd"})
    fmt_wrap = wb.add_format({"text_wrap": True})
    fmt_warn = wb.add_format({"bg_color": yellow, "text_wrap": True})
    fmt_review = wb.add_format({"bg_color": red, "text_wrap": True})
    fmt_confirm = wb.add_format({"bg_color": green, "text_wrap": True})
    fmt_section = wb.add_format({"bold": True, "font_color": white, "bg_color": dark2})
    fmt_kpi_label = wb.add_format({"bg_color": light, "bold": True})
    fmt_kpi_value = wb.add_format({"bg_color": light, "num_format": '$#,##0.00;[Red]($#,##0.00);-'})
    fmt_total = wb.add_format({"bold": True, "bg_color": light, "num_format": '$#,##0.00;[Red]($#,##0.00);-'})

    # Column indexes in Transactions; keep formulas readable through these constants.
    C_DATE, C_DESC, C_DETAILS, C_MERCHANT, C_CATEGORY, C_CHAR, C_RSTATUS, C_RMATCH = range(8)
    C_AMOUNT, C_DEBIT, C_CREDIT, C_BALANCE, C_MONTH, C_PARSE, C_PAGE, C_RAW = range(8, 16)
    tx_letters = {i: xl_col_to_name(i) for i in range(16)}

    # Dashboard first so the workbook opens where the user expects.
    ws_d = wb.add_worksheet("Dashboard")
    ws_tx = wb.add_worksheet("Transactions")
    ws_month = wb.add_worksheet("Monthly Summary")
    ws_budget = wb.add_worksheet("Budget")
    ws_review = wb.add_worksheet("Merchant Review")
    ws_rules = wb.add_worksheet("Merchant Rules")
    ws_parser = wb.add_worksheet("Parser Review")
    ws_a = wb.add_worksheet("Assumptions")
    ws_lists = wb.add_worksheet("Lists")

    # Lists / validation sources.
    ws_lists.write(0, 0, "Category", fmt_header)
    for row, category in enumerate(ALL_CATEGORIES_V4, start=1):
        ws_lists.write(row, 0, category)
    ws_lists.write(0, 1, "Budget Character", fmt_header)
    for row, character in enumerate(BUDGET_CHARACTERS, start=1):
        ws_lists.write(row, 1, character)
    ws_lists.write(0, 2, "Rule Status", fmt_header)
    for row, status in enumerate(["confirmed", "suggested", "fallback", "unmatched", "system"], start=1):
        ws_lists.write(row, 2, status)
    ws_lists.set_column("A:A", 36)
    ws_lists.set_column("B:C", 20)

    # Transactions.
    headers = [
        "Date", "Description", "Details", "Merchant", "Category", "Budget Character",
        "Rule Status", "Rule Match", "Amount (AUD)", "Debit (AUD)", "Credit (AUD)",
        "Statement Balance (AUD)", "Month", "Parse Status", "Source Page", "Raw PDF text",
    ]
    for col, h in enumerate(headers):
        ws_tx.write(0, col, h, fmt_header)
    for row, tx in enumerate(records, start=1):
        ws_tx.write_datetime(row, C_DATE, datetime.combine(tx.date, datetime.min.time()), fmt_date)
        ws_tx.write(row, C_DESC, tx.description)
        ws_tx.write(row, C_DETAILS, tx.details, fmt_wrap)
        ws_tx.write(row, C_MERCHANT, getattr(tx, "merchant", merchant_signature(tx.description)))
        ws_tx.write(row, C_CATEGORY, tx.category)
        ws_tx.write(row, C_CHAR, getattr(tx, "budget_character", "Unknown"))
        rstatus = getattr(tx, "rule_status", "")
        rfmt = fmt_warn if rstatus == "suggested" else (fmt_review if rstatus == "unmatched" else None)
        ws_tx.write(row, C_RSTATUS, rstatus, rfmt)
        ws_tx.write(row, C_RMATCH, getattr(tx, "rule_match", ""), fmt_wrap)
        ws_tx.write_number(row, C_AMOUNT, tx.amount or 0.0, fmt_money)
        ws_tx.write_number(row, C_DEBIT, tx.debit or 0.0, fmt_money)
        ws_tx.write_number(row, C_CREDIT, tx.credit or 0.0, fmt_money)
        ws_tx.write_number(row, C_BALANCE, tx.balance or 0.0, fmt_money)
        ws_tx.write(row, C_MONTH, tx.date.strftime("%Y-%m"))
        status_fmt = fmt_warn if tx.parse_status != "High confidence" else None
        ws_tx.write(row, C_PARSE, tx.parse_status, status_fmt)
        ws_tx.write_number(row, C_PAGE, tx.source_page)
        ws_tx.write(row, C_RAW, tx.raw, fmt_wrap)

    last_excel_row = len(records) + 1
    ws_tx.data_validation(1, C_CATEGORY, len(records), C_CATEGORY, {
        "validate": "list", "source": f"=Lists!$A$2:$A${len(ALL_CATEGORIES_V4)+1}",
    })
    ws_tx.data_validation(1, C_CHAR, len(records), C_CHAR, {
        "validate": "list", "source": f"=Lists!$B$2:$B${len(BUDGET_CHARACTERS)+1}",
    })
    ws_tx.add_table(0, 0, len(records), len(headers) - 1, {
        "name": "TransactionsTable", "columns": [{"header": h} for h in headers],
    })
    ws_tx.freeze_panes(1, 0)
    ws_tx.set_column("A:A", 12)
    ws_tx.set_column("B:B", 42)
    ws_tx.set_column("C:C", 34)
    ws_tx.set_column("D:D", 28)
    ws_tx.set_column("E:F", 24)
    ws_tx.set_column("G:H", 24)
    ws_tx.set_column("I:L", 18)
    ws_tx.set_column("M:M", 11)
    ws_tx.set_column("N:N", 42)
    ws_tx.set_column("O:O", 11)
    ws_tx.set_column("P:P", 55)

    # Monthly Summary: spending character is a separate dimension from category.
    month_headers = [
        "Month", "Recurring Income", "Refunds / Other Income", "Transfer In",
        "Essential Spend", "Discretionary Spend", "Irregular Spend", "Work/Admin Spend",
        "Unknown Spend", "Total Spend excl. Transfers", "Transfer Out", "Net Cash Flow",
    ]
    for c, h in enumerate(month_headers):
        ws_month.write(0, c, h, fmt_header)

    col_credit = tx_letters[C_CREDIT]
    col_debit = tx_letters[C_DEBIT]
    col_month = tx_letters[C_MONTH]
    col_category = tx_letters[C_CATEGORY]
    col_char = tx_letters[C_CHAR]

    for r, month_key in enumerate(all_months, start=1):
        er = r + 1
        mc = cache["monthly"][month_key]
        ws_month.write(r, 0, month_key)
        ws_month.write_formula(r, 1,
            f'=SUMIFS(Transactions!${col_credit}$2:${col_credit}${last_excel_row},Transactions!${col_month}$2:${col_month}${last_excel_row},$A{er},Transactions!${col_category}$2:${col_category}${last_excel_row},"Income - Recurring Direct Credit")',
            fmt_money, mc["recurring"])
        ws_month.write_formula(r, 2,
            f'=SUMIFS(Transactions!${col_credit}$2:${col_credit}${last_excel_row},Transactions!${col_month}$2:${col_month}${last_excel_row},$A{er},Transactions!${col_category}$2:${col_category}${last_excel_row},"Income - Refund/Reimbursement")+'
            f'SUMIFS(Transactions!${col_credit}$2:${col_credit}${last_excel_row},Transactions!${col_month}$2:${col_month}${last_excel_row},$A{er},Transactions!${col_category}$2:${col_category}${last_excel_row},"Income - Other Credit")',
            fmt_money, mc["refunds_other"])
        ws_month.write_formula(r, 3,
            f'=SUMIFS(Transactions!${col_credit}$2:${col_credit}${last_excel_row},Transactions!${col_month}$2:${col_month}${last_excel_row},$A{er},Transactions!${col_category}$2:${col_category}${last_excel_row},"Transfer In")',
            fmt_money, mc["transfer_in"])
        for c, character, key in [
            (4, "Essential", "essential"), (5, "Discretionary", "discretionary"),
            (6, "Irregular", "irregular"), (7, "Work/Admin", "work_admin"), (8, "Unknown", "unknown"),
        ]:
            ws_month.write_formula(r, c,
                f'=SUMIFS(Transactions!${col_debit}$2:${col_debit}${last_excel_row},Transactions!${col_month}$2:${col_month}${last_excel_row},$A{er},Transactions!${col_char}$2:${col_char}${last_excel_row},"{character}")',
                fmt_money, mc[key])
        ws_month.write_formula(r, 9, f"=SUM(E{er}:I{er})", fmt_money, mc["spending"])
        ws_month.write_formula(r, 10,
            f'=SUMIFS(Transactions!${col_debit}$2:${col_debit}${last_excel_row},Transactions!${col_month}$2:${col_month}${last_excel_row},$A{er},Transactions!${col_category}$2:${col_category}${last_excel_row},"Transfer Out")',
            fmt_money, mc["transfer_out"])
        ws_month.write_formula(r, 11, f"=B{er}+C{er}+D{er}-J{er}-K{er}", fmt_money, mc["net"])
    ws_month.freeze_panes(1, 0)
    ws_month.set_column("A:A", 12)
    ws_month.set_column("B:L", 20)

    # Budget by category, preserving the familiar cap model.
    ws_budget.merge_range("A1:I1", "Suggested Monthly Budget", fmt_title)
    ws_budget.write("A2", "Recurring-income baseline", fmt_kpi_label)
    month_to_summary_row = {m: i + 2 for i, m in enumerate(all_months)}
    income_refs = [f"'Monthly Summary'!B{month_to_summary_row[m]}" for m in complete if m in month_to_summary_row]
    if income_refs:
        ws_budget.write_formula("B2", "=MEDIAN(" + ",".join(income_refs) + ")", fmt_kpi_value, cache["income_baseline"])
    else:
        ws_budget.write_number("B2", 0, fmt_kpi_value)

    budget_headers = ["Category"] + complete + ["Average", "Suggested Cap", "Cap vs Avg", "Comment"]
    header_row = 3
    for c, h in enumerate(budget_headers):
        ws_budget.write(header_row, c, h, fmt_header)
    start_row = header_row + 1
    avg_col = 1 + len(complete)
    cap_col = avg_col + 1
    delta_col = cap_col + 1
    comment_col = delta_col + 1
    for rr, (category, cap) in enumerate(BUDGET_CAPS.items(), start=start_row):
        ws_budget.write(rr, 0, category)
        for j, month_key in enumerate(complete, start=1):
            er = rr + 1
            ws_budget.write_formula(rr, j,
                f'=SUMIFS(Transactions!${col_debit}$2:${col_debit}${last_excel_row},Transactions!${col_month}$2:${col_month}${last_excel_row},"{month_key}",Transactions!${col_category}$2:${col_category}${last_excel_row},$A{er})',
                fmt_money, cache["category_month"][category].get(month_key, 0.0))
        er = rr + 1
        if complete:
            first_col = xl_col_to_name(1)
            last_col = xl_col_to_name(len(complete))
            ws_budget.write_formula(rr, avg_col, f"=AVERAGE({first_col}{er}:{last_col}{er})", fmt_money, cache["category_average"][category])
        else:
            ws_budget.write_number(rr, avg_col, 0, fmt_money)
        ws_budget.write_number(rr, cap_col, cap, fmt_money)
        avg_letter = xl_col_to_name(avg_col)
        cap_letter = xl_col_to_name(cap_col)
        ws_budget.write_formula(rr, delta_col, f"={cap_letter}{er}-{avg_letter}{er}", fmt_money, cap - cache["category_average"][category])
        ws_budget.write(rr, comment_col, BUDGET_COMMENTS.get(category, ""), fmt_wrap)

    total_row = start_row + len(BUDGET_CAPS)
    ws_budget.write(total_row, 0, "TOTAL MONTHLY SPEND", fmt_total)
    for c in range(1, 1 + len(complete) + 3):
        col_letter = xl_col_to_name(c)
        if 1 <= c <= len(complete):
            cached_total = cache["month_budget_totals"].get(complete[c - 1], 0.0)
        elif c == 1 + len(complete):
            cached_total = cache["average_total"]
        elif c == 2 + len(complete):
            cached_total = cache["cap_total"]
        else:
            cached_total = cache["delta_total"]
        ws_budget.write_formula(total_row, c, f"=SUM({col_letter}{start_row+1}:{col_letter}{total_row})", fmt_total, cached_total)

    cap_col_letter = xl_col_to_name(cap_col)
    savings_row = total_row + 3
    ws_budget.write(savings_row, 0, "Budget outcome", fmt_section)
    ws_budget.write(savings_row + 1, 0, "Income baseline")
    ws_budget.write_formula(savings_row + 1, 1, "=$B$2", fmt_money, cache["income_baseline"])
    ws_budget.write(savings_row + 2, 0, "Suggested monthly spend")
    ws_budget.write_formula(savings_row + 2, 1, f"={cap_col_letter}{total_row+1}", fmt_money, cache["cap_total"])
    ws_budget.write(savings_row + 3, 0, "Implied monthly savings")
    ws_budget.write_formula(savings_row + 3, 1, f"=B{savings_row+2}-B{savings_row+3}", fmt_money, cache["savings"])
    ws_budget.write(savings_row + 4, 0, "Savings rate")
    ws_budget.write_formula(savings_row + 4, 1, f"=IFERROR(B{savings_row+4}/B{savings_row+2},0)", fmt_percent, cache["savings_rate"])
    ws_budget.freeze_panes(4, 0)
    ws_budget.set_column(0, 0, 30)
    ws_budget.set_column(1, max(1, len(complete) + 3), 15)
    ws_budget.set_column(max(1, len(complete) + 4), max(1, len(complete) + 4), 50)

    # Merchant Review: one row per merchant, not one row per transaction.
    review_headers = [
        "Merchant", "Transactions", "Total Spend", "Median", "Average", "First Seen", "Last Seen",
        "Current Category", "Budget Character", "Rule Status", "Rule Match", "Examples", "Why review",
    ]
    for c, h in enumerate(review_headers):
        ws_review.write(0, c, h, fmt_header)
    for r, item in enumerate(review_rows, start=1):
        ws_review.write(r, 0, item["merchant"])
        ws_review.write_number(r, 1, item["transactions"])
        ws_review.write_number(r, 2, item["total_spend"], fmt_money)
        ws_review.write_number(r, 3, item["median_spend"], fmt_money)
        ws_review.write_number(r, 4, item["average_spend"], fmt_money)
        ws_review.write_datetime(r, 5, datetime.combine(item["first_seen"], datetime.min.time()), fmt_date)
        ws_review.write_datetime(r, 6, datetime.combine(item["last_seen"], datetime.min.time()), fmt_date)
        ws_review.write(r, 7, item["category"])
        ws_review.write(r, 8, item["budget_character"])
        st_fmt = fmt_warn if "suggested" in item["rule_status"] else fmt_review
        ws_review.write(r, 9, item["rule_status"], st_fmt)
        ws_review.write(r, 10, item["rule_match"], fmt_wrap)
        ws_review.write(r, 11, item["examples"], fmt_wrap)
        ws_review.write(r, 12, item["why_review"], st_fmt)
    if review_rows:
        ws_review.add_table(0, 0, len(review_rows), len(review_headers) - 1, {
            "name": "MerchantReviewTable", "columns": [{"header": h} for h in review_headers],
        })
    ws_review.freeze_panes(1, 0)
    ws_review.set_column("A:A", 28)
    ws_review.set_column("B:B", 12)
    ws_review.set_column("C:E", 15)
    ws_review.set_column("F:G", 12)
    ws_review.set_column("H:K", 24)
    ws_review.set_column("L:L", 55)
    ws_review.set_column("M:M", 34)

    # Rules snapshot, sorted exactly as applied.
    rule_headers = ["Enabled", "Priority", "Match Type", "Pattern", "Canonical Name", "Category", "Budget Character", "Status", "Notes"]
    for c, h in enumerate(rule_headers):
        ws_rules.write(0, c, h, fmt_header)
    for r, rule in enumerate(rules, start=1):
        ws_rules.write(r, 0, "yes" if rule.enabled else "no")
        ws_rules.write_number(r, 1, rule.priority)
        ws_rules.write(r, 2, rule.match_type)
        ws_rules.write(r, 3, rule.pattern)
        ws_rules.write(r, 4, rule.canonical_name)
        ws_rules.write(r, 5, rule.category)
        ws_rules.write(r, 6, rule.budget_character)
        s_fmt = fmt_confirm if rule.status == "confirmed" else fmt_warn
        ws_rules.write(r, 7, rule.status, s_fmt)
        ws_rules.write(r, 8, rule.notes, fmt_wrap)
    if rules:
        ws_rules.add_table(0, 0, len(rules), len(rule_headers) - 1, {
            "name": "MerchantRulesTable", "columns": [{"header": h} for h in rule_headers],
        })
    ws_rules.freeze_panes(1, 0)
    ws_rules.set_column("A:C", 12)
    ws_rules.set_column("D:E", 28)
    ws_rules.set_column("F:G", 26)
    ws_rules.set_column("H:H", 14)
    ws_rules.set_column("I:I", 50)

    # Parser review is now separate from merchant categorization review.
    parser_rows = [tx for tx in records if tx.parse_status != "High confidence"]
    parser_headers = ["Date", "Description", "Amount", "Balance", "Parse Status", "Page", "Raw PDF text"]
    for c, h in enumerate(parser_headers):
        ws_parser.write(0, c, h, fmt_header)
    for r, tx in enumerate(parser_rows, start=1):
        ws_parser.write_datetime(r, 0, datetime.combine(tx.date, datetime.min.time()), fmt_date)
        ws_parser.write(r, 1, tx.description)
        ws_parser.write_number(r, 2, tx.amount or 0.0, fmt_money)
        ws_parser.write_number(r, 3, tx.balance or 0.0, fmt_money)
        ws_parser.write(r, 4, tx.parse_status, fmt_warn)
        ws_parser.write_number(r, 5, tx.source_page)
        ws_parser.write(r, 6, tx.raw, fmt_wrap)
    ws_parser.freeze_panes(1, 0)
    ws_parser.set_column("A:A", 12)
    ws_parser.set_column("B:B", 46)
    ws_parser.set_column("C:D", 16)
    ws_parser.set_column("E:E", 52)
    ws_parser.set_column("F:F", 8)
    ws_parser.set_column("G:G", 60)

    # Assumptions / workflow.
    ws_a.merge_range("A1:D1", "Parsing, merchant rules & budgeting assumptions", fmt_title)
    period_text = f"{period.start.isoformat()} to {period.end.isoformat()}" if period else "Not detected"
    assumptions = [
        ("Source", source_name, "Parser", "PyMuPDF text + coordinate columns; no OCR / no network"),
        ("Statement period", period_text, "Complete budget months", ", ".join(complete)),
        ("Opening balance", opening, "Closing balance", closing),
        ("Transactions", len(records), "Parser rows needing review", reconstructed_count),
        ("Merchant rules file", str(rules_path) if rules_path else "Not supplied", "Rules loaded", len(rules)),
        ("Rule precedence", "Money-flow rules -> highest-priority enabled merchant rule -> generic fallback -> Other", "Matching", "contains / exact / regex, case-insensitive"),
        ("Suggested rules", "Applied but kept on Merchant Review until changed to confirmed.", "Unmatched merchants", "Grouped once per merchant rather than repeated for every transaction."),
        ("Budget character", "Separate from category: Essential / Discretionary / Irregular / Work/Admin / Unknown.", "Reason", "Prevents one-off travel/admin costs from looking like normal lifestyle burn."),
        ("Reconciliation", "Every amount is checked against the running balance.", "Failure mode", "Workbook is not written if the statement does not reconcile."),
        ("Budget", "Suggested category caps are still editable in BUDGET_CAPS in the script.", "Partial months", "Only complete calendar months are used when possible."),
    ]
    for r, row in enumerate(assumptions, start=2):
        for c, value in enumerate(row):
            fmt = fmt_money if isinstance(value, float) else fmt_wrap
            ws_a.write(r, c, value, fmt)
    ws_a.set_column("A:A", 24)
    ws_a.set_column("B:B", 66)
    ws_a.set_column("C:C", 28)
    ws_a.set_column("D:D", 66)

    # Dashboard.
    ws_d.merge_range("A1:H1", "Personal Budget Dashboard", fmt_title)
    ws_d.write("A3", "Period", fmt_kpi_label)
    ws_d.write("B3", period_text, fmt_kpi_label)
    ws_d.write("A4", "Transactions", fmt_kpi_label)
    ws_d.write_number("B4", len(records), fmt_kpi_label)
    ws_d.write("A5", "Opening balance", fmt_kpi_label)
    ws_d.write_number("B5", opening, fmt_kpi_value)
    ws_d.write("A6", "Closing balance", fmt_kpi_label)
    ws_d.write_number("B6", closing, fmt_kpi_value)
    ws_d.write("A7", "Merchants to review", fmt_kpi_label)
    ws_d.write_number("B7", len(review_rows), fmt_kpi_label)

    ws_d.write("D3", "Recurring income baseline", fmt_kpi_label)
    ws_d.write_number("E3", cache["income_baseline"], fmt_kpi_value)
    ws_d.write("D4", "Average core spend", fmt_kpi_label)
    ws_d.write_number("E4", cache["core_spend_average"], fmt_kpi_value)
    ws_d.write("D5", "Average irregular spend", fmt_kpi_label)
    ws_d.write_number("E5", cache["irregular_average"], fmt_kpi_value)
    ws_d.write("D6", "Average unknown spend", fmt_kpi_label)
    ws_d.write_number("E6", cache["unknown_average"], fmt_kpi_value)
    ws_d.write("D7", "Suggested monthly budget", fmt_kpi_label)
    ws_d.write_number("E7", cache["cap_total"], fmt_kpi_value)
    ws_d.write("D8", "Implied savings at cap", fmt_kpi_label)
    ws_d.write_number("E8", cache["savings"], fmt_kpi_value)

    # Chart 1: income vs total spending.
    chart = wb.add_chart({"type": "column"})
    if all_months:
        chart.add_series({"name": "Recurring Income", "categories": ["Monthly Summary", 1, 0, len(all_months), 0], "values": ["Monthly Summary", 1, 1, len(all_months), 1]})
        chart.add_series({"name": "Total Spending", "categories": ["Monthly Summary", 1, 0, len(all_months), 0], "values": ["Monthly Summary", 1, 9, len(all_months), 9]})
    chart.set_title({"name": "Monthly recurring income vs spending"})
    chart.set_legend({"position": "bottom"})
    ws_d.insert_chart("A11", chart, {"x_scale": 1.35, "y_scale": 1.18})

    # Chart 2: spend composition by budget character.
    char_chart = wb.add_chart({"type": "column", "subtype": "stacked"})
    if all_months:
        for idx, name in [(4, "Essential"), (5, "Discretionary"), (6, "Irregular"), (7, "Work/Admin"), (8, "Unknown")]:
            char_chart.add_series({"name": name, "categories": ["Monthly Summary", 1, 0, len(all_months), 0], "values": ["Monthly Summary", 1, idx, len(all_months), idx]})
    char_chart.set_title({"name": "Monthly spending by character"})
    char_chart.set_legend({"position": "bottom"})
    ws_d.insert_chart("I11", char_chart, {"x_scale": 1.35, "y_scale": 1.18})

    # Chart 3: observed average vs cap.
    budget_chart = wb.add_chart({"type": "bar"})
    budget_first_excel = start_row + 1
    budget_last_excel = total_row
    budget_chart.add_series({"name": "Observed monthly average", "categories": ["Budget", budget_first_excel - 1, 0, budget_last_excel - 1, 0], "values": ["Budget", budget_first_excel - 1, avg_col, budget_last_excel - 1, avg_col]})
    budget_chart.add_series({"name": "Suggested cap", "categories": ["Budget", budget_first_excel - 1, 0, budget_last_excel - 1, 0], "values": ["Budget", budget_first_excel - 1, cap_col, budget_last_excel - 1, cap_col]})
    budget_chart.set_title({"name": "Average spend vs suggested cap"})
    budget_chart.set_legend({"position": "bottom"})
    budget_chart.set_y_axis({"reverse": True})
    ws_d.insert_chart("A29", budget_chart, {"x_scale": 1.55, "y_scale": 1.6})

    ws_d.set_column("A:A", 30)
    ws_d.set_column("B:B", 26)
    ws_d.set_column("D:D", 28)
    ws_d.set_column("E:E", 18)
    ws_d.activate()
    wb.close()


def default_rules_path(input_path: Path) -> Path:
    return input_path.with_name("merchant_rules.csv")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse CommBank statement PDFs into clean transactions, persistent merchant rules, and a budget workbook."
    )
    parser.add_argument("input", type=Path, help="CommBank statement PDF")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output .xlsx path")
    parser.add_argument("--csv", type=Path, default=None, help="Clean transaction CSV path")
    parser.add_argument("--review-csv", type=Path, default=None, help="Merchant-level review CSV path")
    parser.add_argument("--rules", type=Path, default=None, help="Persistent merchant_rules.csv path (default: beside the statement)")
    parser.add_argument("--csv-only", action="store_true", help="Write CSV outputs only (no XlsxWriter needed)")
    parser.add_argument("--password", default=None, help="Password for a protected statement PDF")
    parser.add_argument("--year", type=int, default=None, help="Fallback starting year if the PDF period cannot be inferred")
    parser.add_argument("--debug-text", type=Path, default=None, help="Write extracted PDF lines / detected headers for troubleshooting")
    args = parser.parse_args()

    if not args.input.exists():
        parser.error(f"Input does not exist: {args.input}")
    if args.input.suffix.lower() != ".pdf":
        parser.error("This version expects a .pdf statement.")

    if args.debug_text:
        pdf_debug_dump(args.input, args.password, args.debug_text)

    rules_path = args.rules or default_rules_path(args.input)
    if not rules_path.exists():
        write_default_merchant_rules(rules_path)
        print(f"Created starter merchant rules: {rules_path}")
    rules = load_merchant_rules(rules_path)

    records, opening, closing, period, reconstructed = parse_pdf(
        args.input, password=args.password, year_hint=args.year
    )
    apply_merchant_rules(records, rules)

    output = args.output or default_output(args.input)
    csv_path = args.csv or output.with_name(output.stem + "_transactions.csv")
    review_path = args.review_csv or output.with_name(output.stem + "_merchant_review.csv")
    write_transactions_csv(records, csv_path)
    write_merchant_review_csv(records, review_path)

    if not args.csv_only:
        write_xlsx(
            records, opening, closing, period, reconstructed,
            source_name=args.input.name, out_path=output,
            rules=rules, rules_path=rules_path,
        )

    print(f"Transactions: {len(records)}")
    print(f"Opening balance: ${opening:,.2f}")
    print(f"Closing balance: ${closing:,.2f}")
    if period:
        print(f"Statement period: {period.start.isoformat()} to {period.end.isoformat()}")
    print(f"Rows reconstructed / mismatched: {reconstructed}")
    print(f"Merchant rules: {rules_path} ({len(rules)} rules)")
    print(f"Merchants needing review: {len(merchant_review_rows(records))}")
    print(f"Clean CSV: {csv_path}")
    print(f"Merchant review CSV: {review_path}")
    if not args.csv_only:
        print(f"Budget workbook: {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
