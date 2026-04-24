import express, { type NextFunction, type Request, type Response } from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { getConfig, type AppConfig } from "./config/env.js";
import { explainQuery } from "./db/explain.js";
import { getPool } from "./db/pool.js";
import { runProposalMigration } from "./db/proposalMigration.js";
import { OllamaClient } from "./llm/ollamaClient.js";
import { loadAllMarkdownProposals } from "./proposals/mdParser.js";
import { clearTsvProposals, storeTsvDeliverables } from "./proposals/tsvStore.js";
import { isFAQCacheEmpty, writeFAQ, clearFAQCache } from "./proposals/faqStore.js";
import { SEED_FAQS } from "./proposals/faqSeeds.js";
import { answerQuestion, answerQuestionInMemory } from "./proposals/ragService.js";
import { getSchemaCatalog } from "./schema/catalogStore.js";
import { generateQueryFromNaturalLanguage } from "./services/queryGenerator.js";

// ── Request schemas ───────────────────────────────────────────────────────────

const GenerateQueryRequestSchema = z.object({
  input: z.string().min(3).max(4000),
  dryRun: z.boolean().optional()
});

const ProposalChatRequestSchema = z.object({
  question: z.string().min(2).max(2000)
});

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const publicDirectory = path.resolve(currentDirectory, "../public");

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(
  config: AppConfig = getConfig(),
  ollamaClient?: OllamaClient
): express.Express {
  const app = express();
  const llmClient = ollamaClient ?? new OllamaClient(config);

  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));
  app.use(express.static(publicDirectory));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDirectory, "index.html"));
  });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "ai-query-generator",
      model: config.modelName,
      maxModelSizeMb: config.maxModelSizeMb,
      autoPullModel: config.autoPullModel,
      allowWriteSql: config.allowWriteSql
    });
  });

  // ── Schema info ───────────────────────────────────────────────────────────
  app.get("/api/schema-info", async (_req, res, next) => {
    try {
      const catalog = await getSchemaCatalog(config);
      res.json({
        ok: true,
        sourcePath: catalog.sourcePath,
        sourceHash: catalog.sourceHash,
        objects: catalog.objects,
        keyPatternCount: Object.keys(catalog.keyPatterns).length,
        allowedQueryPatterns: catalog.allowedQueryPatterns
      });
    } catch (error) {
      next(error);
    }
  });

  // ── SQL generator ─────────────────────────────────────────────────────────
  app.post("/api/generate-query", async (req, res, next) => {
    try {
      const parsed = GenerateQueryRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          message: "Invalid request body.",
          details: parsed.error.flatten()
        });
        return;
      }

      const generation = await generateQueryFromNaturalLanguage(parsed.data.input, config);

      if (!generation.ok) {
        const modelUnavailable = generation.metadata.attempts.some((attempt) =>
          attempt.reasons.includes("model-call-failed")
        );
        res.status(modelUnavailable ? 503 : 422).json(generation);
        return;
      }

      let explainPlan: string[] | undefined;
      let explainError: string | undefined;

      if (parsed.data.dryRun && config.enableExplainDryRun && config.databaseUrl) {
        try {
          explainPlan = await explainQuery(config.databaseUrl, generation.sql);
        } catch (error) {
          explainError = error instanceof Error ? error.message : "EXPLAIN failed";
        }
      }

      res.json({ ...generation, explainPlan, explainError });
    } catch (error) {
      next(error);
    }
  });

  // ── PDGMS Copilot — chat ──────────────────────────────────────────────────
  app.post("/api/proposals/chat", async (req, res, next) => {
    try {
      const parsed = ProposalChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "Invalid request body.", details: parsed.error.flatten() });
        return;
      }

      // No-DB fallback: use in-memory proposal search + seed FAQ cache
      if (!config.databaseUrl) {
        const ragAnswer = await answerQuestionInMemory(parsed.data.question, config, llmClient);
        res.json({ ok: true, ...ragAnswer });
        return;
      }

      const pool = getPool(config.databaseUrl);
      const ragAnswer = await answerQuestion(parsed.data.question, config, llmClient, pool);
      res.json({ ok: true, ...ragAnswer });
    } catch (error) {
      next(error);
    }
  });

  // ── PDGMS Copilot — list seed FAQs ───────────────────────────────────────
  app.get("/api/proposals/faqs", async (_req, res, next) => {
    // No-DB fallback: serve seed FAQs directly from memory
    if (!config.databaseUrl) {
      const faqs = SEED_FAQS.map((f, i) => ({
        id: i + 1,
        query_text: f.question,
        source_file: f.sourceFile
      }));
      res.json({ ok: true, faqs });
      return;
    }
    try {
      const pool = getPool(config.databaseUrl);
      const result = await pool.query(
        `SELECT id, query_text, source_file FROM faq_cache WHERE is_seed = true ORDER BY id ASC`
      );
      res.json({ ok: true, faqs: result.rows });
    } catch (error) {
      next(error);
    }
  });

  // ── PDGMS Copilot — clear FAQ cache ──────────────────────────────────────
  app.delete("/api/proposals/faq-cache", async (_req, res, next) => {
    if (!config.databaseUrl) {
      res.status(503).json({ ok: false, error: "Proposals feature requires DATABASE_URL to be configured." });
      return;
    }
    try {
      const pool = getPool(config.databaseUrl);
      const { deletedCount } = await clearFAQCache(pool);
      console.log(`[proposals] FAQ cache cleared — ${deletedCount} entries removed.`);
      res.json({ ok: true, deletedCount });
    } catch (error) {
      next(error);
    }
  });

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ ok: false, message });
  });

  return app;
}

