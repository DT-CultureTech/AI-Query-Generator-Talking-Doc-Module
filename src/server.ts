import express, { type NextFunction, type Request, type Response } from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { getConfig, type AppConfig } from "./config/env.js";
import { explainQuery } from "./db/explain.js";
import { runProposalMigration } from "./db/proposalMigration.js";
import { OllamaClient } from "./llm/ollamaClient.js";
import { ingestNewProposals, forceReIngestAll } from "./proposals/ingestService.js";
import { answerQuestion } from "./proposals/ragService.js";
import { getIngestionStatus, getProposalPool } from "./proposals/vectorStore.js";
import { getSchemaCatalog } from "./schema/catalogStore.js";
import { generateQueryFromNaturalLanguage } from "./services/queryGenerator.js";

const GenerateQueryRequestSchema = z.object({
  input: z.string().min(3).max(4000),
  dryRun: z.boolean().optional()
});

const ProposalIngestRequestSchema = z.object({
  force: z.boolean().optional().default(false)
});

const ProposalChatRequestSchema = z.object({
  question: z.string().min(2).max(2000)
});

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const publicDirectory = path.resolve(currentDirectory, "../public");

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

      res.json({
        ...generation,
        explainPlan,
        explainError
      });
    } catch (error) {
      next(error);
    }
  });

  // ── PDGMS Copilot — Proposal RAG endpoints ─────────────────────────────────
  // These routes are additive and isolated. If DATABASE_URL is not configured,
  // they return a clear error without affecting any existing functionality.

  app.get("/api/proposals/status", async (_req, res, next) => {
    if (!config.databaseUrl) {
      res.status(503).json({ ok: false, error: "Proposals feature requires DATABASE_URL to be configured." });
      return;
    }
    try {
      const pool = getProposalPool(config.databaseUrl);
      const proposals = await getIngestionStatus(pool);
      res.json({ ok: true, dbConnected: true, proposals });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/proposals/ingest", async (req, res, next) => {
    if (!config.databaseUrl) {
      res.status(503).json({ ok: false, error: "Proposals feature requires DATABASE_URL to be configured." });
      return;
    }
    try {
      const parsed = ProposalIngestRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "Invalid request body.", details: parsed.error.flatten() });
        return;
      }
      const pool = getProposalPool(config.databaseUrl);
      const ingestResult = parsed.data.force
        ? await forceReIngestAll(config, pool)
        : await ingestNewProposals(config, pool);
      res.json({ ok: true, summary: ingestResult });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/proposals/chat", async (req, res, next) => {
    if (!config.databaseUrl) {
      res.status(503).json({ ok: false, error: "Proposals feature requires DATABASE_URL to be configured." });
      return;
    }
    try {
      const parsed = ProposalChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "Invalid request body.", details: parsed.error.flatten() });
        return;
      }
      const pool = getProposalPool(config.databaseUrl);
      const ragAnswer = await answerQuestion(parsed.data.question, config, llmClient, pool);
      res.json({ ok: true, ...ragAnswer });
    } catch (error) {
      next(error);
    }
  });
  // ── End PDGMS Copilot routes ────────────────────────────────────────────────

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected server error";

    res.status(500).json({
      ok: false,
      message
    });
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const config = getConfig();
  const app = createApp(config);

  app.listen(config.port, async () => {
    console.log(`ai-query-generator listening on http://localhost:${config.port}`);

    // Auto-setup and ingest for proposals feature (non-blocking: failures are logged, not thrown)
    if (config.databaseUrl) {
      try {
        const pool = getProposalPool(config.databaseUrl);
        await runProposalMigration(pool, config.embeddingDimension);
        console.log("[proposals] DB schema ready.");

        const result = await ingestNewProposals(config, pool);
        if (result.filesProcessed.length > 0) {
          console.log(`[proposals] Auto-ingested: ${result.filesProcessed.join(", ")} (${result.totalChunks} chunks)`);
        }
        if (result.skippedFiles.length > 0) {
          console.log(`[proposals] Already indexed (skipped): ${result.skippedFiles.join(", ")}`);
        }
        if (result.errors.length > 0) {
          for (const e of result.errors) {
            console.warn(`[proposals] Warning for ${e.file}: ${e.error}`);
          }
        }
      } catch (err) {
        // Never crash the server over proposals feature
        console.warn("[proposals] Setup failed (proposals feature unavailable):", err instanceof Error ? err.message : err);
      }
    } else {
      console.log("[proposals] DATABASE_URL not set — PDGMS Copilot feature disabled.");
    }
  });
}
