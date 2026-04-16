import type { SchemaCatalog, SchemaObject } from "./types.js";

const DEFAULT_OBJECTS: SchemaObject[] = [
  {
    name: "legacy_object",
    kind: "table",
    columns: ["_key", "type", "expireAt"],
    description: "Master index for all key-value objects and expiration metadata"
  },
  {
    name: "legacy_hash",
    kind: "table",
    columns: ["_key", "data", "type"],
    description: "JSONB hash storage for entities: organizations, departments, roles, memberships, HVT entities, users, topics"
  },
  {
    name: "legacy_zset",
    kind: "table",
    columns: ["_key", "value", "score", "type"],
    description: "Sorted set structure for ranking and timestamp ordering"
  },
  {
    name: "legacy_set",
    kind: "table",
    columns: ["_key", "member", "type"],
    description: "Unordered unique set membership — stores IDs/UIDs for relationships and active sets"
  },
  {
    name: "legacy_list",
    kind: "table",
    columns: ["_key", "array", "type"],
    description: "Ordered list storage backed by text arrays"
  },
  {
    name: "legacy_string",
    kind: "table",
    columns: ["_key", "data", "type"],
    description: "Simple string storage — global counters and config"
  },
  {
    name: "session",
    kind: "table",
    columns: ["sid", "sess", "expire"],
    description: "HTTP session storage"
  },
  {
    name: "legacy_object_live",
    kind: "view",
    columns: ["_key", "type"],
    description: "Live object view that excludes expired keys — type is one of: hash, zset, set, list, string"
  }
];

const DEFAULT_KEY_PATTERNS: Record<string, string> = {
  // ---- Users ----
  "user:{uid}": "User profile — legacy_hash",
  "users:joindate": "User join timestamps — legacy_zset (score = join timestamp)",
  "uid:{uid}:memberships:active": "User active membership IDs — legacy_set",
  "uid:{uid}:organizations": "Organizations a user belongs to — legacy_set",

  // ---- Organizations ----
  "organization:{orgId}": "Organization profile data — legacy_hash",
  "organizations:sorted": "All organizations ordered by creation time — legacy_zset (score = timestamp)",
  "organizations:active": "Active organization IDs — legacy_set",
  "organizations:sector:{sector}": "Organization IDs filtered by sector — legacy_set",
  "organization:{orgId}:members:active": "Active member UIDs in organization — legacy_set",
  "organization:{orgId}:members:sorted": "Members by join date — legacy_zset (score = join timestamp)",
  "organization:{orgId}:managers": "Manager UIDs in organization — legacy_set",
  "organization:{orgId}:leaders": "Leader UIDs in organization — legacy_set",
  "organization:{orgId}:departments": "Department IDs in organization — legacy_set",
  "organization:{orgId}:departments:sorted": "Departments ordered by creation time — legacy_zset",
  "organization:{orgId}:roles": "Role IDs in organization — legacy_set",
  "organization:{orgId}:roles:sorted": "Roles ordered by creation time — legacy_zset",

  // ---- Departments ----
  "department:{deptId}": "Department profile data — legacy_hash",
  "department:{deptId}:members:active": "Active member UIDs in department — legacy_set",
  "department:{deptId}:members:sorted": "Members by join date — legacy_zset",
  "department:{deptId}:managers": "Manager UIDs in department — legacy_set",
  "department:{deptId}:roles": "Role IDs in department — legacy_set",
  "department:{deptId}:children": "Child department IDs — legacy_set",

  // ---- Roles ----
  "role:{roleId}": "Role profile data — legacy_hash",

  // ---- Memberships ----
  "membership:{membershipId}": "Membership record (links user to org/dept/role) — legacy_hash",

  // ---- HVT Modules ----
  "hvt:module:{moduleId}": "HVT module data — legacy_hash",
  "hvt:modules:org:{orgId}:sorted": "HVT modules per organization — legacy_zset (score = timestamp)",
  "hvt:modules:sorted": "All HVT modules globally — legacy_zset",

  // ---- HVT Problems ----
  "hvt:problem:{problemId}": "HVT problem data — legacy_hash",
  "hvt:problems:org:{orgId}:sorted": "HVT problems per organization — legacy_zset",
  "hvt:problems:module:{moduleId}": "HVT problem IDs in a module — legacy_set",

  // ---- HVT Ideas ----
  "hvt:idea:{ideaId}": "HVT idea data — legacy_hash",
  "hvt:ideas:org:{orgId}:sorted": "HVT ideas per organization — legacy_zset",
  "hvt:ideas:problem:{problemId}": "HVT idea IDs for a problem — legacy_set",

  // ---- HVT Experiments ----
  "hvt:experiment:{experimentId}": "HVT experiment data — legacy_hash",
  "hvt:experiments:org:{orgId}:sorted": "HVT experiments per organization — legacy_zset (score = timestamp)",
  "hvt:experiments:status:{status}": "HVT experiment IDs filtered by status — legacy_set (status: seeded|probing|active|blocked|logging|ready_for_hash|completed|halted)",
  "hvt:experiments:idea:{ideaId}": "HVT experiment IDs for an idea — legacy_set",

  // ---- HVT Results ----
  "hvt:result:{resultId}": "HVT result data — legacy_hash",
  "hvt:results:experiment:{experimentId}": "HVT result IDs for an experiment — legacy_set",

  // ---- HVT Learnings ----
  "hvt:learning:{learningId}": "HVT learning data — legacy_hash",
  "hvt:learnings:org:{orgId}:sorted": "HVT learnings per organization — legacy_zset",
  "hvt:learnings:experiment:{experimentId}": "HVT learning IDs for an experiment — legacy_set",

  // ---- HVT Escalations ----
  "hvt:escalation:{escalationId}": "HVT escalation data — legacy_hash",
  "hvt:escalations:experiment:{experimentId}": "HVT escalation IDs for an experiment — legacy_set",

  // ---- HVT Tickets & Updates ----
  "hvt:ticket:{ticketId}": "HVT ticket data — legacy_hash",
  "hvt:update:{updateId}": "HVT update/progress note data — legacy_hash",

  // ---- HVT User Role ----
  "hvt:role:{orgId}:{uid}": "HVT user role and permissions per org — legacy_hash",

  // ---- Forum/NodeBB ----
  "topic:{tid}": "Topic metadata — legacy_hash",
  "post:{pid}": "Post metadata — legacy_hash",
  "topics:votes": "Topic vote ranking — legacy_zset (score = vote count)"
};

const DEFAULT_ALLOWED_QUERY_PATTERNS: string[] = [
  "Lookup by exact _key in legacy_hash (entity profile)",
  "Sorted set range query in legacy_zset by _key and score (ordering/pagination)",
  "Set membership reads in legacy_set by _key (relationships and active sets)",
  "Live object access via legacy_object_live",
  "Session lookup in session table by sid",
  "LIKE pattern on _key column to query across all entities of a type"
];

const DEFAULT_FORBIDDEN_SQL_PATTERNS: string[] = [
  "\\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|copy)\\b",
  "->",
  "->>",
  "#>",
  "#>>"
];

export function createDefaultCatalog(sourcePath: string, sourceHash: string): SchemaCatalog {
  return {
    sourcePath,
    sourceHash,
    objects: [...DEFAULT_OBJECTS],
    keyPatterns: { ...DEFAULT_KEY_PATTERNS },
    allowedQueryPatterns: [...DEFAULT_ALLOWED_QUERY_PATTERNS],
    forbiddenSqlPatterns: [...DEFAULT_FORBIDDEN_SQL_PATTERNS]
  };
}
