import type { SchemaCatalog } from "../schema/types.js";

interface BuildPromptInput {
  question: string;
  catalog: SchemaCatalog;
}

export interface PromptPayload {
  systemPrompt: string;
  userPrompt: string;
}

function formatObjects(catalog: SchemaCatalog): string {
  return catalog.objects
    .map((obj) => `  ${obj.name} (${obj.kind}): [${obj.columns.join(", ")}]`)
    .join("\n");
}

function formatKeyPatterns(keyPatterns: Record<string, string>): string {
  return Object.entries(keyPatterns)
    .map(([pattern, description]) => `  ${pattern}  →  ${description}`)
    .join("\n");
}

// Balanced examples covering every entity category equally
const EXAMPLES = `
--- ORGANIZATIONS ---
Q: List all organizations
A: SELECT value AS org_id, score AS created_at FROM legacy_zset WHERE _key = 'organizations:sorted' ORDER BY score DESC;

Q: Get organization 123 profile
A: SELECT data FROM legacy_hash WHERE _key = 'organization:123';

Q: Show active members of organization 5
A: SELECT member AS uid FROM legacy_set WHERE _key = 'organization:5:members:active' ORDER BY member;

Q: Show managers in organization 7
A: SELECT member AS uid FROM legacy_set WHERE _key = 'organization:7:managers';

Q: List organizations in Technology sector
A: SELECT member AS org_id FROM legacy_set WHERE _key = 'organizations:sector:Technology';

Q: List departments in organization 10
A: SELECT member AS dept_id FROM legacy_set WHERE _key = 'organization:10:departments';

--- DEPARTMENTS ---
Q: Get department 456 details
A: SELECT data FROM legacy_hash WHERE _key = 'department:456';

Q: Show active members of department 20
A: SELECT member AS uid FROM legacy_set WHERE _key = 'department:20:members:active';

Q: Show managers in department 30
A: SELECT member AS uid FROM legacy_set WHERE _key = 'department:30:managers';

Q: Get child departments of department 5
A: SELECT member AS child_dept_id FROM legacy_set WHERE _key = 'department:5:children';

Q: List roles in department 8
A: SELECT member AS role_id FROM legacy_set WHERE _key = 'department:8:roles';

--- ROLES ---
Q: Get role 789 details
A: SELECT data FROM legacy_hash WHERE _key = 'role:789';

Q: List all roles in organization 3
A: SELECT member AS role_id FROM legacy_set WHERE _key = 'organization:3:roles';

Q: List roles ordered by creation time for organization 2
A: SELECT value AS role_id, score AS created_at FROM legacy_zset WHERE _key = 'organization:2:roles:sorted' ORDER BY score DESC;

--- MEMBERSHIPS ---
Q: Get membership record 111
A: SELECT data FROM legacy_hash WHERE _key = 'membership:111';

Q: Show all active memberships for user abc
A: SELECT member AS membership_id FROM legacy_set WHERE _key = 'uid:abc:memberships:active';

Q: List organizations that user xyz belongs to
A: SELECT member AS org_id FROM legacy_set WHERE _key = 'uid:xyz:organizations';

Q: Show leaders of organization 4
A: SELECT member AS uid FROM legacy_set WHERE _key = 'organization:4:leaders';

--- USERS ---
Q: Get user abc profile
A: SELECT data FROM legacy_hash WHERE _key = 'user:abc';

Q: List users by join date newest first
A: SELECT value AS uid, score AS joined_at FROM legacy_zset WHERE _key = 'users:joindate' ORDER BY score DESC;

--- HVT MODULES ---
Q: List HVT modules for organization 5
A: SELECT value AS module_id, score AS created_at FROM legacy_zset WHERE _key = 'hvt:modules:org:5:sorted' ORDER BY score DESC;

Q: Get HVT module 3 details
A: SELECT data FROM legacy_hash WHERE _key = 'hvt:module:3';

--- HVT PROBLEMS ---
Q: Show HVT problems in module 2
A: SELECT member AS problem_id FROM legacy_set WHERE _key = 'hvt:problems:module:2';

Q: List HVT problems for organization 6 ordered by newest
A: SELECT value AS problem_id, score AS created_at FROM legacy_zset WHERE _key = 'hvt:problems:org:6:sorted' ORDER BY score DESC;

Q: Get HVT problem 9 data
A: SELECT data FROM legacy_hash WHERE _key = 'hvt:problem:9';

--- HVT IDEAS ---
Q: List ideas for problem 8
A: SELECT member AS idea_id FROM legacy_set WHERE _key = 'hvt:ideas:problem:8';

Q: List all ideas for organization 7
A: SELECT value AS idea_id, score AS created_at FROM legacy_zset WHERE _key = 'hvt:ideas:org:7:sorted' ORDER BY score DESC;

Q: Get HVT idea 12 details
A: SELECT data FROM legacy_hash WHERE _key = 'hvt:idea:12';

--- HVT EXPERIMENTS ---
Q: List experiments for organization 10 newest first
A: SELECT value AS experiment_id, score AS created_at FROM legacy_zset WHERE _key = 'hvt:experiments:org:10:sorted' ORDER BY score DESC;

Q: Show all active HVT experiments
A: SELECT member AS experiment_id FROM legacy_set WHERE _key = 'hvt:experiments:status:active';

Q: List experiments for idea 4
A: SELECT member AS experiment_id FROM legacy_set WHERE _key = 'hvt:experiments:idea:4';

Q: Get experiment 15 details
A: SELECT data FROM legacy_hash WHERE _key = 'hvt:experiment:15';

Q: Show completed HVT experiments
A: SELECT member AS experiment_id FROM legacy_set WHERE _key = 'hvt:experiments:status:completed';

--- HVT RESULTS, LEARNINGS, ESCALATIONS ---
Q: Get results for experiment 3
A: SELECT member AS result_id FROM legacy_set WHERE _key = 'hvt:results:experiment:3';

Q: List learnings for experiment 6
A: SELECT member AS learning_id FROM legacy_set WHERE _key = 'hvt:learnings:experiment:6';

Q: Show escalations for experiment 2
A: SELECT member AS escalation_id FROM legacy_set WHERE _key = 'hvt:escalations:experiment:2';

Q: Get learning 7 details
A: SELECT data FROM legacy_hash WHERE _key = 'hvt:learning:7';

Q: List learnings for organization 5
A: SELECT value AS learning_id, score AS created_at FROM legacy_zset WHERE _key = 'hvt:learnings:org:5:sorted' ORDER BY score DESC;

--- SESSIONS & FORUM ---
Q: List latest 10 sessions ordered by expiry descending
A: SELECT sid, sess, expire FROM session ORDER BY expire DESC LIMIT 10;

Q: Show top 10 topics by votes
A: SELECT value AS topic_id, score AS votes FROM legacy_zset WHERE _key = 'topics:votes' ORDER BY score DESC LIMIT 10;

Q: Get topic 456 metadata
A: SELECT data FROM legacy_hash WHERE _key = 'topic:456';
`.trim();

