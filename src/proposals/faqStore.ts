import type { Pool } from "pg";
import type { FaqEntry } from "./types.js";

// ── Normalisation ─────────────────────────────────────────────────────────────

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:'"()\[\]{}/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Lookup ─────────────────────────────────────────────────────────────────────

export async function lookupFAQ(pool: Pool, query: string): Promise<FaqEntry | null> {
  const normalized = normalizeQuery(query);

  const result = await pool.query<{
    id: number;
    query_text: string;
    query_normalized: string;
    answer: string;
    source_file: string | null;
    is_seed: boolean;
    hit_count: number;
    created_at: Date;
    last_accessed_at: Date;
  }>(
    `SELECT id, query_text, query_normalized, answer, source_file,
            is_seed, hit_count, created_at, last_accessed_at
     FROM faq_cache
     WHERE query_normalized = $1
     LIMIT 1`,
    [normalized]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Increment hit counter asynchronously — never block the response path
  pool
    .query(
      `UPDATE faq_cache
       SET hit_count = hit_count + 1, last_accessed_at = NOW()
       WHERE id = $1`,
      [row.id]
    )
    .catch(() => undefined);

  return {
    id: row.id,
    queryText: row.query_text,
    queryNormalized: row.query_normalized,
    answer: row.answer,
    sourceFile: row.source_file,
    isSeed: row.is_seed,
    hitCount: row.hit_count,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function writeFAQ(
  pool: Pool,
  queryText: string,
  answer: string,
  options: { sourceFile?: string; isSeed?: boolean } = {}
): Promise<void> {
  const normalized = normalizeQuery(queryText);

  await pool.query(
    `INSERT INTO faq_cache (query_text, query_normalized, answer, source_file, is_seed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (query_normalized)
     DO UPDATE SET
       answer           = EXCLUDED.answer,
       source_file      = EXCLUDED.source_file,
       last_accessed_at = NOW()`,
    [
      queryText,
      normalized,
      answer,
      options.sourceFile ?? null,
      options.isSeed ?? false
    ]
  );
}

// ── Seed guard ────────────────────────────────────────────────────────────────

export async function isFAQCacheEmpty(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ cnt: string }>(
    "SELECT COUNT(*) AS cnt FROM faq_cache"
  );
  return Number(result.rows[0]?.cnt ?? 0) === 0;
}

// ── Clear ─────────────────────────────────────────────────────────────────────

export async function clearFAQCache(pool: Pool): Promise<{ deletedCount: number }> {
  const result = await pool.query<{ cnt: string }>(
    "SELECT COUNT(*) AS cnt FROM faq_cache"
  );
  const deletedCount = Number(result.rows[0]?.cnt ?? 0);
  await pool.query("DELETE FROM faq_cache");
  return { deletedCount };
}
