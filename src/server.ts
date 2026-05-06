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
import { extractAllProposals } from "./proposals/kvExtractor.js";
import { listProposals, reingestProposals } from "./proposals/kvStore.js";
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
      copilotModel: config.copilotModelName,
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

  // ── SQL generator (UNCHANGED — AI Query Generator tab) ────────────────────
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

      // No-DB fallback: use in-memory KV extraction
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

  // ── PDGMS Copilot — list ingested proposals ─────────────────────────────
  app.get("/api/proposals", async (_req, res, next) => {
    try {
      if (!config.databaseUrl) {
        res.json({ ok: true, proposals: [] });
        return;
      }
      const pool = getPool(config.databaseUrl);
      const proposals = await listProposals(pool);
      res.json({ ok: true, proposals });
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
    console.log(`[copilot] Using LLM: ${config.copilotModelName}`);

    if (!config.databaseUrl) {
      console.log("[proposals] DATABASE_URL not set — running in in-memory mode (no enrichment).");
      return;
    }

    try {
      const pool = getPool(config.databaseUrl);

      // 1. Migrate the schema
      await runProposalMigration(pool);
      console.log("[proposals] DB schema ready (proposals + proposal_kv_store).");

      // 2. Extract atomic KV pairs from every markdown proposal
      const projectRoot = path.resolve(currentDirectory, "..");
      const proposalsAbsDir = path.isAbsolute(config.proposalsDir)
        ? config.proposalsDir
        : path.resolve(projectRoot, config.proposalsDir);
      console.log(`[proposals] Extracting KV pairs from: ${proposalsAbsDir}`);

      const extracted = await extractAllProposals(proposalsAbsDir);
      if (extracted.length === 0) {
        console.log("[proposals] No proposals found — skipping ingestion.");
        return;
      }

      // 3. Re-ingest into the KV store (replaces previous extraction set)
      await reingestProposals(pool, extracted);
      const totalKv = extracted.reduce((acc, p) => acc + p.kvPairs.length, 0);
      console.log(
        `[proposals] Ingested ${extracted.length} proposals — ${totalKv} atomic KV pairs stored.`
      );

    } catch (err) {
      console.warn(
        "[proposals] Setup failed (PDGMS Copilot feature unavailable):",
        err instanceof Error ? err.message : err
      );
    }
  });
}
