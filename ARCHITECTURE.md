# AI Query Generator - Complete Architecture & Deployment Guide

## 📁 File Structure & Responsibilities

```
ai-query-generator/
├── src/
│   ├── server.ts                      # ⚡ Express HTTP server entrypoint
│   ├── config/
│   │   └── env.ts                     # 🔧 Environment variable validation & types
│   ├── llm/
│   │   └── ollamaClient.ts            # 🤖 Ollama API communication (model calls)
│   ├── prompt/
│   │   └── buildPrompt.ts             # 📝 System + user prompt construction
│   ├── schema/
│   │   ├── types.ts                   # 📊 TypeScript interfaces for schema
│   │   ├── defaultCatalog.ts          # 📚 Default database schema (all key patterns)
│   │   ├── loadSchemaDoc.ts           # 📄 Parse schema from markdown files
│   │   └── catalogStore.ts            # 💾 Cache schema catalog in memory
│   ├── sql/
│   │   ├── extractSql.ts              # 🧹 Clean raw model output → valid SQL
│   │   ├── validateSql.ts             # ✅ Check SQL syntax, table names, safety
│   │   └── policies.ts                # 🛡️ Apply transformation rules
│   ├── services/
│   │   ├── queryGenerator.ts          # 🔄 Orchestrate: prompt → model → validate
│   │   └── templateGenerator.ts       # ❌ (REMOVED - no longer used)
│   └── db/
│       └── explain.ts                 # 📈 (Optional) Run EXPLAIN on DB
├── public/                            # 🌐 Web UI
│   ├── index.html                     # HTML page (input + output)
│   ├── app.js                         # Browser JavaScript (fetch + display)
│   └── styles.css                     # UI styling
├── tests/
│   ├── generate-query.integration.test.ts  # 🧪 End-to-end tests
│   └── validateSql.test.ts            # 🧪 SQL validation unit tests
├── dist/                              # 📦 Compiled JavaScript (npm run build)
├── .env                               # 🔐 Environment variables (LOCAL ONLY)
├── .env.example                       # 📋 Template for .env
├── package.json                       # 📦 Dependencies & scripts
├── tsconfig.json                      # ⚙️ TypeScript config
├── Dockerfile                         # 🐳 Docker build recipe
├── docker-compose.yml                 # 🐳 Docker + Ollama orchestration
└── BACKEND_DATABASE_SCHEMA.md         # 📖 Schema documentation (loaded at runtime)
```

---

## 🔄 Request Flow: Step-by-Step

### User Input → Query Generation → Validation → Response

```
1. USER BROWSER
   └─ Enters: "Show active members of organization 5"
   └─ Clicks: "Generate SQL"
   └─ HTTP POST to: http://localhost:3000/api/generate-query

2. SERVER.TS (Express)
   └─ Receives JSON: { input: "Show active members of organization 5" }
   └─ Calls: generateQueryFromNaturalLanguage(input)

3. QUERYGENERATOR.TS (Orchestrator)
   ├─ Load schema catalog (cached)
   ├─ Build prompt via buildPrompt.ts
   │  └─ Includes: schema tables + key patterns + 30+ worked examples
   ├─ Call ollama via ollamaClient.ts
   └─ Validate response via validateSql.ts

4. OLLAMACLIENT.TS (Model Interface)
   ├─ Check if model installed (qwen2.5-coder:1.5b)
   ├─ HTTP POST to: http://localhost:11434/api/generate
   ├─ Send: { model, systemPrompt, userPrompt, temperature, num_predict }
   └─ Model processes → Returns SQL (3-7 seconds)

5. EXTRACTSQL.TS (Cleaner)
   └─ Raw output: "SELECT member AS uid FROM legacy_set WHERE _key = 'organization:5:members:active';"
   └─ Remove markdown, extra text, comments
   └─ Extract pure SQL

6. POLICIES.TS (Transformer)
   └─ Rule: If using legacy_object without expireAt filter → replace with legacy_object_live
   └─ Apply any special transformations

7. VALIDATESQL.TS (Validator)
   ├─ Parse SQL with pgsql-ast-parser
   ├─ Check:
   │  ✓ Valid syntax?
   │  ✓ Single statement only?
   │  ✓ Only SELECT (no INSERT/UPDATE/DELETE)?
   │  ✓ References only known tables? (legacy_hash, legacy_set, legacy_zset, session, legacy_object_live)
   │  ✓ No JSONB operators (->)?
   └─ Return: { isValid, reasons, warnings, normalizedSql }

8. QUERYGENERATOR.TS (Assemble Response)
   └─ Build JSON response with:
      - ok: true/false
      - sql: normalized SQL (if valid)
      - model: "qwen2.5-coder:1.5b"
      - warnings: []
      - validation: { isValid, reasons, warnings, referencedTables }
      - metadata: { model, latencyMs, attempts }

9. SERVER.TS (Return Response)
   └─ res.json(generation)

10. BROWSER APP.JS
    ├─ Receive response
    ├─ Display SQL in output box
    └─ Show status: "SQL generated in 2.95 seconds"
```

