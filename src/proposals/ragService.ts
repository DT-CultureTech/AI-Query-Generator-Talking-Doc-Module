import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import { OllamaClient } from "../llm/ollamaClient.js";
import type { RagAnswer } from "./types.js";
import { generateEmbedding } from "./embeddings.js";
import { searchSimilarChunks } from "./vectorStore.js";

const RAG_SYSTEM_PROMPT = `You are PDGMS Copilot, an expert assistant that answers questions about client proposals.
You will be given relevant excerpts from one or more proposals. Answer the user's question clearly and concisely based solely on the provided excerpts.
If the excerpts do not contain enough information to answer the question, say "I could not find that information in the available proposals."
Do not invent or assume information not present in the excerpts.
Always mention which proposal the information comes from when relevant.`;

/**
 * Full RAG pipeline:
 *  1. Embed the user's question
 *  2. pgvector similarity search → top relevant chunks
 *  3. Build context prompt from chunks
 *  4. Call the existing Ollama LLM to generate an answer
 */
export async function answerQuestion(
  question: string,
  config: AppConfig,
  ollamaClient: OllamaClient,
  pool: Pool
): Promise<RagAnswer> {
  // Step 1: Embed the question
  const queryEmbedding = await generateEmbedding(
    question,
    config.ollamaBaseUrl,
    config.embeddingModel,
    config.embeddingTimeoutMs
  );

  // Step 2: Find the top-5 most relevant chunks
  const sources = await searchSimilarChunks(pool, queryEmbedding, 5);

  if (sources.length === 0) {
    return {
      answer: "No proposals have been indexed yet. Please click 'Ingest / Re-index Proposals' first.",
      sources: [],
      model: config.modelName
    };
  }

  // Step 3: Build context block for the prompt
  const contextBlock = sources
    .map(
      (s, i) =>
        `--- Excerpt ${i + 1} (from: ${s.proposalName}) ---\n${s.excerpt}`
    )
    .join("\n\n");

  const userPrompt = `Context from proposals:\n\n${contextBlock}\n\n---\n\nUser question: ${question}\n\nAnswer:`;

  // Step 4: Generate answer using the existing LLM (reuses all model readiness + timeout logic)
  const llmResult = await ollamaClient.generate(config.modelName, RAG_SYSTEM_PROMPT, userPrompt);

  return {
    answer: llmResult.output.trim(),
    sources,
    model: config.modelName
  };
}
