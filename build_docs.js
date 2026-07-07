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

    para('Three sets of comparisons:'),
    num('LLM providers — Claude vs Gemini vs OpenAI vs Groq'),
    num('Claude models — Opus vs Sonnet vs Haiku'),
    num('Stack tools — n8n vs alternatives, Firebase vs alternatives, Lovable vs alternatives'),
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

    // ---------- Section 3 -------------------------------------------------
    h1('3. Tool Comparisons'),
    para('Three separate tool decisions in the low-code stack:'),
    bullet('**Orchestration** (which step happens when): n8n vs alternatives'),
    bullet('**Storage & database** (where PDFs and results live): Firebase vs alternatives'),
    bullet('**Frontend** (what the user sees): Lovable vs alternatives'),

    h2('3.1 Orchestration — n8n vs alternatives'),
    para('**What orchestration means in plain English:** the tool that says "when a user uploads a PDF, first save it, then call the AI, then check the result, then save the answer." It’s the recipe-runner.'),
    tableFromMatrix([1500, 2200, 1595, 1595, 1595, 1595], [
      ['Tool', 'What it is', 'POC strengths', 'POC weaknesses', 'Scale strengths', 'Scale weaknesses'],
      ['n8n (chosen)', 'Open-source visual workflow builder.', 'Visual — non-engineers can follow. "Code" node for the hard bits. Self-hostable. Workflows are git-able.', 'Adds vendor accounts to set up. Debugging is per-node, not line-by-line.', 'Handles retries, scheduling, error handling out of the box. Self-host = no per-run pricing. Ops can maintain.', 'Version control awkward (JSON blobs). Debugging complex flows slower than code.'],
      ['Zapier', 'The most popular no-code automation tool.', 'Fastest setup if pre-built connectors cover you. Biggest integration library.', 'Per-run pricing gets expensive. Custom logic requires fighting the tool.', 'Great for small business, light volume.', 'Cost balloons at scale. Weak custom-code story. Not self-hostable.'],
      ['Make (Integromat)', 'Hosted service similar to n8n.', 'More powerful than Zapier for the same workflows.', 'Less transparent about what runs where; not self-hostable.', 'Reasonable at scale.', 'Vendor lock-in. Pricing concerns similar to Zapier.'],
      ['Airflow / Prefect / Dagster', 'Engineer-owned orchestration frameworks.', 'None — overkill for a 48-hour POC.', 'Weeks of setup before anything runs.', 'The right answer for serious data pipelines with lots of retries and backfills.', 'Requires engineering ownership; not touchable by ops.'],
      ['AWS Step Functions / Cloud Workflows', 'Cloud-vendor orchestration services.', 'None — hours inside AWS/GCP consoles before a prompt.', 'Cloud engineering knowledge required.', 'Excellent at scale — durable, cheap, integrates with the whole cloud.', 'Vendor lock-in; harder for non-engineers to touch.'],
      ['Just Python (no orchestrator)', 'Write the workflow directly in code.', 'Fastest path to a running demo. Total control. Zero vendor.', 'You build retries, scheduling and monitoring yourself.', 'Fine at small scale.', 'At real scale you’re reinventing an orchestrator badly. Not touchable by non-engineers.'],
    ]),
    para('**POC winner:** Just Python for Approach A (fastest to demo). n8n for Approach B (visual walkthrough story).'),
    para('**Scale winner:** n8n if non-engineers maintain it. Airflow/Prefect or AWS Step Functions if engineering owns it at high volume.'),

    h2('3.2 Storage & database — Firebase vs alternatives'),
    para('**What we need to store:** the uploaded PDFs, and the JSON result for each one. Plus a way to look up past reviews.'),
    tableFromMatrix([1500, 2200, 1595, 1595, 1595, 1595], [
      ['Tool', 'What it is', 'POC strengths', 'POC weaknesses', 'Scale strengths', 'Scale weaknesses'],
      ['Firebase (chosen)', 'Google’s all-in-one backend (Storage + Firestore + Auth).', 'Minutes to set up. Signed URLs out of the box. Firestore schemaless — matches our JSON. Single console.', 'Firestore isn’t SQL — harder if you later want "all memos where leverage > 4.0".', 'Fine at moderate scale. Auto-scales.', 'Costs grow with reads and file storage. Vendor lock-in. Analytics require exporting.'],
      ['Supabase', 'Open-source Firebase alternative built on Postgres.', 'Fast setup. Real SQL from day one. Row-level security.', 'Slightly more concepts than Firebase for first-time users.', 'Better for SQL analytics. Self-hostable.', 'Smaller company than Google; long-term bet is different.'],
      ['AWS S3 + RDS Postgres', 'Raw cloud storage + managed SQL database.', 'None — hours of IAM/VPC setup for POC.', 'Slow to stand up.', 'The default for enterprise banks. Fits existing AWS infra. Full control.', 'You build the plumbing (signed URLs, dashboards, auth).'],
      ['Local filesystem + SQLite', 'Files in a folder, rows in SQLite.', 'Simplest possible thing. Great for laptop-only demo.', 'Doesn’t work multi-user. Doesn’t work anywhere but your laptop.', 'Not viable.', 'N/A'],
      ['MongoDB Atlas', 'Managed MongoDB — schemaless like Firestore, full database.', 'Fast setup. Rich query language.', 'You still need a separate file store (S3 or similar).', 'Great for document data at scale.', 'Two tools instead of one.'],
    ]),
    para('**POC winner:** Firebase (least ceremony); local filesystem for the pure Python approach.'),
    para('**Scale winner:** AWS S3 + Postgres (or Azure/GCP equivalent) in a bank — fits existing infrastructure, compliance, audit. Supabase for a lightweight product line.'),

    h2('3.3 Frontend — Lovable vs alternatives'),
    para('**What "frontend" means:** the web page the user actually sees and clicks. The upload button, the results table, the download button.'),
    tableFromMatrix([1500, 2200, 1595, 1595, 1595, 1595], [
      ['Tool', 'What it is', 'POC strengths', 'POC weaknesses', 'Scale strengths', 'Scale weaknesses'],
      ['Lovable (chosen)', 'AI-native web app builder. Describe UI in prose, get real React.', 'Very fast for a first version. Real React source you can inspect. Named in the assignment brief.', 'At the mercy of the AI for unusual asks. Not free forever.', 'Exports real code — no lock-in. Can hand off to engineers later.', 'Not a substitute for real engineering on a large app.'],
      ['Bubble', 'Full no-code web app builder. Very powerful.', 'Broadest capabilities of the no-code group.', 'Steeper learning curve. Exported artifact isn’t clean code.', 'Runs at real scale.', 'Locked into Bubble’s runtime — hard to exit.'],
      ['Retool', 'Internal-tool builder. Perfect for admin dashboards.', 'Fast for the "read/write records with buttons" pattern.', 'Aesthetic and UX are admin-flavored — wrong for customer-facing.', 'Excellent for internal tools ops teams use daily.', 'Not the right shape for public-facing product.'],
      ['Softr', 'Frontend generator on top of Airtable.', 'Very fast if data is in Airtable.', 'Wrong shape here — data is JSON in Firestore, not tabular in Airtable.', 'Small business only.', 'Not fit for bank-scale.'],
      ['Streamlit', 'Python web app framework for data/ML demos.', 'Zero-JS. Same process as pipeline. Perfect for an AI demo.', 'Limited aesthetic ceiling. Awkward for multi-user with background jobs.', 'Fine at small internal scale (analytics teams use it).', 'Not a customer-facing production tool.'],
      ['Custom React (Next.js)', 'Real frontend engineering.', 'None for a 48-hour POC.', 'Days of work.', 'Right answer for any product a bank ships to customers. Full control.', 'High engineering cost.'],
    ]),
    para('**POC winner:** Streamlit for the Python approach; Lovable for the low-code approach.'),
    para('**Scale winner:** Custom Next.js for customer-facing; Retool or Bubble for internal tools; Streamlit stays viable for internal analytics/ML tools; Lovable is a starting point, not a destination.'),

    new Paragraph({ children: [new PageBreak()] }),

    // ---------- Section 4 -------------------------------------------------
    h1('4. Summary — What Do We Pick?'),

    h2('4.1 For the POC (this 48-hour demo)'),
    tableFromMatrix([2800, 3640, 3640], [
      ['Layer', 'Approach A (Python)', 'Approach B (low-code)'],
      ['Model provider', 'Claude', 'Claude'],
      ['Model', 'Claude Sonnet 4.6', 'Claude Sonnet 4.6'],
      ['Orchestration', 'Python script (no orchestrator)', 'n8n'],
      ['Storage', 'Local files', 'Firebase'],
      ['Frontend', 'Streamlit', 'Lovable'],
    ]),

    h2('4.2 For running the same tool at scale in a real bank'),
    tableFromMatrix(W2b, [
      ['Layer', 'What we’d actually pick'],
      ['Model provider', 'Whichever the bank has a contract with. Unconstrained: Gemini for cost, Claude for quality-per-dollar.'],
      ['Model', 'Sonnet 4.6 for Extract, Opus 4.8 for Rank.'],
      ['Orchestration', 'n8n if ops maintains it. Airflow/Prefect or Step Functions if engineering owns it.'],
      ['Storage', 'Native cloud (AWS S3 + Postgres, or equivalent). Firebase/Supabase for lightweight product lines.'],
      ['Frontend', 'Custom Next.js for customer-facing. Retool or Bubble for internal tools.'],
    ]),

    para('**The pattern:** POC picks are chosen for **speed of getting to a runnable demo**. Scale picks are chosen for **fit with existing infrastructure, cost, control, and audit**. They are almost never the same tools, and that’s fine.'),
  ];
}

