import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import type { OllamaClient } from "../llm/ollamaClient.js";
import type { RagAnswer } from "./types.js";
import {
  searchKvByPrefix,
  storeKvPairs,
  resolveProposalsFromQuestion,
  type KvRow,
  type ProposalRow
} from "./kvStore.js";
import { validateKeyValue, type AtomicValue } from "./ontology.js";
import { extractAllProposals } from "./kvExtractor.js";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ─────────────────────────────────────────────────────────────────

const FACT_RESOLVE_MAX_TOKENS = 80;
const ANSWER_MAX_TOKENS = 160;
const ENRICHMENT_MAX_TOKENS = 220;

const NO_INFO_REPLY = "The proposal does not specify this.";

// Resolve project root for in-memory fallback
const _ragFile = fileURLToPath(import.meta.url);
const _ragDir = nodePath.dirname(_ragFile);
const _projectRoot = nodePath.resolve(_ragDir, "../..");

function resolveProposalsDir(proposalsDir: string): string {
  return nodePath.isAbsolute(proposalsDir)
    ? proposalsDir
    : nodePath.resolve(_projectRoot, proposalsDir);
}

// ── Step 1: Resolve which ontology categories the question needs ──────────────
//
// We resolve to ONTOLOGY CATEGORIES (e.g. "commercials", "phases", "deliverables"),
// not individual keys. A 1.5B model cannot reliably pick from 165 atomic key
// patterns, but it can reliably pick a handful of category names. Each picked
// category becomes a prefix query that retrieves every atomic fact under it,
// so the answer composer always sees ALL relevant facts.
//
// Stage A: heuristic keyword routing — handles ~80% of common questions
// without an LLM call. Stage B: LLM category resolver as a fallback.

