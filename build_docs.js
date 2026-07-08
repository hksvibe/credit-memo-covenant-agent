// Builds PLAN.docx and COMPARISONS.docx from the plan content.
// Usage:  node build_docs.js
// Requires: docx (installed globally per skill setup)

const fs = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require('docx');

// ---- Layout constants ----------------------------------------------------
const PAGE_WIDTH = 12240;                 // US Letter
const PAGE_HEIGHT = 15840;
const MARGIN = 1080;                      // 0.75" margin
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;   // 10080 DXA
const BORDER_COLOR = 'BFBFBF';
const HEADER_FILL = 'E7EEF5';
const ALT_FILL = 'F7F9FC';

const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR };
const cellBorders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };

// ---- Helpers -------------------------------------------------------------
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 200 },
    children: [new TextRun({ text })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 160 },
    children: [new TextRun({ text })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 120 },
    children: [new TextRun({ text })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80 },
    children: parseInline(text),
  });
}

function num(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    spacing: { after: 80 },
    children: parseInline(text),
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 140, ...(opts.spacing || {}) },
    children: parseInline(text),
  });
}

// A monospace-styled block of code. Multi-line source is split on \n so each
// line becomes its own Paragraph and DOCX preserves the visual line breaks.
function code(source) {
  const lines = source.split('\n');
  return lines.map((line, idx) => new Paragraph({
    spacing: {
      before: idx === 0 ? 80 : 0,
      after: idx === lines.length - 1 ? 140 : 0,
    },
    shading: { fill: 'F3F4F6', type: ShadingType.CLEAR },
    children: [new TextRun({ text: line || ' ', font: 'Menlo', size: 18 })],
  }));
}

function quoteBlock(text) {
  return new Paragraph({
    spacing: { before: 80, after: 140 },
    indent: { left: 360 },
    shading: { fill: 'FAFBFC', type: ShadingType.CLEAR },
    children: [new TextRun({ text: `“${text}”`, italics: true, color: '4B5563' })],
  });
}

// Minimal inline parser: supports **bold**, *italic*, and `code`.
function parseInline(text) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index) }));
    const tok = m[0];
    if (tok.startsWith('**')) runs.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    else if (tok.startsWith('`')) runs.push(new TextRun({ text: tok.slice(1, -1), font: 'Menlo', size: 20 }));
    else runs.push(new TextRun({ text: tok.slice(1, -1), italics: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last) }));
  return runs.length ? runs : [new TextRun({ text: '' })];
}

// Build a table from an array of column widths (DXA) and an array of rows.
// First row is treated as header. Each cell is a string (parsed for inline formatting).
function tableFromMatrix(colWidths, rows) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const tableRows = rows.map((row, rowIdx) => new TableRow({
    tableHeader: rowIdx === 0,
    children: row.map((cell, colIdx) => new TableCell({
      borders: cellBorders,
      width: { size: colWidths[colIdx], type: WidthType.DXA },
      margins: cellMargins,
      shading: rowIdx === 0
        ? { fill: HEADER_FILL, type: ShadingType.CLEAR }
        : (rowIdx % 2 === 0 ? { fill: ALT_FILL, type: ShadingType.CLEAR } : undefined),
      children: cell.split('\n').map(line =>
        new Paragraph({
          spacing: { after: 40 },
          children: rowIdx === 0
            ? [new TextRun({ text: line, bold: true, size: 20 })]
            : parseInline(line).map(r => { r.size = r.size ?? 20; return r; }),
        })),
    })),
  }));
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: tableRows,
  });
}

// Column-width presets that sum to CONTENT_WIDTH (10080)
const W2 = [3360, 6720];
const W2b = [4200, 5880];
const W3 = [2500, 3790, 3790];
const W3b = [2200, 3940, 3940];
const W4 = [1680, 2800, 2800, 2800];
const W5 = [1680, 2100, 2100, 2100, 2100];

