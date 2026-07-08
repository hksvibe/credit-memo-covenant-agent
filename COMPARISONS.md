# Tool, Model & Prompt Comparisons 

Two sets of comparisons:

1. **LLM providers** — Claude vs Gemini vs OpenAI vs Groq
2. **Claude models** — Opus vs Sonnet vs Haiku

Every table has two verdict columns: one for the POC (this 48-hour demo) and one for running the same tool at large scale in a bank.

Plain-English key used throughout:
- **POC** = the demo we're building this week. Small volume, few users, "does it work?" is the question.
- **Scale** = the version a bank actually runs. Thousands to millions of memos, many users, audit trails, uptime commitments.

---

## 1. LLM Provider Comparison

**What "LLM" means here:** the large language model brain that reads the memo and writes the answers.

**Note on Groq:** Groq isn't a model, it's a *hosting company* that runs open-source models (Llama, gpt-oss) on very fast custom chips. So "Groq" in this table means "open-source models running on Groq's fast infrastructure."

### 1.1 Feature-by-feature comparison

| Feature | Claude (Anthropic) | Gemini (Google) | OpenAI (GPT) | Groq (open-source models) |
|---|---|---|---|---|
| **Can it read a PDF directly?** | Yes, cleanly. You hand it the PDF file and it reads text + tables + page images together. | Yes, cleanly. Similar to Claude — first-class PDF support. | Only through their "Assistants" feature, which does its own text extraction behind the scenes. You lose control of how the memo is chunked. | No. You have to convert the PDF to text yourself before sending it. That's a whole separate step to build. |
| **Can it be forced to output valid JSON?** | Yes. You define a "tool" with a schema and the model literally can't return anything else. Very reliable. | Yes. You set `response_schema` and it follows it. Works, but has known quirks with unusual schemas. | Yes. Their "Structured Outputs" mode is arguably the strictest — they constrain the model at the token level so it can't stray. | Partially. Depends on the hosted model. You typically bolt on retry logic ("if it's invalid, ask again"). Less reliable than the top three. |
| **How often does it make things up?** | Low. Trained to say "I don't know" rather than invent. Very good for finance-type documents. | Low-to-medium. Very capable but occasionally over-confident on details. | Medium. Very capable but slightly more inclined to "fill in" plausible-looking numbers when uncertain. | Higher, and varies by model. Smaller open models drop findings and sometimes hallucinate structure. |
| **How much text can it hold at once?** | 200,000 words-ish (~7-page memo fits ~40 times over). Newer versions can hold 1 million. | Up to 2 million. The biggest of the group. | 128,000 for GPT-4o; 1 million for GPT-4.1. | Depends on the open model — usually 8K to 128K. Smaller. |
| **How fast?** | Fine (~5-15 seconds per call for this task). | Fine, similar to Claude. | Fine, similar to Claude. | Extremely fast — Groq's whole selling point. 5-10× faster than the others. |
| **How expensive?** | Medium. | Cheapest of the "top-tier" three. | Medium. | Very cheap per token, but you're paying for a weaker model. |
| **How mature is the developer experience?** | Very mature. Clean SDK, good docs, stable. | Mature but historically the docs have been the messiest of the group. | Very mature. The most third-party tools built for it. | Simple API but ecosystem is thinner. |
| **How easy to switch away from if we outgrow it?** | Easy — API shape is similar to OpenAI/Gemini. Change ~20 lines. | Same. | Same. | Same, but you're already on open-source, so you can host yourself if the vendor becomes a problem. |

### 1.2 POC perspective — which one wins?

| Winner | Why in one sentence |
|---|---|
| **1st: Claude** | Reads PDFs cleanly, forces JSON output reliably, and has the lowest fabrication risk — the three things that matter most for a credit memo demo. |
| **2nd: Gemini** | Nearly as good as Claude at PDFs and cheapest of the top-tier group; loses only on structured-output maturity and my personal debugging speed. |
| **3rd: OpenAI** | Excellent model, but you have to work through the Assistants API to get clean PDF handling — infrastructure I don't want to build in 48 hours. |
| **Not viable: Groq** | Open-source models on Groq don't take PDFs natively. You'd burn 2+ hours writing a PDF-to-text pipeline before you write a single prompt. Wrong shape for this timebox. |

