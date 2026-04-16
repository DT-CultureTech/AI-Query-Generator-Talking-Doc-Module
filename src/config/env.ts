import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const RawEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  MODEL_NAME: z.string().min(1).default("qwen2.5-coder:1.5b"),
  MAX_MODEL_SIZE_MB: z.coerce.number().positive().default(2000),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  MODEL_PULL_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  MODEL_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  MODEL_MAX_TOKENS: z.coerce.number().int().positive().default(256),
  AUTO_PULL_MODEL: z.string().default("true"),
  ALLOW_WRITE_SQL: z.string().default("false"),
  ENABLE_EXPLAIN_DRY_RUN: z.string().default("false"),
  SCHEMA_DOC_PATH: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  MOCK_LLM_RESPONSE: z.string().optional(),
  PROPOSALS_DIR: z.string().default("./proposals"),
  EMBEDDING_MODEL: z.string().min(1).default("nomic-embed-text"),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(768),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)
});

export interface AppConfig {
  port: number;
  ollamaBaseUrl: string;
  modelName: string;
  maxModelSizeMb: number;
  modelTimeoutMs: number;
  modelPullTimeoutMs: number;
  modelTemperature: number;
  modelMaxTokens: number;
  autoPullModel: boolean;
  allowWriteSql: boolean;
  enableExplainDryRun: boolean;
  schemaDocPath?: string;
  databaseUrl?: string;
  mockLlmResponse?: string;
  proposalsDir: string;
  embeddingModel: string;
  embeddingDimension: number;
  embeddingTimeoutMs: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function asOptional(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const parsed = RawEnvSchema.parse(process.env);

  const base: AppConfig = {
    port: parsed.PORT,
    ollamaBaseUrl: parsed.OLLAMA_BASE_URL,
    modelName: parsed.MODEL_NAME,
    maxModelSizeMb: parsed.MAX_MODEL_SIZE_MB,
    modelTimeoutMs: parsed.MODEL_TIMEOUT_MS,
    modelPullTimeoutMs: parsed.MODEL_PULL_TIMEOUT_MS,
    modelTemperature: parsed.MODEL_TEMPERATURE,
    modelMaxTokens: parsed.MODEL_MAX_TOKENS,
    autoPullModel: parseBoolean(parsed.AUTO_PULL_MODEL, true),
    allowWriteSql: parseBoolean(parsed.ALLOW_WRITE_SQL, false),
    enableExplainDryRun: parseBoolean(parsed.ENABLE_EXPLAIN_DRY_RUN, false),
    schemaDocPath: asOptional(parsed.SCHEMA_DOC_PATH),
    databaseUrl: asOptional(parsed.DATABASE_URL),
    mockLlmResponse: asOptional(parsed.MOCK_LLM_RESPONSE),
    proposalsDir: parsed.PROPOSALS_DIR,
    embeddingModel: parsed.EMBEDDING_MODEL,
    embeddingDimension: parsed.EMBEDDING_DIMENSION,
    embeddingTimeoutMs: parsed.EMBEDDING_TIMEOUT_MS
  };

  return {
    ...base,
    ...overrides
  };
}
