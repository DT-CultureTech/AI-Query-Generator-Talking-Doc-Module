import { Pool } from "pg";
import type { ProposalStatus, RagSource } from "./types.js";

let sharedPool: Pool | null = null;

export function getProposalPool(connectionString: string): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString });
  }
  return sharedPool;
}

/**
 * Upserts proposal chunks (content + embedding) into the DB.
 * Uses ON CONFLICT to make ingestion idempotent — safe to re-run.
 */
export async function storeChunks(
  pool: Pool,
  proposalName: string,
  fileName: string,
  chunks: Array<{ content: string; embedding: number[] }>
): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    const { content, embedding } = chunks[i];
    // Format vector as '[0.1,0.2,...]' which pgvector accepts
    const vectorLiteral = `[${embedding.join(",")}]`;

    await pool.query(
      `INSERT INTO proposal_chunks (proposal_name, file_name, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (file_name, chunk_index)
       DO UPDATE SET
         proposal_name = EXCLUDED.proposal_name,
         content       = EXCLUDED.content,
         embedding     = EXCLUDED.embedding,
         created_at    = NOW()`,
      [proposalName, fileName, i, content, vectorLiteral]
    );
  }
}

/**
 * Deletes all chunks for a given file — used before force re-indexing.
 */
export async function clearProposalChunks(pool: Pool, fileName: string): Promise<void> {
  await pool.query("DELETE FROM proposal_chunks WHERE file_name = $1", [fileName]);
}

/**
 * Returns the top-K most semantically similar chunks to the query embedding.
 * Uses pgvector cosine distance operator (<=>).
 */
export async function searchSimilarChunks(
  pool: Pool,
  queryEmbedding: number[],
  topK = 5
): Promise<RagSource[]> {
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const result = await pool.query<{
    proposal_name: string;
    content: string;
    distance: number;
  }>(
    `SELECT proposal_name, content, embedding <=> $1::vector AS distance
     FROM proposal_chunks
     ORDER BY distance
     LIMIT $2`,
    [vectorLiteral, topK]
  );

  return result.rows.map((row) => ({
    proposalName: row.proposal_name,
    excerpt: row.content,
    distance: Number(row.distance)
  }));
}

/**
 * Returns ingestion status for all proposals currently in the DB.
 */
export async function getIngestionStatus(pool: Pool): Promise<ProposalStatus[]> {
  const result = await pool.query<{
    file_name: string;
    proposal_name: string;
    chunk_count: string;
    ingested_at: Date;
  }>(
    `SELECT
       file_name,
       proposal_name,
       COUNT(*) AS chunk_count,
       MIN(created_at) AS ingested_at
     FROM proposal_chunks
     GROUP BY file_name, proposal_name
     ORDER BY proposal_name`
  );

  return result.rows.map((row) => ({
    fileName: row.file_name,
    proposalName: row.proposal_name,
    chunkCount: Number(row.chunk_count),
    ingestedAt: row.ingested_at
  }));
}

/**
 * Returns true if the given file already has chunks stored in the DB.
 */
export async function isFileIngested(pool: Pool, fileName: string): Promise<boolean> {
  const result = await pool.query<{ cnt: string }>(
    "SELECT COUNT(*) AS cnt FROM proposal_chunks WHERE file_name = $1",
    [fileName]
  );
  return Number(result.rows[0]?.cnt ?? 0) > 0;
}
