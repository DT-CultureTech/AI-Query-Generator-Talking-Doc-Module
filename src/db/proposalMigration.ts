import { Pool } from "pg";

/**
 * Runs once on startup when DATABASE_URL is configured.
 * Creates the pgvector extension and proposal_chunks table if they do not exist.
 */
export async function runProposalMigration(pool: Pool, embeddingDimension: number): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposal_chunks (
      id            SERIAL PRIMARY KEY,
      proposal_name TEXT    NOT NULL,
      file_name     TEXT    NOT NULL,
      chunk_index   INTEGER NOT NULL,
      content       TEXT    NOT NULL,
      embedding     vector(${embeddingDimension}) NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT proposal_chunks_file_chunk_unique UNIQUE (file_name, chunk_index)
    )
  `);

  // IVFFlat index for fast approximate cosine similarity search.
  // Using "IF NOT EXISTS" pattern via a DO block since CREATE INDEX lacks IF NOT EXISTS in older PG.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'proposal_chunks'
          AND indexname  = 'proposal_chunks_embedding_idx'
      ) THEN
        CREATE INDEX proposal_chunks_embedding_idx
          ON proposal_chunks
          USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 50);
      END IF;
    END
    $$
  `);
}
