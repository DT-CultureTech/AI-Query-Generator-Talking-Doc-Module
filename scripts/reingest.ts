import dotenv from "dotenv";
import { Pool } from "pg";
import path from "node:path";
import { extractAllProposals } from "../src/proposals/kvExtractor.js";
import { reingestProposals } from "../src/proposals/kvStore.js";

dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });

  const dir = path.resolve(process.cwd(), "./proposals mds");
  console.log("[reingest] Reading proposals from:", dir);

  const extracted = await extractAllProposals(dir);
  console.log("[reingest] Extracted from", extracted.length, "proposals");
  for (const p of extracted) {
    console.log("  " + p.proposalName + ": " + p.kvPairs.length + " KV pairs");
  }

  await reingestProposals(pool, extracted);
  console.log("[reingest] Re-ingested into DB.");

  const r = await pool.query<{ proposal_name: string; n: string }>(
    "SELECT p.proposal_name, COUNT(*) AS n FROM proposal_kv_store kv JOIN proposals p ON p.id = kv.proposal_id GROUP BY p.proposal_name ORDER BY p.proposal_name"
  );
  console.log("[reingest] Verification:");
  for (const row of r.rows) console.log("  " + row.proposal_name + ": " + row.n + " rows");

  await pool.end();
}

main().catch((err) => {
  console.error("[reingest] FAILED:", err);
  process.exit(1);
});