### 1.3 Large-scale perspective — which one wins if we run this on millions of memos?

At scale, the question shifts. Cost matters. So does uptime, regional data residency, whether the vendor will still exist in 3 years, and whether your bank's procurement and legal teams have already approved a vendor.

| Ranking | Why |
|---|---|
| **1st: whichever the bank already has a contract with.** | Real answer. At scale you don't pick the "best" model — you pick the one legal already cleared, that fits your data-residency rules, and that your procurement team has already priced. If the bank runs on Azure, that's GPT via Azure OpenAI. If it runs on Google Cloud, that's Gemini via Vertex AI. If it has an AWS Bedrock relationship, that's Claude via Bedrock. |
| **2nd: Gemini** on pure cost | If nothing is pre-decided, Gemini is the cheapest capable model for a high-volume "read and extract" workload. Cost dominates at millions of runs. |
| **3rd: Claude** on quality-for-money | Slightly more expensive than Gemini but the lower fabrication rate matters more when volume is high (a 1% error rate on 1M runs = 10,000 mistakes). Available on Bedrock for banks already on AWS. |
| **4th: OpenAI** | Same as Claude on cost/quality; strong ecosystem of third-party tools if the bank standardizes on OpenAI. |
| **Groq / open-source at scale** | Interesting for extremely high volume where cost dominates. You'd host an open-source model yourself and take on maintenance in return for the lowest per-run cost. Not the first move; a "phase 3" optimization. |

### 1.4 One-line summary

- **POC → Claude.** Best PDF handling, most reliable JSON, lowest fabrication risk.
- **Scale → whichever the bank already has a contract with, then Gemini for pure cost or Claude for quality-per-dollar.**

---

## 2. Claude Model Comparison

Anthropic ships several Claude models at different price/quality tiers. Picking the right one is like picking the right lawyer: the senior partner is expensive and slow but reasons well; the associate is fast and cheap and handles routine work perfectly.

### 2.1 The lineup

| Model | Plain-English position | Rough relative cost | Rough relative speed |
|---|---|---|---|
| **Opus 4.8** | The senior partner. Frontier reasoning; best on hard, judgment-heavy tasks. | Most expensive (~5× Sonnet). | Slowest. |
| **Sonnet 4.6** | The senior associate. Handles ~95% of real work; the standard "production" pick. | Middle. | Middle. |
| **Haiku 4.5** | The paralegal. Very fast and cheap; great for high-volume routine tasks. | Cheapest. | Fastest. |
| **Fable 5** | The creative writer. Specialized for storytelling and writing tasks. Not relevant for extraction/analysis work. | N/A here | N/A here |

### 2.2 Feature-by-feature comparison

| Feature | Opus 4.8 | Sonnet 4.6 | Haiku 4.5 |
|---|---|---|---|
| **Reading a document and pulling out structured data** | Excellent, but overkill for most cases. | Excellent. This is Sonnet's sweet spot. | Good on simple documents, drops findings on complex ones. |
| **Judgment / reasoning under uncertainty** | Best in class. Notably better on hard reasoning where you'd want a senior person's view. | Very strong. Handles most judgment tasks well. | Weaker. Tends to pick the "obvious" answer rather than working through the full picture. |
| **Following complex instructions in a prompt** | Extremely strong. | Very strong. | Sometimes skips instructions in long prompts. |
| **Cost per run (rough)** | ~5× Sonnet | Baseline | ~5× cheaper than Sonnet |
| **Speed** | Slowest | Middle | Fastest |
| **Best-suited for** | The genuinely hard questions; final review; adversarial checks. | Almost everything in production. | High-volume, low-nuance tasks (classification, tagging, routine extraction). |
| **Failure mode to watch for** | Over-thinking simple questions; higher cost per run. | Rare, but occasionally lists too generously — extracts things that are borderline covenants. | Misses subtle covenants; picks the top-3 mostly from the memo's Executive Summary rather than working through the full list. |

### 2.3 For the two stages of THIS pipeline

