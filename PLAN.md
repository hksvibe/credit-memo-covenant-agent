# Step 2 — Build the Agent: Plan and Design Choices

**Assignment:** ingest a credit memo, extract covenants, rank the top 3 risks with reasoning, return structured JSON.
**Timebox:** ~4-6 hours per approach. Working > polished.
**Input for this build:** `memo/Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf` (7pp, generated in Step 1).

We are building **two parallel approaches** so we can compare them side by side in the walkthrough:

- **Approach A — Code-first:** Python script + Claude API direct + Streamlit UI.
- **Approach B — Low-code:** n8n workflow + Firebase (storage + Firestore) + Lovable frontend.

Both produce identical JSON output against the same schema (Section 6) and can be pointed at the same memo.

---

## 1. Shape of the problem, in one paragraph

This is a **document → structured judgment** pipeline, not an ML problem and not an integrations problem. A credit officer reads a memo, pulls out the covenant package, and forms a view on which covenants are most likely to be tripped. The agent has to do the same, deterministically enough that a POC user can trust the output. There are no external systems to talk to, no ongoing state, no users to authenticate. The interesting work is **prompt design, output schema, and grounding** — everything else is scaffolding.

That framing drives every choice below: keep the surface area small, keep every model call auditable, spend time on the parts a credit officer would actually push back on.

---

## 2. Model choice: why Claude over Gemini, GPT, and open-source

Both approaches call the same LLM. The model choice is the single most important technical decision, so it gets its own section.

### 2.1 The four dimensions I evaluated on

For a **PDF → structured JSON with grounded reasoning** task, the model has to be strong at four things:

1. **Native PDF ingestion.** Can the model read the PDF directly, preserving table structure, or do I have to build a parsing pipeline first?
2. **Structured output enforcement.** Can the model be *forced* to return output matching a schema, or is it "please output JSON" and hope?
3. **Grounded document reasoning.** How well does it reason about a specific document without drifting into plausible-sounding hallucination?
4. **Operational fit.** Latency, cost, rate limits, API stability, ease of debugging.

### 2.2 Head-to-head

#### **Claude (Anthropic) — chosen**

- **Native PDF:** first-class. You attach a PDF as a `document` content block (base64 or Files API reference). The model processes text, tables, and page images together — no OCR step, no `pypdf` table-mangling. For a memo where covenants live in a formatted table (Section 5.1), this is the difference between "extract the threshold column" and "guess from mangled whitespace."
- **Structured output:** Anthropic's **tool use with forced tool choice** is the mechanism. You define a tool with a JSON schema (`input_schema`), then set `tool_choice: {type: "tool", name: "record_covenants"}`. The model *must* call that tool with schema-valid arguments. Not "please output JSON" — literally cannot return anything else. Fewer retries, no post-hoc JSON repair.
- **Grounded reasoning:** Claude is trained hard against fabrication. In practice, when asked to quote a document it quotes accurately; when it doesn't know, it says so instead of confabulating. This matters more for a credit memo than for a general chatbot.
- **Operational:** 200K context (fits a 7-page memo ~40 times over), 1M context available on newer Sonnet with a beta header. Latency is fine (~5-15s per call for this task). I've built enough Claude pipelines to know its failure modes cold.

#### **GPT (OpenAI) — reasonable alternative**

- **Native PDF:** weaker. `gpt-4o` / `gpt-4.1` accept files, but the clean path is via the **Assistants API + File Search**, which does its own text extraction under the hood — you lose control over how the memo is chunked. For direct-in-context PDFs you often end up converting pages to images and passing them as image blocks, which is fine but more code to write.
- **Structured output:** their **Structured Outputs** mode (`response_format: {type: "json_schema", schema: ...}`) is arguably the strongest guarantee in the market — they constrain token generation at the sampling level so the schema is enforced token-by-token, not just checked at the end. Excellent for extraction.
- **Grounded reasoning:** competitive with Claude on document QA benchmarks. Tends slightly more toward "confident completion" — it will occasionally fill in a plausible-sounding number rather than say "not in the document." For credit work, this is a real risk.
- **Operational:** 128K (gpt-4o), 1M (gpt-4.1). Comparable latency.