// ---- Document-level scaffolding -----------------------------------------
function buildDoc(title, children) {
  return new Document({
    creator: 'Harsh (via Claude)',
    title,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Calibri', color: '1F3A57' },
          paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Calibri', color: '1F3A57' },
          paragraph: { spacing: { before: 260, after: 160 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: 'Calibri', color: '2E5B85' },
          paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480, hanging: 240 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 960, hanging: 240 } } } },
        ]},
        { reference: 'numbers', levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480, hanging: 240 } } } },
        ]},
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [ new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: title, italics: true, size: 18, color: '666666' })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [ new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', size: 18, color: '666666' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '666666' }),
              new TextRun({ text: ' of ', size: 18, color: '666666' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '666666' }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

// =========================================================================
// COMPARISONS.docx content
// =========================================================================
function comparisonsChildren() {
  return [
    // Title block
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [new TextRun({ text: 'Tool & Model Comparisons', bold: true, size: 44, color: '1F3A57' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new TextRun({ text: 'Credit Memo Covenant Review Agent  —  POC vs Scale', italics: true, size: 24, color: '2E5B85' })],
    }),

    para('Two sets of comparisons:'),
    num('LLM providers — Claude vs Gemini vs OpenAI vs Groq'),
    num('Claude models — Opus vs Sonnet vs Haiku'),
    para('Every table has two verdict columns: one for the **POC** (this 48-hour demo) and one for running the same tool at **large scale** in a bank.'),

    para('**POC** = the demo we’re building this week. Small volume, few users, "does it work?" is the question.'),
    para('**Scale** = the version a bank actually runs. Thousands to millions of memos, many users, audit trails, uptime commitments.'),

    // ---------- Section 1 -------------------------------------------------
    h1('1. LLM Provider Comparison'),
    para('**What "LLM" means here:** the large language model brain that reads the memo and writes the answers.'),
    para('**Note on Groq:** Groq isn’t a model, it’s a hosting company that runs open-source models (Llama, gpt-oss) on very fast custom chips. So "Groq" in these tables means "open-source models running on Groq’s fast infrastructure."'),

    h2('1.1 Feature-by-feature comparison'),
    tableFromMatrix(W5, [
      ['Feature', 'Claude (Anthropic)', 'Gemini (Google)', 'OpenAI (GPT)', 'Groq (open-source)'],
      ['Reads PDFs directly?', 'Yes, cleanly. Reads text, tables and page images together.', 'Yes, cleanly. First-class PDF support.', 'Only via their Assistants feature, which does its own extraction under the hood.', 'No. You must convert PDF to text yourself first.'],
      ['Forces valid JSON output?', 'Yes. Tool-use with a schema — model literally can’t return anything else.', 'Yes via response_schema. Works, but has quirks with unusual schemas.', 'Yes. Structured Outputs — arguably the strictest (constrains at token level).', 'Partial. Depends on the model. Usually you bolt on retry logic.'],
      ['Fabrication risk', 'Low. Says "I don’t know" rather than invent.', 'Low-to-medium. Very capable but occasionally over-confident.', 'Medium. Slightly more prone to "fill in" plausible numbers.', 'Higher. Varies by model; smaller ones drop or invent findings.'],
      ['Context size', '~200K tokens (fits 7-pg memo 40x). Up to 1M on newer Sonnet.', 'Up to 2M tokens — the largest here.', '128K (gpt-4o); 1M (gpt-4.1).', '8K to 128K depending on model.'],
      ['Speed', 'Fine (~5-15s per call).', 'Similar to Claude.', 'Similar to Claude.', 'Extremely fast — Groq’s core selling point.'],
      ['Cost', 'Medium.', 'Cheapest of the top-tier three.', 'Medium.', 'Very cheap, but you’re paying for a weaker model.'],
      ['Developer experience', 'Very mature. Clean SDK, stable docs.', 'Mature. Docs historically the messiest of the group.', 'Very mature. Biggest third-party tool ecosystem.', 'Simple API but thinner ecosystem.'],
      ['Ease of switching away', 'Easy — ~20 lines of adapter code.', 'Easy.', 'Easy.', 'Easy. Bonus: you’re already on open source.'],
    ]),

    h2('1.2 POC winner — which one wins?'),
    tableFromMatrix(W2, [
      ['Winner', 'Why in one sentence'],
      ['1st: Claude', 'Reads PDFs cleanly, forces JSON output reliably, lowest fabrication risk — the three things that matter most here.'],
      ['2nd: Gemini', 'Nearly as good as Claude at PDFs, and the cheapest top-tier option; loses on structured-output maturity and my personal debugging speed.'],
      ['3rd: OpenAI', 'Excellent model, but you go through the Assistants API for clean PDF handling — infrastructure I don’t want to build in 48 hours.'],
      ['Not viable: Groq', 'Open-source on Groq doesn’t take PDFs natively. You’d burn 2+ hours writing a PDF-to-text pipeline before a single prompt.'],
    ]),

    h2('1.3 Scale winner — running on millions of memos'),
    para('At scale the question shifts. Cost matters. So do uptime, regional data residency, whether the vendor will still exist in 3 years, and whether the bank’s procurement and legal teams have already approved a vendor.'),
    tableFromMatrix(W2, [
      ['Ranking', 'Why'],
      ['1st: whichever the bank already has a contract with', 'At scale you don’t pick the "best" model — you pick the one legal already cleared. Azure → GPT via Azure OpenAI. GCP → Gemini via Vertex. AWS → Claude via Bedrock.'],
      ['2nd: Gemini (pure cost)', 'If nothing is pre-decided, Gemini is the cheapest capable model for a high-volume read-and-extract workload. Cost dominates at millions of runs.'],
      ['3rd: Claude (quality-per-dollar)', 'Slightly more expensive than Gemini but lower fabrication rate matters more at high volume. Available on Bedrock for banks on AWS.'],
      ['4th: OpenAI', 'Same cost/quality tier as Claude; strong ecosystem if the bank standardizes on OpenAI.'],
      ['Groq / open-source at scale', 'Interesting for extreme volume where cost dominates. Self-host, take on maintenance for the lowest per-run cost. A phase-3 optimization, not a first move.'],
    ]),

    h2('1.4 One-line summary'),
    bullet('**POC → Claude.** Best PDF handling, most reliable JSON, lowest fabrication risk.'),
    bullet('**Scale →** whichever the bank already has a contract with. If unconstrained: Gemini for cost, Claude for quality-per-dollar.'),

    new Paragraph({ children: [new PageBreak()] }),

    // ---------- Section 2 -------------------------------------------------
    h1('2. Claude Model Comparison'),
    para('Anthropic ships several Claude models at different price/quality tiers. Picking the right one is like picking the right lawyer: the senior partner is expensive and slow but reasons well; the associate is fast and cheap and handles routine work perfectly.'),

    h2('2.1 The lineup'),
    tableFromMatrix([2300, 4900, 1440, 1440], [
      ['Model', 'Plain-English position', 'Relative cost', 'Relative speed'],
      ['Opus 4.8', 'The senior partner. Frontier reasoning; best on hard, judgment-heavy tasks.', '~5x Sonnet', 'Slowest'],
      ['Sonnet 4.6', 'The senior associate. Handles ~95% of real work; standard production pick.', 'Baseline', 'Middle'],
      ['Haiku 4.5', 'The paralegal. Very fast and cheap; great for high-volume routine tasks.', '~5x cheaper than Sonnet', 'Fastest'],
      ['Fable 5', 'The creative writer. Specialised for storytelling. Not relevant here.', 'N/A here', 'N/A here'],
    ]),

    h2('2.2 Feature-by-feature comparison'),
    tableFromMatrix([2500, 2500, 2540, 2540], [
      ['Feature', 'Opus 4.8', 'Sonnet 4.6', 'Haiku 4.5'],
      ['Reading a document and pulling out structured data', 'Excellent, but overkill for most cases.', 'Excellent — Sonnet’s sweet spot.', 'Good on simple docs, drops findings on complex ones.'],
      ['Judgment / reasoning under uncertainty', 'Best in class. Notably better on hard reasoning.', 'Very strong. Handles most judgment tasks well.', 'Weaker. Tends to pick the "obvious" answer rather than working through the full picture.'],
      ['Following complex instructions', 'Extremely strong.', 'Very strong.', 'Sometimes skips instructions in long prompts.'],
      ['Cost per run (rough)', '~5x Sonnet', 'Baseline', '~5x cheaper than Sonnet'],
      ['Speed', 'Slowest', 'Middle', 'Fastest'],
      ['Best-suited for', 'The genuinely hard questions; final review; adversarial checks.', 'Almost everything in production.', 'High-volume, low-nuance tasks (classification, tagging, routine extraction).'],
      ['Failure mode to watch for', 'Over-thinking simple questions; higher cost per run.', 'Occasionally lists too generously — extracts borderline covenants.', 'Misses subtle covenants; picks top-3 mostly from the Executive Summary.'],
    ]),

    h2('2.3 For the two stages of THIS pipeline'),
    h3('Stage 1 — Extract every covenant'),
    tableFromMatrix(W2, [
      ['Model', 'Verdict for Extract'],
      ['Opus', 'Overkill. Extraction is "read and organize," not "reason and judge." Pay 5x for maybe 3-5% better recall. Not worth it.'],
      ['Sonnet (chosen)', 'Right pick. Extraction is exactly what Sonnet is best at.'],
      ['Haiku', 'Tempting for cost but misses non-financial covenants (change-of-control, restricted payments, affiliate transactions). Extraction failures ripple downstream.'],
    ]),
    h3('Stage 2 — Rank the top 3 risks'),
    tableFromMatrix(W2, [
      ['Model', 'Verdict for Rank'],
      ['Opus', 'The "correct" answer if budget is not a concern. Judgment task, judgment specialist.'],
      ['Sonnet (chosen for POC)', 'Handles this well because the Meridian memo does most of the work (Section 4.3 names the downside breach). For a less generous memo, upgrade to Opus.'],
      ['Haiku', 'Wrong tool. Ranking is the exact kind of judgment task Haiku is weakest on.'],
    ]),

    h2('2.4 POC pick'),
    para('**Sonnet 4.6 for both stages.** Keeps the pipeline symmetrical, keeps cost low enough to iterate on prompts freely, and the test memo gives Sonnet enough signal to arrive at the right ranking.'),

    h2('2.5 Large-scale pick'),
    para('**Sonnet 4.6 for Extract, Opus 4.8 for Rank.** At scale you want the best model on the harder job. Ranking is the low-volume, high-value step; Extract is the high-volume mechanical step.'),
    para('If cost pressure is extreme: **Sonnet for both + Opus as a second opinion on the top 20% of memos** flagged as complex. Same total quality at ~1.4x Sonnet cost instead of ~3x Opus-everything.'),

    h2('2.6 One-line summary'),
    bullet('**POC:** Sonnet 4.6 for both stages.'),
    bullet('**Scale:** Sonnet 4.6 for Extract, Opus 4.8 for Rank. Sample Opus onto the hardest cases only.'),

    new Paragraph({ children: [new PageBreak()] }),

    new Paragraph({ children: [new PageBreak()] }),

    // ---------- Section 3: Why we picked code-first over low-code ---------
    h1('3. Why We Picked the Code-First Approach for This POC'),
    para('We seriously considered building both paths in parallel — Python + Streamlit AND n8n + Firebase + Lovable — and ended up shipping only the code-first version. Same AI model, same schema, same guardrail. Different tooling. Here is the honest reasoning.'),

    h2('3.1 The two candidates, side by side'),
    tableFromMatrix([3000, 3540, 3540], [
      ['Dimension', 'Code-first (chosen)', 'Low-code alternative'],
      ['Stack', 'Python + Anthropic SDK + Streamlit', 'n8n + Firebase + Lovable + Anthropic REST'],
      ['Where the pipeline runs', 'Single Python process on Streamlit Cloud', '9-node visual workflow on n8n Cloud'],
      ['Where the UI lives', 'Streamlit Community Cloud (free tier)', 'GitHub Pages + n8n Cloud webhook'],
      ['Where results live', 'Downloadable JSON', 'Firestore documents (persistent history)'],
      ['Vendor accounts to set up', '2 (Anthropic + Streamlit Cloud)', '4 (Anthropic + n8n Cloud + Firebase + GitHub Pages)'],
      ['Streaming from Anthropic', 'Yes (Python SDK)', 'No (n8n HTTP node waits for full response)'],
      ['Max token budget', '32,000 (fits any real memo)', '16,000 (capped to stay under HTTP timeout)'],
      ['Latency per review', '15-45 seconds', '25-70 seconds'],
      ['Cost per review', '~$0.15-0.63 (Anthropic only)', 'Same Anthropic bill + $20/mo n8n Cloud after trial'],
      ['Interview defensibility', 'Line-by-line through ~150 lines of Python', 'Click through 9 workflow nodes'],
      ['Persistence', 'User downloads the JSON', 'Every run auto-saved to Firestore'],
      ['Retries + observability', 'You write them', 'Built-in per node'],
      ['Who can maintain the prompts', 'Engineers (PR + deploy)', 'Ops/business (edit workflow, save)'],
    ]),

    h2('3.2 Why code-first wins the POC bar'),
    num('**Speed to a runnable demo.**'),
    num('**Fewer moving parts to fail live.** Code-first has one vendor (Anthropic). Low-code has four (Anthropic, n8n Cloud, Firebase, GitHub Pages). Any of the extra three can outage the demo mid-interview.'),
    num('**The AI does the same work in both.** Both approaches run Extract → Rank + guardrail on Claude Sonnet 4.6. The comparison is really about where the code lives, not what it does.'),
    num('**Cost stays flat.** Code-first has $0 fixed cost. Low-code adds n8n Cloud ($20/mo after 14-day trial).'),

    h2('3.3 Where the low-code version would win instead'),
    para('Honest answer to "why not both?" — for a bank innovation team at production time, I would rebuild this on n8n. Reasons:'),
    bullet('**Non-engineers can edit prompts** without a PR / deploy cycle. Real value when ops owns the workflow.'),
    bullet('**Free persistence + history** via Firestore. Every run auditable without writing storage code.'),
    bullet('**Built-in retries + observability** per node. Would take a day to add to the Python version manually.'),
    bullet('**Ops-friendly execution log.** A non-engineer can debug a failed run by clicking the failed node.'),

    new Paragraph({ children: [new PageBreak()] }),

    // ---------- Section 4: Two Calls vs Single Call — three-way ----------
    h1('4. Two Calls vs Single Call — Three-Way Comparison'),
    para('Our pipeline uses **two separate AI calls**: one to extract every covenant (Extract), then a second to rank the top-3 risks (Rank). The obvious alternative is doing both jobs in one AI call. We tested TWO different single-call variants against the production two-call pipeline on two memos.'),

    h2('4.1 What we tested'),
    para('Three approaches head-to-head:'),
    bullet('**Two calls (production).** Extract call followed by Rank call. Each call has its own tightly-scoped system prompt (~4000 chars for Extract, ~2700 for Rank) and its own strict tool schema with the 16-value category enum.'),
    bullet('**Single call — thin prompt (v1).** One combined call with a short (~700 char) prompt that just says "do both." Permissive schema — category accepted as free-text.'),
    bullet('**Single call — comprehensive prompt (v2).** One combined call with a full ~5000-char prompt matching Extract\'s taxonomy and rules AND Rank\'s signals and guardrails. Strict category enum matching production.'),
    para('Both single-call variants are kept as commented reference blocks at the bottom of `src/prompts.py`. Neither is wired into the production pipeline.'),

    h2('4.2 Meridian memo (7 pages, synthetic)'),
    tableFromMatrix([2600, 2200, 2560, 2720], [
      ['Metric', 'Two calls (production)', 'Single — thin (v1)', 'Single — comprehensive (v2)'],
      ['Covenants extracted', '**28**', '26 (−2, −7%)', '**29 (+1, +4%)**'],
      ['Top-3 covenants', 'Interest coverage / Leverage / Liquidity', '✓ same three, same order', '✓ same three, same order'],
      ['Reasoning depth (chars avg)', '459', '489', '470'],
      ['Guardrail quotes verified', '31 of 31', '29 of 29', '**32 of 32**'],
      ['Category enum drift', '0 invented', '**20 invented**', '0 invented'],
      ['Cost per review', '$0.19', '$0.13', '$0.14'],
      ['Wall-clock time', '15-45s typical', '~80s', '~84s'],
    ]),
    para('**Read-through:** on a small, clean memo, comprehensive single-call is actually BETTER than two calls on completeness (29 vs 28) at 27% lower cost. Thin single-call loses ground on completeness AND invents 20 category labels. On Meridian alone, comprehensive single-call would be a defensible choice.'),

    h2('4.3 Deutsche Bank memo (50 pages, real)'),
    tableFromMatrix([2600, 2200, 2560, 2720], [
      ['Metric', 'Two calls (production)', 'Single — thin (v1)', 'Single — comprehensive (v2)'],
      ['Covenants extracted', '**50**', '36 (−14, −28%)', '47 (−3, −6%)'],
      ['Top-3 covenants', 'Guarantor NW / Facility A repayment / Facility B DSCR', '✓ same three, same order', '**≈ same three, rank 2 shifted**'],
      ['Reasoning depth (chars avg)', '547', '619', '580'],
      ['Guardrail quotes verified', '53 of 53', '38 of 39', '50 of 50'],
      ['Category enum drift', '0 invented', '**26 invented**', '0 invented'],
      ['Cost per review', '$0.63', '$0.37', '$0.39'],
      ['Wall-clock time', '~180s', '~185s', '~178s'],
    ]),
    para('**Read-through:** on a real 50-page bank memo, comprehensive single-call dramatically closes the completeness gap — from 14 missing covenants (v1) down to 3 (v2). Category drift is eliminated. BUT the top-3 shifts: v2 picked "Facility A Extension Condition" at rank 2 instead of "Facility A Minimum Annual Repayment." Structurally the same underlying risk (missing the annual repayment schedule means missing the extension gate), but different framing.'),

    h2('4.4 The pattern'),
    para('Two things stand out across both memos:'),
    bullet('**Both single-call variants get the top-3 right on Meridian and both name the same underlying three risks on DB.** Ranking accuracy is not the differentiator.'),
    bullet('**Completeness responds strongly to prompt depth.** Thin single-call misses 28% on DB. Comprehensive single-call misses 6%. Prompt engineering closes most (but not all) of the gap.'),
    bullet('**Schema discipline responds to enum enforcement.** Thin single-call invented 20-26 categories per memo. Comprehensive single-call — same enum as production — invents zero.'),
    para('The story is not "single-call is broken." It is: **thin single-call is clearly worse; comprehensive single-call is a legitimate alternative with a few real trade-offs.**'),

    h2('4.5 Why we still choose two calls over comprehensive single-call'),
    para('Comprehensive single-call closed the biggest gaps. The remaining reasons to keep two calls are structural, not raw-metric:'),
    num('**Auditability of the intermediate covenant list.** A credit officer using this in a review workflow wants to eyeball the extracted covenant list against Section 5 of the memo BEFORE trusting the top-3 ranking. Two calls make the covenant list a first-class checkable artifact. Single-call collapses that check. **This is real product value in a credit-officer workflow, not a demo detail.**'),
    num('**Debuggability** If the demo fails live, two calls let us point at which stage broke. Two independent failure surfaces are easier to reason about than one atomic call.'),
    num('**Marginal completeness matters.** 47 of 50 is not 50 of 50. The three covenants comprehensive single-call missed on DB include a guarantor financial covenant. In a bank workflow, "extraction is 94% complete" is a real gap for a credit officer to hit.'),
    num('**Top-3 run-to-run stability.** Comprehensive single-call shifted rank 2 on DB. Both framings point at the same underlying risk, but a reviewer running the tool multiple times should not see the top-3 fluctuate on wording.'),
    num('**Prompt-engineering brittleness.** Comprehensive single-call works BECAUSE of a very long, carefully-constructed prompt. Any tweak — new covenant category, new ranking signal — has to be threaded through one giant prompt that handles both jobs. Two calls let each stage evolve independently.'),
    para('None of these five is decisive on its own. Together they justify the ~$0.10 cost premium once caching is enabled (see Section 4.7).'),

    h2('4.6 Why we picked two calls (the decision)'),
    para('If the tool were a pure "read memo → return top-3 highlights" API with no human in the loop, comprehensive single-call would be the right choice — same top-3, 38% cheaper, comparable schema quality. That is not the target use case.'),
    para('**The tool is intended to sit in a credit-officer review workflow** where the reviewer wants to (a) see the full covenant list as a checkable artifact, (b) trust the top-3 ranking is grounded in a complete list, and (c) understand which stage of the pipeline produced which output. Every one of those goals is served by two calls and undermined by a single call — regardless of how comprehensive the single-call prompt is.'),
    para('**We picked two calls because the split matches how a credit officer would use the tool.** The AI does the same work in either architecture; the two-call design just makes the intermediate output usable and the failure modes debuggable.'),

    h2('4.7 Cost recovery at scale — prompt caching'),
    para('The ~40% cost premium at DB scale is not a permanent tax. Anthropic offers **prompt caching**, which recovers most of it with a one-line code change.'),
    para('**How it works.** On the first call, mark the PDF as cachable. That call pays a **25% premium** on the cached portion. Any second call within **5 minutes** referencing the same cached content pays only **10% of the normal input price** on the cached portion. Cache expires after 5 minutes. Our Rank call always fires within a few seconds of Extract, so the cache is always warm.'),
    para('**Cost math on the Deutsche Bank memo:**'),
    tableFromMatrix([4200, 2940, 2940], [
      ['Line item', 'Without caching', 'With caching'],
      ['Extract input (PDF ~68K + prompt ~5K)', '$0.22', '$0.27 (cache-write premium on PDF)'],
      ['Extract output', '$0.15', '$0.15'],
      ['Rank input, cached PDF (~68K)', '$0.20', '**$0.02** (90% discount)'],
      ['Rank input, non-cached (covenant list + Rank prompt ~14K)', '$0.05', '$0.04'],
      ['Rank output', '$0.01', '$0.01'],
      ['**Total per review**', '**$0.63**', '**~$0.49**'],
    ]),
    para('**Result:** two calls with caching enabled costs about **$0.49** on a DB-sized memo. Comprehensive single-call was $0.39. The gap narrows from 38% down to about 26% — and two calls keeps its auditability, debuggability, completeness, top-3 stability, and prompt-maintenance advantages.'),
    para('On smaller memos (Meridian-sized), caching saves about 15%.'),
    para('**Implementation cost:** one field on one Python dict. In `src/review.py`, the `_pdf_document_block()` helper would grow one line — `cache_control: {type: "ephemeral"}` on the document source. Everything else stays identical.'),
    para('We have not shipped caching in the POC because at demo volume ($0.15-0.63 per review, 20-30 runs a day) the absolute savings do not justify the extra thing to explain in the walkthrough. It is the first optimisation we would add before going to production volume.'),

    h2('4.8 Summary of the trade-off'),
    tableFromMatrix([2600, 1900, 1900, 1770, 1910], [
      ['Dimension', 'Two calls (chosen)', 'Two + caching', 'Single — thin', 'Single — comprehensive'],
      ['Completeness on DB (50-page real)', '50 / 50', '50 / 50', '36 / 50', '47 / 50'],
      ['Completeness on Meridian', '28', '28', '26', '29'],
      ['Top-3 accuracy', '✓ ref', '✓ ref', '✓ same', '~ same (1 rank shift)'],
      ['Schema / enum discipline', '✓', '✓', '✗ (20-26 invented)', '✓'],
      ['Cost per DB review', '$0.63', '~$0.49', '$0.37', '$0.39'],
      ['Auditable intermediate list', '✓', '✓', '✗', '✗'],
      ['Debuggable by stage', '✓', '✓', '✗', '✗'],
      ['Prompt maintenance', 'Two focused prompts', 'Two focused prompts', 'One thin prompt', 'One ~5000-char monolith'],
    ]),
    para('**The honest one-sentence read:** comprehensive single-call is a legitimate technical alternative — it gets the ranking right, closes the completeness gap to 6%, and costs less. Two calls wins because it produces an intermediate artifact (the covenant list) that fits the credit-officer review workflow, and because two focused prompts are easier to maintain and debug than one 5000-character monolith.'),

    new Paragraph({ children: [new PageBreak()] }),

    // ---------- Section 5: Summary ---------------------------------------
    h1('5. Summary — One-Line Answers'),

    h2('5.1 For the POC (this 48-hour demo)'),
    tableFromMatrix(W2b, [
      ['Layer', 'Pick'],
      ['Model provider', 'Claude'],
      ['Model', 'Claude Sonnet 4.6'],
      ['Orchestration', 'Python script (no orchestrator)'],
      ['Storage', 'Local files'],
      ['Frontend', 'Streamlit'],
    ]),

    h2('5.2 For running the same tool at scale in a real bank'),
    tableFromMatrix(W2b, [
      ['Layer', 'Pick'],
      ['Model provider', 'Whichever the bank has a contract with. Unconstrained: Gemini for cost, Claude for quality-per-dollar.'],
      ['Model', 'Sonnet 4.6 for Extract, Opus 4.8 for Rank.'],
      ['Orchestration', 'n8n if ops maintains it. Airflow/Prefect or Step Functions if engineering owns it.'],
      ['Storage', 'Native cloud (AWS S3 + Postgres, or equivalent). Firebase/Supabase for lightweight product lines.'],
      ['Frontend', 'Custom Next.js for customer-facing. Retool or Bubble for internal tools.'],
    ]),

    para('**The pattern:** POC picks are chosen for **speed of getting to a runnable demo**. Scale picks are chosen for **fit with existing infrastructure, cost, control, and audit**. They are almost never the same tools, and that is fine.'),
  ];
}

// ---- Build helper --------------------------------------------------------
async function build(fileName, title, children) {
  const doc = buildDoc(title, children);
  const buf = await Packer.toBuffer(doc);
  const outPath = path.join(__dirname, fileName);
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, '(' + buf.length + ' bytes)');
}

// =========================================================================
// ARCHITECTURE.docx content
// =========================================================================
function architectureChildren() {
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 },
      children: [new TextRun({ text: 'Architecture', bold: true, size: 44, color: '1F3A57' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 },
      children: [new TextRun({ text: 'What happens when a reviewer drops a PDF and clicks Run', italics: true, size: 24, color: '2E5B85' })] }),

    para('One page. Everything that happens when a reviewer drops a PDF onto the app and clicks **Run review**.'),

    h1('1. The Picture (ASCII version)'),
    para('Word rendering of the Mermaid diagram in ARCHITECTURE.md. The diagram itself renders natively on GitHub if you prefer to view it there.'),
    ...code(
      "  ┌───────────────────────────┐\n" +
      "  │  Reviewer's browser       │\n" +
      "  │  ─ Drop PDF               │\n" +
      "  │  ─ Click Run review       │\n" +
      "  └────────────┬──────────────┘\n" +
      "               │ 1. upload\n" +
      "               ▼\n" +
      "  ┌───────────────────────────────────────────────┐\n" +
      "  │  Streamlit Community Cloud                    │\n" +
      "  │                                               │\n" +
      "  │   Password gate  →  Streamlit UI (app.py)     │\n" +
      "  │                            │                  │\n" +
      "  │                            ▼                  │\n" +
      "  │   review_memo pipeline (review.py)            │\n" +
      "  │       │              ▲              ▲         │\n" +
      "  │  4,6  │        5,7   │        11    │         │\n" +
      "  │       ▼              │              │         │\n" +
      "  │  Anthropic API   Anthropic API   Guardrail    │\n" +
      "  │  Extract call    Rank call       (guardrails  │\n" +
      "  │  Sonnet 4.6      Sonnet 4.6       .py)        │\n" +
      "  │  record_covenants record_top_risks  ▲         │\n" +
      "  │                                     │ 9       │\n" +
      "  │                                     │         │\n" +
      "  │                                pypdf text     │\n" +
      "  │                                extraction     │\n" +
      "  │                                               │\n" +
      "  │  Final ReviewResult JSON → UI → browser       │\n" +
      "  └───────────────────────────────────────────────┘\n" +
      "               ▲\n" +
      "               │ auto-redeploys on git push\n" +
      "  ┌────────────┴──────────────┐\n" +
      "  │  GitHub                   │\n" +
      "  │  hksvibe/credit-memo-     │\n" +
      "  │  covenant-agent           │\n" +
      "  └───────────────────────────┘"
    ),

    h1('2. Reading the Diagram'),
    para('**Four boxes, four places.**'),
    num('The reviewer\'s browser — everything they see. HTML from Streamlit + a file picker.'),
    num('Streamlit Community Cloud — where our Python code actually runs. One container per user session. Holds the PDF in memory for the duration of one review, then deletes it.'),
    num('Anthropic\'s servers — where Claude thinks. We send the PDF and prompts over HTTPS; Claude reads and writes back a structured JSON answer over a streamed connection.'),
    num('GitHub — where the source code lives. Every push triggers Streamlit Cloud to redeploy within a minute.'),

    para('The 13 numbered arrows are one full review, click to result. Total wall-clock time: ~15-45 seconds depending on memo size.'),

    h1('3. The 13 Steps'),
    tableFromMatrix([700, 6400, 2980], [
      ['#', 'What happens', 'Where'],
      ['1', 'Reviewer opens the app, enters the password', 'Browser → Streamlit'],
      ['2', 'Password matches, main UI renders', 'Streamlit'],
      ['3', 'Reviewer drops PDF, clicks Run — Streamlit calls review_memo(pdf_path)', 'Streamlit'],
      ['4', 'Pipeline base64-encodes the PDF and sends it to Anthropic with the Extract prompt and record_covenants tool schema. Streaming mode.', 'Streamlit → Anthropic'],
      ['5', 'Claude reads the PDF, extracts every covenant, streams back a tool call with the structured list', 'Anthropic → Streamlit'],
      ['6', 'Pipeline sends the same PDF plus the extracted covenant list to Anthropic with the Rank prompt and record_top_risks tool schema', 'Streamlit → Anthropic'],
      ['7', 'Claude picks the three highest-risk covenants, streams back a tool call with reasoning + memo quotes', 'Anthropic → Streamlit'],
      ['8', 'Locally, pypdf reads the PDF\'s text layer for the safety check', 'Streamlit'],
      ['9', 'Extracted memo text hands over to the guardrail', 'Streamlit'],
      ['10', 'Pipeline asks the guardrail to verify every quote in the AI\'s output', 'Streamlit'],
      ['11', 'Guardrail returns pass/fail per quote plus a diagnostic on how much text pypdf pulled', 'Streamlit'],
      ['12', 'Pipeline assembles a final ReviewResult (memo metadata + covenants + top-3 + run metadata) and returns it to the UI', 'Streamlit'],
      ['13', 'UI renders metrics, top-3 cards, covenant table, guardrail status, JSON viewer and download button', 'Streamlit → Browser'],
    ]),

    h1('4. Why the Pipeline Talks to Anthropic Twice'),
    para('Split into Extract and Rank on purpose. Backed by real testing — see COMPARISONS.md Section 4 for the three-way head-to-head vs single-call.'),
    bullet('**Auditability.** A credit officer can eyeball the extracted covenant list against the memo\'s Section 5 before trusting the top-3 ranking. Single-call collapses that check.'),
    bullet('**Debuggability under demo pressure.** If the demo breaks live, we can point to which call failed. Single-call fails atomically.'),
    bullet('**Marginal completeness.** On the 50-page Deutsche Bank memo we tested, two calls extracted 50 of 50 covenants; a comprehensive single-call variant extracted 47 of 50. On a real bank workflow, 94% is not 100%.'),
    bullet('**Top-3 stability.** Single-call rank 2 shifted between runs (structurally the same risk, different framing). Two focused calls with narrower schemas produce more consistent rankings.'),
    bullet('**Prompt-maintenance ergonomics.** Two prompts of ~4000 chars and ~2700 chars are easier to evolve independently than one ~5000-char combined prompt that has to handle both jobs.'),
    para('Cost of the split: roughly 2x tokens and 2x latency. Invisible on a demo. At scale, Anthropic\'s prompt caching — a one-line addition — cuts the two-call premium from ~40% down to ~24% by letting the Rank call reuse the cached PDF at 10% of the input price. Full cost math in COMPARISONS.md Section 4.7.'),

    h1('5. Why the Guardrail Runs Locally'),
    para('The AI\'s output claims: "here is a covenant, and here is the exact quote from the memo that proves it." We verify locally that the quote is actually in the memo, using pypdf to pull the memo\'s text layer. Three tiers of check (exact substring → fragment split → fuzzy word overlap at 90%) so we don\'t false-positive on table-row reconstructions or scanned-PDF extractor drift.'),

    h1('6. What Lives Where — Quick Reference'),
    tableFromMatrix([2200, 3000, 4880], [
      ['Component', 'File', 'Job'],
      ['Streamlit UI', 'src/app.py', 'Password gate, file upload, results view, JSON download'],
      ['Main pipeline', 'src/review.py', 'review_memo() orchestrator; run_extract, run_rank, _stream_message'],
      ['Data shapes', 'src/schemas.py', 'Pydantic models + Anthropic tool schemas'],
      ['Prompts', 'src/prompts.py', 'Two versioned system prompts (v2)'],
      ['Safety check', 'src/guardrails.py', 'extract_pdf_text, three-tier check_quotes'],
      ['Runtime config', 'runtime.txt, requirements.txt', 'Python 3.11, dependency list for Streamlit Cloud'],
      ['Local secrets', '.env (gitignored)', 'ANTHROPIC_API_KEY'],
      ['Cloud secrets', 'Streamlit Cloud "Secrets" panel', 'Same key, different source'],
    ]),
  ].flat();
}


// =========================================================================
// SPEAKER_NOTES.docx content — parsed from SPEAKER_NOTES.md
// =========================================================================


(async () => {
  await build('COMPARISONS.docx', 'Tool & Model Comparisons', comparisonsChildren());
  await build('ARCHITECTURE.docx', 'Architecture — Credit Memo Agent', architectureChildren());
})().catch(e => { console.error(e); process.exit(1); });
