# Credit Memo Covenant Reviewer

An AI agent that reads a corporate credit memo, extracts every covenant, ranks the three highest-risk ones with grounded reasoning, and returns structured JSON.

**Live demo:** [covenant-review-demo.streamlit.app](https://covenant-review-demo.streamlit.app/) — password required, shared separately in the submission email.

---

## Reviewer? Start here.

Recommended ~10 minute tour:

1. **Try it live** — open the [deployed app](https://covenant-review-demo.streamlit.app/), enter the password, drop [`memo/Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf`](memo/Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf) onto it, hit **Run review** (~15 seconds).
2. **See the architecture** — [ARCHITECTURE.md](ARCHITECTURE.md) has the pipeline diagram + a 13-step trace from click to result.
3. **See the model + tool decisions** — [COMPARISONS.md](COMPARISONS.md) walks Claude vs Gemini vs OpenAI vs Groq, Sonnet vs Opus vs Haiku, and why we picked the code-first stack over a low-code alternative.
4. **See the code** — source lives in [`src/`](src/). Heart of the pipeline is [`src/review.py`](src/review.py); prompts are in [`src/prompts.py`](src/prompts.py).
5. **See the actual output** — [`outputs/meridian_review.json`](outputs/meridian_review.json) is the committed result from running the pipeline against the Meridian memo. 28 covenants, 31/31 quotes verified.

Word-doc versions of `ARCHITECTURE.docx` and `COMPARISONS.docx` are also committed.

---

## Architecture (one paragraph)

Two calls to Claude, one guardrail:

1. **Extract** — the PDF is sent to Claude Sonnet 4.6 with a tool schema that forces it to record every covenant into a strict list.
2. **Rank** — the PDF plus the extracted covenant list is sent back with a second tool schema that forces the top-3 risks with 1-2 sentence reasoning.
3. **Guardrail** — every `verbatim_text` and `evidence_from_memo` is checked as a substring of the memo's own text. Failures are surfaced, not thrown.

Same output whether you use the CLI or the Streamlit UI. Full diagram in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Setup

```bash
# 1. Create a virtualenv (Python 3.10+)
python3 -m venv .venv
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure your Anthropic API key
cp .env.example .env
# open .env and paste your key
```

Get an Anthropic API key at <https://console.anthropic.com/settings/keys>.

---

## Run — CLI

```bash
python -m src.review memo/Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf \
    --out outputs/meridian_review.json
```

Or pipe to stdout:

```bash
python -m src.review memo/Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf > outputs/meridian_review.json
```

Override the model:

```bash
python -m src.review memo.pdf --model claude-opus-4-8
```

---

## Run — Streamlit UI

```bash
streamlit run src/app.py
```

Drag a PDF onto the page, hit **Run review**, and:

- see the borrower / facility size / date at the top,
- see the three ranked risks with reasoning and memo quotes,
- see every extracted covenant in a sortable table,
- see the quote-check guardrail status,
- download the raw JSON.

---

## Project layout

```
credit-memo-covenants-assignment/
├── README.md                # this file
├── ARCHITECTURE.md          # pipeline diagram + 13-step trace
├── COMPARISONS.md           # model + tool comparison tables
├── ARCHITECTURE.docx        # Word version of ARCHITECTURE
├── COMPARISONS.docx         # Word version of COMPARISONS
├── requirements.txt
├── .env.example
├── assignment_brief.pdf
├── memo/
│   └── Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf
├── outputs/
│   └── meridian_review.json       # committed example output
└── src/
    ├── __init__.py
    ├── schemas.py          # Pydantic models + Anthropic tool schemas
    ├── prompts.py          # Extract + Rank system prompts (versioned)
    ├── guardrails.py       # Verbatim-quote substring check
    ├── review.py           # Main pipeline + CLI
    └── app.py              # Streamlit UI
```

---

## Design choices at a glance

- **Model:** Claude Sonnet 4.6 for both stages. Native PDF ingestion, tool-forced JSON, low fabrication risk. Full defense in [COMPARISONS.md](COMPARISONS.md) §1-2.
- **Two calls, not one.** Extract and Rank are separate calls so the covenant list is auditable independently of the ranking. Costs 2× latency; buys defensibility.
- **Tool-forced JSON.** `tool_choice: {type: "tool", name: ...}` — the model literally cannot return anything other than schema-valid arguments.
- **Verbatim-quote guardrail.** Every finding must quote the memo. A post-run substring check surfaces any quote that isn't in the source.
- **No RAG.** The memo fits in Claude's context ~40× over. A vector store on a 7-page document is theatre.
- **No agent loop.** Two clean stages beat a "while not done" loop I couldn't defend.

---

## What you'd extend with two more weeks

Build an eval harness: 5-10 varied memos with human-labeled top-3, then measure covenant recall + rank agreement. Right now the only "grader" is me and one memo — not enough to know how the tool generalises.
