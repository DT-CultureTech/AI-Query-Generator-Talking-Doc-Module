import type { AppConfig } from "../config/env.js";
import { OllamaClient } from "../llm/ollamaClient.js";
import { buildPrompt } from "../prompt/buildPrompt.js";
import { getSchemaCatalog } from "../schema/catalogStore.js";
import { extractSql } from "../sql/extractSql.js";
import { applySqlPolicies } from "../sql/policies.js";
import { validateSql, type SqlValidationResult } from "../sql/validateSql.js";

export interface GenerationAttempt {
  model: string;
  latencyMs: number;
  valid: boolean;
  reasons: string[];
  error?: string;
  candidateSql?: string;
  outputPreview?: string;
}

interface GenerationMetadata {
  schemaSourcePath: string;
  schemaSourceHash: string;
  attempts: GenerationAttempt[];
}

export interface QueryGenerationSuccess {
  ok: true;
  sql: string;
  model: string;
  warnings: string[];
  validation: SqlValidationResult;
  metadata: GenerationMetadata;
}

export interface QueryGenerationFailure {
  ok: false;
  message: string;
  metadata: GenerationMetadata;
}

export type QueryGenerationResult = QueryGenerationSuccess | QueryGenerationFailure;

function buildPreview(text: string, maxLength = 180): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}...`;
}

export async function generateQueryFromNaturalLanguage(
  naturalLanguageInput: string,
  config: AppConfig
): Promise<QueryGenerationResult> {
  const catalog = await getSchemaCatalog(config);
  const prompt = buildPrompt({ question: naturalLanguageInput, catalog });

  const model = config.modelName;
  const client = new OllamaClient(config);
  const attempts: GenerationAttempt[] = [];

  const startedAt = Date.now();

  try {
    const generation = await client.generate(model, prompt.systemPrompt, prompt.userPrompt);
    const extractedSql = extractSql(generation.output);
    const policyResult = applySqlPolicies(extractedSql);
    const validation = validateSql(policyResult.sql, catalog, config.allowWriteSql);
    const latencyMs = generation.durationMs ?? Date.now() - startedAt;

    attempts.push({
      model,
      latencyMs,
      valid: validation.isValid,
      reasons: validation.reasons,
      candidateSql: validation.normalizedSql,
      outputPreview: buildPreview(generation.output)
    });

    if (validation.isValid) {
      return {
        ok: true,
        sql: validation.normalizedSql,
        model,
        warnings: [...policyResult.warnings, ...validation.warnings],
        validation,
        metadata: {
          schemaSourcePath: catalog.sourcePath,
          schemaSourceHash: catalog.sourceHash,
          attempts
        }
      };
    }

    return {
      ok: false,
      message: `Model produced SQL that failed safety checks: ${validation.reasons.join(", ")}. Try rephrasing your request.`,
      metadata: {
        schemaSourcePath: catalog.sourcePath,
        schemaSourceHash: catalog.sourceHash,
        attempts
      }
    };
  } catch (error) {
    attempts.push({
      model,
      latencyMs: Date.now() - startedAt,
      valid: false,
      reasons: ["model-call-failed"],
      error: error instanceof Error ? error.message : "Unknown model error"
    });

    return {
      ok: false,
      message: error instanceof Error ? error.message : "Model call failed.",
      metadata: {
        schemaSourcePath: catalog.sourcePath,
        schemaSourceHash: catalog.sourceHash,
        attempts
      }
    };
  }
}
