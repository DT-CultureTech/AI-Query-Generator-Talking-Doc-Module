import type { Pool } from "pg";
import type { AtomicValue } from "./ontology.js";
import type { ExtractedKv, ExtractedProposal } from "./kvExtractor.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProposalRow {
  id: string;
  fileName: string;
  proposalName: string;
}

export interface KvRow {
  id: string;
  proposalId: string;
  proposalName: string;
  fileName: string;
  key: string;
  value: AtomicValue;
  source: "extracted" | "enriched";
}

// ── Proposal upsert ───────────────────────────────────────────────────────────

export async function upsertProposal(
  pool: Pool,
  fileName: string,
  proposalName: string
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO proposals (file_name, proposal_name)
     VALUES ($1, $2)
     ON CONFLICT (file_name)
     DO UPDATE SET proposal_name = EXCLUDED.proposal_name
     RETURNING id`,
    [fileName, proposalName]
  );
  return result.rows[0].id;
}

// ── Bulk store extracted KV pairs ─────────────────────────────────────────────

export async function storeKvPairs(
  pool: Pool,
  proposalId: string,
  pairs: ExtractedKv[],
  source: "extracted" | "enriched" = "extracted"
): Promise<void> {
  for (const p of pairs) {
    await pool.query(
      `INSERT INTO proposal_kv_store (proposal_id, key, value, source)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (proposal_id, key)
       DO UPDATE SET
         value      = EXCLUDED.value,
         source     = EXCLUDED.source,
         created_at = NOW()`,
      [proposalId, p.key, JSON.stringify(p.value), source]
    );
  }
}

/**
 * Wipe all KV pairs (and their proposals) and re-insert fresh extracted data.
 * Used on server startup to keep store in sync with the markdown source files.
 */
export async function reingestProposals(
  pool: Pool,
  proposals: ExtractedProposal[]
): Promise<void> {
  // Cascading delete via FK removes child KV rows
  await pool.query(`DELETE FROM proposals`);

  for (const p of proposals) {
    const proposalId = await upsertProposal(pool, p.fileName, p.proposalName);
    await storeKvPairs(pool, proposalId, p.kvPairs, "extracted");
  }
}

// ── List proposals ────────────────────────────────────────────────────────────

export async function listProposals(pool: Pool): Promise<ProposalRow[]> {
  const result = await pool.query<{ id: string; file_name: string; proposal_name: string }>(
    `SELECT id, file_name, proposal_name FROM proposals ORDER BY proposal_name ASC`
  );
  return result.rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    proposalName: r.proposal_name
  }));
}

// ── Lookup helpers ────────────────────────────────────────────────────────────

interface DbKvRow {
  id: string;
  proposal_id: string;
  proposal_name: string;
  file_name: string;
  key: string;
  value: AtomicValue;
  source: "extracted" | "enriched";
}

function toKvRow(r: DbKvRow): KvRow {
  return {
    id: r.id,
    proposalId: r.proposal_id,
    proposalName: r.proposal_name,
    fileName: r.file_name,
    key: r.key,
    value: r.value,
    source: r.source
  };
}

/**
 * Fetch a single KV pair by exact key, optionally scoped to a proposal.
 */
export async function getKv(
  pool: Pool,
  key: string,
  proposalId?: string
): Promise<KvRow | null> {
  const sql = proposalId
    ? `SELECT kv.id, kv.proposal_id, p.proposal_name, p.file_name, kv.key, kv.value, kv.source
       FROM proposal_kv_store kv
       JOIN proposals p ON p.id = kv.proposal_id
       WHERE kv.key = $1 AND kv.proposal_id = $2
       LIMIT 1`
    : `SELECT kv.id, kv.proposal_id, p.proposal_name, p.file_name, kv.key, kv.value, kv.source
       FROM proposal_kv_store kv
       JOIN proposals p ON p.id = kv.proposal_id
       WHERE kv.key = $1
       LIMIT 1`;

  const params = proposalId ? [key, proposalId] : [key];
  const result = await pool.query<DbKvRow>(sql, params);

  return result.rows.length > 0 ? toKvRow(result.rows[0]) : null;
}

/**
 * Fetch all KV pairs whose key matches any of the supplied keys.
 */
export async function getKvBatch(pool: Pool, keys: string[]): Promise<KvRow[]> {
  if (keys.length === 0) return [];
  const result = await pool.query<DbKvRow>(
    `SELECT kv.id, kv.proposal_id, p.proposal_name, p.file_name, kv.key, kv.value, kv.source
     FROM proposal_kv_store kv
     JOIN proposals p ON p.id = kv.proposal_id
     WHERE kv.key = ANY($1::text[])
     ORDER BY p.proposal_name, kv.key`,
    [keys]
  );
  return result.rows.map(toKvRow);
}

/**
 * Fetch every KV pair for a specific proposal.
 */
export async function getKvByProposal(pool: Pool, proposalId: string): Promise<KvRow[]> {
  const result = await pool.query<DbKvRow>(
    `SELECT kv.id, kv.proposal_id, p.proposal_name, p.file_name, kv.key, kv.value, kv.source
     FROM proposal_kv_store kv
     JOIN proposals p ON p.id = kv.proposal_id
     WHERE kv.proposal_id = $1
     ORDER BY kv.key`,
    [proposalId]
  );
  return result.rows.map(toKvRow);
}

/**
 * Search KV pairs by key prefix and optional substring on the JSON value.
 * Used when an exact key is unknown (e.g., "phases.*", "team.*").
 */
export async function searchKvByPrefix(pool: Pool, prefixes: string[]): Promise<KvRow[]> {
  if (prefixes.length === 0) return [];
  const conditions = prefixes.map((_, i) => `kv.key LIKE $${i + 1}`).join(" OR ");
  const params = prefixes.map((p) => `${p}%`);

  const result = await pool.query<DbKvRow>(
    `SELECT kv.id, kv.proposal_id, p.proposal_name, p.file_name, kv.key, kv.value, kv.source
     FROM proposal_kv_store kv
     JOIN proposals p ON p.id = kv.proposal_id
     WHERE ${conditions}
     ORDER BY p.proposal_name, kv.key`,
    params
  );
  return result.rows.map(toKvRow);
}

/**
 * Find proposal(s) matching a name fragment (e.g., "munchable", "integrated").
 * Returns proposal IDs that the question most likely refers to. If the question
 * does not name any proposal, returns all proposals.
 */
export async function resolveProposalsFromQuestion(
  pool: Pool,
  question: string
): Promise<ProposalRow[]> {
  const all = await listProposals(pool);
  if (all.length === 0) return [];

  // Split on whitespace AND punctuation so multi-part names like "Munchable.tv"
  // yield individual tokens (["munchable","tv"]). Otherwise a question
  // mentioning "Munchable" never matches the stored token "munchable.tv" and
  // the resolver falls back to "return all proposals" — which leaks other
  // proposals' facts into the answer composer.
  const q = question.toLowerCase();
  const matches = all.filter((p) =>
    p.proposalName
      .toLowerCase()
      .split(/[\s.\-_/]+/)
      .some((tok) => tok.length > 3 && q.includes(tok))
  );
  return matches.length > 0 ? matches : all;
}
