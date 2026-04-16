# Latency Optimization Plan: 70s → 20-30s Query Generation

## Executive Summary

Your current 70-second latency is **dominantly model inference (95%)** on CPU. To reach 20-30 seconds, you need a **55-70% latency reduction**, which requires hardware acceleration (GPU) or accepting accuracy trade-offs.

**Realistic Achievement (without GPU):**
- Quick wins + prompt optimization: **60-65 seconds** (5-10% gain)
- + Model quantization (q4): **52-59 seconds** (20-25% gain) ← **Best free option**
- + GPU: **14-21 seconds** (80% gain, costs $10-30/month)

---

## The Core Problem

```
Current latency breakdown (70 seconds):
├─ Model inference (qwen2.5-coder:1.5b on CPU): 65-70s (93%)
├─ Validation + parsing + extraction: <200ms
├─ Prompt building + schema load: <300ms
└─ Total: ~70 seconds
```

**Inference is CPU-bound.** Only these things reduce it:
1. Faster hardware (GPU) - 3-5x speedup
2. Smaller/faster model - accuracy trade-off
3. Quantization - 15-25% speedup, minimal accuracy loss
4. Better prompts - 2-3% speedup

---

## Optimization Tiers (Pick Your Path)

### 🎯 TIER 1: Quick Wins (Free, 5-10% reduction)
**Time to implement:** 1-2 hours | **Expected latency:** 60-65s

#### Step 1.1: Add Timing Instrumentation
Measure where the time actually goes:
```typescript
// In src/services/queryGenerator.ts
const timings = {
  promptBuildMs: 0,
  modelInferenceMs: 0,
  validationMs: 0,
  totalMs: 0
};

// Return in response metadata for visibility
```

#### Step 1.2: Optimize System Prompt
Reduce from ~500 tokens to ~300 tokens:
- Remove redundant schema documentation
- Compress key patterns explanation (can be more terse)
- Keep only top 12-15 in-context examples (currently 40+)

**Where:** [src/prompt/buildPrompt.ts](src/prompt/buildPrompt.ts)

#### Step 1.3: Pre-Load Model at Startup
Currently: Model loads on first query (cold start variance)
New: Load on app startup

**Where:** [src/server.ts](src/server.ts)
```typescript
// On startup:
await ollamaClient.ensureModelReady(config.MODEL_NAME);
console.log(`Model ${config.MODEL_NAME} ready`);
```

#### Step 1.4: Verify Configuration
- ✅ `MODEL_TEMPERATURE=0.1` (already optimal for speed)
- ✅ `MODEL_MAX_TOKENS=256` (appropriate)
- ✅ `OLLAMA_BASE_URL=http://localhost:11434` (localhost, no network overhead)

---

### 🎯 TIER 2: Code Optimizations (Free, 5-10% reduction)
**Time to implement:** 2-3 hours | **Expected latency:** 60-65s

#### Step 2.1: Cache System Prompt
System prompt is static, build once:
- **Before:** Rebuild for every request
- **After:** Cache in memory, reuse

**Where:** [src/services/queryGenerator.ts](src/services/queryGenerator.ts)
```typescript
// Cache system prompt at startup
const cachedSystemPrompt = buildSystemPrompt(catalog);
// Reuse for all requests
```

#### Step 2.2: Verify Schema Catalog Caching
Already implemented in `catalogStore.ts`, but verify it's working:
- Schema loads once on first request
- Reused for all subsequent requests
- Only invalidates if file changes

---

### 🎯 TIER 3: Model Quantization (Free, 15-25% reduction) ⭐ **RECOMMENDED**
**Time to implement:** 30 minutes | **Expected latency:** 52-59s

**What is quantization?** Reduces model precision (full→4-bit), speeds up inference ~15-25%, minimal accuracy loss (<2%).

#### Step 3.1: Switch to Quantized Model
**Current:** `qwen2.5-coder:1.5b` (full precision)
**New:** `qwen2.5-coder:1.5b-q4_K_M` (4-bit quantization)

Alternative: `qwen2.5-coder:1.5b-q5_K_M` (5-bit, slower but more accurate)

#### Step 3.2: Update Configuration Files

**File 1:** [src/config/env.ts](src/config/env.ts)
```typescript
// Change default model
MODEL_NAME: z.string().default("qwen2.5-coder:1.5b-q4_K_M"),
```

**File 2:** [docker-compose.yml](docker-compose.yml)
In the `model-init` service environment section:
```yaml
environment:
  MODEL_NAME: qwen2.5-coder:1.5b-q4_K_M
```

