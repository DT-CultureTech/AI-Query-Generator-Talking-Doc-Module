import { Pool } from "pg";

/**
 * Runs once on startup when DATABASE_URL is configured.
 * Creates the proposal_chunks table if it does not exist.
 * Uses JSONB for embedding storage — no PostgreSQL extensions required.
 */
export async function runProposalMigration(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposal_chunks (
      id            SERIAL PRIMARY KEY,
      proposal_name TEXT    NOT NULL,
      file_name     TEXT    NOT NULL,
      chunk_index   INTEGER NOT NULL,
      content       TEXT    NOT NULL,
      embedding     JSONB   NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT proposal_chunks_file_chunk_unique UNIQUE (file_name, chunk_index)
    )
  `);
}
