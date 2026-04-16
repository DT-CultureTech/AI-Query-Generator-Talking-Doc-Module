import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import type { IngestResult } from "./types.js";
import { loadAllProposals } from "./pdfParser.js";
import { generateEmbeddingsBatch } from "./embeddings.js";
import { storeChunks, clearProposalChunks, isFileIngested } from "./vectorStore.js";

/**
 * Ingests only proposals that are not yet present in the DB.
 * Returns a summary of what was processed, skipped, and any errors.
 */
export async function ingestNewProposals(config: AppConfig, pool: Pool): Promise<IngestResult> {
  return runIngestion(config, pool, false);
}

/**
 * Force re-ingests ALL proposals, clearing existing data first.
 * Used when the user clicks "Re-index" in the UI.
 */
export async function forceReIngestAll(config: AppConfig, pool: Pool): Promise<IngestResult> {
  return runIngestion(config, pool, true);
}

async function runIngestion(
  config: AppConfig,
  pool: Pool,
  force: boolean
): Promise<IngestResult> {
  const result: IngestResult = {
    filesProcessed: [],
    totalChunks: 0,
    skippedFiles: [],
    errors: []
  };

  let proposals;
  try {
    proposals = await loadAllProposals(config.proposalsDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push({ file: config.proposalsDir, error: `Failed to scan proposals directory: ${message}` });
    return result;
  }

  for (const proposal of proposals) {
    // Skip already-ingested files unless force=true
    if (!force) {
      const alreadyDone = await isFileIngested(pool, proposal.fileName);
      if (alreadyDone) {
        result.skippedFiles.push(proposal.fileName);
        continue;
      }
    } else {
      // Clear existing chunks for this file before re-ingesting
      try {
        await clearProposalChunks(pool, proposal.fileName);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ file: proposal.fileName, error: `Clear failed: ${message}` });
        continue;
      }
    }

    if (proposal.chunks.length === 0) {
      result.errors.push({ file: proposal.fileName, error: "No text could be extracted from PDF" });
      continue;
    }

    // Generate embeddings for all chunks in this proposal
    const embeddings = await generateEmbeddingsBatch(
      proposal.chunks,
      config.ollamaBaseUrl,
      config.embeddingModel,
      config.embeddingTimeoutMs
    );

    // Pair chunks with their embeddings; skip any that failed
    const chunksWithEmbeddings: Array<{ content: string; embedding: number[] }> = [];
    let failedCount = 0;

    for (let i = 0; i < proposal.chunks.length; i++) {
      const embedding = embeddings[i];
      if (embedding === null) {
        failedCount++;
        continue;
      }
      chunksWithEmbeddings.push({ content: proposal.chunks[i], embedding });
    }

    if (failedCount > 0) {
      result.errors.push({
        file: proposal.fileName,
        error: `${failedCount} of ${proposal.chunks.length} chunks failed to embed — rest were stored`
      });
    }

    if (chunksWithEmbeddings.length === 0) {
      result.errors.push({ file: proposal.fileName, error: "All chunks failed to embed; nothing stored" });
      continue;
    }

    try {
      await storeChunks(pool, proposal.name, proposal.fileName, chunksWithEmbeddings);
      result.filesProcessed.push(proposal.fileName);
      result.totalChunks += chunksWithEmbeddings.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: proposal.fileName, error: `DB store failed: ${message}` });
    }
  }

  return result;
}
