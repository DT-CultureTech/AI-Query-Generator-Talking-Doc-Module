import dotenv from "dotenv";
import { Pool } from "pg";
import { getConfig } from "../src/config/env.js";
import { OllamaClient } from "../src/llm/ollamaClient.js";
import { answerQuestion } from "../src/proposals/ragService.js";

dotenv.config();

const TESTS: Array<{ q: string; mustMention?: string[]; expectsCategory?: string[] }> = [
  // Integrated Spaces — phases / cost / deliverables
  { q: "For Integrated Spaces, what does Phase 1 cost and what does it deliver?",
    mustMention: ["Removing the Guesswork", "7", "Target", "Qualification", "Funnel"] },
  { q: "What tools will be used in the Integrated Spaces engagement?",
    mustMention: ["Excel", "CRM", "LinkedIn"] },
  { q: "What are the payment terms for Munchable.tv?",
    mustMention: ["40,000", "12", "monthly", "advance", "non-refundable"] },
  { q: "What is excluded from scope for Integrated Spaces?",
    mustMention: ["ad", "hiring", "sales calls"] },
  { q: "What assumptions is DeepThought making for Munchable.tv?",
    mustMention: ["software", "data", "communication"] },
  { q: "What happens if we want to cancel the Munchable.tv engagement?",
    mustMention: ["non-poaching", "24"] },
  { q: "Who is on the Integrated Spaces team and how many hours are they allocated?",
    mustMention: ["Senior Consultant", "5", "Strategy Consultant", "10", "Analytics"] },
  { q: "What are the success metrics for Munchable.tv?",
    mustMention: ["C-SAT", "TAT", "Project Completion"] },
  { q: "What frameworks does DeepThought use for Munchable.tv?",
    mustMention: ["First Principles", "Systems Thinking"] }
];

async function main() {
  const config = getConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: config.databaseUrl });
  const llm = new OllamaClient(config);

  let passed = 0;
  for (const [i, t] of TESTS.entries()) {
    process.stdout.write(`\n[${i + 1}/${TESTS.length}] Q: ${t.q}\n`);
    const t0 = Date.now();
    let result;
    try {
      result = await answerQuestion(t.q, config, llm, pool);
    } catch (err) {
      console.error("  ERROR:", err instanceof Error ? err.message : err);
      continue;
    }
    const ms = Date.now() - t0;
    const cited = result.citedKeys?.length ?? 0;
    const enriched = result.enrichedKeys?.length ?? 0;

    console.log(`  Answer (${ms}ms, ${cited} keys cited, ${enriched} enriched):`);
    console.log("  > " + (result.answer || "").replace(/\n/g, "\n  > ").slice(0, 600));

    const lc = (result.answer || "").toLowerCase();
    const missing = (t.mustMention ?? []).filter((m) => !lc.includes(m.toLowerCase()));
    // Match the exact NO_INFO_REPLY sentence, not any "does not specify" substring
    const noInfo = (result.answer || "").trim() === "The proposal does not specify this.";
    if (missing.length === 0 && !noInfo) {
      console.log("  ✅ PASS");
      passed++;
    } else {
      console.log("  ❌ FAIL — missing terms: " + missing.join(", ") + (noInfo ? " (NO_INFO_REPLY)" : ""));
    }
  }

  console.log(`\n=== ${passed}/${TESTS.length} passed ===`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