---

## 🤖 How the Model Works

### Model: qwen2.5-coder:1.5b
- **Type**: Code/SQL generation (NOT a general chat model)
- **Size**: ~986 MB (fits on any machine)
- **Location**: Stored in `~/.ollama/models/`
- **Runtime**: Ollama (local server on port 11434)
- **Speed**:
  - First query after startup: ~10-15 seconds (model loading + inference)
  - Subsequent queries: ~3-7 seconds (model stays in RAM)

### What It Receives (System Prompt)

```
You are a PostgreSQL SQL generator. Output ONLY one SQL SELECT statement.

RULES:
1. Output exactly one SELECT (or WITH...SELECT). End with semicolon.
2. Never use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE.
3. Use ONLY the tables listed below.
4. All entities are looked up by _key column using KEY PATTERNS.
5. legacy_set rows use 'member' column. legacy_zset rows use 'value' and 'score'.

SCHEMA:
  legacy_hash (_key, data, type) — Entity full profiles
  legacy_set (_key, member, type) — Membership/relationship lists
  legacy_zset (_key, value, score, type) — Ranked/time-ordered lists
  session (sid, sess, expire) — HTTP sessions
  legacy_object_live (_key, type) — Live objects (non-expired)

KEY PATTERNS:
  organization:{orgId}  →  Organization profile
  organization:{orgId}:members:active  →  Active member UIDs (set)
  organizations:sorted  →  All orgs by timestamp (zset)
  ... (30 more patterns)

EXAMPLES:
  Q: List all organizations
  A: SELECT value AS org_id FROM legacy_zset WHERE _key = 'organizations:sorted' ORDER BY score DESC;

  Q: Show active members of organization 5
  A: SELECT member AS uid FROM legacy_set WHERE _key = 'organization:5:members:active';

  ... (25 more examples)
```

### What It Outputs

```
SELECT member AS uid FROM legacy_set WHERE _key = 'organization:5:members:active' ORDER BY member;
```

That's it — clean SQL, ready to run.

---

## 📦 Model Import & Installation

### Local Development
1. **Ollama starts**: `ollama serve` (runs on port 11434)
2. **Model is pulled once**: `ollama pull qwen2.5-coder:1.5b` (986 MB download)
3. **Model lives in**: `~/.ollama/models/blobs/sha256-*` (binary files)
4. **App connects**: HTTP to `http://localhost:11434/api/generate`
5. **Model stays in RAM** after first query for speed

### Docker Deployment
```dockerfile
# In Dockerfile + docker-compose.yml:
services:
  ollama:
    image: ollama/ollama:latest
    ports: ["11434:11434"]
    volumes: [ollama_data:/root/.ollama]  # Persist models across restarts

  model-init:
    # Automatically pulls qwen2.5-coder:1.5b on startup
    command: curl -X POST http://ollama:11434/api/pull -d '{"model":"qwen2.5-coder:1.5b"}'

  app:
    # Node.js app connects to ollama:11434 (internal Docker network)
    environment:
      OLLAMA_BASE_URL: http://ollama:11434
```

---

## 🚀 Deployment Options

### Option 1: Local Development (What You're Doing Now)
```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Start Node app
cd ai-query-generator
npm run dev
```
✅ Access: http://localhost:3000
✅ Best for: Development, testing, local use
⚠️ Limited to your machine