**Why not the winner here:** the file-handling story is uglier (Assistants API adds infrastructure I don't want in a 150-line demo), and I'd rather have a model that under-answers than over-fabricates. If a client already lived on Azure OpenAI, I'd flip to GPT-4.1 without ceremony.

#### **Gemini (Google) — strong alternative, cheapest**

- **Native PDF:** excellent. Gemini 2.5 Pro handles PDFs as first-class inputs via the Files API, including tables and figures.
- **Structured output:** `response_mime_type: "application/json"` plus `response_schema`. Works, but less battle-tested than Claude's tool use or OpenAI's Structured Outputs — there are known quirks around recursive schemas and some union types.
- **Grounded reasoning:** very strong at long contexts (2M tokens). For a 7-page memo, context isn't a differentiator.
- **Operational:** the **cheapest** of the three by a meaningful margin. If cost were the deciding factor, Gemini wins.

**Why not the winner here:** cost isn't a deciding factor for a demo that will run a handful of times. Structured output tooling is slightly less polished. I'd revisit Gemini for the "run this against thousands of memos" version.

#### **Open source (Llama 3.3, gpt-oss-20b via Groq, etc.) — not viable**

- **Native PDF:** none of the popular open models take PDFs natively. You build the parsing pipeline yourself (Unstructured, PyMuPDF, Marker, etc.), which is a real chunk of work and introduces its own failure modes on tables.
- **Structured output:** you rely on JSON mode in the inference server (vLLM's `guided_json`, llama.cpp's grammar mode, or an Instructor-style retry loop). Works, but weaker than a tool-use guarantee.
- **Reasoning quality:** meaningfully behind on nuanced document reasoning. The Meridian memo has a downside case (Section 4.3) that requires reading a table and connecting it to a covenant threshold — this is where smaller open models drop findings.
- **Operational:** cheap if you host yourself, but that's not a POC concern.

**Why not:** would burn most of the 6-hour budget on PDF parsing.

### 2.3 Which *Claude* model, and why

The Claude family (as of this build):

| Model | ID | Position |
|---|---|---|
| Opus 4.8 | `claude-opus-4-8` | Frontier reasoning; highest quality; ~5× Sonnet cost |
| Sonnet 4.6 | `claude-sonnet-4-6` | Production sweet spot; strong reasoning, fast, mid-priced |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | Fast and cheap; lower ceiling on nuanced reasoning |
| Fable 5 | `claude-fable-5` | Creative-writing specialist; not applicable here |

**Decision: Sonnet 4.6 for both the Extract call and the Rank call.**

Reasoning per stage:

- **Extract stage** is a "read and organize" task — take a well-structured section of the memo (5.1 and 5.2) and put every covenant into a schema. Sonnet handles this well; Opus would be overkill (2-3× cost for maybe 5% marginal quality on a task Sonnet already does at 95%+).
- **Rank stage** is a "judgment under uncertainty" task — compare covenants by cushion, downside sensitivity, and cure difficulty. Sonnet handles this well too, because the memo does most of the work for us (Section 4.3 explicitly names the downside breach and thin headroom). If the memo were less generous, Opus would earn its price.
- **Haiku** would be tempting for cost but has two failure modes I've seen on this shape of task: (a) misses non-financial covenants in the extract stage, (b) picks the ranking primarily off the Executive Summary rather than working through the full covenant list.

**Production path I'd propose in the interview:** Sonnet 4.6 for Extract, Opus 4.8 for Rank. Extract is the higher-volume, lower-complexity step; Rank is the low-volume, judgment-heavy step where you want the best model on the harder job. For the demo, using Sonnet for both keeps the pipeline symmetrical and cheap enough that I can iterate.

### 2.4 One-line summary

Claude for native PDF + tool-forced JSON + low fabrication risk on document tasks. Sonnet 4.6 because it's the price/quality sweet spot for both stages of this pipeline.

---

## 3. Approach A — Code-first: Python + Claude API + Streamlit

### 3.1 Stack

Python 3.11 · `anthropic` SDK · Pydantic (schemas) · Streamlit (UI). That's it. Four dependencies.

### 3.2 Architecture: two calls, not one

```
  ┌───────────┐   PDF + extract   ┌───────────┐   PDF + covenants +   ┌───────────┐
  │   memo    │  ──────────────▶  │  Extract  │  ────────────────▶    │   Rank    │
  │   PDF     │      prompt       │  (Claude) │      rank prompt      │  (Claude) │
  └───────────┘                   └─────┬─────┘                       └─────┬─────┘
                                        │                                   │
                                        ▼                                   ▼
                                 covenants[] JSON                    top_3 with reasoning
                                        │                                   │
                                        └───────────────┬───────────────────┘
                                                        ▼
                                                 final combined JSON
                                                 (schema in §6)
```

**Why split into two calls:**

- **Faithful extraction is a different job from judgment.** Single-shot "extract and rank" consistently under-lists non-financial covenants (change of control, restricted payments, permitted acquisitions) and over-weights whatever the Executive Summary already flagged.
- **Auditability.** A credit officer should be able to eyeball the covenant list against Section 5 before trusting the ranking. Single-shot collapses that check.
- **Debuggability.** If the demo breaks live, I can point at which stage.

**Cost:** 2× API calls, roughly 2× latency (~10-20s total instead of ~5-10s). Invisible for a demo, and I'd re-evaluate if we were running at scale.

**Explicitly not doing:** RAG (memo is 7 pages, fits in context 40× over), agentic self-critique loop (adds architecture I can't defend), multi-model ensemble (interesting for eval, not for a runnable POC).

### 3.3 Why Streamlit for the UI

The UI has a small, well-defined job: drag a PDF onto a web page, see a covenant table, see the top-3 with reasoning, download the JSON. Alternatives considered:

| Option | Notes |
|---|---|
| **Streamlit** — chosen | Pure Python. `st.file_uploader()`, `st.dataframe()`, `st.json()`, `st.download_button()` — all one-liners. Same process as the pipeline, so no HTTP layer to build. Save the file, browser hot-reloads. Ships as `streamlit run app.py`. |
| Gradio | Similar model, popular for ML demos. Slightly less polished layout, but equivalent for this task. Would work fine. |
| Flask/FastAPI + HTML/JS | Would take an hour of frontend work I don't want to spend. |
| Next.js + React | Overkill by a factor of 10 for a demo. |
| Jupyter notebook | Not "an app" — the interviewer wanted "the agent running live," and a notebook reads as script output, not product. |
| Nothing (CLI only) | Would work, but the Loom would be terminal text scrolling for 20 seconds. Streamlit costs ~40 lines and buys a visual demo. |

**Deeper defense of Streamlit specifically:**

1. **Zero JS/CSS.** Every widget is a Python function. There is no build step, no bundler, no state library.
2. **Native file uploader.** `st.file_uploader("Drop memo", type="pdf")` gives me a validated bytes buffer in one line — no multipart form handling.
3. **Native JSON viewer.** `st.json(result)` renders the output collapsibly. That's the single most useful widget for this demo because the *whole point* is the JSON.
4. **Native dataframe.** `st.dataframe(covenants_df)` gives a sortable/filterable table — perfect for the covenant list.
5. **One process, one language.** The pipeline and the UI import from the same modules. No serialization boundary means I can pass Pydantic objects around without converting to dicts for the frontend.
6. **Familiar aesthetic.** Anyone who's touched an ML POC has seen a Streamlit app. It doesn't need explanation, which frees my walkthrough minutes for the interesting stuff (the two-call split, the guardrails).

**Streamlit's ceiling** (why I'd swap it in production): the state model gets awkward for multi-user apps with long-running background jobs. For this demo, it's ideal.

### 3.4 Repo layout

```
credit-memo-covenants-assignment/
├── README.md
├── PLAN.md                        # this document
├── requirements.txt               # anthropic, streamlit, pydantic, python-dotenv
├── .env.example
├── .gitignore
├── assignment_brief.pdf
├── memo/
│   └── Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf
├── src/
│   ├── __init__.py
│   ├── review.py                  # main pipeline: extract → rank → check → JSON out
│   ├── schemas.py                 # Pydantic models + Anthropic tool schemas
│   ├── prompts.py                 # extract + rank prompts, versioned constants
│   ├── guardrails.py              # verbatim-quote substring check
│   └── app.py                     # Streamlit UI
└── outputs/
    └── meridian_review.json       # committed example output for the walkthrough
```

Two ways to run:
- **CLI:** `python -m src.review memo/Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf > outputs/meridian_review.json`
- **UI:** `streamlit run src/app.py`

---

## 4. Approach B — Low-code: n8n + Firebase + Lovable

Same output, different tooling. The reason this exists in parallel with Approach A is that a bank innovation team lives between these worlds: engineers prototype in Python, and ops/business teams often maintain the productionised version in a visual workflow tool. Showing both is showing that I understand the trade.

### 4.1 Component roles

- **n8n — orchestration.** The workflow: receive a PDF, call Claude twice, run the guardrail check, save the result. Each step is a visual node.
- **Firebase — storage + persistence.** Firebase Storage holds uploaded PDFs. Firestore holds the parsed results (queryable review history). Firebase Auth *optional* for gating access.
- **Lovable — frontend.** The user-facing web app: file upload, results view, review history. Generated from a natural-language spec; exports real React that we can inspect and modify.

### 4.2 Why these three specifically (and what I considered)

**Orchestration: n8n over Zapier or Make**

- **n8n** is open-source, self-hostable, and gives you a real "Code" node where you can write JavaScript when a visual node isn't expressive enough. Workflows are stored as JSON — version-controllable in git if we care. Comfortable for the "engineer prototypes, ops maintains" model.
- **Zapier** — the most polished UI and biggest integration library, but per-run pricing gets expensive fast, and once you need custom logic you're immediately fighting the tool.
- **Make (Integromat)** — closer to n8n's power, but less transparent about what runs where; harder to self-host.

I pick n8n because the workflow has 6-7 steps including two LLM calls and some validation logic — this is exactly the shape where n8n shines and Zapier starts hurting.

**Storage: Firebase over Supabase or a raw S3 + Postgres stack**

- **Firebase** — Storage for the PDFs (signed URLs out of the box), Firestore for the structured results (schemaless is fine because our schema is already enforced by the LLM tool call), Auth if we want it. One vendor, one console.
- **Supabase** — arguably the better technical choice (Postgres, row-level security, real SQL). Overkill for storing a handful of PDFs and JSON blobs during a POC.
- **Raw S3 + Postgres** — most flexible, most infra to set up. Wrong shape for 48 hours.

**Frontend: Lovable over Bubble, Retool, or Softr**

- **Lovable** — AI-native. Describe the UI in prose, it generates a React app, and (importantly) it hands you the source code. When the interviewer asks "what does it do under the hood," I can answer. It's also **named in the brief**, which suggests it's inside the org's active POC toolkit.
- **Bubble** — powerful, but the mental model (workflows, data types, page builder) is heavier and the exported artifact isn't clean React.
- **Retool** — perfect for internal admin tools, less ideal for a customer-facing "drop a file, get a review" experience.
- **Softr** — great over Airtable data; wrong shape when the data is JSON in Firestore.

### 4.3 End-to-end data flow

```
  ┌──────────┐    upload PDF     ┌───────────────┐    trigger     ┌─────────────┐
  │  User    │  ───────────────▶ │  Lovable app  │  ────────────▶ │  n8n        │
  │ browser  │                   │  (React)      │   webhook      │  workflow   │
  └──────────┘                   └───────┬───────┘                └──────┬──────┘
                                         │                               │
                                         │  PDF bytes                    │
                                         ▼                               ▼
                                 ┌───────────────┐              ┌────────────────┐
                                 │  Firebase     │              │  1. Upload PDF │
                                 │  Storage      │◀─────────────│     to Storage │
                                 └───────────────┘              │  2. Extract    │
                                                                │     call →     │
                                                                │     Anthropic  │
                                 ┌───────────────┐              │  3. Rank call  │
                                 │  Firestore    │◀─────────────│     → Anthropic│
                                 │  reviews/     │              │  4. Guardrail  │
                                 │  {reviewId}   │              │     quote-check│
                                 └───────┬───────┘              │  5. Write JSON │
                                         │                      │     to Firestore│
                                         │                      └────────┬────────┘
                                         │                               │
                                         └───────────────┬───────────────┘
                                                         ▼
                                                 ┌───────────────┐
                                                 │  Lovable app  │
                                                 │  results view │
                                                 │  + history    │
                                                 └───────────────┘
```

### 4.4 n8n workflow nodes (concrete)

| # | Node | Purpose |
|---|---|---|
| 1 | Webhook (trigger) | `POST /review` — receives PDF (multipart or base64) from Lovable |
| 2 | Firebase Storage: Upload | Store the raw PDF under `memos/{uuid}.pdf`; get a signed URL |
| 3 | HTTP Request → Anthropic Messages API | **Extract call.** Send PDF as `document` block + extract system prompt + tool schema. Force tool choice. |
| 4 | Function (JS) | Parse `tool_use` block from response; hand the covenants array to the next node |
| 5 | HTTP Request → Anthropic Messages API | **Rank call.** Send PDF + extracted covenants + rank prompt + rank tool schema |
| 6 | Function (JS) | Assemble final JSON; run the verbatim-quote check against PDF text (n8n's `Extract from File` node gives us the memo text once, cached) |
| 7 | Firestore: Set Document | `reviews/{reviewId}` — write the full JSON output |
| 8 | Respond to Webhook | Return the JSON to Lovable |

Each node is inspectable in the n8n UI — you can click a node mid-run and see its input and output. This is the low-code equivalent of Approach A's line-by-line walkthrough.

### 4.5 Trade-offs versus Approach A

| Dimension | Approach A (Python) | Approach B (n8n + Firebase + Lovable) |
|---|---|---|
| Time to first working run | ~2 hours | ~3-4 hours (more accounts and glue to wire up) |
| Explaining the pipeline | Line by line in one file | Click through nodes in the n8n UI |
| Debugging | `print()`, breakpoints, tests | n8n execution log per node — good, but not as tight as a debugger |
| Persistence / history | Not built (writes JSON to disk) | Free (Firestore stores every run) |
| Retries + error handling | I write them | Built-in n8n retry per node |
| Multi-user, hosted demo | Would need to deploy | Hosted from day one |
| Version control | Git-native | Workflow is exportable JSON; more friction than code |
| Cost model | ~$0.10 per run in Anthropic API calls | Anthropic API + n8n cloud (or self-host) + Firebase (small) |
| Who can maintain it | Engineers | Ops/business can edit workflow nodes; engineers own the Function nodes |

### 4.6 When I'd actually pick B over A in production

- Non-engineers need to modify the workflow (e.g., swap models, adjust prompts, add a Slack notification).
- We need retries, scheduled runs, or event triggers (webhook from a document management system).
- The tool integrates with 5+ external systems, not 1.
- We need built-in observability and a run history without building it ourselves.

For this specific demo, Approach A is faster to explain in 10 Loom minutes. Approach B is more like what the production version would look like.

---

## 5. Grounding and hallucination guardrails (both approaches)

The single biggest risk in this pipeline is a plausible-sounding covenant that isn't in the memo, or a "top risk" reasoning citing facts not present. Three cheap defenses, identical across A and B:

1. **Verbatim quotes required.** Every extracted covenant carries a `verbatim_text` field — the exact string from the memo. Every top-3 risk carries `evidence_from_memo` with the quote it's leaning on. Enforced by the tool schema.
2. **Source section labels.** Every covenant carries `source_section` ("5.1", "5.2", "7", "8"). Traceable back to the document.
3. **Post-run substring check.** After both calls, walk the JSON and confirm each `verbatim_text` / `evidence_from_memo` appears in the memo's extracted text. Trivial code, high-value defensibility — in the Loom I can say "the tool checks its own quotes."

Not adding an LLM-as-judge verifier layer. It would help quality but doubles complexity, and the guardrails above already give me an auditable output for a 48-hour build.

---

## 6. Output schema (target JSON — identical for both approaches)

```jsonc
{
  "memo_metadata": {
    "borrower": "Meridian Packaging Group, Inc.",
    "facility_size_usd_m": 450,
    "memo_date": "2026-07-06",
    "source_file": "Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf"
  },
  "covenants": [
    {
      "id": "cov_01",
      "name": "Maximum total net leverage",
      "type": "financial",              // financial | non-financial
      "category": "leverage",           // leverage | coverage | liquidity | capex | reporting | restricted_payment | change_of_control | negative_pledge | acquisition | other
      "threshold": "4.25x at close; 4.00x from Q4 2026; 3.75x from Q4 2027; 3.50x from Q4 2028",
      "test_frequency": "quarterly",
      "current_value": "3.51x (PF at close)",
      "downside_value": "3.93x (FY26 downside)",
      "source_section": "5.1",
      "verbatim_text": "Maximum total net leverage — 4.25x at close; 4.00x from Q4 2026 …"
    }
  ],
  "top_risks": [
    {
      "rank": 1,
      "covenant_id": "cov_02",
      "covenant_name": "Minimum cash interest coverage",
      "reasoning": "Downside case (Section 4.3) projects 2.97x vs. the 3.00x minimum — a projected breach on the memo's own downside scenario. Base case carries only 39 bps of cushion, so realistic under-performance on synergies plus resin-cost timing lands in breach territory.",
      "evidence_from_memo": "Cash interest coverage … 2.97x … Min 3.00x — BREACH"
    }
  ],
  "run_metadata": {
    "model": "claude-sonnet-4-6",
    "approach": "python" ,             // "python" | "n8n"
    "extract_tokens": { "input": 0, "output": 0 },
    "rank_tokens":    { "input": 0, "output": 0 },
    "quote_check": { "passed": true, "failures": [] }
  }
}
```

**Schema choices worth calling out:**

- `type` (financial vs non-financial) is what the brief asked for; `category` is what a credit officer actually filters on.
- `downside_value` is in the covenant record even though the brief didn't ask for it. The rank stage needs it to compare cushions, and it's far cheaper to extract once here than re-derive during ranking.
- `top_risks` uses explicit `rank` fields, not array order — insurance against downstream serialization bugs.
- `run_metadata.quote_check` is the audit trail from the guardrail layer.

---

## 7. Prompt design (sketch — full prompts live in `src/prompts.py` and mirrored into the n8n nodes)

**Extract prompt (system):**
- Role: "You extract covenant terms from corporate credit memos. You do not analyze risk in this call."
- Explicit list of what counts as a covenant (both 5.1 financial and 5.2 non-financial).
- Instruction to include *every* covenant, one row each, including boilerplate ones (sanctions/AML, insurance).
- Schema handed over as a tool definition; `tool_choice: {type: "tool", name: "record_covenants"}`.
- Quote the memo verbatim in `verbatim_text` — no paraphrase.

**Rank prompt (system):**
- Role: "You are a senior credit officer reviewing a memo. You already have the extracted covenant list. Your only job is to pick the three highest-risk covenants and explain why in 1-2 sentences each."
- Definition of "risk" spelled out: probability of a covenant being tripped over the facility life, weighted by ease of curing it.
- Lean on the downside case (Section 4.3) and the risk table (Section 7) where they exist.
- Anti-bias instruction: "Do not default to risks the memo's own executive summary flagged. Consider the full covenant list and disagree if warranted."
- Tool-forced output.

**Expected ranking for the Meridian memo** (what "correct" looks like — derived from Section 4.3 and 7):
1. Minimum cash interest coverage — projected downside breach (2.97x vs 3.00x).
2. Maximum total net leverage — 0.07x headroom at the Q4 2026 step-down under downside.
3. Minimum liquidity — Q3 seasonal trough drops to $38M vs $30M minimum in downside; thin buffer.

If either approach surfaces those three (in roughly that order) with grounded reasoning, the demo works.

---

## 8. What lives in the Loom

1. **Memo generation** (~1 min): what I prompted for, what I checked (memo must contain a downside sensitivity, must *not* label the top 3 risks in Section 5 verbatim, otherwise the agent's job is trivial).
2. **Approach A running live** (~2-3 min): drop the PDF into Streamlit, walk through the covenant table, then the top-3 with reasoning.
3. **Approach B running live** (~2 min): drop the PDF into the Lovable app, show the n8n execution log, show the Firestore record.
4. **Architecture side-by-side** (~1-2 min): two diagrams. Same LLM, same schema, same guardrails; different orchestration.
5. **The trade-off** (~1 min): two calls instead of one — auditability at the cost of latency. Same trade in both approaches.
6. **Two more weeks** (~1 min): eval harness — 5-10 varied memos with human-labeled top-3, measure covenant recall + rank agreement. Right now the grader is me and one memo — not enough to know the tool generalizes.

---

## 9. What is explicitly out of scope (both approaches)

- UI polish beyond a working page.
- Production deployment (Approach A runs on my laptop; Approach B runs in the vendor consoles).
- Auth, RBAC, audit logging.
- Non-PDF inputs, scanned PDFs (would need OCR), multi-memo batching.
- Auditing whether the memo's *numbers* are correct — the agent reviews the memo as written.

---

## 10. Execution plan

| Step | Approach A | Approach B |
|---|---|---|
| Scaffold repo/accounts, wire secrets | 0.5h | 1.0h (Firebase project, n8n instance, Lovable workspace) |
| Extract call end-to-end | 1.0h | 1.0h (HTTP node + prompt + tool schema) |
| Rank call end-to-end | 1.0h | 0.75h (mostly the same as Extract) |
| Guardrails (quote check) | 0.5h | 0.5h (Function node) |
| UI (Streamlit / Lovable) | 0.75h | 1.0h (Lovable connect to n8n webhook + Firestore) |
| README + committed example output | 0.75h | 0.75h |
| **Total** | **~4.5h** | **~5h** |
| **Combined (with shared work)** | | **~7-8h** |

Combined is above the "5-6 hour" comfort zone the brief mentions but below the 48-hour ceiling. If time gets tight, ship Approach A end-to-end first, then bring Approach B to demo-ready.
