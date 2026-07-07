"""Main pipeline: PDF in → structured JSON out.

Two calls to Claude:
  1. Extract  — record_covenants tool, produces the full covenant list.
  2. Rank     — record_top_risks tool, produces the top-3 risks.

Then a local guardrail pass checks that every quote appears in the memo text.

Usage:
    python -m src.review memo/some_memo.pdf > outputs/review.json
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv

from .guardrails import check_quotes, extract_pdf_text
from .prompts import EXTRACT_SYSTEM_PROMPT, RANK_SYSTEM_PROMPT
from .schemas import (
    EXTRACT_TOOL,
    RANK_TOOL,
    Covenant,
    MemoMetadata,
    ReviewResult,
    RunMetadata,
    TokenUsage,
    TopRisk,
)


DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
# Extract has to accommodate real memos with 50+ covenants and long
# verbatim quotes. Sonnet supports large output budgets; 32K is comfortable.
MAX_TOKENS_EXTRACT = 32000
MAX_TOKENS_RANK = 4096


class PipelineError(RuntimeError):
    """User-friendly error raised when a stage fails in a recoverable way."""


def _pdf_document_block(pdf_bytes: bytes) -> dict[str, Any]:
    return {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": base64.standard_b64encode(pdf_bytes).decode("utf-8"),
        },
    }


def _tool_call_input(response, tool_name: str) -> dict[str, Any]:
    """Pull the forced tool_use block out of an Anthropic response.

    Raises PipelineError with a friendly message on the two failure modes
    we can actually diagnose: (a) the model's output was truncated because
    max_tokens was hit, (b) no tool_use block came back at all.
    """
    if response.stop_reason == "max_tokens":
        raise PipelineError(
            f"The model ran out of output budget while completing '{tool_name}'. "
            "This usually means the memo has more covenants than fit in a single call. "
            "Try increasing MAX_TOKENS_EXTRACT in src/review.py, or ask about paginating "
            "the extract stage across sections."
        )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == tool_name:
            args = block.input
            if not isinstance(args, dict):
                raise PipelineError(f"Tool call for '{tool_name}' returned non-dict input.")
            return args
    raise PipelineError(
        f"The model did not call the '{tool_name}' tool. "
        f"Stop reason: {response.stop_reason}. "
        "The input may not be recognisable as a credit memo, or the extract prompt "
        "needs to be adjusted for this memo's structure."
    )


def run_extract(
    client: Anthropic,
    pdf_bytes: bytes,
    model: str,
) -> tuple[MemoMetadata, list[Covenant], TokenUsage]:
    response = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS_EXTRACT,
        system=EXTRACT_SYSTEM_PROMPT,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "record_covenants"},
        messages=[{
            "role": "user",
            "content": [
                _pdf_document_block(pdf_bytes),
                {
                    "type": "text",
                    "text": (
                        "The attached PDF is a corporate credit memo. Extract every covenant "
                        "into the record_covenants tool. Remember: no risk analysis in this call."
                    ),
                },
            ],
        }],
    )

    args = _tool_call_input(response, "record_covenants")
    metadata_raw = args.get("memo_metadata") or {"borrower": "Unknown"}
    covenants_raw = args.get("covenants") or []
    if not covenants_raw:
        raise PipelineError(
            "The extract call returned no covenants. This usually means either "
            "(a) the uploaded document is not a credit memo, or (b) the memo uses "
            "terminology or structure the current prompt does not recognise. "
            "Try a different memo, or update the extract prompt in src/prompts.py."
        )
    metadata = MemoMetadata(**metadata_raw)
    covenants = [Covenant(**c) for c in covenants_raw]
    usage = TokenUsage(input=response.usage.input_tokens, output=response.usage.output_tokens)
    return metadata, covenants, usage


def run_rank(
    client: Anthropic,
    pdf_bytes: bytes,
    covenants: list[Covenant],
    model: str,
) -> tuple[list[TopRisk], TokenUsage]:
    covenant_summary = json.dumps(
        [c.model_dump(exclude_none=True) for c in covenants],
        indent=2,
        ensure_ascii=False,
    )
    response = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS_RANK,
        system=RANK_SYSTEM_PROMPT,
        tools=[RANK_TOOL],
        tool_choice={"type": "tool", "name": "record_top_risks"},
        messages=[{
            "role": "user",
            "content": [
                _pdf_document_block(pdf_bytes),
                {
                    "type": "text",
                    "text": (
                        "The attached PDF is a corporate credit memo. Here is the fully "
                        "extracted covenant list, one per row:\n\n"
                        f"```json\n{covenant_summary}\n```\n\n"
                        "Pick the three highest-risk covenants and record them via the "
                        "record_top_risks tool. Reason independently — do not simply repeat "
                        "whichever risks the memo's executive summary flagged."
                    ),
                },
            ],
        }],
    )

    args = _tool_call_input(response, "record_top_risks")
    risks_raw = args.get("top_risks") or []
    if len(risks_raw) < 1:
        raise PipelineError(
            "The rank call returned no top risks. The memo may not contain enough "
            "signal to distinguish covenant risk levels."
        )
    risks = [TopRisk(**r) for r in risks_raw]
    risks.sort(key=lambda r: r.rank)
    usage = TokenUsage(input=response.usage.input_tokens, output=response.usage.output_tokens)
    return risks, usage


def review_memo(pdf_path: str | Path, model: str = DEFAULT_MODEL) -> ReviewResult:
    """Run the full pipeline against a PDF path and return a validated result."""
    pdf_path = Path(pdf_path)
    pdf_bytes = pdf_path.read_bytes()

    client = Anthropic()

    metadata, covenants, extract_usage = run_extract(client, pdf_bytes, model)
    metadata.source_file = pdf_path.name

    risks, rank_usage = run_rank(client, pdf_bytes, covenants, model)

    result = ReviewResult(
        memo_metadata=metadata,
        covenants=covenants,
        top_risks=risks,
        run_metadata=RunMetadata(
            model=model,
            approach="python",
            extract_tokens=extract_usage,
            rank_tokens=rank_usage,
        ),
    )

    memo_text = extract_pdf_text(pdf_path)
    result.run_metadata.quote_check = check_quotes(result, memo_text)
    return result


def _cli() -> int:
    parser = argparse.ArgumentParser(description="Review a corporate credit memo and flag covenant risks.")
    parser.add_argument("pdf", type=Path, help="Path to the memo PDF")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Anthropic model (default: {DEFAULT_MODEL})")
    parser.add_argument("--out", type=Path, help="Write JSON to this path instead of stdout")
    args = parser.parse_args()

    load_dotenv()
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.", file=sys.stderr)
        return 1
    if not args.pdf.exists():
        print(f"ERROR: {args.pdf} does not exist.", file=sys.stderr)
        return 1

    result = review_memo(args.pdf, model=args.model)
    payload = result.model_dump_json(indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
