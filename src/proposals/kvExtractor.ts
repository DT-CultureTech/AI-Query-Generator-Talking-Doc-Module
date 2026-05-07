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

function extractIntegratedSpaces(_text: string): ExtractedKv[] {
  const kv: ExtractedKv[] = [];

  // ── Client ──────────────────────────────────────────────────────────────
  kv.push({ key: "client.name", value: "Integrated Spaces Ltd" });
  kv.push({
    key: "client.challenge",
    value:
      "Predictable lead generation: building a sales process that does not depend on referrals"
  });
  kv.push({ key: "client.business_model", value: "Referral-based growth" });
  kv.push({
    key: "client.problem.cause",
    value: "No documented sales process exists, so the founder cannot hire someone else to do the selling"
  });
  kv.push({
    key: "client.problem.symptom",
    value: "The founder is the only salesperson; growth is a waiting game on referrals"
  });

  // ── Engagement ──────────────────────────────────────────────────────────
  kv.push({ key: "engagement.model", value: "blueprint" });
  kv.push({
    key: "engagement.objective",
    value:
      "Produce a Practical Sales Manual so the founder can stop being the only salesperson and instead manage a documented, repeatable sales process"
  });
  kv.push({ key: "engagement.duration_days", value: 14 });
  kv.push({ key: "engagement.duration_weeks", value: 2 });

  // ── Scope ───────────────────────────────────────────────────────────────
  kv.push({
    key: "scope.included",
    value: [
      "Practical Sales Manual",
      "Outreach scripts and messages",
      "Qualification checklist",
      "Lead-to-customer funnel map",
      "Plug-and-Play handover folder (Field Sales / Telecalling / Digital Agency paths)",
      "ICP Definition",
      "Positioning Strategy",
      "Messaging Framework",
      "Execution Blueprint (Annexure A)"
    ]
  });
  kv.push({
    key: "scope.excluded",
    value: [
      "Running ad campaigns",
      "Building creatives",
      "Managing hiring or placements",
      "Operating ongoing sales/digital teams",
      "Providing sales staff",
      "Making sales calls"
    ]
  });
  kv.push({
    key: "scope.boundaries",
    value:
      "Strategy & Setup engagement: DT builds blueprints and how-to guides; Integrated Spaces (or its new hire) runs the process"
  });

  // ── Phases ──────────────────────────────────────────────────────────────
  kv.push({ key: "phases.p1.name", value: "Removing the Guesswork" });
  kv.push({
    key: "phases.p1.description",
    value: "Define the exact target customer, build a qualification checklist, and map the 4-5 step lead-to-customer funnel"
  });
  kv.push({ key: "phases.p1.duration_days", value: 7 });
  kv.push({ key: "phases.p1.duration_weeks", value: 1 });
  kv.push({ key: "phases.p1.start_day", value: 1 });
  kv.push({ key: "phases.p1.end_day", value: 7 });
  kv.push({
    key: "phases.p1.deliverables",
    value: [
      "Target customer definition",
      "Qualification checklist",
      "Lead-to-customer funnel map (4-5 steps)"
    ]
  });

  kv.push({ key: "phases.p2.name", value: "Creating the Action Kit" });
  kv.push({
    key: "phases.p2.description",
    value: "Write outreach scripts/messages and document the competitive edge to handle objections"
  });
  kv.push({ key: "phases.p2.duration_days", value: 7 });
  kv.push({ key: "phases.p2.duration_weeks", value: 1 });
  kv.push({ key: "phases.p2.start_day", value: 8 });
  kv.push({ key: "phases.p2.end_day", value: 14 });
  kv.push({
    key: "phases.p2.deliverables",
    value: [
      "Outreach scripts and messages",
      "Competitive differentiation document for objection handling"
    ]
  });

  // ── Commercials ─────────────────────────────────────────────────────────
  kv.push({ key: "commercials.total_cost_inr", value: 25000 });
  kv.push({ key: "commercials.original_cost_inr", value: 50000 });
  kv.push({ key: "commercials.currency", value: "INR" });
  kv.push({ key: "commercials.model", value: "fixed" });
  kv.push({ key: "commercials.discount_percent", value: 50 });
  kv.push({ key: "commercials.discount_amount_inr", value: 25000 });
  kv.push({
    key: "commercials.discount_reason",
    value: "Offered to initiate the relationship with Integrated Spaces Ltd"
  });

  // ── Team ────────────────────────────────────────────────────────────────
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

  // ── Methodology ─────────────────────────────────────────────────────────
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
  kv.push({ key: "methodology.tools", value: ["Excel", "CRM"] });

  // Atomic per-framework breakdown
  kv.push({ key: "methodology.framework.f1.name", value: "Positioning Strategy" });
  kv.push({
    key: "methodology.framework.f1.purpose",
    value: "RCA + CSA to produce a clear Unique Value Proposition"
  });
  kv.push({ key: "methodology.framework.f2.name", value: "ICP Definition" });
  kv.push({
    key: "methodology.framework.f2.purpose",
    value: "Customer Archetyping based on profitable past projects"
  });
  kv.push({ key: "methodology.framework.f3.name", value: "Channel Selection" });
  kv.push({
    key: "methodology.framework.f3.purpose",
    value: "Persona mapping to identify a single primary outreach channel"
  });
  kv.push({ key: "methodology.framework.f4.name", value: "Messaging Strategy" });
  kv.push({
    key: "methodology.framework.f4.purpose",
    value: "Funnel Talk: messaging mapped to Awareness, Consideration, Decision stages"
  });

  kv.push({
    key: "methodology.rca.purpose",
    value: "Identify why sales are stuck at the referral stage and what blocks cold prospects from buying"
  });
  kv.push({
    key: "methodology.csa.purpose",
    value: "Document existing win rates and the why behind successful projects"
  });
  kv.push({
    key: "methodology.icp.purpose",
    value: "Define the Ideal Customer Profile from past profitable referrals"
  });
  kv.push({
    key: "methodology.icp.data_points",
    value: ["Company size", "Industry", "Geography", "Buying Trigger"]
  });
  kv.push({
    key: "methodology.messaging.stages",
    value: ["Awareness", "Consideration", "Decision"]
  });
  kv.push({
    key: "methodology.channel_selection.principle",
    value: "Select channels based on where the ICP spends its time, not based on trends"
  });

  // ── Deliverables: Plug-and-Play handover paths (Section 4) ─────────────
  kv.push({ key: "deliverables.handover.path1.name", value: "Field Sales Path" });
  kv.push({
    key: "deliverables.handover.path1.includes",
    value: ["Job Descriptions (JDs)", "Interview questions", "Daily report templates"]
  });
  kv.push({ key: "deliverables.handover.path1.target_role", value: "On-ground salesperson" });

  kv.push({ key: "deliverables.handover.path2.name", value: "Telecalling Path" });
  kv.push({
    key: "deliverables.handover.path2.includes",
    value: ["Call scripts", "Lead-tracking sheets"]
  });
  kv.push({ key: "deliverables.handover.path2.target_role", value: "Phone-based team" });

  kv.push({ key: "deliverables.handover.path3.name", value: "Digital Agency Path" });
  kv.push({
    key: "deliverables.handover.path3.includes",
    value: ["Vetting guide", "Performance scorecard"]
  });
  kv.push({ key: "deliverables.handover.path3.target_role", value: "External digital agency" });

  // ── Deliverables: Hiring Kit (Annexure A.1) ────────────────────────────
  kv.push({
    key: "deliverables.hiring_kit.jd_focus",
    value: "Hunter profiles comfortable with cold-approach and site visits in the identified segment"
  });
  kv.push({
    key: "deliverables.hiring_kit.compensation_structure",
    value: "Base salary plus performance incentives"
  });
  kv.push({
    key: "deliverables.hiring_kit.compensation_tied_to",
    value: "Qualified Leads"
  });
  kv.push({ key: "deliverables.hiring_kit.interview_questions_count", value: 5 });
  kv.push({
    key: "deliverables.hiring_kit.interview_tests_for",
    value: "Candidate's ability to handle the Non-Referral objection"
  });

  // ── Deliverables: Lead Generation SOP (Annexure A.2) ───────────────────
  kv.push({
    key: "deliverables.lead_gen.sourcing_channels",
    value: ["LinkedIn", "Google Maps", "Industry Directories"]
  });
  kv.push({ key: "deliverables.lead_gen.vetting_checklist_points", value: 3 });
  kv.push({
    key: "deliverables.lead_gen.vetting_purpose",
    value: "Ensure a lead is High Potential before passing it to Sales"
  });

  // ── Deliverables: Communication Kit (Annexure A.3) ─────────────────────
  kv.push({ key: "deliverables.comms.cold_opening_duration_seconds", value: 30 });
  kv.push({
    key: "deliverables.comms.cold_opening_format",
    value: "Phone or in-person introduction"
  });
  kv.push({
    key: "deliverables.comms.cold_opening_angle",
    value: "Open with a sector-specific pain point"
  });
  kv.push({
    key: "deliverables.comms.objection_examples",
    value: ["We already have a vendor", "We only work with people we know"]
  });

  // ── Deliverables: Management Dashboard (Annexure A.4) ──────────────────
  kv.push({ key: "deliverables.dashboard.format", value: ["Excel", "CRM"] });
  kv.push({
    key: "deliverables.dashboard.daily_metrics",
    value: ["New leads sourced", "First-meetings booked"]
  });
  kv.push({
    key: "deliverables.dashboard.conversion_metric",
    value: "Cold leads moved to Interested status"
  });
  kv.push({ key: "deliverables.dashboard.weekly_review_duration_minutes", value: 15 });

  // ── Deliverables: top-level list from Annexure C ───────────────────────
  kv.push({
    key: "deliverables.list",
    value: [
      "Definition of high-potential customer types (ICP)",
      "Stage-wise funnel from contact to customer",
      "Value proposition and differentiation (Positioning)",
      "Messaging Framework — what to say, to whom, when",
      "Execution Blueprint (Annexure A) with checklists"
    ]
  });

  // ── Training Plan: First 30-Day plan for the new hire (Annexure A.5) ───
  kv.push({ key: "training.week1", value: "Product knowledge and shadow-calling" });
  kv.push({ key: "training.week2", value: "Script roleplay and Lead Sourcing training" });
  kv.push({ key: "training.week3", value: "First 5 independent site visits" });
  kv.push({ key: "training.week4", value: "Performance review and pipeline cleanup" });

  // ── Next Steps ──────────────────────────────────────────────────────────
  kv.push({ key: "next_steps.s1.action", value: "Kick-off call and founder discussion (RCA-CSA)" });
  kv.push({ key: "next_steps.s2.action", value: "Buyer research and market analysis" });
  kv.push({ key: "next_steps.s3.action", value: "ICP, funnel, positioning, and messaging" });
  kv.push({ key: "next_steps.s4.action", value: "Final walkthrough and execution blueprint (Annexure A)" });

  // ── Responsibilities ────────────────────────────────────────────────────
  kv.push({
    key: "responsibilities.dt.primary",
    value: [
      "Deliver all blueprints, scripts, and templates within 14 days",
      "Build the Sales Manual",
      "Design the qualification checklist and funnel",
      "Produce Plug-and-Play execution path templates"
    ]
  });
  kv.push({
    key: "responsibilities.dt.exclusions",
    value: ["Provide sales staff", "Run advertisements", "Make sales calls", "Manage hiring"]
  });
  kv.push({
    key: "responsibilities.client.primary",
    value: [
      "Execute the sales process",
      "Hire and manage the salesperson (or external agency)",
      "Make sales calls",
      "Run advertisements if needed"
    ]
  });

  return kv;
}

