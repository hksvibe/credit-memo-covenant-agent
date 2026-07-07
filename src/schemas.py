"""Pydantic models and Anthropic tool schemas for the credit memo review pipeline.

Two model calls, two tool schemas:
  1. record_covenants  — Extract stage output
  2. record_top_risks  — Rank stage output

The Pydantic models double as (a) runtime validation of the model's tool-call
arguments, and (b) the shape of the final JSON result on disk.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


CovenantType = Literal["financial", "non-financial"]

CovenantCategory = Literal[
    "leverage",
    "coverage",
    "liquidity",
    "capex",
    "reporting",
    "restricted_payment",
    "change_of_control",
    "negative_pledge",
    "acquisition",
    "asset_sale",
    "cash_flow_sweep",
    "affiliate_transaction",
    "sanctions_aml",
    "insurance_erisa",
    "indebtedness",
    "other",
]


class MemoMetadata(BaseModel):
    borrower: str
    facility_size_usd_m: Optional[float] = None
    memo_date: Optional[str] = None
    source_file: Optional[str] = None


class Covenant(BaseModel):
    id: str = Field(..., description="Stable identifier, e.g. cov_01, cov_02")
    name: str
    type: CovenantType
    category: CovenantCategory
    threshold: str = Field(..., description="Full threshold text, including any stepped schedule")
    test_frequency: Optional[str] = None
    current_value: Optional[str] = Field(None, description="Value at close if stated in the memo")
    downside_value: Optional[str] = Field(None, description="Value under the memo's downside sensitivity, if stated")
    source_section: str = Field(..., description="Section number in the memo, e.g. '5.1', '5.2', '7', '8'")
    verbatim_text: str = Field(..., description="Exact quote from the memo — no paraphrase")


class TopRisk(BaseModel):
    rank: int = Field(..., ge=1, le=3)
    covenant_id: str
    covenant_name: str
    reasoning: str = Field(..., description="1-2 sentences explaining why this covenant is one of the top-3 risks")
    evidence_from_memo: str = Field(..., description="Verbatim quote from the memo supporting the ranking")


class TokenUsage(BaseModel):
    input: int = 0
    output: int = 0


class QuoteCheckFailure(BaseModel):
    where: str
    quote: str


class QuoteCheck(BaseModel):
    passed: bool
    checked: int = 0
    failures: list[QuoteCheckFailure] = Field(default_factory=list)


class RunMetadata(BaseModel):
    model: str
    approach: Literal["python", "n8n"] = "python"
    extract_tokens: TokenUsage = Field(default_factory=TokenUsage)
    rank_tokens: TokenUsage = Field(default_factory=TokenUsage)
    quote_check: QuoteCheck = Field(default_factory=lambda: QuoteCheck(passed=False))


class ReviewResult(BaseModel):
    memo_metadata: MemoMetadata
    covenants: list[Covenant]
    top_risks: list[TopRisk]
    run_metadata: RunMetadata


# ---------------------------------------------------------------------------
# Anthropic tool schemas
# ---------------------------------------------------------------------------

_CATEGORY_ENUM = list(CovenantCategory.__args__)  # type: ignore[attr-defined]

EXTRACT_TOOL = {
    "name": "record_covenants",
    "description": (
        "Records every covenant found in the credit memo, plus basic memo metadata. "
        "Do NOT analyze risk in this call — that is a separate step."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "memo_metadata": {
                "type": "object",
                "properties": {
                    "borrower": {"type": "string", "description": "Legal name of the borrower."},
                    "facility_size_usd_m": {
                        "type": "number",
                        "description": "Total facility size in $ millions.",
                    },
                    "memo_date": {
                        "type": "string",
                        "description": "Memo date in ISO format (YYYY-MM-DD) if stated.",
                    },
                    "source_file": {"type": "string"},
                },
                "required": ["borrower"],
            },
            "covenants": {
                "type": "array",
                "description": "Every covenant in the memo. Include both financial and non-financial. Do not skip boilerplate.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Stable id, e.g. cov_01, cov_02, one per covenant.",
                        },
                        "name": {
                            "type": "string",
                            "description": "Short name, e.g. 'Maximum total net leverage'.",
                        },
                        "type": {"type": "string", "enum": ["financial", "non-financial"]},
                        "category": {"type": "string", "enum": _CATEGORY_ENUM},
                        "threshold": {
                            "type": "string",
                            "description": (
                                "Full threshold text. If stepped (e.g. '4.25x at close; 4.00x from Q4 2026'), "
                                "include the whole schedule."
                            ),
                        },
                        "test_frequency": {
                            "type": "string",
                            "description": "e.g. 'quarterly', 'monthly', 'annually', 'at all times'.",
                        },
                        "current_value": {
                            "type": "string",
                            "description": "Value at close if stated in the memo.",
                        },
                        "downside_value": {
                            "type": "string",
                            "description": "Value under the memo's downside sensitivity, if stated.",
                        },
                        "source_section": {
                            "type": "string",
                            "description": "Section number in the memo, e.g. '5.1', '5.2'.",
                        },
                        "verbatim_text": {
                            "type": "string",
                            "description": "Exact quote from the memo. No paraphrase.",
                        },
                    },
                    "required": [
                        "id",
                        "name",
                        "type",
                        "category",
                        "threshold",
                        "source_section",
                        "verbatim_text",
                    ],
                },
            },
        },
        "required": ["memo_metadata", "covenants"],
    },
}


RANK_TOOL = {
    "name": "record_top_risks",
    "description": (
        "Records the three highest-risk covenants with grounded reasoning. "
        "Exactly three items — rank 1 is the highest risk."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "top_risks": {
                "type": "array",
                "minItems": 3,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "rank": {"type": "integer", "enum": [1, 2, 3]},
                        "covenant_id": {
                            "type": "string",
                            "description": "The id of the covenant from the extracted list.",
                        },
                        "covenant_name": {"type": "string"},
                        "reasoning": {
                            "type": "string",
                            "description": (
                                "1-2 sentences explaining why this covenant is one of the top-3 risks. "
                                "Reference the downside case, headroom, or seasonal pressure explicitly."
                            ),
                        },
                        "evidence_from_memo": {
                            "type": "string",
                            "description": "Verbatim quote(s) from the memo supporting the ranking.",
                        },
                    },
                    "required": [
                        "rank",
                        "covenant_id",
                        "covenant_name",
                        "reasoning",
                        "evidence_from_memo",
                    ],
                },
            }
        },
        "required": ["top_risks"],
    },
}
