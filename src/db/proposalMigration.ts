import { Pool } from "pg";

/**
 * Runs once on startup when DATABASE_URL is configured.
 * Creates the three proposal-feature tables if they do not exist.
 * No PostgreSQL extensions required — uses standard TEXT, JSONB, and BOOLEAN.
 */
export async function runProposalMigration(pool: Pool): Promise<void> {

  // TSV-style table: individual TEXT columns per deliverable field
  // process_steps is stored as a pipe-separated string (pipes are safe in TSV cells)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposals_tsv (
      id               SERIAL PRIMARY KEY,
      proposal_name    TEXT NOT NULL,
      file_name        TEXT NOT NULL,
      deliverable_name TEXT,
      kpi_target       TEXT,
      kpi_reasoning    TEXT,
      process_steps    TEXT,
      timeline         TEXT,
      owner            TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // FAQ cache: zero-LLM answers for normalised query matches
  await pool.query(`
    CREATE TABLE IF NOT EXISTS faq_cache (
      id               SERIAL    PRIMARY KEY,
      query_text       TEXT      NOT NULL,
      query_normalized TEXT      NOT NULL,
      answer           TEXT      NOT NULL,
      source_file      TEXT,
      is_seed          BOOLEAN   NOT NULL DEFAULT FALSE,
      hit_count        INTEGER   NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      last_accessed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Unique index on normalised query — powers the ON CONFLICT upsert in faqStore
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS faq_cache_normalized_idx
      ON faq_cache (query_normalized)
  `);

  // Add columns that may be missing when upgrading an older schema
  await pool.query(`
    ALTER TABLE faq_cache
      ADD COLUMN IF NOT EXISTS is_seed          BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS hit_count        INTEGER     NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ DEFAULT NOW()
  `);
}
