#!/usr/bin/env python3

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import pymupdf


MIN_FONT_SIZE = 4.0
WIDTH_MARGIN = 0.94
REDACTION_PADDING = 0.75


@dataclass(frozen=True)
class Replacement:
    label: str
    real: str
    fake: str


@dataclass(frozen=True)
class Match:
    page_number: int
    rect: pymupdf.Rect
    baseline_y: float
    font_size: float
    fake: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Pseudonymize selected searchable text in a PDF."
    )
    parser.add_argument("input", type=Path, help="Source PDF.")
    parser.add_argument("output", type=Path, help="Pseudonymized PDF.")
    parser.add_argument(
        "--replacements",
        type=Path,
        required=True,
        help="Private JSON replacement file.",
    )
    return parser.parse_args()


def load_replacements(path: Path) -> list[Replacement]:
    data = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        raise ValueError("Replacement file must contain a non-empty JSON array.")

    replacements = []
    seen_real = set()

    for item in data:
        try:
            replacement = Replacement(
                label=item["label"],
                real=item["real"],
                fake=item["fake"],
            )
        except (TypeError, KeyError) as exc:
            raise ValueError(
                "Each replacement needs label, real, and fake strings."
            ) from exc

        if not all(
            isinstance(value, str) and value.strip()
            for value in (
                replacement.label,
                replacement.real,
                replacement.fake,
            )
        ):
            raise ValueError(
                f"{replacement.label!r}: values must be nonblank strings."
            )

        if replacement.real in seen_real:
            raise ValueError(f"{replacement.label!r}: duplicate real value.")

        seen_real.add(replacement.real)
        replacements.append(replacement)

    return replacements


def original_style(page, rect: pymupdf.Rect) -> tuple[float, float]:
    best_area = -1.0
    best_size = None
    best_baseline = None

    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue

        for line in block.get("lines", []):
            for span in line.get("spans", []):
                bbox = span.get("bbox")
                if not bbox:
                    continue

                overlap = pymupdf.Rect(bbox) & rect
                if overlap.is_empty:
                    continue

                area = max(overlap.width, 0) * max(overlap.height, 0)
                if area <= best_area:
                    continue

                best_area = area
                best_size = float(span.get("size", 0)) or None
                origin = span.get("origin")
                best_baseline = float(origin[1]) if origin else None

    size = best_size or max(MIN_FONT_SIZE, rect.height * 0.75)
    baseline = best_baseline or rect.y1 - max(1.0, rect.height * 0.15)
    return size, baseline


def fitted_size(text: str, original_size: float, width: float) -> float:
    rendered = pymupdf.get_text_length(
        text,
        fontname="helv",
        fontsize=original_size,
    )
    size = original_size

    if rendered > width * WIDTH_MARGIN:
        size *= (width * WIDTH_MARGIN) / rendered

    if size < MIN_FONT_SIZE:
        raise RuntimeError(
            f"Replacement {text!r} is too wide; use a shorter fake value."
        )

    return size


def verify(path: Path, replacements: list[Replacement]) -> None:
    with pymupdf.open(path) as doc:
        leaks = [
            replacement.label
            for replacement in replacements
            if any(page.search_for(replacement.real) for page in doc)
        ]

    if leaks:
        raise RuntimeError(
            "Sensitive text remains in output: " + ", ".join(leaks)
        )


def pseudonymize(
    input_path: Path,
    output_path: Path,
    replacements: list[Replacement],
) -> dict[str, int]:
    input_path = input_path.expanduser()
    output_path = output_path.expanduser()

    if not input_path.exists():
        raise FileNotFoundError(input_path)

    if input_path.resolve() == output_path.resolve():
        raise ValueError("Input and output must be different files.")

    temp_path = output_path.with_name(f".{output_path.name}.tmp")
    temp_path.unlink(missing_ok=True)

    counts = {replacement.label: 0 for replacement in replacements}

    try:
        with pymupdf.open(input_path) as doc:
            matches: list[Match] = []

            for page_number, page in enumerate(doc):
                for replacement in replacements:
                    for rect in page.search_for(replacement.real):
                        size, baseline = original_style(page, rect)
                        matches.append(
                            Match(
                                page_number,
                                rect,
                                baseline,
                                size,
                                replacement.fake,
                            )
                        )
                        counts[replacement.label] += 1

                        padded = pymupdf.Rect(
                            rect.x0 - REDACTION_PADDING,
                            rect.y0 - REDACTION_PADDING,
                            rect.x1 + REDACTION_PADDING,
                            rect.y1 + REDACTION_PADDING,
                        )
                        page.add_redact_annot(padded, fill=(1, 1, 1))

            missing = [
                label for label, count in counts.items() if count == 0
            ]
            if missing:
                raise RuntimeError(
                    "Sensitive fields not found: " + ", ".join(missing)
                )

            for page in doc:
                page.apply_redactions()

            for match in matches:
                page = doc[match.page_number]
                page.insert_text(
                    pymupdf.Point(match.rect.x0, match.baseline_y),
                    match.fake,
                    fontname="helv",
                    fontsize=fitted_size(
                        match.fake,
                        match.font_size,
                        match.rect.width,
                    ),
                    color=(0, 0, 0),
                    overlay=True,
                )

            doc.set_metadata({})
            output_path.parent.mkdir(parents=True, exist_ok=True)
            doc.save(temp_path, garbage=4, clean=True, deflate=True)

        verify(temp_path, replacements)
        temp_path.replace(output_path)
        return counts

    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def main() -> None:
    args = parse_args()
    replacements = load_replacements(args.replacements)
    counts = pseudonymize(args.input, args.output, replacements)

    print(f"Created: {args.output.expanduser()}")
    for label, count in counts.items():
        print(f"  {label}: {count}")
    print("Verified: configured original values are no longer searchable.")
    print("Manually inspect the PDF before sharing it.")


if __name__ == "__main__":
    main()
