# Architecture

One page. Everything that happens when a reviewer drops a PDF onto the app and clicks **Run review**.

---

## The picture

```mermaid
flowchart TB
    subgraph Browser["🧑 Reviewer's browser"]
        USER["Drop credit-memo PDF<br/>Click <b>Run review</b>"]
        RENDER["Rendered results:<br/>metrics · top-3 cards · covenants table · JSON"]
    end

    subgraph SC["☁️ Streamlit Community Cloud &nbsp;(auto-deploys from GitHub)"]
        GATE["Password gate<br/>(_password_gate)"]
        UI["Streamlit UI<br/>src/app.py"]
        PIPE["review_memo pipeline<br/>src/review.py"]
        PYPDF["Local text extractor<br/>src/guardrails.py + pypdf"]
        GUARD["Three-tier guardrail<br/>substring · fragment split · fuzzy 90%"]
    end

    subgraph API["🤖 Anthropic API &nbsp;(streaming HTTP)"]
        EXTRACT["<b>Extract call</b><br/>Claude Sonnet 4.6<br/>tool_choice: record_covenants"]
        RANK["<b>Rank call</b><br/>Claude Sonnet 4.6<br/>tool_choice: record_top_risks"]
    end

    subgraph GH["📦 GitHub &nbsp;credit-memo-covenant-agent"]
        REPO["Source code<br/>(git push → Streamlit auto-redeploys)"]
    end

    USER -->|"1"| GATE
    GATE -->|"2 · authed"| UI
    UI -->|"3 · run_memo(pdf)"| PIPE
    PIPE -->|"4 · PDF base64 + Extract prompt"| EXTRACT
    EXTRACT -->|"5 · streamed tool_use with covenants"| PIPE
    PIPE -->|"6 · PDF + covenants JSON + Rank prompt"| RANK
    RANK -->|"7 · streamed tool_use with top-3"| PIPE
    PIPE -->|"8 · extract text"| PYPDF
    PYPDF -->|"9 · memo text"| GUARD
    PIPE -->|"10 · check every quote"| GUARD
    GUARD -->|"11 · pass/fail + diagnostics"| PIPE
    PIPE -->|"12 · assembled ReviewResult"| UI
    UI -->|"13 · render"| RENDER

    REPO -.->|"on git push"| SC
```

---

## Reading the diagram

**Colours in your head:** the four boxes are four different places.

1. **The reviewer's browser** — everything they see. Nothing runs here except HTML/JS from Streamlit and the file selector for the PDF upload.
2. **Streamlit Community Cloud** — where our Python code actually runs. One container per user session. Holds the PDF in memory for the duration of one review, then deletes it.
3. **Anthropic's servers** — where Claude thinks. We send the PDF and prompts over HTTPS; Claude reads and writes back a structured JSON answer over a streamed connection.
4. **GitHub** — where the source code lives. Every push triggers Streamlit Cloud to redeploy within a minute.

**The 13 numbered arrows are one full review** from click to result. Total wall-clock time: ~15-45 seconds depending on memo size.

---

## The 13 steps, in plain English

| # | What happens | Where |
|---|---|---|
| 1 | Reviewer opens the app, enters the password | Browser → Streamlit |
| 2 | Password matches, main UI renders | Streamlit |
| 3 | Reviewer drops PDF, clicks Run — Streamlit calls `review_memo(pdf_path)` | Streamlit |
| 4 | Pipeline base64-encodes the PDF and sends it to Anthropic with the **Extract** prompt and the `record_covenants` tool schema. Streaming mode. | Streamlit → Anthropic |
| 5 | Claude reads the PDF, extracts every covenant, streams back a tool call with the structured list | Anthropic → Streamlit |
| 6 | Pipeline sends the **same PDF plus the extracted covenant list** to Anthropic with the **Rank** prompt and the `record_top_risks` tool schema | Streamlit → Anthropic |
| 7 | Claude picks the three highest-risk covenants, streams back a tool call with reasoning + memo quotes | Anthropic → Streamlit |
| 8 | Locally, pypdf reads the PDF's text layer for the safety check | Streamlit |
| 9 | Extracted memo text hands over to the guardrail | Streamlit |
| 10 | Pipeline asks the guardrail to verify every quote in the AI's output | Streamlit |
| 11 | Guardrail returns pass/fail per quote plus a diagnostic on how much text pypdf actually pulled out | Streamlit |
| 12 | Pipeline assembles a final `ReviewResult` (memo metadata + covenants + top-3 + run metadata) and returns it to the UI | Streamlit |
| 13 | UI renders metrics, top-3 cards, covenant table, guardrail status, JSON viewer and download button | Streamlit → Browser |

The dotted line at the bottom shows how a `git push` to GitHub triggers Streamlit Cloud to redeploy the app.

---

## Why the pipeline talks to Anthropic twice

Split into **Extract** and **Rank** on purpose. Backed by real testing — see [COMPARISONS.md](COMPARISONS.md) Section 4 for the three-way head-to-head vs single-call.

- **Auditability.** A credit officer can eyeball the extracted covenant list against the memo's Section 5 before trusting the top-3 ranking. Single-call collapses that check.
- **Debuggability under demo pressure.** If the demo breaks live, we can point to which call failed. Single-call fails atomically.
- **Marginal completeness.** On the 50-page Deutsche Bank memo we tested, two calls extracted 50 of 50 covenants; a comprehensive single-call variant extracted 47 of 50. On a real bank workflow, 94% is not 100%.
- **Top-3 stability.** Single-call rank 2 shifted between runs (structurally the same risk, different framing). Two focused calls with narrower schemas produce more consistent rankings.
- **Prompt-maintenance ergonomics.** Two prompts of ~4000 chars and ~2700 chars are easier to evolve independently than one ~5000-char combined prompt that has to handle both jobs.

Cost of the split: roughly 2× tokens and 2× latency. Invisible on a demo. At scale, Anthropic's **prompt caching** — a one-line addition to `_pdf_document_block()` — cuts the two-call premium from ~40% down to ~24% by letting the Rank call reuse the cached PDF at 10% of the input price. Full cost math in COMPARISONS.md Section 4.7.

---

## Why the guardrail runs locally

The AI's output claims: "here is a covenant, and here is the exact quote from the memo that proves it." We verify locally that the quote is actually in the memo, using pypdf to pull the memo's text layer. Three tiers of check (exact substring → fragment split → fuzzy word overlap at 90%) so we don't false-positive on table-row reconstructions or scanned-PDF extractor drift. Full logic in [src/guardrails.py](src/guardrails.py).

---

## What lives where — quick reference

| Component | File | Job |
|---|---|---|
| Streamlit UI | [src/app.py](src/app.py) | Password gate, file upload, results view, JSON download |
| Main pipeline | [src/review.py](src/review.py) | `review_memo()` — the orchestrator; `run_extract()`, `run_rank()`, `_stream_message()` |
| Data shapes | [src/schemas.py](src/schemas.py) | Pydantic models + Anthropic tool schemas |
| Prompts | [src/prompts.py](src/prompts.py) | Two versioned system prompts (v2) |
| Safety check | [src/guardrails.py](src/guardrails.py) | `extract_pdf_text()`, three-tier `check_quotes()` |
| Runtime config | [runtime.txt](runtime.txt), [requirements.txt](requirements.txt) | Python 3.11, dependency list for Streamlit Cloud |
| Local secrets | `.env` (gitignored), [.env.example](.env.example) | `ANTHROPIC_API_KEY` |
| Cloud secrets | Streamlit Cloud "Secrets" panel | Same key, different source |