// ── Startup ───────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== "test") {
  const config = getConfig();
  const sharedOllamaClient = new OllamaClient(config);
  const app = createApp(config, sharedOllamaClient);

  app.listen(config.port, async () => {
    console.log(`ai-query-generator listening on http://localhost:${config.port}`);

    if (!config.databaseUrl) {
      console.log("[proposals] DATABASE_URL not set — PDGMS Copilot feature disabled.");
      return;
    }

    try {
      const pool = getPool(config.databaseUrl);

      // 1. Create tables
      await runProposalMigration(pool);
      console.log("[proposals] DB schema ready.");

      // 2. Parse all .md files and (re-)populate both format tables
      // Resolve relative to project root (dirname of src/ → one level up from server.ts)
      const projectRoot = path.resolve(currentDirectory, "..");
      const proposalsAbsDir = path.isAbsolute(config.proposalsDir)
        ? config.proposalsDir
        : path.resolve(projectRoot, config.proposalsDir);
      console.log(`[proposals] Loading markdown proposals from: ${proposalsAbsDir}`);
      const deliverables = await loadAllMarkdownProposals(proposalsAbsDir);

      if (deliverables.length === 0) {
        console.log("[proposals] No .md files found — skipping data load.");
      } else {
        await clearTsvProposals(pool);
        await storeTsvDeliverables(pool, deliverables);
        console.log(`[proposals] Loaded ${deliverables.length} deliverable rows into proposals_tsv.`);
      }

      // 3. Seed FAQ cache on first startup
      const isEmpty = await isFAQCacheEmpty(pool);
      if (isEmpty) {
        console.log("[proposals] FAQ cache is empty — seeding with curated FAQs...");
        for (const faq of SEED_FAQS) {
          await writeFAQ(pool, faq.question, faq.answer, {
            sourceFile: faq.sourceFile,
            isSeed: true
          });
        }
        console.log(`[proposals] Seeded ${SEED_FAQS.length} FAQ entries.`);
      } else {
        console.log("[proposals] FAQ cache already populated — skipping seed.");
      }

    } catch (err) {
      // Never crash the server over the proposals feature
      console.warn(
        "[proposals] Setup failed (PDGMS Copilot feature unavailable):",
        err instanceof Error ? err.message : err
      );
    }
  });
}
