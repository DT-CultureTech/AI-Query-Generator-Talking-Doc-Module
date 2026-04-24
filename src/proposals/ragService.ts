import type { Pool } from "pg";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config/env.js";
import type { OllamaClient } from "../llm/ollamaClient.js";
import type { ParsedDeliverable, RagAnswer } from "./types.js";
import { lookupFAQ, writeFAQ, normalizeQuery } from "./faqStore.js";
import { searchTsvByQuery, formatTsvContextFromRows } from "./tsvStore.js";
import { SEED_FAQS } from "./faqSeeds.js";
import { loadAllMarkdownProposals } from "./mdParser.js";

// Resolve project root relative to this file: src/proposals/ → src/ → project root
const _ragServiceFile = fileURLToPath(import.meta.url);
const _ragServiceDir = nodePath.dirname(_ragServiceFile);
const _projectRoot = nodePath.resolve(_ragServiceDir, "../..");

function resolveProposalsDir(proposalsDir: string): string {
  return nodePath.isAbsolute(proposalsDir)
    ? proposalsDir
    : nodePath.resolve(_projectRoot, proposalsDir);
}

// Use a higher token budget for answers — 256 (default) can truncate detailed responses
const ANSWER_MAX_TOKENS = 400;

const SYSTEM_PROMPT = `You are PDGMS Copilot, an expert assistant for DeepThought (DT) proposals.
You will be given structured proposal data and must answer the user's question based solely on that data.
Be specific and concise. Mention which proposal you are referencing when relevant.
If the data does not contain enough information to answer, say exactly: "I could not find that information in the available proposals."
Do not invent or assume anything not present in the provided data.`;

function buildUserPrompt(tsvContext: string, question: string): string {
  return `=== Proposal Data (TSV Format) ===
${tsvContext}

===
User question: ${question}

Answer:`;
}

/**
 * Deterministic query routing:
 *
 *  1. FAQ cache lookup  →  HIT: return instantly, zero LLM calls
 *  2. FTS search on proposals_tsv (falls back to all rows if no match)
 *  3. Single LLM call with TSV-formatted context
 *  4. Cache the answer (fire-and-forget)
 *  5. Return { answer, model, fromCache: false }
 */
export async function answerQuestion(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient,
  pool: Pool
): Promise<RagAnswer> {

  // ── Step 1: FAQ cache (zero LLM calls on hit) ─────────────────────────────
  const cached = await lookupFAQ(pool, question);
  if (cached) {
    return {
      answer: cached.answer,
      model: config.modelName,
      fromCache: true
    };
  }

  // ── Step 2: FTS search — narrows context to relevant rows ─────────────────
  const rows = await searchTsvByQuery(pool, question);
  const tsvContext = formatTsvContextFromRows(rows);

  if (!tsvContext) {
    return {
      answer: "No proposals have been loaded yet. Please restart the server to trigger proposal ingestion.",
      model: config.modelName,
      fromCache: false
    };
  }

  // ── Step 3: Single LLM call with TSV context ──────────────────────────────
  const result = await ollamaClient.generate(
    config.modelName,
    SYSTEM_PROMPT,
    buildUserPrompt(tsvContext, question),
    { maxTokens: ANSWER_MAX_TOKENS }
  );

  const answer = result.output.trim();

  // ── Step 4: Cache the answer (fire-and-forget) ────────────────────────────
  writeFAQ(pool, question, answer).catch(() => undefined);

  // ── Step 5: Return ────────────────────────────────────────────────────────
  return {
    answer,
    model: config.modelName,
    fromCache: false
  };
}

// ── In-memory RAG (no DATABASE_URL required) ──────────────────────────────────

function buildInMemoryTsvContext(deliverables: ParsedDeliverable[], question: string): string {
  if (deliverables.length === 0) return "";

  // Score each deliverable by keyword overlap with the question
  const words = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  const scored = deliverables.map((d) => {
    const text = [
      d.proposalName,
      d.deliverableName,
      d.kpiTarget,
      d.kpiReasoning,
      ...d.processSteps,
      d.timeline,
      d.owner
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const score = words.filter((w) => text.includes(w)).length;
    return { d, score };
  });

  const relevant = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => x.d);

  const header = [
    "proposal_name",
    "deliverable_name",
    "kpi_target",
    "kpi_reasoning",
    "process_steps",
    "timeline",
    "owner"
  ].join("\t");

  const lines = relevant.map((d) =>
    [
      d.proposalName,
      d.deliverableName ?? "-",
      d.kpiTarget ?? "-",
      d.kpiReasoning?.replace(/\t/g, " ").replace(/\n/g, " ").slice(0, 200) ?? "-",
      d.processSteps.join(" | ") || "-",
      d.timeline ?? "-",
      d.owner ?? "-"
    ].join("\t")
  );

  return `${header}\n${lines.join("\n")}`;
}

/**
 * Answers a question using only in-memory data (markdown files + seed FAQs).
 * Used when DATABASE_URL is not configured.
 */
export async function answerQuestionInMemory(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient
): Promise<RagAnswer> {
  // ── Step 1: Exact-match against seed FAQs (zero LLM calls) ───────────────
  const normalized = normalizeQuery(question);
  const seedMatch = SEED_FAQS.find((f) => normalizeQuery(f.question) === normalized);
  if (seedMatch) {
    return { answer: seedMatch.answer, model: config.modelName, fromCache: true };
  }

  // ── Step 2: Load markdown proposals from disk ─────────────────────────────
  const deliverables = await loadAllMarkdownProposals(resolveProposalsDir(config.proposalsDir));

  if (deliverables.length === 0) {
    return {
      answer:
        "No proposals have been loaded yet. Please check the proposals directory.",
      model: config.modelName,
      fromCache: false
    };
  }

  // ── Step 3: Build keyword-ranked TSV context ──────────────────────────────
  const tsvContext = buildInMemoryTsvContext(deliverables, question);

  // ── Step 4: Single LLM call with in-memory context ───────────────────────
  const result = await ollamaClient.generate(
    config.modelName,
    SYSTEM_PROMPT,
    buildUserPrompt(tsvContext, question),
    { maxTokens: ANSWER_MAX_TOKENS }
  );

  return { answer: result.output.trim(), model: config.modelName, fromCache: false };
}
