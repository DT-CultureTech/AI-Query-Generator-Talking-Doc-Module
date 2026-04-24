// ── Parsed from .md files ────────────────────────────────────────────────────

export interface ParsedDeliverable {
  proposalName: string;
  fileName: string;
  deliverableName: string;
  kpiTarget: string | null;
  kpiReasoning: string | null;
  processSteps: string[];
  timeline: string | null;
  owner: string | null;
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

export interface TsvRow extends ParsedDeliverable {
  id: number;
  createdAt: Date;
}

// ── FAQ cache ─────────────────────────────────────────────────────────────────

export interface FaqEntry {
  id: number;
  queryText: string;
  queryNormalized: string;
  answer: string;
  sourceFile: string | null;
  isSeed: boolean;
  hitCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

// ── RAG service response ──────────────────────────────────────────────────────

export interface RagAnswer {
  answer: string;
  model: string;
  fromCache: boolean;
}