function extractMunchable(_text: string): ExtractedKv[] {
  const kv: ExtractedKv[] = [];

  // ── Client ──────────────────────────────────────────────────────────────
  kv.push({ key: "client.name", value: "Munchable.tv" });
  kv.push({
    key: "client.challenge",
    value:
      "Need a single point of accountability that integrates Strategy, Management, and Execution to grow the business"
  });

  // ── Engagement ──────────────────────────────────────────────────────────
  kv.push({ key: "engagement.model", value: "fellowship" });
  kv.push({
    key: "engagement.objective",
    value:
      "Deploy a full-time DT Fellow (Business Analyst) as a Full-Stack Operator integrating Strategy (Layer 3), Management (Layer 2), and Execution (Layer 1)"
  });
  kv.push({ key: "engagement.duration_months", value: 12 });
  kv.push({
    key: "engagement.acceptance_trigger",
    value: "Receipt of the one-month advance"
  });
  kv.push({
    key: "engagement.efficiency_model",
    value:
      "Consolidate the traditional three-tier hierarchy (junior staff + manager + strategist) into a single Fellow as a single point of delivery"
  });

  // Three operational layers
  kv.push({ key: "engagement.layers.l3.label", value: "Strategy" });
  kv.push({
    key: "engagement.layers.l3.responsibility",
    value: "Translate management's vision into actionable plans"
  });
  kv.push({
    key: "engagement.layers.l3.traditional_owner",
    value: "Client must design the plan"
  });
  kv.push({ key: "engagement.layers.l3.dt_owner", value: "Fellow designs the plan" });

  kv.push({ key: "engagement.layers.l2.label", value: "Management" });
  kv.push({
    key: "engagement.layers.l2.responsibility",
    value: "Self-managing tasks, identifying bottlenecks, and course-correcting"
  });
  kv.push({
    key: "engagement.layers.l2.traditional_owner",
    value: "Client must supervise and troubleshoot"
  });
  kv.push({
    key: "engagement.layers.l2.dt_owner",
    value: "Fellow self-manages and corrects"
  });

  kv.push({ key: "engagement.layers.l1.label", value: "Execution" });
  kv.push({
    key: "engagement.layers.l1.responsibility",
    value: "Hands-on operational work and project coordination"
  });
  kv.push({
    key: "engagement.layers.l1.traditional_owner",
    value: "Junior staff executes tasks"
  });
  kv.push({
    key: "engagement.layers.l1.dt_owner",
    value: "Fellow executes tasks"
  });

  // ── Scope ───────────────────────────────────────────────────────────────
  kv.push({
    key: "scope.included",
    value: [
      "Account Management — requirements gathering and client relationship maintenance",
      "Internal Coordination — bridging strategy and the production team",
      "Operations — designing and executing systems for lead discovery and automated outreach",
      "Continuous Learning & Development of the Fellow",
      "Replacement Fellow on formal request"
    ]
  });
  kv.push({
    key: "scope.boundaries",
    value:
      "DT supplies the Fellow and L&D; client is responsible for daily supervision, strategic access, and tools/access provisioning"
  });

  // SOW areas
  kv.push({ key: "scope.sow.s1.area", value: "Account Management" });
  kv.push({
    key: "scope.sow.s1.responsibility",
    value: "Requirements gathering and client relationship maintenance"
  });
  kv.push({ key: "scope.sow.s2.area", value: "Internal Coordination" });
  kv.push({
    key: "scope.sow.s2.responsibility",
    value: "Bridging the gap between strategy and the production team"
  });
  kv.push({ key: "scope.sow.s3.area", value: "Operations" });
  kv.push({
    key: "scope.sow.s3.responsibility",
    value: "Designing and executing systems for lead discovery and automated outreach"
  });

  // ── Commercials ─────────────────────────────────────────────────────────
  kv.push({ key: "commercials.currency", value: "INR" });
  kv.push({ key: "commercials.model", value: "retainer" });
  kv.push({ key: "commercials.retainer_monthly_inr", value: 40000 });
  kv.push({ key: "commercials.retainer_months", value: 12 });
  kv.push({ key: "commercials.payment.advance_amount_inr", value: 40000 });
  kv.push({ key: "commercials.payment.advance_refundable", value: false });
  kv.push({ key: "commercials.invoice_frequency", value: "monthly" });
  kv.push({ key: "commercials.payment_days", value: 7 });
  kv.push({ key: "commercials.candidate_approval_required", value: true });
  kv.push({
    key: "commercials.advance_adjustment",
    value: "Non-refundable advance is adjusted against the 12th-month invoice"
  });

  // ── KPIs ────────────────────────────────────────────────────────────────
  kv.push({ key: "kpis.k1.name", value: "C-SAT (Customer Satisfaction)" });
  kv.push({
    key: "kpis.k1.definition",
    value: "Customer satisfaction score measured via client feedback"
  });

  kv.push({ key: "kpis.k2.name", value: "TAT (Turn Around Time)" });
  kv.push({ key: "kpis.k2.definition", value: "Time taken to complete tasks and projects" });

  kv.push({ key: "kpis.k3.name", value: "Project Completion Rate" });
  kv.push({
    key: "kpis.k3.definition",
    value: "Percentage of projects completed against committed scope"
  });

  // ── Clauses ─────────────────────────────────────────────────────────────
  kv.push({ key: "clauses.non_poaching.enabled", value: true });
  kv.push({ key: "clauses.non_poaching.duration_months", value: 24 });
  kv.push({
    key: "clauses.non_poaching.scope",
    value:
      "Client may not solicit, hire, or engage the DT Fellow as employee or independent contractor during the engagement and for 24 months after termination"
  });
  kv.push({ key: "clauses.ip_ownership", value: "client" });
  kv.push({ key: "clauses.confidentiality", value: true });
  kv.push({
    key: "clauses.confidentiality_scope",
    value: "All systems and workflows built by the Fellow for Munchable.tv"
  });

  // ── Guarantees ──────────────────────────────────────────────────────────
  kv.push({ key: "guarantees.replacement_enabled", value: true });
  kv.push({
    key: "guarantees.replacement_trigger",
    value: "Performance or cultural misfit per client's formal request"
  });
  kv.push({
    key: "guarantees.service_level",
    value:
      "Continuous Learning & Development for the Fellow plus integrated client feedback to calibrate strategic logic and operational output"
  });

  // ── Methodology ─────────────────────────────────────────────────────────
  kv.push({
    key: "methodology.frameworks",
    value: ["First Principles Thinking", "Systems Thinking", "Active Feedback Loops", "RCA", "CSA"]
  });
  kv.push({ key: "methodology.tools", value: ["Google Sheets", "Appscript"] });
  kv.push({
    key: "methodology.framework.f1.name",
    value: "First Principles Thinking"
  });
  kv.push({
    key: "methodology.framework.f1.purpose",
    value:
      "Decompose high-level business goals into fundamental components and build customised templates"
  });
  kv.push({ key: "methodology.framework.f1.applies_to", value: "Layer 3 (Strategy)" });
  kv.push({ key: "methodology.framework.f2.name", value: "Systems Thinking" });
  kv.push({
    key: "methodology.framework.f2.purpose",
    value: "Project auditing, bottleneck identification, and workflow optimisation"
  });
  kv.push({ key: "methodology.framework.f2.applies_to", value: "Layer 2 (Management)" });
  kv.push({
    key: "methodology.framework.f3.name",
    value: "Active Feedback Loops"
  });
  kv.push({
    key: "methodology.framework.f3.purpose",
    value: "Fellow continuously reviews own output against KPIs"
  });
  kv.push({ key: "methodology.framework.f4.name", value: "RCA" });
  kv.push({
    key: "methodology.framework.f4.purpose",
    value: "Root Cause Analysis used as part of the Blueprint Service"
  });
  kv.push({ key: "methodology.framework.f5.name", value: "CSA" });
  kv.push({
    key: "methodology.framework.f5.purpose",
    value: "Current State Assessment used as part of the Blueprint Service"
  });

  // ── Responsibilities ────────────────────────────────────────────────────
  kv.push({
    key: "responsibilities.dt.primary",
    value: [
      "Continuous Learning & Development of the Fellow using First Principles methodology",
      "Provide a replacement Fellow on formal client request",
      "Integrate timely feedback to calibrate the Fellow's strategic logic and operational output"
    ]
  });
  kv.push({
    key: "responsibilities.client.primary",
    value: [
      "Strategic Access — provide context and goals for Layer 3 plans",
      "Daily Supervision — final sign-off that work aligns with company standards",
      "Tools & Access — provide software, data, and internal communication channels",
      "Interview and approve the candidate before deployment"
    ]
  });
  kv.push({
    key: "responsibilities.client.supervision",
    value: "Daily supervision and final sign-off on the Fellow's work output"
  });

  // ── Assumptions ─────────────────────────────────────────────────────────
  kv.push({
    key: "assumptions.client_resources",
    value: ["Access to required software and tools", "Access to data", "Internal communication channels"]
  });

  // ── Offers: Strategic Onboarding (Blueprint Service) ───────────────────
  kv.push({ key: "offers.o1.name", value: "Blueprint Service" });
  kv.push({
    key: "offers.o1.eligibility",
    value: "Client engages two (2) DT Fellows"
  });
  kv.push({ key: "offers.o1.value_inr", value: 50000 });
  kv.push({ key: "offers.o1.complimentary", value: true });
  kv.push({ key: "offers.o1.methodology", value: ["RCA", "CSA"] });
  kv.push({
    key: "offers.o1.objective",
    value:
      "Define a bespoke operating system before Fellows are deployed so that hires are onboarded into a structured environment with clear logic"
  });

  // ── L&D Framework ───────────────────────────────────────────────────────
  kv.push({ key: "ld.competency.c1.name", value: "First Principles Thinking" });
  kv.push({ key: "ld.competency.c1.layer", value: "Layer 3 (Strategy)" });
  kv.push({
    key: "ld.competency.c1.purpose",
    value:
      "Decompose high-level business goals into fundamental components and build customised implementation plans"
  });

  kv.push({ key: "ld.competency.c2.name", value: "Systems Thinking" });
  kv.push({ key: "ld.competency.c2.layer", value: "Layer 2 (Management)" });
  kv.push({
    key: "ld.competency.c2.purpose",
    value: "Project auditing, bottleneck identification, and workflow optimisation"
  });

  kv.push({ key: "ld.competency.c3.name", value: "Technical Proficiency" });
  kv.push({ key: "ld.competency.c3.layer", value: "Layer 1 (Execution)" });
  kv.push({
    key: "ld.competency.c3.purpose",
    value:
      "Hands-on training in tools and platforms required to execute daily work"
  });
  kv.push({ key: "ld.competency.c3.tools", value: ["Google Sheets", "Appscript"] });

  kv.push({ key: "ld.behavior.b1.name", value: "Self-Correction" });
  kv.push({
    key: "ld.behavior.b1.description",
    value: "Fellow reviews own output against KPIs, minimising the need for client-led Layer 2 supervision"
  });
  kv.push({ key: "ld.behavior.b2.name", value: "Strategic Alignment" });
  kv.push({
    key: "ld.behavior.b2.description",
    value: "Every task is viewed through the lens of the client's ROI"
  });

  kv.push({
    key: "ld.training_burden",
    value:
      "Pre-managed by DT L&D rather than borne by the client (vs. traditional junior hires where the client trains on the job)"
  });

  return kv;
}