**Stage 1 — Extract every covenant:**

| Model | Verdict for Extract |
|---|---|
| **Opus** | Overkill. Extraction is "read and organize," not "reason and judge." You'd pay 5× the cost for maybe 3-5% better recall. Not worth it. |
| **Sonnet** ✅ | Right pick. Extraction is exactly what Sonnet is best at. |
| **Haiku** | Tempting for cost but I've seen it miss non-financial covenants (change-of-control, restricted payments, affiliate transactions). Extraction failures ripple downstream. Not worth the saving. |

**Stage 2 — Rank the top 3 risks:**

| Model | Verdict for Rank |
|---|---|
| **Opus** | The "correct" answer if budget is not a concern. This is a judgment task and Opus is the judgment specialist. |
| **Sonnet** ✅ (for the POC) | Handles this well because the Meridian memo does most of the work (Section 4.3 explicitly names the downside breach). For a memo without such clear signals, I'd upgrade to Opus. |
| **Haiku** | Wrong tool. Ranking is the exact kind of judgment task Haiku is weakest on. |

### 2.4 POC pick

**Sonnet 4.6 for both stages.**

Simple reason: keeps the pipeline symmetrical, keeps the cost low enough to iterate on prompts freely, and the memo we're testing on gives Sonnet enough signal to arrive at the right ranking.

### 2.5 Large-scale pick

**Sonnet 4.6 for Extract, Opus 4.8 for Rank.**

Simple reason: at scale you want the best model on the harder job. Ranking is the low-volume, high-value step (one rank call per memo, and the answer influences credit decisions). Extract is the high-volume mechanical step (Sonnet is more than enough).

If cost pressure is extreme at scale, an alternative is **Sonnet for both + Opus as a "second opinion" on the top 20% of memos flagged by the Extract stage as complex.** Same total quality at ~1.4× the Sonnet-only cost instead of ~3× the Opus-everything cost.

### 2.6 One-line summary

- **POC:** Sonnet 4.6 for both stages.
- **Scale:** Sonnet 4.6 for Extract, Opus 4.8 for Rank. Sample Opus onto the hardest cases only.

---

## 3. Why we picked the code-first approach for this POC

We seriously considered building both paths in parallel — Python + Streamlit AND n8n + Firebase + Lovable — and ended up shipping only the code-first version. Same AI model, same schema, same guardrail. Different tooling. Here's the honest reasoning.

### The two candidates, side by side

