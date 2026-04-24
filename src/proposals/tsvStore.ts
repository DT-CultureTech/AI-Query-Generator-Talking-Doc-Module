import type { Pool } from "pg";
import type { ParsedDeliverable } from "./types.js";

// ── Write ─────────────────────────────────────────────────────────────────────

export async function clearTsvProposals(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM proposals_tsv");
}

export async function storeTsvDeliverables(
  pool: Pool,
  deliverables: ParsedDeliverable[]
): Promise<void> {
  for (const d of deliverables) {
    // process_steps stored as pipe-separated string (pipes are safe inside a TSV cell)
    const stepsCell = d.processSteps.length > 0 ? d.processSteps.join(" | ") : null;

    await pool.query(
      `INSERT INTO proposals_tsv
         (proposal_name, file_name, deliverable_name, kpi_target, kpi_reasoning, process_steps, timeline, owner)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        d.proposalName,
        d.fileName,
        d.deliverableName,
        d.kpiTarget,
        d.kpiReasoning,
        stepsCell,
        d.timeline,
        d.owner
      ]
    );
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface TsvDbRow {
  proposal_name: string;
  file_name: string;
  deliverable_name: string | null;
  kpi_target: string | null;
  kpi_reasoning: string | null;
  process_steps: string | null;
  timeline: string | null;
  owner: string | null;
}

/**
 * Full-text search on proposals_tsv using PostgreSQL's to_tsvector / plainto_tsquery.
 * Falls back to all rows when no FTS match is found (guarantees LLM always has context).
 */
export async function searchTsvByQuery(pool: Pool, query: string): Promise<TsvDbRow[]> {
  const ftsResult = await pool.query<TsvDbRow>(
    `SELECT proposal_name, file_name, deliverable_name, kpi_target,
            kpi_reasoning, process_steps, timeline, owner
     FROM proposals_tsv
     WHERE to_tsvector('english',
             coalesce(proposal_name,    '') || ' ' ||
             coalesce(deliverable_name, '') || ' ' ||
             coalesce(kpi_target,       '') || ' ' ||
             coalesce(kpi_reasoning,    '') || ' ' ||
             coalesce(process_steps,    '') || ' ' ||
             coalesce(owner,            ''))
           @@ plainto_tsquery('english', $1)
     ORDER BY proposal_name, deliverable_name`,
    [query]
  );

  if (ftsResult.rows.length > 0) {
    return ftsResult.rows;
  }

  // Fallback: return all rows so the LLM always has something to work with
  const allResult = await pool.query<TsvDbRow>(
    `SELECT proposal_name, file_name, deliverable_name, kpi_target,
            kpi_reasoning, process_steps, timeline, owner
     FROM proposals_tsv
     ORDER BY proposal_name, id`
  );

  return allResult.rows;
}

/**
 * Formats a row array as a tab-separated context block for the LLM prompt.
 *
 * Header:  proposal_name \t deliverable_name \t kpi_target \t kpi_reasoning \t process_steps \t timeline \t owner
 * Each row: values separated by \t, nulls rendered as "-"
 */
export function formatTsvContextFromRows(rows: TsvDbRow[]): string {
  if (rows.length === 0) return "";

  const header = [
    "proposal_name",
    "deliverable_name",
    "kpi_target",
    "kpi_reasoning",
    "process_steps",
    "timeline",
    "owner"
  ].join("\t");

  const lines = rows.map((r) =>
    [
      r.proposal_name,
      r.deliverable_name ?? "-",
      r.kpi_target ?? "-",
      r.kpi_reasoning?.replace(/\t/g, " ").replace(/\n/g, " ").slice(0, 200) ?? "-",
      r.process_steps ?? "-",
      r.timeline ?? "-",
      r.owner ?? "-"
    ].join("\t")
  );

  return `${header}\n${lines.join("\n")}`;
}