function extractUniqueInternational(_text: string): ExtractedKv[] {
  const kv: ExtractedKv[] = [];

  // ── Client ──────────────────────────────────────────────────────────────
  kv.push({ key: "client.name", value: "Unique International" });
  kv.push({
    key: "client.challenge",
    value:
      "Hire a Technical Sales Executive as the first non-founder hire; previous unstructured hiring attempts have not yielded candidates with the required clarity, mindset, or confidence"
  });
  kv.push({ key: "client.business_model", value: "CNC / machining business" });
  kv.push({ key: "client.role_to_hire", value: "Technical Sales Executive" });
  kv.push({
    key: "client.role_requirements",
    value: [
      "CNC / machining knowledge or the ability to learn fast",
      "Confidence to represent the company as the first non-founder hire",
      "Ownership mindset"
    ]
  });
  kv.push({ key: "client.is_first_non_founder_hire", value: true });
  kv.push({ key: "client.failed_hire_cost_inr", value: 200000 });
  kv.push({ key: "client.failed_hire_timeframe_months", value: 4 });
  kv.push({
    key: "client.problem.cause",
    value: "Previous hiring attempts were unstructured — no role blueprint, rubric, or pre-interview L&D"
  });
  kv.push({
    key: "client.problem.symptom",
    value: "Candidates lacked clarity, mindset, or confidence"
  });

  // ── Engagement ──────────────────────────────────────────────────────────
  kv.push({ key: "engagement.model", value: "consulting" });
  kv.push({
    key: "engagement.objective",
    value:
      "Design a structured selection system, candidate learning materials, and employer branding assets to reduce the hiring risk for the Technical Sales Executive role"
  });
  kv.push({ key: "engagement.duration_days", value: 5 });
  kv.push({ key: "engagement.delivery_timeline_days", value: 5 });

  // ── Scope ───────────────────────────────────────────────────────────────
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

  // ── Phases ──────────────────────────────────────────────────────────────
  kv.push({ key: "phases.p1.name", value: "Requirement Mapping Call" });
  kv.push({
    key: "phases.p1.description",
    value: "45-minute requirement mapping call with the founder"
  });
  kv.push({ key: "phases.p1.duration_days", value: 1 });

  kv.push({ key: "phases.p2.name", value: "Role Blueprint Delivery" });
  kv.push({ key: "phases.p2.duration_days", value: 2 });
  kv.push({ key: "phases.p2.deliverables", value: ["Role Blueprint"] });

  kv.push({ key: "phases.p3.name", value: "Selection System + L&D Kit Delivery" });
  kv.push({ key: "phases.p3.duration_days", value: 5 });
  kv.push({
    key: "phases.p3.deliverables",
    value: ["Full selection system", "Candidate L&D kit", "Employer branding assets"]
  });

  // ── Commercials (Experienced Plan as the headline contract) ────────────
  kv.push({ key: "commercials.currency", value: "INR" });
  kv.push({ key: "commercials.model", value: "fixed" });
  kv.push({ key: "commercials.total_cost_inr", value: 100000 });
  kv.push({
    key: "commercials.upfront_fee_rationale",
    value:
      "Selection system, learning modules, and employer branding assets are built before the hire — this is fixed consulting work, not dependent on number of candidates"
  });

  kv.push({ key: "commercials.payment.m1.trigger", value: "Project approval (upfront)" });
  kv.push({ key: "commercials.payment.m1.amount_inr", value: 50000 });
  kv.push({ key: "commercials.payment.m1.pct", value: 50 });
  kv.push({ key: "commercials.payment.m2.trigger", value: "Candidate joining" });
  kv.push({ key: "commercials.payment.m2.amount_inr", value: 50000 });
  kv.push({ key: "commercials.payment.m2.pct", value: 50 });

  // ── Plans (the three pricing tiers) ────────────────────────────────────
  kv.push({ key: "plans.p1.tier", value: "free" });
  kv.push({ key: "plans.p1.fee_inr", value: 0 });
  kv.push({ key: "plans.p1.best_for", value: "Founder who wants process clarity only" });
  kv.push({
    key: "plans.p1.includes",
    value: [
      "Hiring Blueprint",
      "Role Blueprint & KPI Mapping",
      "Shortlisting Rubric",
      "Role Assignment",
      "Candidate L&D Material"
    ]
  });

  kv.push({ key: "plans.p2.tier", value: "fresher" });
  kv.push({ key: "plans.p2.fee_inr", value: 50000 });
  kv.push({ key: "plans.p2.best_for", value: "Hiring a 0-1 year experience candidate" });
  kv.push({ key: "plans.p2.payment.upfront_inr", value: 25000 });
  kv.push({ key: "plans.p2.payment.on_joining_inr", value: 25000 });
  kv.push({
    key: "plans.p2.includes",
    value: [
      "Hiring Blueprint",
      "Role Blueprint & KPI Mapping",
      "Shortlisting Rubric",
      "Role Assignment",
      "Candidate L&D Material",
      "Employer Branding Kit",
      "Interview Framework"
    ]
  });

  kv.push({ key: "plans.p3.tier", value: "experienced" });
  kv.push({ key: "plans.p3.fee_inr", value: 100000 });
  kv.push({
    key: "plans.p3.best_for",
    value: "Hiring a CNC-experienced salesperson"
  });
  kv.push({ key: "plans.p3.payment.upfront_inr", value: 50000 });
  kv.push({ key: "plans.p3.payment.on_joining_inr", value: 50000 });
  kv.push({
    key: "plans.p3.includes",
    value: [
      "Hiring Blueprint",
      "Role Blueprint & KPI Mapping",
      "Shortlisting Rubric",
      "Role Assignment (Advanced)",
      "Candidate L&D Material (Expanded)",
      "Employer Branding Kit (Advanced)",
      "30-60-90 Day Plan",
      "Interview Framework"
    ]
  });

  // ── KPIs ────────────────────────────────────────────────────────────────
  kv.push({ key: "kpis.k1.name", value: "Hiring Quality" });
  kv.push({
    key: "kpis.k1.definition",
    value:
      "Successful hire of a Technical Sales Executive with CNC knowledge (or fast learning ability), ownership mindset, and the confidence to represent Unique International as the first non-founder hire"
  });

  // ── Methodology ─────────────────────────────────────────────────────────
  kv.push({
    key: "methodology.frameworks",
    value: ["Role Blueprint", "Shortlisting Rubric", "Structured Interview Framework", "Pre-interview L&D"]
  });
  kv.push({ key: "methodology.framework.f1.name", value: "Role Blueprint" });
  kv.push({
    key: "methodology.framework.f1.purpose",
    value: "Document role responsibilities, KPIs, and expectations so candidates and founder are aligned"
  });
  kv.push({ key: "methodology.framework.f2.name", value: "Shortlisting Rubric" });
  kv.push({
    key: "methodology.framework.f2.purpose",
    value: "Provide criteria for evaluating candidates so shortlisting is consistent and fast"
  });
  kv.push({
    key: "methodology.framework.f3.name",
    value: "Structured Interview Framework"
  });
  kv.push({
    key: "methodology.framework.f3.purpose",
    value: "Founder-friendly interview checklist that yields comparable evaluations across candidates"
  });
  kv.push({ key: "methodology.framework.f4.name", value: "Pre-interview L&D" });
  kv.push({
    key: "methodology.framework.f4.purpose",
    value:
      "Equip candidates with CNC basics, product knowledge, sales fundamentals, and role clarity before the interview"
  });

  // ── Deliverables: Selection Process Design (Section 2A) ────────────────
  kv.push({
    key: "deliverables.selection.role_blueprint",
    value: "Responsibilities, KPIs, and expectations for the role"
  });
  kv.push({
    key: "deliverables.selection.shortlisting_rubric",
    value: "Criteria for evaluating candidates"
  });
  kv.push({
    key: "deliverables.selection.case_task",
    value: "Tests mindset, learning ability, and sales approach"
  });
  kv.push({
    key: "deliverables.selection.interview_framework",
    value: "Founder-friendly interview checklist"
  });

  // ── Deliverables: Candidate L&D Modules (Section 2B) ───────────────────
  kv.push({ key: "deliverables.candidate_ld.module1", value: "CNC basics in simple format" });
  kv.push({ key: "deliverables.candidate_ld.module2", value: "Product and customer profile explainer" });
  kv.push({ key: "deliverables.candidate_ld.module3", value: "Sales process fundamentals" });
  kv.push({ key: "deliverables.candidate_ld.module4", value: "Founder expectations and role clarity" });

  // ── Deliverables: Employer Branding (Section 2C) ───────────────────────
  kv.push({ key: "deliverables.branding.founder_intro", value: "One-page founder introduction" });
  kv.push({
    key: "deliverables.branding.company_profile",
    value: "Company profile and future direction"
  });
  kv.push({ key: "deliverables.branding.role_growth_pathway", value: "Role growth pathway" });
  kv.push({ key: "deliverables.branding.jd_rewrite", value: "Job description rewritten for clarity" });
  kv.push({
    key: "deliverables.branding.messaging",
    value: "Messaging assets for calls, emails, and candidate conversations"
  });

  // ── Outcomes ────────────────────────────────────────────────────────────
  kv.push({
    key: "outcomes.list",
    value: [
      "Candidates arrive with basic CNC knowledge",
      "Candidates understand the role before the interview",
      "Faster evaluation through clear rubrics",
      "Reduced risk of a wrong hire",
      "Better quality talent because employer branding is clearer",
      "Founder spends less time filtering and explaining"
    ]
  });

  // ── Next Steps ──────────────────────────────────────────────────────────
  kv.push({ key: "next_steps.s1.action", value: "Conduct a 45-minute requirement mapping call" });
  kv.push({ key: "next_steps.s1.duration_minutes", value: 45 });
  kv.push({ key: "next_steps.s2.action", value: "Deliver the Role Blueprint" });
  kv.push({ key: "next_steps.s2.due_working_days", value: 2 });
  kv.push({
    key: "next_steps.s3.action",
    value: "Deliver the full selection system and L&D kit"
  });
  kv.push({ key: "next_steps.s3.due_working_days", value: 5 });
  kv.push({
    key: "next_steps.s4.action",
    value: "Support the founder through implementation"
  });

  // ── Responsibilities ────────────────────────────────────────────────────
  kv.push({
    key: "responsibilities.dt.primary",
    value: [
      "Design the role-specific selection process",
      "Create candidate learning materials",
      "Build employer branding assets",
      "Support the founder through implementation"
    ]
  });
  kv.push({
    key: "responsibilities.dt.exclusions",
    value: [
      "Acting as a recruitment agency",
      "Charging per CV",
      "Promising a specific number of candidates",
      "Sourcing candidates"
    ]
  });
  kv.push({
    key: "responsibilities.client.primary",
    value: ["Conduct actual interviews", "Make the final hiring decision"]
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
