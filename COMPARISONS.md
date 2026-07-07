# Tool & Model Comparisons — Simple English

Three sets of comparisons:

1. **LLM providers** — Claude vs Gemini vs OpenAI vs Groq
2. **Claude models** — Opus vs Sonnet vs Haiku
3. **Stack tools** — n8n vs alternatives · Firebase vs alternatives · Lovable vs alternatives

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

### 1.2 POC perspective — which one wins for this 48-hour demo?

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

## 3. Tool Comparisons

Three separate tool decisions in the low-code stack:

- **Orchestration** (the "which step happens when" tool): **n8n** vs alternatives
- **Storage & database** (where PDFs and results live): **Firebase** vs alternatives
- **Frontend** (what the user sees): **Lovable** vs alternatives

### 3.1 Orchestration — n8n vs alternatives

**What orchestration means in plain English:** the tool that says "when a user uploads a PDF, first save it, then call the AI, then check the result, then save the answer." It's the recipe-runner.

| Tool | What it is | POC strengths | POC weaknesses | Scale strengths | Scale weaknesses |
|---|---|---|---|---|---|
| **n8n** ✅ | Open-source visual workflow builder. Drag boxes, connect them, run. | Visual — non-engineers can follow the flow. Has a "Code" node when visual isn't expressive enough. Self-hostable if the bank wants that. Workflows are files you can put in git. | Adds vendor accounts to set up. Debugging is per-node, not line-by-line. | Handles scheduled runs, retries, error handling out of the box. Self-hosting means no per-run pricing. Non-engineers can maintain workflows. | Version control for workflows is awkward (JSON blobs). Debugging complex flows still slower than code. |
| **Zapier** | The most popular no-code automation tool. Very polished UI. | Fastest to set up if the pieces you need are pre-built. Biggest library of integrations. | Per-run pricing gets expensive. Custom logic requires you to fight the tool. | Great for a small business with light volume. | Cost balloons at scale. Weak custom-code story. Not self-hostable — vendor lock-in. |
| **Make (Integromat)** | Similar to n8n but as a hosted service. | More powerful than Zapier for the same kind of workflows. | Less transparent about what runs where; not self-hostable. | Reasonable at scale but same pricing concerns as Zapier. | Vendor lock-in. |
| **Airflow / Prefect / Dagster** | Engineer-owned orchestration frameworks. Code-first. | None for a 48-hour POC. Overkill. | Weeks of setup before you get anything running. | The right answer for serious data pipelines with lots of steps, retries, backfills. | Requires engineering ownership; not touchable by ops. |
| **AWS Step Functions / Google Cloud Workflows** | Cloud-vendor orchestration services. | None for POC — you're inside AWS/GCP consoles for hours before you write a prompt. | Requires cloud engineering knowledge. | Excellent at true scale — durable, cheap, integrates with everything in the cloud. | Vendor lock-in; harder for non-engineers to touch. |
| **Just Python + FastAPI (no orchestration tool)** | Write the workflow directly in code. | Fastest to get to a running demo. Total control. Zero vendor. | You build retries, scheduling, monitoring yourself. | Fine at small scale. At real scale, you're eventually reinventing an orchestrator badly — usually the trigger to move to Airflow or similar. | Not touchable by non-engineers. |

**POC winner:** **Just Python** for Approach A because it's the fastest path to a runnable demo. **n8n** for Approach B because it's the visual story the interviewer can watch, and it's genuinely a good POC tool.

**Scale winner:** depends on org. For a mid-scale bank workflow with ops involvement, **n8n** stays a good answer. For high-volume automated pipelines run by an engineering team, **Airflow/Prefect or cloud-native (Step Functions)**. For a small business or single-team use, **n8n or Make**.

### 3.2 Storage & database — Firebase vs alternatives

**What we need to store in plain English:** the uploaded PDFs, and the JSON result for each one. Also a way to look up past reviews.

| Tool | What it is | POC strengths | POC weaknesses | Scale strengths | Scale weaknesses |
|---|---|---|---|---|---|
| **Firebase** ✅ | Google's all-in-one backend service. Storage for files, Firestore (a document database) for JSON, Auth for logins. | Setup takes minutes. Signed URLs for files out of the box. Firestore is schemaless — matches our JSON output. Single console, single vendor. | Firestore is not a great fit if you later want SQL-style queries ("all memos where leverage > 4.0"). | Fine at moderate scale. Automatic scaling. | Costs get real if you're storing lots of files or making many reads. Vendor lock-in to Google. Firestore isn't SQL, so complex analytics require exporting data. |
| **Supabase** | Open-source Firebase alternative built on Postgres. | Also very fast setup. Real SQL from day one. Row-level security is powerful. | Slightly more concepts to learn than Firebase for a first-time user. | Better than Firebase if you need SQL analytics. Self-hostable. | Managed service is a smaller company than Firebase; long-term bet is different. |
| **AWS S3 + RDS Postgres** | Raw cloud storage + a managed SQL database. | None for POC — hours of setup for IAM, VPCs, etc. | Slow to stand up. | The default choice for enterprise banks. Fits with existing AWS infrastructure. Full control. | You build more of the plumbing yourself (signed URLs, dashboards, auth). |
| **Local filesystem + SQLite** | Just save files in a folder and rows in a SQLite database. | Simplest possible thing. Great for a laptop-only demo. | Doesn't work multi-user. Doesn't work if the demo runs anywhere but your laptop. | Not viable. | N/A |
| **MongoDB Atlas** | Managed MongoDB — schemaless like Firestore, but a full database. | Fast setup. Rich query language. | You still need a separate file store (S3 or similar). | Great for document-shaped data at scale. | Two tools instead of one (adds an S3-equivalent). |

