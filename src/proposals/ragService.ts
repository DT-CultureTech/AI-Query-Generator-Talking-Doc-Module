import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import type { OllamaClient } from "../llm/ollamaClient.js";
import type { RagAnswer } from "./types.js";
import {
  getKvBatch,
  searchKvByPrefix,
  storeKvPairs,
  resolveProposalsFromQuestion,
  type KvRow,
  type ProposalRow
} from "./kvStore.js";
import { listOntologyPatterns, validateKeyValue, type AtomicValue } from "./ontology.js";
import { extractAllProposals } from "./kvExtractor.js";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ─────────────────────────────────────────────────────────────────

const FACT_RESOLVE_MAX_TOKENS = 200;
const ANSWER_MAX_TOKENS = 350;
const ENRICHMENT_MAX_TOKENS = 350;

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

// ── Step 1: Ask LLM which keys are needed to answer the question ──────────────

const KEY_RESOLVER_SYSTEM = `You are a key resolver for the PDGMS proposal store.
Given a user question and the ontology of valid keys, output the keys (or key prefixes ending with .*) needed to answer.
Output ONLY a JSON array of strings. No prose. No markdown. No explanations.
Use a key prefix like "phases.*" or "team.*" when you need every entry under that group.
If the question is general/unscoped, prefer broad prefixes over specific keys.`;

function buildKeyResolverPrompt(
  question: string,
  topPatterns: string[],
  proposalNames: string[]
): string {
  return `Available proposals: ${proposalNames.join(", ")}

Valid key patterns (subset):
${topPatterns.join("\n")}

Question: ${question}

Output JSON array of keys/prefixes:`;
}

function safeParseJsonArray(raw: string): string[] {
  // Strip code fences and any leading/trailing prose
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  // Find first [ ... ] block
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    // fall through
  }
  return [];
}

async function identifyKeysViaLlm(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient,
  proposals: ProposalRow[]
): Promise<string[]> {
  const allPatterns = await listOntologyPatterns();
  // Cap at top patterns to keep the prompt small for the 1.5B model
  const topPatterns = allPatterns.slice(0, 60);
  const proposalNames = proposals.map((p) => p.proposalName);

  try {
    const result = await ollamaClient.generate(
      config.copilotModelName ?? config.modelName,
      KEY_RESOLVER_SYSTEM,
      buildKeyResolverPrompt(question, topPatterns, proposalNames),
      { maxTokens: FACT_RESOLVE_MAX_TOKENS }
    );
    return safeParseJsonArray(result.output);
  } catch (err) {
    console.warn("[ragService] Key resolver LLM call failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Step 2: Fetch KV pairs from store ─────────────────────────────────────────

function splitExactAndPrefix(keys: string[]): { exact: string[]; prefixes: string[] } {
  const exact: string[] = [];
  const prefixes: string[] = [];
  for (const k of keys) {
    if (k.endsWith(".*")) {
      prefixes.push(k.slice(0, -1)); // drop the *, keep the trailing .
    } else if (k.endsWith("*")) {
      prefixes.push(k.slice(0, -1));
    } else {
      exact.push(k);
    }
  }
  return { exact, prefixes };
}

async function fetchFacts(pool: Pool, keys: string[]): Promise<KvRow[]> {
  const { exact, prefixes } = splitExactAndPrefix(keys);

  const [exactRows, prefixRows] = await Promise.all([
    exact.length > 0 ? getKvBatch(pool, exact) : Promise.resolve([]),
    prefixes.length > 0 ? searchKvByPrefix(pool, prefixes) : Promise.resolve([])
  ]);

  // Deduplicate by row id
  const seen = new Set<string>();
  const merged: KvRow[] = [];
  for (const row of [...exactRows, ...prefixRows]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

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
Answer the user's question using ONLY the supplied atomic facts.
Each fact is a key=value pair extracted from a DeepThought proposal.
Rules:
- Cite specific numbers, names, and dates exactly as they appear.
- If the answer requires arithmetic (sums, totals), compute from the raw values shown.
- If the supplied facts do not contain the answer, reply with EXACTLY this single sentence and nothing else: "${NO_INFO_REPLY}"
- Do NOT invent any fact, number, or detail not present below.
- Be concise (2-4 sentences).`;

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
  return result.output.trim();
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
  // Resolve which proposals the question is asking about
  const targetProposals = await resolveProposalsFromQuestion(pool, question);
  if (targetProposals.length === 0) {
    return {
      answer: "No proposals have been ingested yet.",
      model: config.copilotModelName ?? config.modelName,
      fromCache: false
    };
  }

  // ── Step 1: Identify which keys are needed ───────────────────────────────
  const requestedKeys = await identifyKeysViaLlm(question, config, ollamaClient, targetProposals);

  // ── Step 2: Fetch matching facts ─────────────────────────────────────────
  let facts = requestedKeys.length > 0 ? await fetchFacts(pool, requestedKeys) : [];

  // Filter facts to those belonging to the target proposals
  const targetIds = new Set(targetProposals.map((p) => p.id));
  facts = facts.filter((f) => targetIds.has(f.proposalId));

  // Fallback — if the LLM returned no usable keys, fetch every fact for the
  // target proposals so the answer composer at least has context
  if (facts.length === 0) {
    facts = await fetchAllForProposals(pool, targetProposals);
  }

  // ── Step 3: Compose grounded answer ──────────────────────────────────────
  const initialAnswer = await composeAnswer(question, facts, config, ollamaClient);

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

    return {
      answer: escalation.answer,
      model: config.copilotModelName ?? config.modelName,
      fromCache: false,
      citedKeys: facts.map((f) => f.key),
      enrichedKeys: escalation.enrichedKeys,
      sourceProposals: targetProposals.map((p) => p.proposalName)
    };
  }

  return {
    answer: initialAnswer,
    model: config.copilotModelName ?? config.modelName,
    fromCache: false,
    citedKeys: facts.map((f) => f.key),
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
