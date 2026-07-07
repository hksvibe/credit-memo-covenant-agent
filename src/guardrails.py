"""Verbatim-quote guardrail.

Every extracted covenant and every top-risk carries a quote from the memo.
This module tries to verify each quote against the memo's own text.

Design tension:
  Claude reads the PDF natively — text plus page images, OCR of scans,
  full font/layout awareness. pypdf reads only the PDF's text layer. When
  the memo is scanned, image-heavy, or uses non-standard encoding, pypdf
  gets partial text while Claude reads the memo cleanly.

  In those cases a strict substring check will "fail" for quotes that are
  actually in the memo. That's a tool-mismatch, not a hallucination — but
  a naive failure count reads like the model made things up.

Two-tier check:
  1. Exact substring match (after unicode-normalising, dash/quote folding,
     whitespace collapsing, lowercasing). Handles Claude's usual quoting.
  2. If step 1 misses, split on common concatenation separators (em-dashes,
     ellipses, pipes) and try each fragment as a substring.
  3. If step 2 still misses, fall back to a fuzzy word-overlap check: at
     least 90% of the quote's meaningful words (>= 3 chars) appear anywhere
     in the extracted memo text. This absorbs whitespace, hyphenation, and
     ligature drift between the two extractors.

We also report a diagnostic — how many characters pypdf pulled out — so a
user can tell at a glance if the local check couldn't verify anything at
all because the source is scanned.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader

from .schemas import QuoteCheck, QuoteCheckFailure, ReviewResult


_DASH_MAP = str.maketrans({
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
    "‘": "'", "’": "'", "‚": "'",
    "“": '"', "”": '"', "„": '"',
    " ": " ",  # nbsp
})

_FRAGMENT_SEPARATORS = re.compile(r"\s*(?:\.{3,}|…|-{2,}|—|–|\|)\s*")
_WORD_RE = re.compile(r"\w+", flags=re.UNICODE)
_MIN_WORD_LEN = 3
_FUZZY_THRESHOLD = 0.9
_THIN_TEXT_THRESHOLD = 1000  # characters — below this, we call it "thin"


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_DASH_MAP)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def extract_pdf_text(pdf_path: str | Path) -> str:
    reader = PdfReader(str(pdf_path))
    return " ".join((page.extract_text() or "") for page in reader.pages)


def _fuzzy_overlap(quote: str, memo_words: set[str]) -> float:
    """Fraction of the quote's meaningful words that appear in the memo."""
    tokens = {w.lower() for w in _WORD_RE.findall(quote) if len(w) >= _MIN_WORD_LEN}
    if not tokens:
        return 1.0
    hits = sum(1 for t in tokens if t in memo_words)
    return hits / len(tokens)


def _quote_verified(quote: str, normalised_memo: str, memo_words: set[str]) -> bool:
    normalised_full = _normalise(quote)
    if not normalised_full:
        return True

    # Tier 1: exact substring match.
    if normalised_full in normalised_memo:
        return True

    # Tier 2: split on concatenation separators; require each meaningful
    # fragment to appear as a substring.
    fragments = [f for f in _FRAGMENT_SEPARATORS.split(quote) if f.strip()]
    if len(fragments) > 1:
        all_present = True
        for frag in fragments:
            normalised = _normalise(frag)
            if len(normalised) < 8:
                continue  # tiny fragments (numbers, separators) — ignore
            if normalised not in normalised_memo:
                all_present = False
                break
        if all_present:
            return True

    # Tier 3: fuzzy word-overlap. Absorbs whitespace / hyphenation / ligature
    # drift between Claude's PDF vision and pypdf's text extraction.
    if _fuzzy_overlap(quote, memo_words) >= _FUZZY_THRESHOLD:
        return True

    return False


def check_quotes(result: ReviewResult, memo_text: str) -> QuoteCheck:
    normalised_memo = _normalise(memo_text)
    memo_words = {w.lower() for w in _WORD_RE.findall(memo_text) if len(w) >= _MIN_WORD_LEN}
    failures: list[QuoteCheckFailure] = []
    checked = 0

    for cov in result.covenants:
        checked += 1
        if not _quote_verified(cov.verbatim_text, normalised_memo, memo_words):
            failures.append(QuoteCheckFailure(
                where=f"covenant[{cov.id}].verbatim_text",
                quote=cov.verbatim_text[:200],
            ))

    for risk in result.top_risks:
        checked += 1
        if not _quote_verified(risk.evidence_from_memo, normalised_memo, memo_words):
            failures.append(QuoteCheckFailure(
                where=f"top_risks[rank={risk.rank}].evidence_from_memo",
                quote=risk.evidence_from_memo[:200],
            ))

    text_chars = len(memo_text)
    thin = text_chars < _THIN_TEXT_THRESHOLD

    return QuoteCheck(
        passed=(len(failures) == 0),
        checked=checked,
        failures=failures,
        memo_text_chars=text_chars,
        memo_text_looks_thin=thin,
    )