**POC winner:** **Firebase** — least ceremony, and Storage + Firestore + Auth in one console covers everything we need. **Local filesystem** for the Python approach because the demo runs on my laptop.

**Scale winner:** In a bank, **AWS S3 + Postgres** (or equivalent in Azure/GCP) will almost always win because it fits existing infrastructure, compliance, and audit. **Supabase** is a strong middle-ground pick if a lightweight product owns the workload. **Firebase at real scale is fine but usually loses to native-cloud alternatives for bank workloads.**

### 3.3 Frontend — Lovable vs alternatives

**What "frontend" means in plain English:** the web page the user actually sees and clicks. The upload button, the results table, the download button.

| Tool | What it is | POC strengths | POC weaknesses | Scale strengths | Scale weaknesses |
|---|---|---|---|---|---|
| **Lovable** ✅ | AI-native web app builder. You describe the UI in prose, it generates real React code. | Very fast for a first version. You get real React source you can inspect and modify. Named in the assignment brief. | You're at the mercy of the AI for anything unusual. Not free forever. | Since it exports real code, you can hand it off to engineers later — no lock-in. | Not a substitute for real engineering on a large app. Best as a starting point, not the final product. |
| **Bubble** | Full no-code web app builder. Very powerful. | Broadest capabilities of the no-code group. | Steeper learning curve. Exported artifact isn't clean code. | Runs at real scale (many production apps use Bubble). | Locked into Bubble's runtime forever — hard to exit. |
| **Retool** | Internal-tool builder. Perfect for admin dashboards. | Fast for the "read/write records with buttons" pattern. | Not a great fit for customer-facing apps (aesthetic and UX are admin-flavored). | Excellent for building internal tools that ops teams use daily. | Not the right shape for public-facing product. |
| **Softr** | Frontend generator on top of Airtable data. | Very fast if your data is already in Airtable. | Wrong shape here — our data is JSON in Firestore, not tabular in Airtable. | Small business only. Not for bank-scale workloads. | Not the right fit for our data. |
| **Streamlit** | Python-based web app framework for data/ML demos. | Zero-JS. One process with the pipeline. Perfect for a demo. | Aesthetic ceiling is limited. Awkward for multi-user apps with long-running jobs. | Fine at small internal scale (an analytics team using it). | Not a customer-facing production tool. |
| **Custom React (Next.js) + your own components** | Real frontend engineering. | None for a 48-hour POC. | Days of work. | The right answer for any product a bank actually ships to customers. Full control. | High engineering cost. |

**POC winner:** **Streamlit** for the Python approach — perfect for showing an AI pipeline. **Lovable** for the low-code approach — fastest way to a working web app that isn't limited to Python.

**Scale winner:** For a **customer-facing product** at scale, **custom React (Next.js)** — always. For an **internal tool** at scale, **Retool** or **Bubble** depending on complexity. **Streamlit** stays viable for internal analytics/ML tooling forever. **Lovable is a starting point, not the final product** — but that's okay, because it exports code you can grow into a real React app.

---

## 4. Summary — one-line answers to "what do we pick?"

### For the POC (this 48-hour demo):

| Layer | Approach A (Python) | Approach B (low-code) |
|---|---|---|
| Model provider | Claude | Claude |
| Model | Claude Sonnet 4.6 | Claude Sonnet 4.6 |
| Orchestration | Python script (no orchestrator) | n8n |
| Storage | Local files | Firebase |
| Frontend | Streamlit | Lovable |

### For running the same tool at scale in a real bank:

| Layer | What we'd actually pick |
|---|---|
| Model provider | Whichever the bank already has a contract with. If unconstrained: Gemini for pure cost, Claude for quality-per-dollar. |
| Model | Sonnet 4.6 for Extract, Opus 4.8 for Rank. |
| Orchestration | n8n if non-engineers maintain it. Airflow/Prefect or Step Functions if engineering owns it. |
| Storage | Native cloud (AWS S3 + Postgres, or equivalent). Firebase or Supabase for a lightweight product line. |
| Frontend | Custom Next.js for a customer-facing product. Retool or Bubble for internal tools. |

**The pattern:** POC picks are chosen for **speed of getting to a runnable demo**. Scale picks are chosen for **fit with existing infrastructure, cost, control, and audit**. They are almost never the same tools, and that's fine.