| | **Code-first (chosen)** | **Low-code alternative** |
|---|---|---|
| Stack | Python + Anthropic SDK + Streamlit | n8n + Firebase + Lovable + Anthropic REST |
| Where the pipeline runs | Single Python process on Streamlit Cloud | 9-node visual workflow on n8n Cloud |
| Where the UI lives | Streamlit Community Cloud (free tier) | GitHub Pages (frontend) + n8n Cloud (backend) |
| Where results live | Downloadable JSON | Firestore documents (persistent history) |
| Vendor accounts to set up | 2 (Anthropic + Streamlit Cloud) | 4 (Anthropic + n8n Cloud + Firebase + GitHub Pages) |
| Streaming from Anthropic | Yes (Python SDK) | No (n8n's HTTP node waits for full response) |
| Max token budget | 32,000 (fits any real memo) | 16,000 (capped to stay under HTTP timeout) |
| Latency per review | 15-45 seconds | 25-70 seconds |
| Cost per review | ~$0.15-0.63 (Anthropic only) | Same Anthropic bill + $20/mo n8n Cloud after 14-day trial |
| How you defend it in interview | Line-by-line through ~150 lines of Python | Click through 9 workflow nodes |
| Persistence | User downloads the JSON | Every run auto-saved to Firestore |
| Retries + observability | You write them | Built-in per node |
| Who can maintain the prompts | Engineers (PR + deploy) | Ops/business (edit workflow, save, done) |

### Why code-first wins the POC bar

**1. Speed to a runnable demo.** 

**2. Fewer moving parts to fail live.** The code-first stack has one vendor (Anthropic). The low-code stack has four (Anthropic, n8n Cloud, Firebase, GitHub Pages). Any of the extra three can outage the demo mid-interview — a webhook 404, a Firestore rules typo, a Pages build lag — and each is one more thing to debug.

**3. The AI does the same work in both.** Both approaches would run Extract → Rank + guardrail on Claude Sonnet 4.6. The tool comparison is really about *where the code lives*, not *what it does*. A reviewer wanting to see the pipeline doesn't need two versions producing the same JSON.

**4. Cost stays flat.** Code-first has $0 fixed cost — everything is pay-as-you-go on Anthropic. Low-code adds n8n Cloud ($20/mo after 14-day trial) for the duration of the demo period.

### Where the low-code version would win instead

Honest answer to *"why not both?"* — for a bank innovation team at production time, I'd absolutely rebuild this on n8n or similar. Reasons:

- **Non-engineers can edit prompts** without a PR / deploy cycle. Real value when the ops team owns the workflow.
- **Free persistence + history** via Firestore. Every run auditable without writing storage code.
- **Built-in retries + observability** per node. Would take a day to add to the Python version manually.
- **Ops-friendly execution log.** A non-engineer can debug a failed run by clicking the failed node — no need to read a stack trace.


---

## 4. Two Calls vs Single Call — three-way comparison

Our pipeline uses **two separate AI calls**: one to extract every covenant (Extract), then a second to rank the top-3 risks (Rank). The obvious alternative is doing both jobs in one AI call — extract AND rank in the same request. We tested TWO different single-call variants against the production two-call pipeline on two memos.

### 4.1 What we tested

Three approaches head-to-head:

- **Two calls (production)** — Extract call followed by Rank call. Each call has its own tightly-scoped system prompt (~4000 chars for Extract, ~2700 for Rank) and its own strict tool schema with the 16-value category enum.
- **Single call — thin prompt (v1)** — one combined call with a short (~700 char) prompt that just says "do both." Permissive schema — `category` accepted as free-text.
- **Single call — comprehensive prompt (v2)** — one combined call with a full ~5000-char prompt matching Extract's taxonomy and rules AND Rank's signals and guardrails. Strict category enum matching production.

Both single-call variants are kept as commented reference blocks at the bottom of [`src/prompts.py`](src/prompts.py). Neither is wired into the production pipeline.

### 4.2 Meridian memo (7 pages, synthetic)

| Metric | Two calls (production) | Single call — thin (v1) | Single call — comprehensive (v2) |
|---|---|---|---|
| Covenants extracted | **28** | 26 (−2, −7%) | **29 (+1, +4%)** |
| Top-3 covenants | Interest coverage / Leverage / Liquidity | ✓ same three, same order | ✓ same three, same order |
| Quality of reasoning | 459 chars avg | 489 chars avg | 470 chars avg |
| Guardrail quotes verified | 31 of 31 | 29 of 29 | **32 of 32** |
| Category enum drift | 0 invented | **20 invented** | 0 invented |
| Cost per review | $0.19 | $0.13 | $0.14 |
| Wall-clock time | 15-45s typical | ~80s | ~84s |

**Read-through:** on a small, clean, well-structured memo, comprehensive single-call is actually BETTER than two calls on completeness (29 vs 28) at 27% lower cost. Thin single-call loses ground on completeness AND invents 20 category labels. On Meridian alone, comprehensive single-call would be a defensible choice.

### 4.3 Deutsche Bank memo (50 pages, real)

| Metric | Two calls (production) | Single call — thin (v1) | Single call — comprehensive (v2) |
|---|---|---|---|
| Covenants extracted | **50** | 36 (−14, −28%) | 47 (−3, −6%) |
| Top-3 covenants | Guarantor NW / Facility A repayment / Facility B DSCR | ✓ same three, same order | **≈ same three, rank 2 shifted** (extension condition vs repayment) |
| Quality of reasoning | 547 chars avg | 619 chars avg | 580 chars avg |
| Guardrail quotes verified | 53 of 53 | 38 of 39 | 50 of 50 |
| Category enum drift | 0 invented | **26 invented** | 0 invented |
| Cost per review | $0.63 | $0.37 | $0.39 |
| Wall-clock time | ~180s | ~185s | ~178s |

**Read-through:** on a real 50-page bank memo, comprehensive single-call dramatically closes the completeness gap — from 14 missing covenants (v1) down to 3 (v2). Category drift is eliminated. BUT the top-3 shifts: v2 picked "Facility A Extension Condition" at rank 2 instead of "Facility A Minimum Annual Repayment." These are structurally the same risk (missing the annual $14M repayment schedule means missing the extension gate), but different framing — a real run-to-run stability question.

### 4.4 The pattern

Two things stand out across both memos:

- **Both single-call variants get the top-3 right on Meridian and both name the same underlying three risks on DB.** Ranking accuracy is not the differentiator.
- **Completeness responds strongly to prompt depth.** Thin single-call misses 28% on DB. Comprehensive single-call misses 6%. Prompt engineering closes most (but not all) of the gap.
- **Schema discipline responds to enum enforcement.** Thin single-call invented 20-26 categories per memo. Comprehensive single-call — same enum as production — invents zero.

The story is not "single-call is broken." It is: **thin single-call is clearly worse; comprehensive single-call is a legitimate alternative with a few real trade-offs.**

### 4.5 Why we still choose two calls over comprehensive single-call

Comprehensive single-call closed the biggest gaps. The remaining reasons to keep two calls are structural, not raw-metric:

1. **Auditability of the intermediate covenant list.** A credit officer using this in a review workflow wants to eyeball the extracted covenant list against Section 5 of the memo BEFORE trusting the top-3 ranking. Two calls make the covenant list a first-class checkable artifact — you get it back from Extract, you can display it, save it, filter it. Single-call collapses that check: you get the covenants and the ranking together and have to trust or reject both. **This is real product value in a credit-officer workflow, not a demo detail.**

2. **Debuggability** If the demo fails live, two calls let us point at which stage broke. Extraction thorough but ranking confused? Extraction missed covenants that would have changed the ranking? Two independent failure surfaces are easier to reason about than one atomic call. Single-call fails atomically — no way to tell which half went wrong.

3. **Marginal completeness matters.** 47 of 50 is not 50 of 50. The three covenants comprehensive single-call missed on DB include a guarantor financial covenant. In a bank workflow, "extraction is 94% complete" is a real gap for a credit officer to hit.

4. **Top-3 run-to-run stability.** Comprehensive single-call shifted rank 2 on DB (Facility A extension condition vs annual repayment). Both are structurally the same underlying risk, but a reviewer running the tool multiple times shouldn't see the top-3 fluctuate on wording. Two focused calls with narrower schemas produce more stable output.

5. **Prompt-engineering brittleness.** Comprehensive single-call works BECAUSE of a very long, carefully-constructed prompt. Any tweak — a new covenant category, a new ranking signal, a change to the guardrail definition — has to be threaded through one giant prompt that handles both jobs. Two calls let each stage evolve independently. Cheaper maintenance long-term.

None of these five is decisive on its own. Together they justify the ~$0.10 cost premium (once caching is enabled, see Section 4.7).

### 4.6 Why we picked two calls (the decision)

If the tool were a pure "read memo → return top-3 highlights" API with no human in the loop, comprehensive single-call would be the right choice — same top-3, 38% cheaper, comparable schema quality. That's not the target use case.

**The tool is intended to sit in a credit-officer review workflow** where the reviewer wants to (a) see the full covenant list as a checkable artifact, (b) trust the top-3 ranking is grounded in a complete list, and (c) understand which stage of the pipeline produced which output. Every one of those goals is served by two calls and undermined by a single call — regardless of how comprehensive the single-call prompt is.

**We picked two calls because the split matches how a credit officer would use the tool.** The AI does the same work in either architecture; the two-call design just makes the intermediate output usable and the failure modes debuggable.

### 4.7 Cost recovery at scale — prompt caching

The ~40% cost premium at DB scale is not a permanent tax. Anthropic offers **prompt caching**, which recovers most of it with a one-line code change.

**How it works.**
- On the first call, mark the PDF as cachable. The first call pays a small **25% premium** on the cached portion (Anthropic charges $3.75 per million tokens instead of $3.00 for cache-write content).
- On any second call **within 5 minutes** that references the same cached content, the cached portion is billed at only **10% of the normal input price** — $0.30 per million tokens instead of $3.00.
- Cache expires after 5 minutes.

Our Rank call always fires within a few seconds of Extract, so the cache is always warm.

**Cost math on the Deutsche Bank memo.**

| Line item | Without caching | With caching |
|---|---|---|
| Extract input (PDF ~68K + prompt ~5K) | $0.22 | $0.27 (cache-write premium on PDF) |
| Extract output | $0.15 | $0.15 |
| Rank input, cached PDF (~68K) | $0.20 | **$0.02** (90% discount) |
| Rank input, non-cached (covenants list + Rank prompt ~14K) | $0.05 | $0.04 |
| Rank output | $0.01 | $0.01 |
| **Total per review** | **$0.63** | **~$0.49** |

Result: two calls with caching enabled costs about **$0.49** on a DB-sized memo. Comprehensive single-call was $0.39. The gap narrows from 38% down to about 26% — and two calls keeps its auditability, debuggability, completeness, top-3 stability, and prompt-maintenance advantages.

On smaller memos (Meridian-sized), caching saves about 15%.

**Implementation cost:** one field on one Python dict. In [`src/review.py`](src/review.py), the `_pdf_document_block()` helper would grow one line — `"cache_control": {"type": "ephemeral"}` on the document source. Everything else stays identical.

We have not shipped caching in the POC because at demo volume ($0.15-0.63 per review, 20-30 runs a day) the absolute savings do not justify the extra thing to explain in the walkthrough. It is the first optimisation we would add before going to production volume.

### 4.8 Summary of the trade-off

| Dimension | Two calls (chosen) | Two calls + caching | Single — thin | Single — comprehensive |
|---|---|---|---|---|
| Completeness on DB (50-page real memo) | 50 / 50 | 50 / 50 | 36 / 50 | 47 / 50 |
| Completeness on Meridian (7-page synthetic) | 28 | 28 | 26 | 29 |
| Top-3 accuracy | ✓ ref | ✓ ref | ✓ same | ~ same (1 rank shift on DB) |
| Schema / enum discipline | ✓ | ✓ | ✗ (20-26 invented) | ✓ |
| Cost per DB review | $0.63 | ~$0.49 | $0.37 | $0.39 |
| Auditable intermediate covenant list | ✓ | ✓ | ✗ | ✗ |
| Debuggable by stage | ✓ | ✓ | ✗ | ✗ |
| Prompt maintenance | Two focused prompts | Two focused prompts | One thin prompt | One ~5000-char monolith |

**The honest one-sentence read:** comprehensive single-call is a legitimate technical alternative — it gets the ranking right, closes the completeness gap to 6%, and costs less. Two calls wins because it produces an intermediate artifact (the covenant list) that fits the credit-officer review workflow, and because two focused prompts are easier to maintain and debug than one 5000-character monolith.

---

## 5. Summary — one-line answers to "what do we pick?"

### For the POC (this 48-hour demo)

| Layer | Pick |
|---|---|
| Model provider | Claude |
| Model | Claude Sonnet 4.6 |
| Orchestration | Python script (no orchestrator) |
| Storage | Local files |
| Frontend | Streamlit |

### For running the same tool at scale in a real bank

| Layer | Pick |
|---|---|
| Model provider | Whichever the bank already has a contract with. If unconstrained: Gemini for pure cost, Claude for quality-per-dollar. |
| Model | Sonnet 4.6 for Extract, Opus 4.8 for Rank. |
| Orchestration | n8n if non-engineers maintain it. Airflow/Prefect or Step Functions if engineering owns it. |
| Storage | Native cloud (AWS S3 + Postgres, or equivalent). Firebase or Supabase for a lightweight product line. |
| Frontend | Custom Next.js for a customer-facing product. Retool or Bubble for internal tools. |

**The pattern:** POC picks are chosen for **speed of getting to a runnable demo**. Scale picks are chosen for **fit with existing infrastructure, cost, control, and audit**. They are almost never the same tools, and that's fine.
