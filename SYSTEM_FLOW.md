# AI Query Generator - End-to-End Working Flow

## 1) Goal

Convert natural language into safe PostgreSQL read-only SQL for the backend schema documented in `Details.md`.

## 2) Model Choice and Size Policy

- Active default model: `smollm2:135m`
- Runtime: Ollama (local)
- Intended footprint: under 300MB (this project is configured for a <=300MB default model)
- Why this model: very small local model for low-resource environments

Important:
- Actual download and on-disk size can vary slightly by platform and quantization metadata.
- To verify the actual local size on your machine, run:

```powershell
ollama list
```

This command prints installed model names and sizes.

## 3) High-Level Architecture

Natural language request -> Template router -> (if no template) Local model inference -> SQL extraction -> SQL safety validation -> API response

Components:
- API server: `src/server.ts`
- Query orchestration: `src/services/queryGenerator.ts`
- Template engine: `src/services/templateGenerator.ts`
- Prompt builder: `src/prompt/buildPrompt.ts`
- Ollama client: `src/llm/ollamaClient.ts`
- SQL validation: `src/sql/validateSql.ts`
- Schema source loader: `src/schema/loadSchemaDoc.ts`

## 4) Request Lifecycle (Detailed)

1. User sends request to `POST /api/generate-query` with `input`.
2. App loads schema catalog (from `SCHEMA_DOC_PATH`, `BACKEND_DATABASE_SCHEMA.md`, or `Details.md` fallback path order).
3. Template engine tries deterministic mappings first.
4. If no template matched, app calls `smollm2:135m` via Ollama.
5. Model output is normalized to a single SQL statement.
6. SQL policies and validator enforce:
   - Single statement only
   - Read-only by default (`SELECT` / `WITH ... SELECT`)
   - Known schema objects only
   - Forbidden patterns blocked
7. If valid: return SQL.
8. If invalid: return safe rejection with reasons.

## 5) Deterministic Template Behavior

The app intentionally handles common intents without model inference to avoid hallucinations.

Examples:
- Topic votes ranking
- Organization active members
- Department active members
- User profile lookup by ID
- Organization profile lookup by ID

For this prompt:
- Input: `Give me all the active members of the organisation.`
- Correct SQL now produced:

```sql
SELECT split_part(_key, ':', 2) AS organization_id, member AS uid
FROM legacy_set
WHERE _key LIKE 'organization:%:members:active'
ORDER BY organization_id, uid;
```

Reason:
- Active organization members are stored as set keys matching `organization:{orgId}:members:active` in `legacy_set`.
- `legacy_object_live.type` can only be `hash | zset | set | list | string`, so filtering type by `'members'` or `'active'` is invalid.

## 6) Safety Rules

Read-only guardrails are active by default:
- `ALLOW_WRITE_SQL=false`
- write operations (INSERT/UPDATE/DELETE/etc.) rejected
- unknown tables/views rejected
- multi-statement SQL rejected

This prevents accidental data mutation.

## 7) Configuration

Primary env file: `.env`

Important variables:
- `MODEL_NAME=smollm2:135m`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `AUTO_PULL_MODEL=true`
- `ALLOW_WRITE_SQL=false`
- `ENABLE_EXPLAIN_DRY_RUN=false`
- `SCHEMA_DOC_PATH=` (optional override)

## 8) Run and Validate

### Setup

```powershell
npm run setup:windows:no-start
```

### Start app

```powershell
npm run dev
```

### Health check

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
```

### Generate SQL

```powershell
$body = @{ input = "Give me all the active members of the organisation."; dryRun = $false } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/generate-query" -Method Post -ContentType "application/json" -Body $body
```

### Run tests

```powershell
npm test
```

## 9) Sample Inputs (Based on Your Schema)

Organization and membership:
- Give me all the active members of the organisation
- Get active members for organization 123
- Find organization 15 details
- Show membership 111 record

Department and roles:
- Get active members for department 7
- Show role 789 details
- List departments for organization 123

Users:
- Find user 42 profile hash by key
- Show users sorted by join date top 20

Topics and posts:
- Show top 10 topics by votes
- Show trending topics by votes top 25
- Show topic 456 metadata

Sessions and operational:
- List session rows sorted by expire descending limit 10
- Show non-expired objects from legacy_object_live limit 20

## 10) Known Trade-offs

- A <=300MB model is lightweight but less capable than larger models for complex multi-join reasoning.
- Accuracy is improved by deterministic templates and strict validation.
- For advanced prompts, you can add more templates for consistent precision while keeping the model small.

## 11) Extension Path

If you need better accuracy later while preserving this architecture:
1. Keep templates for high-frequency intents.
2. Add more schema-aware templates.
3. Switch to a stronger model only if your size policy allows it.