export function buildPrompt(input: BuildPromptInput): PromptPayload {
  const systemPrompt = [
    "You are a PostgreSQL SQL generator. Output ONLY one SQL SELECT statement. No explanations, no markdown, no code blocks.",
    "",
    "RULES:",
    "1. Output exactly one SELECT (or WITH...SELECT). End with semicolon.",
    "2. Never use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE.",
    "3. Use ONLY the tables listed in SCHEMA. Never invent table or column names.",
    "4. Never use JSONB operators (->, ->>, #>, #>>).",
    "5. All entities are looked up by _key column using the patterns in KEY PATTERNS.",
    "6. legacy_set rows use 'member' column. legacy_zset rows use 'value' and 'score' columns.",
    "7. legacy_hash rows use 'data' column for the entity payload.",
    "8. When an ID is given, use exact _key match (e.g. _key = 'organization:123').",
    "9. When no ID is given and querying across all, use LIKE (e.g. _key LIKE 'organization:%:members:active').",
    "10. For 'active'/'live' objects use legacy_object_live, not legacy_object.",
    "",
    "SCHEMA:",
    formatObjects(input.catalog),
    "",
    "KEY PATTERNS:",
    formatKeyPatterns(input.catalog.keyPatterns),
    "",
    "EXAMPLES:",
    EXAMPLES
  ].join("\n");

  const userPrompt = `Generate SQL for: ${input.question.trim()}\n\nSQL:`;

  return { systemPrompt, userPrompt };
}
