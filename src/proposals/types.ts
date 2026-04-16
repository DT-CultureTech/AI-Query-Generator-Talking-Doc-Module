export interface ProposalChunk {
  id?: number;
  proposalName: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  embedding?: number[];
  createdAt?: Date;
}

export interface RagSource {
  proposalName: string;
  excerpt: string;
  distance: number;
}

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
  model: string;
}

export interface IngestResult {
  filesProcessed: string[];
  totalChunks: number;
  skippedFiles: string[];
  errors: Array<{ file: string; error: string }>;
}

export interface ProposalStatus {
  fileName: string;
  proposalName: string;
  chunkCount: number;
  ingestedAt: Date;
}
