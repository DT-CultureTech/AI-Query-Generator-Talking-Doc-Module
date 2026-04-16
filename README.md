# AI Query Generator (MVP)

Local-first MVP that converts natural language into PostgreSQL SQL queries using a lightweight local model and strict SQL safety validation.

## What It Does

- Accepts natural language input from API or web UI.
- Generates SQL using one local mini model (default: `smollm2:135m`).
- Auto-pulls the configured model when missing (can be disabled via env).
- Uses deterministic SQL templates for common intents before model inference to reduce hallucination.
- Enforces strict guardrails:
  - Single statement only.
  - Read-only (`SELECT`/`WITH`) by default.
  - Only known schema objects from the backend schema docs.
- Returns clear validation errors for unsafe queries.

## Project Structure

- `src/server.ts` - API server and route wiring.
- `src/services/queryGenerator.ts` - NL-to-SQL orchestration.
- `src/schema/loadSchemaDoc.ts` - schema doc resolution and parsing.
- `src/prompt/buildPrompt.ts` - constrained prompting.
- `src/sql/validateSql.ts` - SQL safety checks.
- `public/` - minimal frontend.

## Prerequisites

- Node.js 20+
- Ollama (auto-installed by setup script on Windows when winget is available)

## Local Setup

### Windows One-Command Setup (Recommended)

From project root, run:

```bash
npm run setup:windows
```

What it does:

1. Creates `.env` from `.env.example` if missing.
2. Installs npm dependencies.
3. Installs Ollama with `winget` if not found.
4. Pulls the configured model (`smollm2:135m`).
5. Starts the app (`npm run dev`).

### Manual Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env file:

```bash
copy .env.example .env
```

3. Start app:

```bash
npm run dev
```

4. Open UI:

- http://localhost:3000

Note: On first use, the app will pull `smollm2:135m` if it is not already present. The first query can take longer.

## Quick Validation

With app running:

```bash
npm run smoke
```

This checks:

1. `GET /api/health`
2. `POST /api/generate-query`

and prints generated SQL.

## API

### Health

- `GET /api/health`

### Schema Info

- `GET /api/schema-info`

### Generate SQL

- `POST /api/generate-query`
- Request body:

```json
{
  "input": "show top 10 topics by votes",
  "dryRun": false
}
```

- Response (success):

```json
{
  "ok": true,
  "sql": "SELECT value, score FROM legacy_zset WHERE _key = 'topics:votes' ORDER BY score DESC LIMIT 10;",
  "model": "smollm2:135m",
  "warnings": [],
  "validation": {
    "isValid": true,
    "reasons": [],
    "warnings": [],
    "referencedTables": ["legacy_zset"],
    "normalizedSql": "SELECT value, score FROM legacy_zset WHERE _key = 'topics:votes' ORDER BY score DESC LIMIT 10;"
  },
  "metadata": {
    "schemaSourcePath": "...",
    "attempts": []
  }
}
```

## Model Sizing Strategy

- Fixed default for MVP: `smollm2:135m`.
- Expected model download footprint: approximately 200-300MB depending on platform/quantization metadata in Ollama.
- This default is chosen specifically to stay within your <=300MB requirement.
- If you change `MODEL_NAME`, ensure the selected model still satisfies your size policy.

## Generation Flow

1. Try deterministic template mapping for known intents (for example, top topics by votes).
2. If no template matches, call the mini model (`smollm2:135m`) through Ollama.
3. Validate SQL safety and schema usage before returning output.

For the request "Give me all the active members of the organisation.", the deterministic template path now returns:

```sql
SELECT split_part(_key, ':', 2) AS organization_id, member AS uid
FROM legacy_set
WHERE _key LIKE 'organization:%:members:active'
ORDER BY organization_id, uid;
```

## Sample Inputs (Schema-Aligned)

- Show top 10 topics by votes
- Give me all the active members of the organisation
- Get active members for organization 123
- Get active members for department 5
- Find user 42 profile hash by key
- Find organization 9 details
- List session rows sorted by expire descending limit 10
- Show topic 456 metadata
- Show membership 111 record
- Show all category hashes (first 20)

## Full Flow Document

For a complete architecture and execution flow (including model usage, size policy, safety checks, and request lifecycle), see `SYSTEM_FLOW.md`.

For a concise operational brief with model and parameter rationale, see `PDGMS_BRIEF.md`.

## Expected Failure Mode

- If Ollama is unavailable, `POST /api/generate-query` returns HTTP 503 with an actionable message.
- If model output is unsafe SQL, endpoint returns HTTP 422.

## Environment Variables

See `.env.example`.

Key flags:

- `AUTO_PULL_MODEL=true` auto-downloads missing model from Ollama.
- `MAX_MODEL_SIZE_MB=300` enforces an upper model-size policy when Ollama reports model size metadata.
- `ALLOW_WRITE_SQL=false` keeps generation read-only.
- `ENABLE_EXPLAIN_DRY_RUN=true` enables optional `EXPLAIN` validation if `DATABASE_URL` is set.

## Tests

```bash
npm test
```

## Docker (Optional)

```bash
docker compose up --build
```

Compose includes a model bootstrap service that pulls `smollm2:135m` automatically.

## Notes

- The service resolves schema docs in this order:
  1. `SCHEMA_DOC_PATH` env override.
  2. `BACKEND_DATABASE_SCHEMA.md` in project root.
  3. `Details.md` in project root.
  4. Parent directory versions of the same files.
- In this workspace, it will pick `../Details.md` by default.
- If a schema file is present but empty, the app falls back to the embedded default catalog derived from your documented backend schema structure.
