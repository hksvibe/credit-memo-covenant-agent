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

    h2('1.2 POC winner — which one for this 48-hour demo?'),
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
      ['Time to a working demo', '~2 hours', '~4-5 hours'],
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
    num('**Speed to a runnable demo.** 2 hours vs 4-5 hours. The brief is explicit: "if you hit 5-6 hours and it works, stop there." Building both broke that budget without giving the reviewer anything meaningfully different to click.'),
    num('**Line-by-line defensibility.** The brief says "explain the integrations you chose, not just name them." 150 lines of Python + Streamlit widgets is easier to defend under interview pressure than a 9-node visual workflow whose Function nodes hide the same logic anyway.'),
    num('**Fewer moving parts to fail live.** Code-first has one vendor (Anthropic). Low-code has four (Anthropic, n8n Cloud, Firebase, GitHub Pages). Any of the extra three can outage the demo mid-interview.'),
    num('**The AI does the same work in both.** Both approaches run Extract → Rank + guardrail on Claude Sonnet 4.6. The comparison is really about where the code lives, not what it does.'),
    num('**Cost stays flat.** Code-first has $0 fixed cost. Low-code adds n8n Cloud ($20/mo after 14-day trial).'),

    h2('3.3 Where the low-code version would win instead'),
    para('Honest answer to "why not both?" — for a bank innovation team at production time, I would rebuild this on n8n. Reasons:'),
    bullet('**Non-engineers can edit prompts** without a PR / deploy cycle. Real value when ops owns the workflow.'),
    bullet('**Free persistence + history** via Firestore. Every run auditable without writing storage code.'),
    bullet('**Built-in retries + observability** per node. Would take a day to add to the Python version manually.'),
    bullet('**Ops-friendly execution log.** A non-engineer can debug a failed run by clicking the failed node.'),

    h2('3.4 One-line position'),
    para('**Code-first is the right POC. Low-code is the right production version.** The interview answer: "I picked code-first because it defends better in a walkthrough. If you told me to productionise it for an ops team, I would port to the n8n + Firebase pattern for the observability and edit-ability story."'),

    new Paragraph({ children: [new PageBreak()] }),

    // ---------- Section 4: Single Call vs Two Calls ----------------------
    h1('4. Single Call vs Two Calls — What We Tested and Why We Picked Two'),
    para('Our pipeline uses **two separate AI calls**: one to extract every covenant (Extract), then a second to rank the top-3 risks (Rank). The obvious alternative is doing both jobs in **one AI call**. It sounds simpler and cheaper. We tested it against real memos to see if the two-call design earns its cost.'),

    h2('4.1 What we tested'),
    para('We built a single-call variant with one combined system prompt, one combined tool schema with slots for both the covenant list AND the top-3 risks, same model (Sonnet 4.6), same PDF input. Then ran BOTH pipelines against two different memos and compared directly.'),
    para('The single-call prompt and tool schema are kept as a commented reference block at the bottom of `src/prompts.py` — anyone can reproduce the experiment. It is NOT wired into the production pipeline.'),

    h2('4.2 Meridian memo (7 pages, synthetic)'),
    tableFromMatrix([3400, 2400, 2400, 1880], [
      ['What we measured', 'Two calls (production)', 'Single call (experiment)', 'Delta'],
      ['Covenants extracted', '28', '26', '−2 (−7%)'],
      ['Top-3 covenants named', 'Interest coverage / Leverage / Liquidity', 'Same three, same order', '✓ match'],
      ['Quality of reasoning', '459 chars avg', '489 chars avg', '≈ same'],
      ['Guardrail (quotes verified)', '31 of 31', '29 of 29', 'both 100%'],
      ['Category discipline', '16 valid enum values', '20 invented labels', '✗ drift'],
      ['Cost per review', '$0.19', '$0.13', '−33%'],
      ['Wall-clock time', '15-45s typical', '~80s', 'slower'],
    ]),
    para('**Read-through:** on a small, clean, well-structured memo, single-call gets the same top-3 for 33% less. But it already starts inventing category labels that do not match our controlled vocabulary.'),

    h2('4.3 Deutsche Bank memo (50 pages, real)'),
    tableFromMatrix([3400, 2400, 2400, 1880], [
      ['What we measured', 'Two calls (production)', 'Single call (experiment)', 'Delta'],
      ['Covenants extracted', '**50**', '**36**', '**−14 (−28%)**'],
      ['Top-3 covenants named', 'Guarantor net worth / Facility A repayment / Facility B DSCR', 'Same three, same order', '✓ match'],
      ['Quality of reasoning', '547 chars avg', '619 chars avg', 'slightly longer'],
      ['Guardrail (quotes verified)', '53 of 53', '38 of 39', '~100%'],
      ['Category discipline', '11 valid enum values', '**26 invented labels**', '✗ severe drift'],
      ['Cost per review', '$0.63', '$0.37', '**−41%**'],
      ['Wall-clock time', '~180s', '~180s', '≈ same'],
    ]),
    para('**Read-through:** on a real 50-page bank memo, single-call misses **14 covenants** — including two of the three guarantor financial covenants, all four Facility A extension conditions, the Facility B negative covenants, and multiple reporting sub-requirements. Same top-3, but the completeness gap is huge.'),

    h2('4.4 The pattern in one sentence'),
    para('**Both approaches get the top-3 right on both memos. Single-call misses covenants; the gap widens sharply with memo size — from 7% on Meridian to 28% on Deutsche Bank.**'),
    para('On a clean synthetic test, single-call looks fine. On a real memo, it drops nearly a third of the covenants.'),

    h2('4.5 Benefits of the two-call design'),
    para('Five specific things two calls buy you that a single call does not:'),
    num('**Completeness on the covenant list.** The single call spends its output budget getting the top-3 reasoning right, at the expense of listing every boring covenant. The two-call design forces the AI to focus entirely on completeness in the first call, before it thinks about ranking.'),
    num('**Schema discipline (enum compliance).** Each of our two tool schemas has strict enum constraints — 16 valid categories for covenants, exactly 3 ranked risks. Two focused schemas are easier to enforce than one big combined schema. When we relaxed the schema in the single-call experiment, the AI invented 26 different category names — every filter, every cross-memo query, every downstream automation rule breaks silently on those.'),
    num('**Auditability.** A credit officer wants to eyeball the extracted covenant list against Section 5 of the memo BEFORE trusting the top-3 ranking. Two calls make the covenant list a checkable artifact. Single-call collapses that check.'),
    num('**Debuggability.** If the demo breaks live, we can point at which of the two calls failed. Single-call fails atomically — no way to tell which half went wrong.'),
    num('**Anti-summary bias.** Single-call outputs over-weighted whatever the memo executive summary flagged as risky. Two calls, with Rank working from a clean covenant list, gives the model a chance to actually work through the covenants.'),

    h2('4.6 Why we picked two calls'),
    para('If we only tested Meridian, single-call would be defensible — 33% cheaper for 95% of the value. But testing on Deutsche Bank changed the story. A production tool has to work on real memos, not just clean synthetic ones. The 28% completeness gap on Deutsche Bank is unacceptable — it means the tool is quietly dropping guarantor covenants, extension conditions, and reporting requirements that a credit officer would care about.'),
    para('**We picked two calls because the completeness gap widens with memo complexity, and the tool is meant to work on real memos.** The 41% cost premium buys real value on real memos — value that would only be visible once a reviewer tried a bigger document. Add schema discipline, auditability, and debuggability, and every one of those has real production value.'),

    h2('4.7 Cost recovery at scale — prompt caching'),
    para('The 41% cost premium is not a permanent tax. Anthropic offers **prompt caching**, which recovers most of it with a one-line code change.'),
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
    para('**Result:** two calls with caching enabled costs about **$0.49 per review** on a DB-sized memo. Single-call was $0.37. The gap narrows from 41% down to about 24% — and two calls keeps its completeness, schema discipline, auditability, and debuggability advantages.'),
    para('On smaller memos (Meridian-sized), caching saves about 15% — smaller absolute dollars but the same proportional recovery.'),
    para('**Implementation cost:** one field on one Python dict. In `src/review.py`, the `_pdf_document_block()` helper would grow one line — `cache_control: {type: "ephemeral"}` — added to the document source. Everything else stays identical.'),
    para('We have not shipped caching in the POC because at demo volume ($0.15-0.63 per review, 20-30 runs a day) the absolute savings do not justify the extra thing to explain in the walkthrough. It is the first optimisation we would add before going to production volume.'),

    h2('4.8 Summary of the trade-off'),
    tableFromMatrix([3200, 2280, 2280, 2320], [
      ['', 'Two calls (chosen)', 'Single call', 'Two calls + caching'],
      ['Covenants completeness on real memos', 'Full (50/50 on DB)', '−28% (36/50 on DB)', 'Full'],
      ['Top-3 accuracy', '✓', '✓', '✓'],
      ['Schema / enum compliance', '✓', '✗', '✓'],
      ['Cost per review (DB scale)', '$0.63', '$0.37', '~$0.49'],
      ['Auditable intermediate covenant list', '✓', '✗', '✓'],
      ['Debuggable by stage', '✓', '✗', '✓'],
    ]),
    para('Same accuracy on the ranking, but two calls (with caching enabled at scale) delivers full completeness, schema compliance, and auditability at ~$0.12 more than single-call — worth it for a tool meant to run on real memos.'),

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
    para('Split into Extract and Rank on purpose:'),
    bullet('**Auditability.** A credit officer can eyeball the extracted covenant list against the memo\'s Section 5 before trusting the top-3 ranking. Single-shot collapses that check.'),
    bullet('**Better quality on each stage.** Single-shot consistently under-lists non-financial covenants and over-weights whatever the memo\'s executive summary flagged.'),
    bullet('**Debuggability under demo pressure.** If the demo breaks live, we can point to which call failed.'),
    para('Cost of the split: roughly 2x tokens and 2x latency. Invisible on a demo. Would revisit at scale with prompt caching (~35% cost recovery).'),

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
