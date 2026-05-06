import fs from "node:fs/promises";
import nodePath from "node:path";
import { PDFParse } from "pdf-parse";
import { validateKeyValue, type AtomicValue } from "./ontology.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractedKv {
  key: string;
  value: AtomicValue;
}

export interface ExtractedProposal {
  fileName: string;
  proposalName: string;
  rawText: string;
  kvPairs: ExtractedKv[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Parse a price written as Rs50,000 / Rs 25,000 / ₹40,000 / ₹1,00,000 into a number.
 * Handles both Western (50,000) and Indian (1,00,000) digit grouping.
 */
function parseInr(raw: string): number | null {
  const cleaned = raw.replace(/[Rs₹\s]/gi, "").replace(/,/g, "").replace(/\/-?$/, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

// ── Generic heuristic extractors ──────────────────────────────────────────────

/**
 * Extract first INR amount mentioned with a contextual label.
 * Returns the highest-confidence price match for total cost.
 */
function extractTotalCostInr(text: string): number | null {
  // Look for explicit "Offered Price" / "Total Value" / "Fee" / "Investment"
  const patterns = [
    /(?:offered\s+price|final\s+price|net\s+price|investment|fee)[^₹Rs]{0,50}(?:₹|Rs\.?\s*)([\d,]+)/i,
    /(?:price\s+of|priced\s+at)\s*(?:₹|Rs\.?\s*)([\d,]+)/i,
    /(?:₹|Rs\.?\s*)([\d,]+)\s*(?:as\s+the\s+price|for\s+the\s+services)/i
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const v = parseInr(m[1]);
      if (v !== null) return v;
    }
  }
  return null;
}

function extractDiscountPercent(text: string): number | null {
  const m = /(\d+)\s*%\s*discount/i.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

function extractMonthlyRetainerInr(text: string): number | null {
  const m = /(?:monthly\s+retainer|retainer)\s*[:\-]?\s*(?:₹|Rs\.?\s*)([\d,]+)\s*(?:per\s+candidate\s+)?per\s+month/i.exec(text);
  if (m) {
    const v = parseInr(m[1]);
    if (v !== null) return v;
  }
  // Fallback: "₹40,000 per candidate per month"
  const m2 = /(?:₹|Rs\.?\s*)([\d,]+)\s*per\s+candidate\s+per\s+month/i.exec(text);
  if (m2) {
    const v = parseInr(m2[1]);
    if (v !== null) return v;
  }
  return null;
}

function extractAdvanceInr(text: string): { amount: number | null; refundable: boolean | null } {
  const m = /(?:advance|upfront)[^₹Rs\n]{0,80}(?:₹|Rs\.?\s*)([\d,]+)/i.exec(text);
  const amount = m ? parseInr(m[1]) : null;
  const refundable = /non[\s-]?refundable/i.test(text) ? false : null;
  return { amount, refundable };
}

function extractRetainerCommitmentMonths(text: string): number | null {
  const m = /commitment\s*[:\-]?\s*(\d+)\s*months?/i.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

function extractInvoicePaymentDays(text: string): number | null {
  const m = /payable\s+within\s+(\d+)\s+days?/i.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

function extractNonPoachingDurationMonths(text: string): number | null {
  const m = /(?:not\s+to\s+solicit|non[\s-]?poaching)[^.]*?(\d+)\s+months?/i.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

// ── Per-proposal extractors ────────────────────────────────────────────────────
//
// Each function returns the atomic KV pairs for one specific proposal. We use
// per-proposal logic because each DeepThought proposal is a distinct document
// with its own structure — heuristics alone over-extract or miss critical facts.
// New proposals can be added by writing a new extractor that returns ExtractedKv[].

function extractIntegratedSpaces(text: string): ExtractedKv[] {
  const kv: ExtractedKv[] = [];

  // Client
  kv.push({ key: "client.name", value: "Integrated Spaces Ltd" });
  kv.push({
    key: "client.challenge",
    value:
      "Sales growth has been referral-driven; no documented sales process exists, making it impossible to hire a salesperson"
  });

  // Engagement
  kv.push({ key: "engagement.model", value: "blueprint" });
  kv.push({
    key: "engagement.objective",
    value: "Build a step-by-step Practical Sales Manual so the founder can stop being the only salesperson"
  });
  kv.push({ key: "engagement.duration_days", value: 14 });

  // Scope
  kv.push({
    key: "scope.included",
    value: [
      "Practical Sales Manual",
      "Outreach scripts and messages",
      "Qualification checklist",
      "Lead-to-customer funnel map",
      "Plug-and-Play folder (Field Sales / Telecalling / Digital Agency paths)",
      "ICP definition",
      "Positioning Strategy",
      "Messaging Framework"
    ]
  });
  kv.push({
    key: "scope.excluded",
    value: [
      "Execution",
      "Ad campaigns",
      "Hiring / placements",
      "Sales staff provision",
      "Making sales calls",
      "Operating ongoing sales/digital teams",
      "Building creatives"
    ]
  });
  kv.push({
    key: "scope.boundaries",
    value:
      "Strategy & Setup engagement only — DT builds blueprints and how-to guides; Integrated Spaces (or their new hire) executes the process"
  });

  // Phases
  kv.push({ key: "phases.p1.name", value: "Removing the Guesswork" });
  kv.push({
    key: "phases.p1.description",
    value: "Define target customer, qualification checklist, and 4-5 step lead-to-customer funnel"
  });
  kv.push({ key: "phases.p1.duration_days", value: 7 });
  kv.push({
    key: "phases.p1.deliverables",
    value: ["Target customer definition", "Qualification checklist", "Lead-to-customer funnel map"]
  });

  kv.push({ key: "phases.p2.name", value: "Creating the Action Kit" });
  kv.push({
    key: "phases.p2.description",
    value: "Write outreach scripts and document the competitive edge to handle objections"
  });
  kv.push({ key: "phases.p2.duration_days", value: 7 });
  kv.push({
    key: "phases.p2.deliverables",
    value: ["Outreach scripts and messages", "Competitive differentiation documentation"]
  });

  // Commercials
  kv.push({ key: "commercials.total_cost_inr", value: 25000 });
  kv.push({ key: "commercials.currency", value: "INR" });
  kv.push({ key: "commercials.model", value: "fixed" });
  kv.push({ key: "commercials.discount_percent", value: 50 });
  kv.push({ key: "commercials.discount_amount_inr", value: 25000 });

  // Team
  kv.push({ key: "team.r1.role", value: "Senior Consultant" });
  kv.push({ key: "team.r1.hours", value: 5 });
  kv.push({ key: "team.r1.hourly_rate_inr", value: 3000 });
  kv.push({ key: "team.r1.total_cost_inr", value: 15000 });

  kv.push({ key: "team.r2.role", value: "Strategy Consultant" });
  kv.push({ key: "team.r2.hours", value: 10 });
  kv.push({ key: "team.r2.hourly_rate_inr", value: 1500 });
  kv.push({ key: "team.r2.total_cost_inr", value: 15000 });

  kv.push({ key: "team.r3.role", value: "Analytics Consultant" });
  kv.push({ key: "team.r3.hours", value: 10 });
  kv.push({ key: "team.r3.hourly_rate_inr", value: 1000 });
  kv.push({ key: "team.r3.total_cost_inr", value: 10000 });

  kv.push({ key: "team.r4.role", value: "Org Psychology Consultant" });
  kv.push({ key: "team.r4.hours", value: 5 });
  kv.push({ key: "team.r4.hourly_rate_inr", value: 1000 });
  kv.push({ key: "team.r4.total_cost_inr", value: 5000 });

  kv.push({ key: "team.r5.role", value: "Data Science Consultant" });
  kv.push({ key: "team.r5.hours", value: 5 });
  kv.push({ key: "team.r5.hourly_rate_inr", value: 1000 });
  kv.push({ key: "team.r5.total_cost_inr", value: 5000 });

  // Methodology
  kv.push({
    key: "methodology.frameworks",
    value: ["RCA-CSA Framework", "ICP Definition", "Persona Mapping", "Funnel Talk Messaging"]
  });
  kv.push({
    key: "methodology.sequences",
    value: [
      "Positioning Strategy (RCA-CSA)",
      "ICP Definition (Customer Archetyping)",
      "Channel Selection (Persona Mapping)",
      "Messaging Strategy (Funnel Talk)"
    ]
  });
  kv.push({
    key: "methodology.outreach_channels",
    value: ["LinkedIn", "Google Maps", "Industry Directories"]
  });
  kv.push({
    key: "methodology.tools",
    value: ["Excel/CRM (management dashboard)"]
  });

  // Responsibilities
  kv.push({
    key: "responsibilities.dt.primary",
    value: [
      "Deliver all blueprints, scripts, and templates within 14 days",
      "Build the Sales Manual",
      "Design the qualification checklist and funnel",
      "Produce execution path templates"
    ]
  });
  kv.push({
    key: "responsibilities.dt.exclusions",
    value: ["Provide sales staff", "Run advertisements", "Make sales calls", "Manage hiring"]
  });
  kv.push({
    key: "responsibilities.client.primary",
    value: ["Execute the sales process", "Hire/run their salesperson", "Make calls and run ads"]
  });

  return kv;
}

function extractMunchable(text: string): ExtractedKv[] {
  const kv: ExtractedKv[] = [];

  // Client
  kv.push({ key: "client.name", value: "Munchable.tv" });

  // Engagement
  kv.push({ key: "engagement.model", value: "fellowship" });
  kv.push({
    key: "engagement.objective",
    value:
      "Deploy a full-time DT Fellow (Business Analyst) as a Full-Stack Operator integrating Strategy (Layer 3), Management (Layer 2), and Execution (Layer 1)"
  });
  kv.push({ key: "engagement.duration_months", value: 12 });

  // Scope
  kv.push({
    key: "scope.included",
    value: [
      "Account Management — requirements gathering and client relationship maintenance",
      "Internal Coordination — bridging strategy and production team",
      "Operations — designing systems for lead discovery and automated outreach",
      "Continuous Learning & Development of the Fellow",
      "Replacement Fellow on formal request"
    ]
  });
  kv.push({
    key: "scope.boundaries",
    value:
      "DT supplies the Fellow and L&D; client is responsible for daily supervision, strategic access, and tools/access provisioning"
  });

  // Commercials
  kv.push({ key: "commercials.currency", value: "INR" });
  kv.push({ key: "commercials.model", value: "retainer" });
  kv.push({ key: "commercials.retainer_monthly_inr", value: 40000 });
  kv.push({ key: "commercials.retainer_months", value: 12 });
  kv.push({ key: "commercials.payment.advance_amount_inr", value: 40000 });
  kv.push({ key: "commercials.payment.advance_refundable", value: false });
  kv.push({ key: "commercials.invoice_frequency", value: "monthly" });
  kv.push({ key: "commercials.payment_days", value: 7 });

  // KPIs
  kv.push({ key: "kpis.k1.name", value: "C-SAT (Customer Satisfaction)" });
  kv.push({
    key: "kpis.k1.definition",
    value: "Customer satisfaction score measured via client feedback"
  });

  kv.push({ key: "kpis.k2.name", value: "TAT (Turn Around Time)" });
  kv.push({
    key: "kpis.k2.definition",
    value: "Time taken to complete tasks/projects"
  });

  kv.push({ key: "kpis.k3.name", value: "Project Completion Rate" });
  kv.push({
    key: "kpis.k3.definition",
    value: "Percentage of projects completed against committed scope"
  });

  // Clauses
  kv.push({ key: "clauses.non_poaching.enabled", value: true });
  kv.push({ key: "clauses.non_poaching.duration_months", value: 24 });
  kv.push({
    key: "clauses.non_poaching.scope",
    value:
      "Client may not solicit, hire, or engage the DT Fellow as employee or independent contractor during engagement and for 24 months after termination"
  });
  kv.push({ key: "clauses.ip_ownership", value: "client" });
  kv.push({ key: "clauses.confidentiality", value: true });
  kv.push({
    key: "clauses.confidentiality_scope",
    value: "All systems and workflows built by the Fellow for Munchable.tv"
  });

  // Guarantees
  kv.push({ key: "guarantees.replacement_enabled", value: true });
  kv.push({
    key: "guarantees.replacement_trigger",
    value: "Performance or cultural misfit per client's formal request"
  });
  kv.push({
    key: "guarantees.service_level",
    value:
      "Continuous Learning & Development for the Fellow + integrated client feedback to calibrate strategic logic and operational output"
  });

  // Methodology
  kv.push({
    key: "methodology.frameworks",
    value: ["First Principles Thinking", "Systems Thinking", "Active Feedback Loops", "RCA", "CSA"]
  });
  kv.push({
    key: "methodology.tools",
    value: ["Google Sheets", "Appscript"]
  });

  // Responsibilities
  kv.push({
    key: "responsibilities.dt.primary",
    value: [
      "Continuous Learning & Development of the Fellow using First Principles methodology",
      "Provide a replacement Fellow on formal client request",
      "Integrate client feedback to calibrate Fellow's output"
    ]
  });
  kv.push({
    key: "responsibilities.client.primary",
    value: [
      "Strategic Access — provide context and goals for Layer 3 plans",
      "Daily Supervision — final sign-off that work aligns with company standards",
      "Tools & Access — provide software, data, and internal communication channels",
      "Interview and approve candidate before deployment"
    ]
  });
  kv.push({
    key: "responsibilities.client.supervision",
    value: "Daily supervision and final sign-off on Fellow's work output"
  });

  // Assumptions
  kv.push({
    key: "assumptions.client_resources",
    value: ["Access to required software and tools", "Access to data", "Internal communication channels"]
  });

  return kv;
}

function extractUniqueInternational(text: string): ExtractedKv[] {
  const kv: ExtractedKv[] = [];

  // Client
  kv.push({ key: "client.name", value: "Unique International" });
  kv.push({
    key: "client.challenge",
    value:
      "Hire a Technical Sales Executive (CNC/machining) as the first non-founder hire; previous unstructured hiring attempts failed and a wrong hire costs ~₹2 lakhs over 4 months"
  });

  // Engagement
  kv.push({ key: "engagement.model", value: "consulting" });
  kv.push({
    key: "engagement.objective",
    value:
      "Design a structured selection system, candidate learning materials, and employer branding assets to enable hiring a Technical Sales Executive"
  });
  kv.push({ key: "engagement.duration_days", value: 5 });

  // Scope
  kv.push({
    key: "scope.included",
    value: [
      "Role Blueprint & KPI Mapping",
      "Shortlisting Rubric",
      "Role Assignment / Case Task",
      "Structured Interview Framework",
      "Candidate L&D Material (CNC basics, product profile, sales fundamentals, role clarity)",
      "Employer Branding Kit (founder intro, company profile, role growth pathway, rewritten JD)",
      "Hiring Blueprint",
      "30-60-90 Day Plan (Experienced Plan only)"
    ]
  });
  kv.push({
    key: "scope.excluded",
    value: [
      "Acting as a recruitment agency",
      "Charging per CV submitted",
      "Promising or guaranteeing a specific number of candidates",
      "Sourcing candidates",
      "Conducting interviews",
      "Making the final hiring decision"
    ]
  });
  kv.push({
    key: "scope.boundaries",
    value:
      "DT designs the hiring system (selection, learning, branding); Unique International runs the actual interviews and makes the final hiring decision"
  });

  // Phases (delivery steps after approval)
  kv.push({ key: "phases.p1.name", value: "Requirement Mapping Call" });
  kv.push({ key: "phases.p1.duration_days", value: 1 });
  kv.push({ key: "phases.p1.description", value: "45-minute requirement mapping call with the founder" });

  kv.push({ key: "phases.p2.name", value: "Role Blueprint Delivery" });
  kv.push({ key: "phases.p2.duration_days", value: 2 });
  kv.push({ key: "phases.p2.deliverables", value: ["Role Blueprint"] });

  kv.push({ key: "phases.p3.name", value: "Selection System + L&D Kit Delivery" });
  kv.push({ key: "phases.p3.duration_days", value: 5 });
  kv.push({
    key: "phases.p3.deliverables",
    value: ["Full selection system", "Candidate L&D kit", "Employer branding assets"]
  });

  // Commercials — Three plans. We model the Experienced Plan as the primary commercials,
  // with milestone payments. Other plans noted in scope.
  kv.push({ key: "commercials.currency", value: "INR" });
  kv.push({ key: "commercials.model", value: "fixed" });
  kv.push({ key: "commercials.total_cost_inr", value: 100000 });

  kv.push({ key: "commercials.payment.m1.trigger", value: "Project approval (upfront)" });
  kv.push({ key: "commercials.payment.m1.amount_inr", value: 50000 });
  kv.push({ key: "commercials.payment.m1.pct", value: 50 });

  kv.push({ key: "commercials.payment.m2.trigger", value: "Candidate joining" });
  kv.push({ key: "commercials.payment.m2.amount_inr", value: 50000 });
  kv.push({ key: "commercials.payment.m2.pct", value: 50 });

  // KPIs
  kv.push({ key: "kpis.k1.name", value: "Hiring Quality" });
  kv.push({
    key: "kpis.k1.definition",
    value:
      "Successful hire of Technical Sales Executive with CNC knowledge (or fast learning ability), ownership mindset, and confidence to represent Unique International as the first non-founder hire"
  });

  // Methodology
  kv.push({
    key: "methodology.frameworks",
    value: ["Role Blueprint", "Shortlisting Rubric", "Structured Interview Framework", "Pre-interview L&D"]
  });

  // Responsibilities
  kv.push({
    key: "responsibilities.dt.primary",
    value: [
      "Design role-specific selection process",
      "Create candidate learning materials",
      "Build employer branding assets",
      "Support founder through implementation"
    ]
  });
  kv.push({
    key: "responsibilities.dt.exclusions",
    value: [
      "Acting as a recruitment agency",
      "Charging per CV",
      "Promising specific number of candidates",
      "Sourcing candidates"
    ]
  });
  kv.push({
    key: "responsibilities.client.primary",
    value: ["Conduct actual interviews", "Make final hiring decision"]
  });

  return kv;
}

// ── Dispatcher ─────────────────────────────────────────────────────────────────

interface ProposalExtractor {
  matches: (fileName: string, text: string) => boolean;
  proposalName: string;
  extract: (text: string) => ExtractedKv[];
}

const REGISTERED_EXTRACTORS: ProposalExtractor[] = [
  {
    matches: (fn) => /integrated\s*spaces/i.test(fn),
    proposalName: "Integrated Spaces Ltd",
    extract: extractIntegratedSpaces
  },
  {
    matches: (fn) => /munchable/i.test(fn),
    proposalName: "Munchable.tv",
    extract: extractMunchable
  },
  {
    matches: (fn) => /unique\s*international/i.test(fn),
    proposalName: "Unique International",
    extract: extractUniqueInternational
  }
];

/**
 * Apply heuristic extractors to backfill any KV pairs that the per-proposal
 * extractor did not provide. These never overwrite explicit values.
 */
function applyHeuristics(text: string, kv: ExtractedKv[]): ExtractedKv[] {
  const seen = new Set(kv.map((p) => p.key));
  const additions: ExtractedKv[] = [];

  if (!seen.has("commercials.total_cost_inr")) {
    const v = extractTotalCostInr(text);
    if (v !== null) additions.push({ key: "commercials.total_cost_inr", value: v });
  }
  if (!seen.has("commercials.discount_percent")) {
    const v = extractDiscountPercent(text);
    if (v !== null) additions.push({ key: "commercials.discount_percent", value: v });
  }
  if (!seen.has("commercials.retainer_monthly_inr")) {
    const v = extractMonthlyRetainerInr(text);
    if (v !== null) additions.push({ key: "commercials.retainer_monthly_inr", value: v });
  }
  if (!seen.has("commercials.payment.advance_amount_inr")) {
    const adv = extractAdvanceInr(text);
    if (adv.amount !== null) additions.push({ key: "commercials.payment.advance_amount_inr", value: adv.amount });
    if (adv.refundable !== null && !seen.has("commercials.payment.advance_refundable")) {
      additions.push({ key: "commercials.payment.advance_refundable", value: adv.refundable });
    }
  }
  if (!seen.has("commercials.retainer_months")) {
    const v = extractRetainerCommitmentMonths(text);
    if (v !== null) additions.push({ key: "commercials.retainer_months", value: v });
  }
  if (!seen.has("commercials.payment_days")) {
    const v = extractInvoicePaymentDays(text);
    if (v !== null) additions.push({ key: "commercials.payment_days", value: v });
  }
  if (!seen.has("clauses.non_poaching.duration_months")) {
    const v = extractNonPoachingDurationMonths(text);
    if (v !== null) {
      additions.push({ key: "clauses.non_poaching.duration_months", value: v });
      if (!seen.has("clauses.non_poaching.enabled")) {
        additions.push({ key: "clauses.non_poaching.enabled", value: true });
      }
    }
  }

  return [...kv, ...additions];
}

/**
 * Validate every KV pair against the ontology; drop invalid pairs and log them.
 */
async function validatePairs(pairs: ExtractedKv[], proposalName: string): Promise<ExtractedKv[]> {
  const valid: ExtractedKv[] = [];
  for (const p of pairs) {
    const result = await validateKeyValue(p.key, p.value);
    if (result.ok) {
      valid.push(p);
    } else {
      console.warn(`[kvExtractor] Dropping invalid KV for ${proposalName}: ${result.reason}`);
    }
  }
  return valid;
}

/**
 * Core extraction logic shared by both MD and PDF paths.
 * Receives the file name and already-decoded plain text.
 */
async function runExtraction(fileName: string, text: string): Promise<ExtractedProposal | null> {
  const extractor = REGISTERED_EXTRACTORS.find((e) => e.matches(fileName, text));
  if (!extractor) {
    console.warn(`[kvExtractor] No registered extractor for ${fileName} — skipping.`);
    return null;
  }

  const baseKv = extractor.extract(text);
  const heuristicKv = applyHeuristics(text, baseKv);
  const validKv = await validatePairs(heuristicKv, extractor.proposalName);

  return {
    fileName,
    proposalName: extractor.proposalName,
    rawText: normalizeWhitespace(text),
    kvPairs: validKv
  };
}

/**
 * Extract all atomic KV pairs from a single markdown proposal file.
 */
export async function extractFromMarkdownFile(filePath: string): Promise<ExtractedProposal | null> {
  const fileName = nodePath.basename(filePath);
  const rawText = await fs.readFile(filePath, "utf8");
  return runExtraction(fileName, stripMarkdown(rawText));
}

/**
 * Extract all atomic KV pairs from a single PDF proposal file.
 * Uses pdf-parse to get the raw text, then runs the same dispatcher
 * and heuristics used for markdown files.
 */
export async function extractFromPdfFile(filePath: string): Promise<ExtractedProposal | null> {
  const fileName = nodePath.basename(filePath);
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  return runExtraction(fileName, normalizeWhitespace(parsed.text));
}

/**
 * Extract atomic KV pairs from every .md and .pdf file in the given directory.
 */
export async function extractAllProposals(proposalsDir: string): Promise<ExtractedProposal[]> {
  const entries = await fs.readdir(proposalsDir, { withFileTypes: true });
  const proposalFiles = entries
    .filter((e) => {
      if (!e.isFile()) return false;
      const ext = nodePath.extname(e.name).toLowerCase();
      return ext === ".md" || ext === ".pdf";
    })
    .map((e) => nodePath.join(proposalsDir, e.name));

  const results: ExtractedProposal[] = [];
  for (const filePath of proposalFiles) {
    const ext = nodePath.extname(filePath).toLowerCase();
    const extracted = ext === ".pdf"
      ? await extractFromPdfFile(filePath)
      : await extractFromMarkdownFile(filePath);
    if (extracted) results.push(extracted);
  }
  return results;
}
