interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

/**
 * Generates a single embedding vector for the given text using Ollama's /api/embed endpoint.
 */
export async function generateEmbedding(
  text: string,
  ollamaBaseUrl: string,
  model: string,
  timeoutMs: number
): Promise<number[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal
    });

    const payload = (await response.json()) as OllamaEmbedResponse;

    if (!response.ok) {
      const detail = payload.error ?? `HTTP ${response.status}`;
      throw new Error(`Ollama /api/embed failed: ${detail}`);
    }

    const embeddings = payload.embeddings;
    if (!embeddings || embeddings.length === 0 || !embeddings[0] || embeddings[0].length === 0) {
      throw new Error("Ollama returned an empty embedding");
    }

    return embeddings[0];
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`Ollama /api/embed timed out after ${timeoutMs}ms`);
    }
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot connect to Ollama at ${ollamaBaseUrl}. Ensure Ollama is running.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generates embeddings for an array of texts sequentially.
 * Failed items are returned as null and the caller decides how to handle them.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  ollamaBaseUrl: string,
  model: string,
  timeoutMs: number
): Promise<Array<number[] | null>> {
  const results: Array<number[] | null> = [];

  for (const text of texts) {
    try {
      const embedding = await generateEmbedding(text, ollamaBaseUrl, model, timeoutMs);
      results.push(embedding);
    } catch {
      results.push(null);
    }
  }

  return results;
}