// Patterns use `\w*` suffixes so that base keywords match common plurals
// and inflections (e.g. "kpi" → "KPIs", "outcome" → "outcomes", "phase" → "phases",
// "tool" → "tools"). Without this, `\bkpi\b` fails to match "KPIs" because
// "s" is a word character — that bug routed common questions to Stage B LLM
// (slow and prone to hallucinated category names on small models).
const CATEGORY_KEYWORDS: Record<string, RegExp[]> = {
  client: [/\b(client|compan\w*|customer\w*|who is|industry|sector|business model|problem\w*|challenge\w*|role to hire|first hire)\b/i],
  engagement: [/\b(engagement\w*|how long|fellowship|consulting|layer\w*|acceptance|begin|start)\b/i],
  scope: [/\b(scope|include[ds]?|exclude[ds]?|not included|won'?t|does not|sow|boundar\w+|what.*deliver|what.*build)\b/i],
  phases: [/\b(phase\w*|week\w*|day \d|stage\w*|sprint\w*|milestone\w*|step \d|timeline\w*|duration\w*)\b/i],
  commercials: [/\b(cost\w*|price\w*|fee\w*|payment\w*|pay\w*|invoice\w*|advance\w*|retainer\w*|discount\w*|gst|amount\w*|inr|rs\b|rupees|₹|upfront|monthly|on joining|trigger\w*|terms?|commercial\w*)\b/i],
  team: [/\b(team\w*|consultant\w*|hours?|rate\w*|allocation\w*|who works|staff|role\w*)\b/i],
  methodology: [/\b(methodology|methodologies|framework\w*|approach\w*|method\w*|process\w*|rca|csa|icp|persona\w*|systems thinking|first principles|how do you|how does|tool\w*|tooling|platform\w*|software|use\w*|using|stack)\b/i],
  assumptions: [/\b(assume\w*|assumption\w*|expect\w*|presume\w*)\b/i],
  dependencies: [/\b(depend\w*|require\w*|prerequisite\w*|need\w* from|must provide)\b/i],
  responsibilities: [/\b(responsib\w*|owner\w*|accountab\w*|who does|who handles|who is responsible|raci|role of)\b/i],
  kpis: [/\b(kpi\w*|metric\w*|measure\w*|success|target\w*|c-?sat|tat|completion rate|hiring quality)\b/i],
  clauses: [/\b(clause\w*|non-?poach\w*|poach\w*|ip|intellectual property|confidential\w*|nda|legal|cancel\w*|terminat\w*|leave|end the engagement)\b/i],
  guarantees: [/\b(guarantee\w*|replace\w*|replacement\w*|replac\w*|sla|service level|warranty|commitment\w*)\b/i],
  exit: [/\b(exit\w*|terminat\w*|cancel\w*|notice|refund\w*|disengage\w*|early end|leave)\b/i],
  deliverables: [/\b(deliver\w*|template\w*|asset\w*|kit\w*|manual\w*|plug.?and.?play|handover\w*|hiring kit|dashboard\w*|jd\w*|interview question\w*|cold opening|objection\w*|sourcing channel\w*)\b/i],
  plans: [/\b(plan\w*|tier\w*|fresher|experienced|free plan|option\w*|package\w*|pricing)\b/i],
  offers: [/\b(offer\w*|complimentary|free|bonus|blueprint service|added)\b/i],
  training: [/\b(training|train\w*|onboard\w*|first 30 day|first month|week 1|week 2|week 3|week 4)\b/i],
  ld: [/\b(l&d|ld|learning|development|self-correct\w*|technical proficiency|behaviou?r\w*|competenc\w+)\b/i],
  outcomes: [/\b(outcome\w*|result\w*|impact\w*|benefit\w*|expect\w*)\b/i],
  next_steps: [/\b(next step\w*|after|after approval|kick.?off|how do we start|what'?s next|when do|happens)\b/i]
};

const ALL_CATEGORIES = Object.keys(CATEGORY_KEYWORDS);

function resolveCategoriesByKeyword(question: string): string[] {
  // Rank categories by hit count across their patterns — most-relevant first.
  const scored: Array<{ cat: string; hits: number }> = [];
  for (const [cat, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    let hits = 0;
    for (const re of patterns) {
      const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
      const matches = question.match(new RegExp(re.source, flags));
      if (matches) hits += matches.length;
    }
    if (hits > 0) scored.push({ cat, hits });
  }
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((s) => s.cat);
}

const MAX_FACTS_PER_ANSWER = 25;

/**
 * Cap fact volume to keep the answer-composition LLM call fast.
 * Facts whose key prefix matches the most-relevant category come first.
 */
function prioritizeAndCapFacts(facts: KvRow[], rankedCategories: string[], limit = MAX_FACTS_PER_ANSWER): KvRow[] {
  if (facts.length <= limit) return facts;
  const priorityOf = (key: string): number => {
    for (let i = 0; i < rankedCategories.length; i++) {
      if (key.startsWith(rankedCategories[i] + ".")) return i;
    }
    return rankedCategories.length;
  };
  return [...facts]
    .map((f) => ({ f, p: priorityOf(f.key) }))
    .sort((a, b) => a.p - b.p)
    .slice(0, limit)
    .map((x) => x.f);
}

const CATEGORY_RESOLVER_SYSTEM = `You map a user question to PDGMS proposal categories.
Output ONLY a JSON array of category names (lowercase). No prose. No markdown.
Pick every category whose facts are needed to answer the question.

Categories:
- client: identity, role to hire, business model, challenge
- engagement: model, duration, layers, acceptance trigger
- scope: included/excluded items, SOW areas, boundaries
- phases: phase names, durations, deliverables
- commercials: cost, discount, payment, retainer, milestones, advance, invoice
- team: roles, hours, hourly rates, total cost per role
- methodology: frameworks, tools, channels, RCA/CSA, ICP, messaging
- assumptions: client resources/preconditions
- dependencies: client-supplied deliverables
- responsibilities: DT vs client primary tasks
- kpis: metrics, targets, definitions
- clauses: non-poaching, IP, confidentiality
- guarantees: replacement, SLA
- exit: notice, refund
- deliverables: detailed breakdown of every deliverable component
- plans: tiered pricing options (free/fresher/experienced)
- offers: complimentary or conditional offers
- training: per-week training plans
- ld: DT's L&D framework competencies and behaviors
- outcomes: expected outcomes / success indicators
- next_steps: post-approval steps and timelines

Output: ["category1","category2"]`;

async function identifyCategoriesViaLlm(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient
): Promise<string[]> {
  try {
    const result = await ollamaClient.generate(
      config.copilotModelName ?? config.modelName,
      CATEGORY_RESOLVER_SYSTEM,
      `Question: ${question}\n\nOutput JSON array:`,
      { maxTokens: FACT_RESOLVE_MAX_TOKENS }
    );
    const cleaned = result.output.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => typeof x === "string")
      .map((s) => s.trim().toLowerCase())
      .filter((c) => ALL_CATEGORIES.includes(c));
  } catch (err) {
    console.warn("[ragService] Category resolver LLM call failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function resolveCategories(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient
): Promise<string[]> {
  // Stage A: keyword heuristic — fast, deterministic, no LLM call
  const heuristic = resolveCategoriesByKeyword(question);
  if (heuristic.length > 0) return heuristic;

  // Stage B: small-LLM category resolver as fallback
  const llm = await identifyCategoriesViaLlm(question, config, ollamaClient);
  if (llm.length > 0) return llm;

  // Final fallback: return all categories so we fetch every fact rather than
  // give up. The answer composer will still ground the answer in stored facts.
  return ALL_CATEGORIES;
}

/** Convert categories to KV-key prefixes (e.g. "commercials" → "commercials."). */
function categoriesToPrefixes(categories: string[]): string[] {
  return categories.map((c) => `${c}.`);
}

// ── Step 2: Fetch KV pairs from store (category prefixes already cover the
//           full set; exact-key lookup is unused under the category resolver). ──

/**
 * Fetch ALL KV pairs for the proposals named in the question. Used as a
 * fallback when the LLM key-resolver returns nothing usable.
 */
async function fetchAllForProposals(pool: Pool, proposals: ProposalRow[]): Promise<KvRow[]> {
  if (proposals.length === 0) return [];
  const ids = proposals.map((p) => p.id);
  const conditions = ids.map((_, i) => `proposal_id = $${i + 1}`).join(" OR ");
  const result = await pool.query<{
    id: string;
    proposal_id: string;
    proposal_name: string;
    file_name: string;
    key: string;
    value: AtomicValue;
    source: "extracted" | "enriched";
  }>(
    `SELECT kv.id, kv.proposal_id, p.proposal_name, p.file_name, kv.key, kv.value, kv.source
     FROM proposal_kv_store kv
     JOIN proposals p ON p.id = kv.proposal_id
     WHERE ${conditions}
     ORDER BY p.proposal_name, kv.key`,
    ids
  );
  return result.rows.map((r) => ({
    id: r.id,
    proposalId: r.proposal_id,
    proposalName: r.proposal_name,
    fileName: r.file_name,
    key: r.key,
    value: r.value,
    source: r.source
  }));
}

// ── Step 3: Compose grounded answer ───────────────────────────────────────────

const ANSWER_SYSTEM = `You are PDGMS Copilot.
Answer the user's question using ONLY the supplied atomic key=value facts.

PROPOSAL SCOPING (read this first):
- The facts block is split into sections, each starting with a "# <ProposalName>" heading.
- Read the user's question and identify which proposal it asks about (e.g. "Munchable", "Munchable.tv", "Integrated Spaces", "Unique International"). A partial match counts (e.g. "Munchable" matches the "# Munchable.tv" section).
- Use facts ONLY from that one proposal's section. Ignore every fact under any other "# ..." heading, even if it looks topically similar.
- If the question does not name a proposal, use facts from all sections.

NUMBER FORMATTING (do not reformat):
- Write every number EXACTLY as it appears in the facts. Do not insert commas. Do not switch between Indian and Western digit grouping. Do not multiply, divide, or round.
- Example: if a fact says total_cost_inr = 15000, write 15000 — never 15,000 and never 1,50,000.
- Prefix with the currency only if the fact's key indicates currency (e.g. "_inr" → INR or ₹). Keep the digits unchanged.

GENERAL RULES:
- Every number, name, and date you mention must appear verbatim in a value above (after stripping commas).
- If the supplied facts cannot answer the question at all, reply with EXACTLY this and nothing else: "${NO_INFO_REPLY}"
- For arithmetic (sums, totals), compute from raw values shown.
- Do NOT invent any number, name, or detail not present in the facts.
- Be concise (2-5 sentences). No preamble. No phrases like "Based on the facts".`;

function formatFactsForPrompt(rows: KvRow[]): string {
  if (rows.length === 0) return "(no facts available)";

  // Group by proposal for readability
  const byProposal = new Map<string, KvRow[]>();
  for (const r of rows) {
    if (!byProposal.has(r.proposalName)) byProposal.set(r.proposalName, []);
    byProposal.get(r.proposalName)!.push(r);
  }

  const lines: string[] = [];
  for (const [name, items] of byProposal) {
    lines.push(`# ${name}`);
    for (const it of items) {
      const v = Array.isArray(it.value) ? JSON.stringify(it.value) : JSON.stringify(it.value);
      lines.push(`${it.key} = ${v}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function composeAnswer(
  question: string,
  facts: KvRow[],
  config: AppConfig,
  ollamaClient: OllamaClient
): Promise<string> {
  const factsBlock = formatFactsForPrompt(facts);
  const userPrompt = `Facts:
${factsBlock}

Question: ${question}

Answer:`;

  const result = await ollamaClient.generate(
    config.copilotModelName ?? config.modelName,
    ANSWER_SYSTEM,
    userPrompt,
    { maxTokens: ANSWER_MAX_TOKENS }
  );
  return validateAgainstFacts(result.output.trim(), facts);
}

/**
 * Post-validation: every number that appears in the answer must also appear
 * in at least one fact value. If a hallucinated number is detected, replace
 * it with [unverified] so the user sees the issue rather than trusting a
 * fabricated figure. Numbers <10 are allowed (often used for ordinals,
 * counts in lists, or ranges already in deliverables).
 */
function validateAgainstFacts(answer: string, facts: KvRow[]): string {
  // Collect every number that appears in any fact value (after stripping commas)
  const factNumbers = new Set<string>();
  for (const f of facts) {
    const flat = JSON.stringify(f.value);
    for (const m of flat.matchAll(/\d[\d,]*/g)) {
      factNumbers.add(m[0].replace(/,/g, ""));
    }
  }

  // Extract all numbers from the answer (with optional commas)
  return answer.replace(/\b\d[\d,]*\b/g, (match) => {
    const normalized = match.replace(/,/g, "");
    if (normalized.length <= 1) return match;     // single digits often refer to ordinals
    const asInt = parseInt(normalized, 10);
    if (Number.isFinite(asInt) && asInt < 10) return match;
    if (factNumbers.has(normalized)) return match;
    // Hallucinated number — flag it
    console.warn(`[ragService] Numeric hallucination guard: "${match}" not found in any fact value`);
    return `[unverified: ${match}]`;
  });
}

// ── Step 4: Escalation + enrichment ───────────────────────────────────────────

const ENRICHMENT_SYSTEM = `You are an extractor for the PDGMS proposal store.
Read the proposal text and answer the user's question.
Then identify any new atomic facts that should be added to the store as key=value pairs.
Each value MUST be atomic: a string, number, boolean, or array of strings/numbers — never a sentence.
Use dot-notation keys from the PDGMS Ontology.

Output STRICT JSON with this shape:
{ "answer": "...", "newFacts": [ { "key": "phases.p1.cost_inr", "value": 250000 }, ... ] }
No markdown. No prose outside JSON.`;

interface EnrichmentResult {
  answer: string;
  newFacts: Array<{ key: string; value: AtomicValue }>;
}

function safeParseEnrichmentJson(raw: string): EnrichmentResult | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (typeof parsed.answer !== "string") return null;
    const newFacts = Array.isArray(parsed.newFacts) ? parsed.newFacts : [];
    return {
      answer: parsed.answer,
      newFacts: newFacts.filter(
        (f: unknown) =>
          typeof f === "object" &&
          f !== null &&
          typeof (f as { key?: unknown }).key === "string" &&
          (f as { value?: unknown }).value !== undefined
      )
    };
  } catch {
    return null;
  }
}

async function escalateAndEnrich(
  question: string,
  proposals: ProposalRow[],
  proposalsDir: string,
  config: AppConfig,
  ollamaClient: OllamaClient,
  pool: Pool
): Promise<{ answer: string; enrichedKeys: string[] }> {
  // Load full markdown for the relevant proposals (already on disk)
  const allExtracted = await extractAllProposals(proposalsDir);
  const relevantTexts = allExtracted
    .filter((e) => proposals.some((p) => p.fileName === e.fileName))
    .map((e) => `# ${e.proposalName}\n${e.rawText.slice(0, 4000)}`)
    .join("\n\n");

  if (!relevantTexts) {
    return { answer: NO_INFO_REPLY, enrichedKeys: [] };
  }

  const userPrompt = `Proposal text:
${relevantTexts}

Question: ${question}

Output JSON only:`;

  let parsed: EnrichmentResult | null = null;
  try {
    const result = await ollamaClient.generate(
      config.copilotModelName ?? config.modelName,
      ENRICHMENT_SYSTEM,
      userPrompt,
      { maxTokens: ENRICHMENT_MAX_TOKENS }
    );
    parsed = safeParseEnrichmentJson(result.output);
  } catch (err) {
    console.warn("[ragService] Enrichment LLM call failed:", err instanceof Error ? err.message : err);
  }

  if (!parsed) {
    return { answer: NO_INFO_REPLY, enrichedKeys: [] };
  }

  // Validate new facts against the ontology and persist the valid ones
  const enrichedKeys: string[] = [];
  for (const proposal of proposals) {
    for (const fact of parsed.newFacts) {
      const validation = await validateKeyValue(fact.key, fact.value);
      if (!validation.ok) continue;
      try {
        await storeKvPairs(pool, proposal.id, [{ key: fact.key, value: fact.value }], "enriched");
        enrichedKeys.push(fact.key);
      } catch (err) {
        console.warn("[ragService] Failed to store enriched fact:", err instanceof Error ? err.message : err);
      }
    }
  }

  return { answer: parsed.answer.trim() || NO_INFO_REPLY, enrichedKeys };
}

// ── Public entrypoint (DB-backed) ─────────────────────────────────────────────

export async function answerQuestion(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient,
  pool: Pool
): Promise<RagAnswer> {
  const t0 = Date.now();

  // Resolve which proposals the question is asking about
  const targetProposals = await resolveProposalsFromQuestion(pool, question);
  if (targetProposals.length === 0) {
    return {
      answer: "No proposals have been ingested yet.",
      model: config.copilotModelName ?? config.modelName,
      fromCache: false
    };
  }

  // ── Step 1: Resolve relevant ontology categories ─────────────────────────
  const categories = await resolveCategories(question, config, ollamaClient);
  const prefixes = categoriesToPrefixes(categories);

  // ── Step 2: Fetch every fact under those categories ──────────────────────
  let facts = prefixes.length > 0 ? await searchKvByPrefix(pool, prefixes) : [];

  // Filter facts to those belonging to the target proposals
  const targetIds = new Set(targetProposals.map((p) => p.id));
  facts = facts.filter((f) => targetIds.has(f.proposalId));

  // Fallback — if categories somehow yielded nothing, fetch every fact
  if (facts.length === 0) {
    facts = await fetchAllForProposals(pool, targetProposals);
  }

  // Cap volume sent to the LLM — keeps composition fast
  const cappedFacts = prioritizeAndCapFacts(facts, categories);

  // ── Step 3: Compose grounded answer ──────────────────────────────────────
  const initialAnswer = await composeAnswer(question, cappedFacts, config, ollamaClient);

  const isNoInfo =
    initialAnswer.trim().toLowerCase().includes(NO_INFO_REPLY.toLowerCase());

  // ── Step 4: Escalate + enrich if no info found ───────────────────────────
  if (isNoInfo) {
    const proposalsDir = resolveProposalsDir(config.proposalsDir);
    const escalation = await escalateAndEnrich(
      question,
      targetProposals,
      proposalsDir,
      config,
      ollamaClient,
      pool
    );

    console.log(`[ragService] answerQuestion total=${Date.now() - t0}ms facts=${cappedFacts.length} categories=${categories.length} escalated=true`);
    return {
      answer: escalation.answer,
      model: config.copilotModelName ?? config.modelName,
      fromCache: false,
      citedKeys: cappedFacts.map((f) => f.key),
      enrichedKeys: escalation.enrichedKeys,
      sourceProposals: targetProposals.map((p) => p.proposalName)
    };
  }

  console.log(`[ragService] answerQuestion total=${Date.now() - t0}ms facts=${cappedFacts.length} categories=${categories.length} escalated=false`);
  return {
    answer: initialAnswer,
    model: config.copilotModelName ?? config.modelName,
    fromCache: false,
    citedKeys: cappedFacts.map((f) => f.key),
    sourceProposals: targetProposals.map((p) => p.proposalName)
  };
}

// ── In-memory fallback (no DATABASE_URL) ─────────────────────────────────────
//
// When DATABASE_URL is not configured, we re-extract on every request and
// answer purely from the in-memory KV store. No enrichment loop (no DB to
// persist to).
export async function answerQuestionInMemory(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient
): Promise<RagAnswer> {
  const dir = resolveProposalsDir(config.proposalsDir);
  const proposals = await extractAllProposals(dir);
  if (proposals.length === 0) {
    return {
      answer: "No proposals have been loaded yet.",
      model: config.copilotModelName ?? config.modelName,
      fromCache: false
    };
  }

  // Filter by question reference (same logic as DB version)
  const q = question.toLowerCase();
  const matched = proposals.filter((p) =>
    p.proposalName.toLowerCase().split(/\s+/).some((tok) => tok.length > 3 && q.includes(tok))
  );
  const target = matched.length > 0 ? matched : proposals;

  // Build a flat KvRow-like list for the answer composer
  const facts: KvRow[] = target.flatMap((p, idx) =>
    p.kvPairs.map((kv, i) => ({
      id: `${idx}-${i}`,
      proposalId: `${idx}`,
      proposalName: p.proposalName,
      fileName: p.fileName,
      key: kv.key,
      value: kv.value,
      source: "extracted" as const
    }))
  );

  const answer = await composeAnswer(question, facts, config, ollamaClient);

  return {
    answer,
    model: config.copilotModelName ?? config.modelName,
    fromCache: false,
    citedKeys: facts.map((f) => f.key),
    sourceProposals: target.map((p) => p.proposalName)
  };
}
