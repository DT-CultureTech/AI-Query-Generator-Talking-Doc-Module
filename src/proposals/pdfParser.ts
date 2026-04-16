import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

// pdf-parse is a CommonJS module; use createRequire to import it in ESM context
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  // Normalise whitespace: collapse runs of whitespace/newlines to single space
  const normalised = text.replace(/\s+/g, " ").trim();

  if (normalised.length === 0) return [];
  if (normalised.length <= chunkSize) return [normalised];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalised.length) {
    const end = Math.min(start + chunkSize, normalised.length);
    const chunk = normalised.slice(start, end).trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // If we've reached the end, stop
    if (end === normalised.length) break;

    start += chunkSize - overlap;
  }

  return chunks;
}

export async function extractTextFromPdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text;
}

function proposalNameFromFileName(fileName: string): string {
  // e.g. "Integrated Spaces Ltd Proposal.pdf" -> "Integrated Spaces Ltd Proposal"
  const base = path.basename(fileName, path.extname(fileName));
  return base.trim();
}

export interface ParsedProposal {
  name: string;
  fileName: string;
  chunks: string[];
}

export async function loadAllProposals(dir: string): Promise<ParsedProposal[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(dir);
  } catch {
    // Directory might not exist or be unreadable; return empty list
    return [];
  }

  const pdfFiles = entries.filter((f) => path.extname(f).toLowerCase() === ".pdf");

  const results: ParsedProposal[] = [];

  for (const fileName of pdfFiles) {
    const filePath = path.join(dir, fileName);
    const text = await extractTextFromPdf(filePath);
    const chunks = chunkText(text);
    results.push({
      name: proposalNameFromFileName(fileName),
      fileName,
      chunks
    });
  }

  return results;
}