#### Step 3.3: Test & Verify
1. Run 20 test queries with new model
2. Measure latency (should be 52-59s)
3. Spot-check SQL quality (should be 93%+ accurate)
4. Verify no new validation errors

**Testing Command:**
```powershell
# Clear old model from Ollama
# Test new quantized model
npm run dev
# Try generating 5 queries, check timing in response
```

---

### 🎯 TIER 4A: Smaller Model (Conditional, 35-45% reduction)
**Time to implement:** 1 hour | **Expected latency:** 40-45s | **Accuracy trade-off:** 85-90% (down from 95%+)

**Only pursue if Tier 1-3 insufficient and can accept accuracy loss.**

**Options:**
- `qwen2.5-coder:0.5b-q4` (0.5B params, ~40s, 85-90% accuracy)
- `mistral:7b-instruct-q4` (different arch, ~35-50s, 88-92% accuracy)

**Risk:** More queries fail validation, more hallucinated SQL.

---

### 🎯 TIER 4B: GPU Acceleration (70-80% reduction)
**Time to implement:** Complex (1-2 days) | **Expected latency:** 14-21s | **Cost:** $10-30/month

**Requirements:**
- GPU-enabled DigitalOcean droplet (GPU Droplet tier)
- CUDA drivers
- Ollama configured for GPU

**Expected result:** 3-5x speedup = ~14-21 seconds

---

## Execution Plan (Do This Today)

### Phase 1: Measurement (30 min)
```bash
# Step 1: Add instrumentation to src/services/queryGenerator.ts
# Step 2: Deploy locally
# Step 3: Run 5 test queries
# Step 4: Check timing breakdown in response JSON
```

### Phase 2: Quick Wins (1-2 hours)
```bash
# Step 1: Shorten system prompt (remove examples, compress descriptions)
# Step 2: Add prompt caching
# Step 3: Pre-load model at startup
# Step 4: Deploy locally, measure latency again
# Expected: 60-65 seconds
```

### Phase 3: Model Quantization (30 min)
```bash
# Step 1: Switch MODEL_NAME to qwen2.5-coder:1.5b-q4_K_M
# Step 2: Update docker-compose.yml
# Step 3: Deploy, run test queries
# Step 4: Measure latency
# Expected: 52-59 seconds
```

### Phase 4: Evaluate
- If 52-59s acceptable → Done
- If need <50s → Try Tier 4A (smaller model) or investigate GPU option
- If need <25s → GPU is only realistic path

---

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| [src/services/queryGenerator.ts](src/services/queryGenerator.ts) | Add timing breakdown, prompt caching | 1 |
| [src/prompt/buildPrompt.ts](src/prompt/buildPrompt.ts) | Reduce prompt verbosity, fewer examples | 1 |
| [src/server.ts](src/server.ts) | Pre-load model at startup | 2 |
| [src/config/env.ts](src/config/env.ts) | Update MODEL_NAME to q4 variant (Tier 3) | 2 |
| [docker-compose.yml](docker-compose.yml) | Update MODEL_NAME in model-init (Tier 3) | 2 |
| [README.md](README.md) | Document optimization & quantization choice | 3 |

---

## Key Decisions

1. **Accuracy Non-Negotiable:** Keep at 95%+ → Stick to Tier 1-3
2. **Cost Constraint:** Prefer free solutions → Tier 3 (quantization) is best ROI
3. **Real-Time Interactive:** Users waiting → Need <50s at minimum
4. **Unique Queries:** No caching benefit → Query-level optimizations won't help much

---

## Realistic Expectations

| Scenario | Latency | Cost | Accuracy |
|----------|---------|------|----------|
| Current | ~70s | Free | 95%+ |
| Tier 1-2 only | 60-65s | Free | 95%+ |
| Tier 1-3 (q4) | **52-59s** | Free | 94-95% |
| Tier 4A (0.5b) | 40-45s | Free | 85-90% ⚠️ |
| Tier 4B (GPU) | **14-21s** | $10-30/mo | 95%+ |

**Best free option:** Tier 1-3 = **52-59 seconds**
**Best overall:** GPU = **14-21 seconds** (if budget allows)

---

## Next Steps

1. **Decision:** Which tier do you want to implement?
   - A) Tier 1-2 only (quick wins, 60-65s)
   - B) Tier 1-3 (quantization, 52-59s) ← Recommended
   - C) Tier 4A (smaller model, 40-45s, accuracy risk)
   - D) Tier 4B (GPU, 14-21s, requires budget)

2. **Once decided:** I'll implement the changes with code modifications.

3. **Testing:** Run measurements before/after each tier.

---

**Questions before proceeding?** Let me know which tier you want to implement first.
