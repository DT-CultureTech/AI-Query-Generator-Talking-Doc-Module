import type { AppConfig } from "../config/env.js";

export interface LlmGenerationResult {
  output: string;
  durationMs?: number;
  promptEvalCount?: number;
  evalCount?: number;
}

interface OllamaGenerateApiResponse {
  response?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface OllamaTagsApiResponse {
  models?: Array<{ name?: string; model?: string; size?: number }>;
  error?: string;
}

interface OllamaPullApiResponse {
  status?: string;
  error?: string;
}

function toDurationMs(rawDuration?: number): number | undefined {
  if (typeof rawDuration !== "number") {
    return undefined;
  }

  if (rawDuration > 1_000_000) {
    return Math.round(rawDuration / 1_000_000);
  }

  return Math.round(rawDuration);
}

export class OllamaClient {
  private readonly readyModels = new Set<string>();
  private readonly modelPreparationInFlight = new Map<string, Promise<void>>();

  constructor(private readonly config: AppConfig) {}

  private getModelEntry(
    tags: OllamaTagsApiResponse,
    model: string
  ): { name?: string; model?: string; size?: number } | undefined {
    const normalizedTarget = model.trim().toLowerCase();

    return tags.models?.find((entry) => {
      const candidate = (entry.name ?? entry.model ?? "").trim().toLowerCase();
      return candidate === normalizedTarget;
    });
  }

  private assertModelSizeWithinLimit(
    entry: { name?: string; model?: string; size?: number } | undefined,
    model: string
  ): void {
    if (!entry || typeof entry.size !== "number" || !Number.isFinite(entry.size) || entry.size <= 0) {
      return;
    }

    const sizeMb = entry.size / (1024 * 1024);
    if (sizeMb > this.config.maxModelSizeMb) {
      throw new Error(
        `Configured model ${model} is ${sizeMb.toFixed(1)}MB and exceeds MAX_MODEL_SIZE_MB=${this.config.maxModelSizeMb}. Choose a smaller model.`
      );
    }
  }

  private async fetchJson<TPayload>(
    apiPath: string,
    requestInit: RequestInit,
    timeoutMs: number
  ): Promise<TPayload> {
    const endpoint = `${this.config.ollamaBaseUrl}${apiPath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        ...requestInit,
        signal: controller.signal
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        const detail = payload.error ?? `HTTP ${response.status}`;
        throw new Error(`Ollama API ${apiPath} failed: ${detail}`);
      }

      return payload as TPayload;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`Ollama API ${apiPath} timed out after ${timeoutMs}ms`);
      }

      if (error instanceof TypeError) {
        throw new Error(
          `Cannot connect to Ollama at ${this.config.ollamaBaseUrl}. Start Ollama and retry.`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isModelInstalled(tags: OllamaTagsApiResponse, model: string): boolean {
    return Boolean(this.getModelEntry(tags, model));
  }

  private async ensureModelReadyInternal(model: string): Promise<void> {
    if (this.config.mockLlmResponse) {
      return;
    }

    const tags = await this.fetchJson<OllamaTagsApiResponse>(
      "/api/tags",
      {
        method: "GET"
      },
      this.config.modelTimeoutMs
    );

    if (this.isModelInstalled(tags, model)) {
      this.assertModelSizeWithinLimit(this.getModelEntry(tags, model), model);
      this.readyModels.add(model);
      return;
    }

    if (!this.config.autoPullModel) {
      throw new Error(
        `Model ${model} is not available in Ollama. Enable AUTO_PULL_MODEL=true or run: ollama pull ${model}`
      );
    }

    await this.fetchJson<OllamaPullApiResponse>(
      "/api/pull",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          stream: false
        })
      },
      this.config.modelPullTimeoutMs
    );

    const refreshedTags = await this.fetchJson<OllamaTagsApiResponse>(
      "/api/tags",
      {
        method: "GET"
      },
      this.config.modelTimeoutMs
    );

    this.assertModelSizeWithinLimit(this.getModelEntry(refreshedTags, model), model);

    this.readyModels.add(model);
  }

  async ensureModelReady(model: string): Promise<void> {
    if (this.readyModels.has(model) || this.config.mockLlmResponse) {
      return;
    }

    const existing = this.modelPreparationInFlight.get(model);
    if (existing) {
      await existing;
      return;
    }

    const pending = this.ensureModelReadyInternal(model).finally(() => {
      this.modelPreparationInFlight.delete(model);
    });

    this.modelPreparationInFlight.set(model, pending);
    await pending;
  }

  async generate(model: string, systemPrompt: string, userPrompt: string): Promise<LlmGenerationResult> {
    if (this.config.mockLlmResponse) {
      return {
        output: this.config.mockLlmResponse,
        durationMs: 0
      };
    }

    await this.ensureModelReady(model);

    const payload = await this.fetchJson<OllamaGenerateApiResponse>(
      "/api/generate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          stream: false,
          prompt: userPrompt,
          system: systemPrompt,
          options: {
            temperature: this.config.modelTemperature,
            num_predict: this.config.modelMaxTokens
          }
        })
      },
      this.config.modelTimeoutMs
    );

    if (!payload.response || payload.response.trim().length === 0) {
      throw new Error("Ollama returned an empty response");
    }

    return {
      output: payload.response,
      durationMs: toDurationMs(payload.total_duration),
      promptEvalCount: payload.prompt_eval_count,
      evalCount: payload.eval_count
    };
  }
}