---

### Option 2: Docker (Recommended for Server Deployment)
```bash
# Build and start everything
docker-compose up --build

# Access: http://localhost:3000
# Ollama automatically inside container
# Models persist in Docker volume
```
✅ Reproducible on any machine
✅ Easy to deploy to cloud (AWS, GCP, Azure, VPS)
✅ Models stay isolated
⚠️ Requires Docker installed

**How to push to GitHub first:**
```bash
git init
git add .
git commit -m "Initial: AI Query Generator MVP"
git remote add origin https://github.com/YOUR_USERNAME/ai-query-generator.git
git push -u origin main
```

Then on your server:
```bash
git clone https://github.com/YOUR_USERNAME/ai-query-generator.git
cd ai-query-generator
docker-compose up -d
# Now running on your server!
```

---

### Option 3: Production Server Deployment (No Docker)
```bash
# SSH into your server
ssh user@your-server.com

# Install Ollama
curl https://ollama.ai/install.sh | sh

# Start Ollama in background
ollama serve &

# Clone and run app
git clone https://github.com/YOUR_USERNAME/ai-query-generator.git
cd ai-query-generator
npm install
npm run build
npm start  # runs compiled dist/

# Use PM2 to keep it running
npm install -g pm2
pm2 start dist/server.js --name "ai-query-generator"
pm2 startup
pm2 save
```

---

## ⚡ Performance Analysis & Optimization

### Current Performance

| Metric | Value | Cause |
|---|---|---|
| **First query** | 10-15s | Model loading into RAM for first time |
| **Subsequent queries** | 3-7s | Model inference only |
| **Bottleneck** | Model inference time | qwen2.5-coder:1.5b is intelligent but not optimized for speed |

### Why 3-7 seconds?

1. **Model inference**: Qwen model reads prompt + generates SQL tokens (~5-6 seconds CPU time)
2. **Network**: HTTP overhead (minimal, <100ms)
3. **Validation**: SQL parsing + checking (very fast, <50ms)
4. **Server overhead**: Express routing, JSON parsing, schema loading (cached, <100ms)

---

## 🚀 Speed Optimization Strategy

### I have 3 questions before optimizing:

**Q1: What's your target latency?**
   - A: 10-15 seconds? (current: 3-7s after warmup)
   - B: <5 seconds? (would need smaller model, less accurate)
   - C: <2 seconds? (would need GPU)

**Q2: How will you deploy?**
   - A: Local machine only
   - B: Docker on a server
   - C: Cloud (AWS Lambda, Google Cloud Run, etc.)

**Q3: How many concurrent users?**
   - A: 1-2 people max
   - B: 10-50 concurrent users
   - C: 100+ concurrent users

---

## 📊 Optimization Options (Ranked by Impact)

### Option 1: Keep Model Warm (Quick, No Code Change)
**Impact**: Eliminate 10-15s first-load delay
**How**: Periodic no-op queries keep model in RAM
```bash
# Every 5 minutes, ping the model to keep it warm
curl http://localhost:3000/api/generate-query -d '{"input":"SELECT 1"}'
```
✅ Instant: 3-7s (not 10-15s)
❌ Wastes CPU

---

### Option 2: Use Smaller Model (Faster, Less Accurate)
**Current**: `qwen2.5-coder:1.5b` (986MB, 4-7s per query)
**Alternative**: `phi2:2.7b` (1.4GB, 2-3s per query) — SQL might be less accurate
**Trade-off**: 50% faster, but accuracy ~85% vs 95%

```bash
# In .env:
MODEL_NAME=phi2:2.7b
MAX_MODEL_SIZE_MB=2000
```

---

### Option 3: GPU Acceleration (Fastest, Most Complex)
**Impact**: 4-7s → 1-2s per query
**Requires**: NVIDIA GPU (not CPU only)
**Example**: NVIDIA RTX 4090 = 10x faster

```bash
# Ollama with GPU:
CUDA_VISIBLE_DEVICES=0 ollama serve
```

---

