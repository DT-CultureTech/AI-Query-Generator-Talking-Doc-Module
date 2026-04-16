# PDGMS AI Query Generator - Brief

## Purpose

PDGMS AI Query Generator converts natural language into safe PostgreSQL read-only SQL for the backend schema in `Details.md`.

## Current Model

- Model: `smollm2:135m`
- Runtime: Ollama (local)
- Size policy: `MAX_MODEL_SIZE_MB=300`
- Why this model:
  - Fits your hard requirement for a very small local model
  - Works on low-resource systems
  - Keeps setup and download lightweight

## Why This Still Works Reliably

A very small model can be weaker for complex SQL reasoning, so reliability is protected by deterministic templates and validation:

1. Template-first routing handles common intents without model inference.
2. Model is used only when no template matches.
3. Output is validated by strict SQL safety rules.

This architecture gives practical accuracy while keeping model size very low.

## Key Parameters and Why

- `MODEL_NAME=smollm2:135m`
  - Enforces small model usage.
- `MAX_MODEL_SIZE_MB=300`
  - Hard upper bound for model size policy.
- `MODEL_TEMPERATURE=0.1`
  - Low randomness for more stable SQL output.
- `MODEL_MAX_TOKENS=512`
  - Sufficient generation length while reducing verbose drift.
- `MODEL_TIMEOUT_MS=30000`
  - Avoids indefinite waits on inference requests.
- `MODEL_PULL_TIMEOUT_MS=600000`
  - Allows enough time for initial model download.
- `AUTO_PULL_MODEL=true`
  - Installs missing configured model automatically.
- `ALLOW_WRITE_SQL=false`
  - Blocks write operations for safety.
- `ENABLE_EXPLAIN_DRY_RUN=false`
  - Off by default to avoid DB dependency unless explicitly enabled.

## Input to SQL Flow

1. User sends text to `POST /api/generate-query`.
2. App loads schema catalog from docs (`Details.md` and fallback order).
3. Template engine checks known intents first.
4. If no template matches, app queries Ollama model.
5. SQL is extracted and normalized.
6. SQL policies and validator run:
   - single statement only
   - read-only only (unless explicitly allowed)
   - known tables/views only
   - forbidden patterns blocked
7. Safe SQL is returned; unsafe SQL is rejected with reasons.

## Important Deterministic Templates Included

- Top topics by votes
- Organization active members (supports both "organization" and "organisation")
- Department active members
- Session rows sorted by expire
- User profile by id
- Topic metadata by id
- Membership record by id
- Role details by id
- Organization details by id

## Example of Fixed Behavior

Input:
- `Give me all the active members of the organisation.`

Output:
- `SELECT split_part(_key, ':', 2) AS organization_id, member AS uid FROM legacy_set WHERE _key LIKE 'organization:%:members:active' ORDER BY organization_id, uid;`

Why this is correct:
- Active members are represented by key patterns in `legacy_set`.
- `legacy_object_live.type` stores object kinds (`hash|zset|set|list|string`), not business labels like `members` or `active`.

## API Endpoints

- `GET /api/health`
  - Shows active model, max size policy, and safety flags.
- `GET /api/schema-info`
  - Shows schema source and object metadata.
- `POST /api/generate-query`
  - Main natural language to SQL endpoint.

## What To Expect from a Tiny Model

- Strong performance on template-covered requests.
- Acceptable results for simple non-template prompts.
- For difficult ad hoc prompts, validation may reject model output instead of returning unsafe SQL.

This is an intentional safety-first behavior.
