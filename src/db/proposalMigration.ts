import { Pool } from "pg";

/**
 * Runs once on startup when DATABASE_URL is configured.
 * Sets up the PDGMS Copilot schema based on atomic key-value pairs
 * derived from the PDGMS Ontology.
 *
 * Tables:
 *   - proposals          : one row per ingested proposal file
 *   - proposal_kv_store  : atomic KV facts extracted/enriched from proposals
 *
 * No PostgreSQL extensions required (no pgvector, no pg_trgm).
 *
 * NOTE: AI Query Generator tables (legacy_hash, legacy_set, etc.) are NOT
 * touched by this migration.
 */
export async function runProposalMigration(pool: Pool): Promise<void> {

  // pgcrypto is needed for gen_random_uuid()
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  // ── proposals: one row per ingested proposal document ──────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposals (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_name     TEXT NOT NULL UNIQUE,
      proposal_name TEXT NOT NULL,
      ingested_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── proposal_kv_store: atomic KV facts (extracted or enriched) ────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposal_kv_store (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id  UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      key          TEXT NOT NULL,
      value        JSONB NOT NULL,
      source       TEXT NOT NULL CHECK (source IN ('extracted', 'enriched')),
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (proposal_id, key)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS proposal_kv_store_proposal_id_idx
      ON proposal_kv_store (proposal_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS proposal_kv_store_key_idx
      ON proposal_kv_store (key)
  `);

  // GIN index on JSONB value for value-based search
  await pool.query(`
    CREATE INDEX IF NOT EXISTS proposal_kv_store_value_gin_idx
      ON proposal_kv_store USING GIN (value)
  `);

  // ── Drop deprecated tables from earlier (FAQ + TSV) iterations ─────────────
  // These were never part of the AI Query Generator and are safe to drop.
  await pool.query(`DROP TABLE IF EXISTS proposals_tsv`);
  await pool.query(`DROP TABLE IF EXISTS proposals_json`);
  await pool.query(`DROP TABLE IF EXISTS faq_cache`);
}