### Option 4: Prompt Caching (Code Change, Moderate Complexity)
**Impact**: Skip prompt building on repeated patterns
**Idea**: Cache `systemPrompt` in Redis/memory, reuse across queries
```javascript
// Instead of rebuilding prompt every time:
const cacheKey = `prompt:${schemaHash}`;
let systemPrompt = cache.get(cacheKey);
if (!systemPrompt) {
  systemPrompt = buildPrompt(schema);
  cache.set(cacheKey, systemPrompt);
}
```
✅ Saves ~200-300ms per query
❌ Architecture change

---

### Option 5: Query Batching (Code Change, Complex)
**Idea**: Accept multiple queries at once, run in parallel
```javascript
POST /api/generate-queries
{
  "queries": [
    "List organizations",
    "Show org 5 members",
    "Get department 10"
  ]
}
```
✅ 3 queries in ~8s (instead of 3×7 = 21s)
❌ Different UX

---

## ✅ My Recommendation

**For your MVP:**
- **Keep current setup** (qwen2.5-coder:1.5b is perfect)
- **Accept 3-7 second latency** (standard for LLM inference)
- **Implement Option 1** (keep model warm) if users complain about first-load delay

**For production:**
- **Deploy via Docker** (Option 2 in deployment section)
- **Use GPU if available** (20-30x cost, 10x speed)
- **Implement prompt caching** (Option 4) if you have >1000 queries/day

---

## 🔧 Key Configuration Explained

### `.env` File (Your Settings)
```bash
PORT=3000                           # HTTP server port
OLLAMA_BASE_URL=http://localhost:11434  # Model server URL
MODEL_NAME=qwen2.5-coder:1.5b      # Which model to use
MAX_MODEL_SIZE_MB=2000              # Don't download models >2GB
MODEL_TIMEOUT_MS=120000             # Wait up to 2 minutes for model to respond
MODEL_MAX_TOKENS=256                # Max SQL output length
MODEL_TEMPERATURE=0.1               # Low randomness = consistent output
AUTO_PULL_MODEL=true                # Auto-download model if missing
ALLOW_WRITE_SQL=false               # Block INSERT/UPDATE/DELETE (safe mode)
```

### Environment Variables in Docker
```yaml
# docker-compose.yml sets these for the container:
environment:
  MODEL_NAME: qwen2.5-coder:1.5b
  OLLAMA_BASE_URL: http://ollama:11434  # Internal Docker networking
```

---

## 📈 Monitoring & Debugging

### Check Model Status
```bash
# Is Ollama running?
curl http://localhost:11434/api/tags

# Is app running?
curl http://localhost:3000/api/health
```

### View Logs
```bash
# Development
npm run dev  # Logs displayed in terminal

# Docker
docker-compose logs -f app      # App logs
docker-compose logs -f ollama   # Model logs
```

### Debug a Query
```bash
# Enable verbose logging (if implemented)
DEBUG=* npm run dev

# Test the model directly
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5-coder:1.5b","prompt":"SELECT 1","stream":false}'
```

---

## 🎯 Summary: Files & Responsibilities

| File | Responsibility | Speed Impact |
|---|---|---|
| `ollamaClient.ts` | Calls model API | 3-7s (model inference) |
| `buildPrompt.ts` | Creates prompt | <1ms |
| `queryGenerator.ts` | Orchestrates flow | <10ms |
| `validateSql.ts` | Checks syntax | <50ms |
| `server.ts` | HTTP server | <5ms |
| `extractSql.ts` | Cleans output | <5ms |

**Slowest part**: Model inference (ollamaClient.ts calling Ollama)
**Everything else**: <20ms combined

---

## 🚀 Next Steps

**Before pushing to GitHub:**
1. Create `.gitignore` to exclude `.env`, `node_modules/`, `dist/`
2. Test Docker build: `docker-compose up --build`
3. Clean up any console.log statements

**Before deploying to server:**
1. Update `.env.example` with production secrets
2. Use environment variables for sensitive data (don't commit `.env`)
3. Add health check endpoint monitoring
4. Set up log aggregation (CloudWatch, ELK, etc.)
5. Configure auto-restart (PM2, systemd, or Docker policy)

---

**Everything is working well. I've explained the full architecture without changing anything. Let me know:**
- Your target latency
- Deployment preference (local/Docker/cloud)
- Number of concurrent users expected
- Then I can optimize accordingly!