// =========================================================================
// PLAN.docx content
// =========================================================================
function planChildren() {
  return [
    // Title block
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [new TextRun({ text: 'Step 2 — Build the Agent', bold: true, size: 44, color: '1F3A57' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new TextRun({ text: 'Plan and Design Choices  —  Credit Memo Covenant Risk Agent', italics: true, size: 24, color: '2E5B85' })],
    }),

    para('**Assignment:** ingest a credit memo, extract covenants, rank the top 3 risks with reasoning, return structured JSON.'),
    para('**Timebox:** ~4-6 hours per approach. Working > polished.'),
    para('**Input for this build:** Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf (7 pages, generated in Step 1).'),

    para('We are building **two parallel approaches** so we can compare them side by side in the walkthrough:'),
    bullet('**Approach A — Code-first:** Python script + Claude API direct + Streamlit UI.'),
    bullet('**Approach B — Low-code:** n8n workflow + Firebase (storage + Firestore) + Lovable frontend.'),
    para('Both produce identical JSON output against the same schema (Section 6) and can be pointed at the same memo.'),

    // Section 1
    h1('1. Shape of the Problem'),
    para('This is a **document → structured judgment** pipeline, not an ML problem and not an integrations problem. A credit officer reads a memo, pulls out the covenant package, and forms a view on which covenants are most likely to be tripped. The agent has to do the same, deterministically enough that a POC user can trust the output. There are no external systems to talk to, no ongoing state, no users to authenticate. The interesting work is **prompt design, output schema, and grounding** — everything else is scaffolding.'),
    para('That framing drives every choice below: keep the surface area small, keep every model call auditable, spend time on the parts a credit officer would actually push back on.'),

    // Section 2
    h1('2. Model Choice: Why Claude'),
    para('Both approaches call the same LLM. The model choice is the most important technical decision, so it gets its own section.'),

    h2('2.1 Evaluation dimensions'),
    para('For a PDF → structured JSON with grounded reasoning task, the model has to be strong at four things:'),
    num('**Native PDF ingestion.** Can the model read the PDF directly, preserving table structure, or do I build a parsing pipeline first?'),
    num('**Structured output enforcement.** Can the model be forced to return output matching a schema, or is it "please output JSON" and hope?'),
    num('**Grounded document reasoning.** How well does it reason about a specific document without drifting into plausible-sounding hallucination?'),
    num('**Operational fit.** Latency, cost, rate limits, API stability, ease of debugging.'),

    h2('2.2 Head-to-head'),
    para('**Claude (Anthropic) — chosen.** Native PDF via document blocks; tool-forced JSON via tool_choice; low fabrication risk; 200K context; SDK I know cold.'),
    para('**GPT (OpenAI) — reasonable alternative.** File handling is uglier (Assistants API), tends slightly more toward "confident completion." Would flip to GPT-4.1 without ceremony if a bank already runs on Azure OpenAI.'),
    para('**Gemini (Google) — strong alternative, cheapest.** Excellent PDF support, up to 2M context, response_schema less battle-tested. Would revisit for the "millions of runs" version.'),
    para('**Open source (Llama 3.3, gpt-oss-20b via Groq, etc.) — not viable.** None take PDFs natively; would burn most of the 6-hour budget on PDF parsing.'),

    h2('2.3 Which Claude model'),
    tableFromMatrix([2500, 3000, 2290, 2290], [
      ['Model', 'ID', 'Cost tier', 'Best fit'],
      ['Opus 4.8', 'claude-opus-4-8', 'Frontier / highest', 'Hard judgment tasks; final review'],
      ['Sonnet 4.6 (chosen)', 'claude-sonnet-4-6', 'Middle', 'Almost everything in production'],
      ['Haiku 4.5', 'claude-haiku-4-5-20251001', 'Cheap', 'High-volume, low-nuance work'],
      ['Fable 5', 'claude-fable-5', 'N/A here', 'Creative writing — not this task'],
    ]),
    para('**Decision: Sonnet 4.6 for both Extract and Rank calls.** Extract is a "read and organize" task Sonnet handles at 95%+; Opus would be 3x cost for maybe 5% marginal quality. Rank is judgment-heavy but the memo does most of the work for us (Section 4.3 explicitly names the downside breach).'),
    para('**Production path I’d propose in the interview:** Sonnet for Extract, Opus for Rank. Best model on the harder, lower-volume job.'),

    // Section 3 - Approach A
    h1('3. Approach A — Python + Claude API + Streamlit'),

    h2('3.1 Stack'),
    para('Python 3.11 · anthropic SDK · Pydantic (schemas) · Streamlit (UI). Four dependencies.'),

    h2('3.2 Architecture: two calls, not one'),
    para('The pipeline splits into two model calls: an **Extract** stage that lists every covenant, and a **Rank** stage that picks the top-3 risks. The Extract output feeds the Rank stage along with the original PDF.'),
    para('**Why split into two calls:**'),
    bullet('**Faithful extraction is a different job from judgment.** Single-shot "extract and rank" consistently under-lists non-financial covenants and over-weights whatever the Executive Summary already flagged.'),
    bullet('**Auditability.** A credit officer should be able to eyeball the covenant list against Section 5 before trusting the ranking. Single-shot collapses that check.'),
    bullet('**Debuggability.** If the demo breaks live, I can point at which stage.'),
    para('**Cost:** 2x API calls, roughly 2x latency (~10-20s total instead of ~5-10s). Invisible for a demo. Would re-evaluate at scale.'),
    para('**Explicitly not doing:** RAG (memo is 7 pages), agentic self-critique loop, multi-model ensemble. All add architecture I can’t defend on a 48-hour build.'),

    h2('3.3 Why Streamlit'),
    tableFromMatrix([2200, 7880], [
      ['Option', 'Notes'],
      ['Streamlit (chosen)', 'Pure Python. st.file_uploader(), st.dataframe(), st.json(), st.download_button() — all one-liners. Same process as the pipeline; no HTTP layer to build. Save the file, browser hot-reloads. Ships as streamlit run app.py.'],
      ['Gradio', 'Similar model, popular for ML demos. Slightly less polished layout but equivalent here.'],
      ['Flask/FastAPI + HTML/JS', 'Costs an hour of frontend work I don’t want to spend.'],
      ['Next.js + React', 'Overkill by 10x for a demo.'],
      ['Jupyter notebook', 'Not "an app" — reads as script output, not product.'],
      ['CLI only', 'Would work, but the Loom would be terminal text scrolling. Streamlit costs ~40 lines and buys a visual demo.'],
    ]),

    h2('3.4 Repo layout'),
    bullet('README.md'),
    bullet('PLAN.md (this document, markdown source)'),
    bullet('requirements.txt — anthropic, streamlit, pydantic, python-dotenv'),
    bullet('.env.example, .gitignore, assignment_brief.pdf'),
    bullet('memo/ — Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf'),
    bullet('src/ — review.py, schemas.py, prompts.py, guardrails.py, app.py'),
    bullet('outputs/ — meridian_review.json'),
    para('Two ways to run: **CLI** (python -m src.review memo.pdf > outputs/meridian_review.json) or **UI** (streamlit run src/app.py).'),

    // Section 4 - Approach B
    h1('4. Approach B — n8n + Firebase + Lovable'),
    para('Same output, different tooling. A bank innovation team lives between these worlds: engineers prototype in Python, ops/business teams maintain the productionised version in a visual workflow tool. Showing both is showing I understand the trade.'),

    h2('4.1 Component roles'),
    bullet('**n8n — orchestration.** Receive PDF, call Claude twice, run the guardrail check, save the result. Each step is a visual node.'),
    bullet('**Firebase — storage + persistence.** Storage for PDFs. Firestore for structured results (queryable history). Auth optional.'),
    bullet('**Lovable — frontend.** File upload, results view, review history. Generated from a natural-language spec, exports real React.'),

    h2('4.2 n8n workflow nodes'),
    tableFromMatrix([600, 2200, 7280], [
      ['#', 'Node', 'Purpose'],
      ['1', 'Webhook (trigger)', 'POST /review — receives PDF (multipart or base64) from Lovable'],
      ['2', 'Firebase Storage: Upload', 'Store the raw PDF under memos/{uuid}.pdf; get a signed URL'],
      ['3', 'HTTP → Anthropic', 'Extract call. Send PDF as document block + extract system prompt + tool schema. Force tool choice.'],
      ['4', 'Function (JS)', 'Parse tool_use block from response; hand covenants array to next node'],
      ['5', 'HTTP → Anthropic', 'Rank call. Send PDF + extracted covenants + rank prompt + rank tool schema'],
      ['6', 'Function (JS)', 'Assemble final JSON; run verbatim-quote check against extracted PDF text'],
      ['7', 'Firestore: Set Document', 'reviews/{reviewId} — write the full JSON output'],
      ['8', 'Respond to Webhook', 'Return the JSON to Lovable'],
    ]),

    h2('4.3 Trade-offs vs Approach A'),
    tableFromMatrix([2600, 3740, 3740], [
      ['Dimension', 'Approach A (Python)', 'Approach B (n8n + Firebase + Lovable)'],
      ['Time to first working run', '~2 hours', '~3-4 hours (more accounts and glue)'],
      ['Explaining the pipeline', 'Line by line in one file', 'Click through nodes in n8n UI'],
      ['Debugging', 'print(), breakpoints, tests', 'n8n execution log per node'],
      ['Persistence / history', 'Not built (writes JSON to disk)', 'Free (Firestore stores every run)'],
      ['Retries + error handling', 'I write them', 'Built-in n8n retry per node'],
      ['Multi-user, hosted demo', 'Would need to deploy', 'Hosted from day one'],
      ['Version control', 'Git-native', 'Workflow is exportable JSON; more friction than code'],
      ['Cost model', '~$0.10 per run (Anthropic API)', 'Anthropic API + n8n cloud (or self-host) + Firebase (small)'],
      ['Who can maintain it', 'Engineers', 'Ops/business can edit nodes; engineers own Function nodes'],
    ]),

    // Section 5
    h1('5. Grounding and Guardrails (Both Approaches)'),
    para('The single biggest risk is a plausible-sounding covenant that isn’t in the memo, or a "top risk" reasoning citing facts not present. Three cheap defenses, identical across A and B:'),
    num('**Verbatim quotes required.** Every extracted covenant carries a verbatim_text field — the exact string from the memo. Every top-3 risk carries evidence_from_memo with the quote it’s leaning on. Enforced by the tool schema.'),
    num('**Source section labels.** Every covenant carries source_section ("5.1", "5.2", "7", "8"). Traceable back to the document.'),
    num('**Post-run substring check.** After both calls, walk the JSON and confirm each verbatim_text / evidence_from_memo appears in the memo text. Trivial code, high-value defensibility.'),
    para('Not adding an LLM-as-judge verifier layer — helps quality but doubles complexity. Guardrails above already give me an auditable output for a 48-hour build.'),

    // Section 6
    h1('6. Output Schema (Target JSON)'),
    para('Same JSON output from both approaches. Key fields:'),
    bullet('**memo_metadata:** borrower, facility_size_usd_m, memo_date, source_file'),
    bullet('**covenants[]:** id, name, type (financial | non-financial), category (leverage | coverage | liquidity | …), threshold, test_frequency, current_value, downside_value, source_section, verbatim_text'),
    bullet('**top_risks[]:** rank, covenant_id, covenant_name, reasoning, evidence_from_memo'),
    bullet('**run_metadata:** model, approach, extract_tokens, rank_tokens, quote_check {passed, failures}'),
    para('Schema choices worth calling out:'),
    bullet('type (financial vs non-financial) is what the brief asked for; category is what a credit officer actually filters on.'),
    bullet('downside_value is stored on the covenant record even though the brief didn’t ask for it — the Rank stage needs it, and it’s cheaper to extract once.'),
    bullet('top_risks uses explicit rank fields, not array order — insurance against downstream serialization bugs.'),
    bullet('run_metadata.quote_check is the audit trail from the guardrail layer.'),

    // Section 7 - Prompt design
    h1('7. Prompt Design'),
    para('**Extract prompt (system):** Role: "You extract covenant terms from corporate credit memos. You do not analyze risk in this call." Explicit list of what counts as a covenant. Instruction to include every covenant, including boilerplate. Schema handed over as a tool; tool_choice forced. Quote the memo verbatim.'),
    para('**Rank prompt (system):** Role: "You are a senior credit officer. You already have the extracted covenant list. Your only job is to pick the three highest-risk covenants and explain why in 1-2 sentences each." Definition of "risk" spelled out. Lean on Section 4.3 downside and Section 7 risk table. Anti-bias instruction: do not default to the risks the memo’s executive summary flagged.'),
    para('**Expected top-3 for Meridian memo:**'),
    num('Minimum cash interest coverage — projected downside breach (2.97x vs 3.00x).'),
    num('Maximum total net leverage — 0.07x headroom at Q4 2026 step-down under downside.'),
    num('Minimum liquidity — Q3 seasonal trough drops to $38M vs $30M minimum in downside.'),
    para('If either approach surfaces those three (in roughly that order) with grounded reasoning, the demo works.'),

    // Section 8 - Loom
    h1('8. What Lives in the Loom Walkthrough'),
    num('**Memo generation (~1 min):** what I prompted for, what I checked.'),
    num('**Approach A running live (~2-3 min):** drop the PDF into Streamlit, walk through the covenant table, then top-3 with reasoning.'),
    num('**Approach B running live (~2 min):** drop the PDF into Lovable, show the n8n execution log, show the Firestore record.'),
    num('**Architecture side-by-side (~1-2 min):** two diagrams. Same LLM, same schema, same guardrails; different orchestration.'),
    num('**The trade-off (~1 min):** two calls instead of one — auditability at the cost of latency.'),
    num('**Two more weeks (~1 min):** eval harness — 5-10 varied memos with human-labeled top-3, measure covenant recall + rank agreement.'),

    // Section 9 - Out of scope
    h1('9. Explicitly Out of Scope'),
    bullet('UI polish beyond a working page.'),
    bullet('Production deployment (Approach A runs on laptop; Approach B in vendor consoles).'),
    bullet('Auth, RBAC, audit logging.'),
    bullet('Non-PDF inputs, scanned PDFs (OCR), multi-memo batching.'),
    bullet('Auditing whether the memo’s numbers are correct — the agent reviews the memo as written.'),

    // Section 10 - Execution
    h1('10. Execution Plan'),
    tableFromMatrix([4400, 2840, 2840], [
      ['Step', 'Approach A', 'Approach B'],
      ['Scaffold repo/accounts, wire secrets', '0.5h', '1.0h (Firebase, n8n, Lovable)'],
      ['Extract call end-to-end', '1.0h', '1.0h'],
      ['Rank call end-to-end', '1.0h', '0.75h'],
      ['Guardrails (quote check)', '0.5h', '0.5h'],
      ['UI (Streamlit / Lovable)', '0.75h', '1.0h'],
      ['README + committed example output', '0.75h', '0.75h'],
      ['Total', '~4.5h', '~5h'],
      ['Combined (with shared work)', '', '~7-8h'],
    ]),
    para('Above the "5-6 hour comfort zone" the brief mentions but below the 48-hour ceiling. If time gets tight, ship Approach A end-to-end first, then bring Approach B to demo-ready.'),
  ];
}

// ---- Build and write ----------------------------------------------------
async function build(fileName, title, children) {
  const doc = buildDoc(title, children);
  const buf = await Packer.toBuffer(doc);
  const outPath = path.join(__dirname, fileName);
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, '(' + buf.length + ' bytes)');
}

(async () => {
  await build('COMPARISONS.docx', 'Tool & Model Comparisons', comparisonsChildren());
  await build('PLAN.docx', 'Step 2 Plan — Credit Memo Agent', planChildren());
})().catch(e => { console.error(e); process.exit(1); });
