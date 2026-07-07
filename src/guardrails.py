"""Verbatim-quote guardrail.

Every extracted covenant and every top-risk carries a quote from the memo.
This module confirms the quote actually appears in the memo's text.

We normalise both the memo text and the quote by:
  - unicode-normalising (NFKC)
  - replacing curly quotes and dashes with straight equivalents
  - collapsing all whitespace to single spaces
  - lowercasing

This is deliberately forgiving: PDF text extraction differs from what Claude
"reads" from the same PDF (whitespace across line breaks, ligatures like fi/fl,
etc.). We want to fail only on real hallucinations, not on transcription noise.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader

from .schemas import QuoteCheck, QuoteCheckFailure, ReviewResult


_DASH_MAP = str.maketrans({
    "‐": "-",  # hyphen
    "‑": "-",  # non-breaking hyphen
    "‒": "-",  # figure dash
    "–": "-",  # en dash
    "—": "-",  # em dash
    "―": "-",  # horizontal bar
    "−": "-",  # minus sign
    "‘": "'",
    "’": "'",
    "‚": "'",
    "“": '"',
    "”": '"',
    "„": '"',
    " ": " ",  # nbsp
})


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_DASH_MAP)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def extract_pdf_text(pdf_path: str | Path) -> str:
    """Extract raw text from every page of a PDF, joined with single spaces."""
    reader = PdfReader(str(pdf_path))
    pages: list[str] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return " ".join(pages)


# Separators the model uses when quoting either (a) a table row across
# multiple cells or (b) several non-contiguous passages. When any of these
# appear in a "verbatim" field, we split on them and require each fragment
# to appear in the memo individually.
_FRAGMENT_SEPARATORS = re.compile(r"\s*(?:\.{3,}|…|-{2,}|—|–|\|)\s*")


def _quote_matches(quote: str, normalised_memo: str, min_fragment_len: int = 8) -> bool:
    """Return True if `quote` (or every meaningful fragment of it) is in the memo.

    Very short fragments (< min_fragment_len chars after normalisation) are
    ignored — they're almost always sub-word tokens or separator noise.
    """
    normalised_full = _normalise(quote)
    if not normalised_full:
        return True
    if normalised_full in normalised_memo:
        return True
    # Fallback: try splitting on separators and check each fragment.
    fragments = [f for f in _FRAGMENT_SEPARATORS.split(quote) if f.strip()]
    if len(fragments) <= 1:
        return False
    for frag in fragments:
        normalised = _normalise(frag)
        if len(normalised) < min_fragment_len:
            continue
        if normalised not in normalised_memo:
            return False
    return True


def check_quotes(result: ReviewResult, memo_text: str) -> QuoteCheck:
    """Verify every verbatim_text and evidence_from_memo appears in the memo.

    Multi-fragment quotes (table rows joined with em-dashes, or non-contiguous
    passages joined with " ... ") are treated as passing if each meaningful
    fragment appears in the memo. This is deliberate: the model reconstructing
    a table row from separately-extracted cells is faithful behaviour, not a
    hallucination.

    Returns a QuoteCheck describing which quotes failed to match. The pipeline
    never *raises* on a failure — a single-source-of-truth report goes into
    the JSON output for a human to eyeball.
    """
    normalised_memo = _normalise(memo_text)
    failures: list[QuoteCheckFailure] = []
    checked = 0

    for cov in result.covenants:
        checked += 1
        if not _quote_matches(cov.verbatim_text, normalised_memo):
            failures.append(QuoteCheckFailure(
                where=f"covenant[{cov.id}].verbatim_text",
                quote=cov.verbatim_text[:200],
            ))

    for risk in result.top_risks:
        checked += 1
        if not _quote_matches(risk.evidence_from_memo, normalised_memo):
            failures.append(QuoteCheckFailure(
                where=f"top_risks[rank={risk.rank}].evidence_from_memo",
                quote=risk.evidence_from_memo[:200],
            ))

    return QuoteCheck(passed=(len(failures) == 0), checked=checked, failures=failures)
