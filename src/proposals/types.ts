// ── RAG service response ──────────────────────────────────────────────────────

export interface RagAnswer {
  answer: string;
  model: string;
  fromCache: boolean;
  citedKeys?: string[];
  enrichedKeys?: string[];
  sourceProposals?: string[];
}
