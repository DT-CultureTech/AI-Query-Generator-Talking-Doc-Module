import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedDeliverable } from "./types.js";

// ── Text extraction helpers ───────────────────────────────────────────────────

const BULLET_RE = /^[ \t]*(?:[●○•\-\*]|\d+\.)\s+(.+)/;

// Matches common time/duration expressions found in the proposal documents
const TIMELINE_RE =
  /\b(\d+[\s-]*(?:working[\s-]*)?(?:day|week|month|year)s?(?:\s+(?:commitment|retainer|engagement))?|\d+[\s-]*minute(?:\s+call)?|within\s+\d+(?:\s+working)?\s+(?:day|week|hour)s?|Days?\s*\d+[–\-]+\d+|Phase\s+\d+[^\n]*?Days?\s*[\d–\-]+|Q[1-4]\s*\d{4})\b/gi;

const KPI_LINE_RE = /(?:core\s+)?KPI[s]?\s*[:\-]\s*(.+)/i;
const EXPLICIT_TARGET_RE = /(?:target|goal|objective|KPI)\s*[:\-]\s*(.+)/i;

function cleanHeading(text: string): string {
  return text
    .replace(/^\d+\.\s+/, "")   // strip leading "1. "
    .replace(/^[A-Z]\.\s+/, "") // strip leading "A. "
    .replace(/\s*[:\-–]\s*$/, "") // strip trailing punctuation
    .replace(/\*\*/g, "")
    .trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1")      // italic
    .replace(/```[\s\S]*?```/gm, "")  // code blocks
    .replace(/`(.+?)`/g, "$1")        // inline code
    .trim();
}

function extractBullets(body: string): string[] {
  const results: string[] = [];
  for (const line of body.split("\n")) {
    const m = BULLET_RE.exec(line);
    if (m) {
      const cleaned = stripMarkdown(m[1]).trim();
      if (cleaned.length > 3) results.push(cleaned);
    }
  }
  return results;
}

function extractTimeline(body: string): string | null {
  const raw = body.match(TIMELINE_RE);
  if (!raw || raw.length === 0) return null;
  const unique = [...new Set(raw.map((m) => m.trim()))];
  return unique.slice(0, 3).join("; ");
}

function extractKpiTarget(heading: string, body: string): string | null {
  // Heading itself signals a KPI or objective
  if (/\b(KPI|objective|target|goal)\b/i.test(heading)) return cleanHeading(heading);

  for (const line of body.split("\n")) {
    const kpiMatch = KPI_LINE_RE.exec(line);
    if (kpiMatch) return stripMarkdown(kpiMatch[1]).slice(0, 300).trim() || null;
    const targetMatch = EXPLICIT_TARGET_RE.exec(line);
    if (targetMatch && line.length < 200) {
      return stripMarkdown(targetMatch[1]).slice(0, 300).trim() || null;
    }
  }
  return null;
}

function extractOwner(body: string): string | null {
  // "Submitted by: X" pattern
  const submittedBy = /Submitted\s+by\s*[:\-]\s*([^\n]+)/i.exec(body);
  if (submittedBy) return stripMarkdown(submittedBy[1]).trim();

  // Check for explicit responsibility lines
  for (const line of body.split("\n")) {
    if (/\b(DT|DeepThought|DT Fellow|Fellow)\b.*\b(is|will|shall|are)\b.*\b(responsible|accountable|lead)\b/i.test(line)) {
      return "DeepThought (DT)";
    }
    if (/\b(Client|Munchable|company)\b.*\b(is|will)\b.*\b(responsible|accountable)\b/i.test(line)) {
      return "Client";
    }
  }

  // Implicit: if section is about DT's role
  if (/\bDT(?:'s|\s+is|\s+will|\s+shall)\b/i.test(body)) return "DeepThought (DT)";
  if (/\bClient(?:'s|\s+is|\s+must)\b/i.test(body)) return "Client";

  return null;
}

// ── Section splitting ─────────────────────────────────────────────────────────

interface Section {
  heading: string;
  body: string;
}

function splitIntoSections(content: string): Section[] {
  // Normalize CRLF and lone CR to LF so the heading regex works on all platforms
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const sections: Section[] = [];

  let currentHeading = "";
  let currentLines: string[] = [];
  let seenFirstHeading = false;

  for (const line of lines) {
    // Match any H2–H6 heading
    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
    if (headingMatch) {
      if (seenFirstHeading) {
        const body = currentLines.join("\n").trim();
        if (body.length > 20) {
          sections.push({ heading: currentHeading, body });
        }
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [];
      seenFirstHeading = true;
    } else if (seenFirstHeading) {
      currentLines.push(line);
    }
  }

  // Flush the last section
  if (seenFirstHeading) {
    const body = currentLines.join("\n").trim();
    if (body.length > 20) {
      sections.push({ heading: currentHeading, body });
    }
  }

  return sections;
}

// ── Main parser ───────────────────────────────────────────────────────────────

function sectionToDeliverable(
  section: Section,
  proposalName: string,
  fileName: string
): ParsedDeliverable | null {
  const { heading, body } = section;
  const cleanBody = stripMarkdown(body);

  // Skip sections that are too thin (just a heading, no real content)
  if (cleanBody.length < 30) return null;

  const bullets = extractBullets(body);
  const timeline = extractTimeline(body);
  const kpiTarget = extractKpiTarget(heading, body);
  const owner = extractOwner(body);

  // kpiReasoning: first substantive paragraph (skip bullets)
  const paragraphs = cleanBody
    .split(/\n\n+/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 30 && !BULLET_RE.test(p));
  const kpiReasoning = paragraphs[0]?.slice(0, 500) ?? null;

  return {
    proposalName,
    fileName,
    deliverableName: cleanHeading(heading),
    kpiTarget,
    kpiReasoning,
    processSteps: bullets,
    timeline,
    owner
  };
}

function proposalNameFromFileName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  // "Proposal _ Munchable.tv _ DT Intrapreneur Programme" → "Munchable.tv – DT Intrapreneur Programme"
  // "Unique International _ GTG Proposal" → "Unique International – GTG Proposal"
  return base.replace(/\s*_\s*/g, " – ").replace(/\s*–\s*Proposal\s*$/i, "").trim();
}

export async function loadAllMarkdownProposals(dir: string): Promise<ParsedDeliverable[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    console.warn(`[mdParser] Could not read proposals directory "${dir}":`, err instanceof Error ? err.message : err);
    return [];
  }

  const mdFiles = entries.filter((f) => path.extname(f).toLowerCase() === ".md");
  const all: ParsedDeliverable[] = [];

  for (const fileName of mdFiles) {
    const filePath = path.join(dir, fileName);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const proposalName = proposalNameFromFileName(fileName);
      const sections = splitIntoSections(content);
      const deliverables = sections
        .map((s) => sectionToDeliverable(s, proposalName, fileName))
        .filter((d): d is ParsedDeliverable => d !== null);
      all.push(...deliverables);
    } catch (err) {
      console.warn(`[mdParser] Could not parse ${fileName}:`, err instanceof Error ? err.message : err);
    }
  }

  return all;
}
