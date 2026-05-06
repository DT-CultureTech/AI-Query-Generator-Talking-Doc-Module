import fs from "node:fs/promises";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

// Resolve project root (three levels up: ontology.ts → proposals → src → root)
const _ontologyFile = fileURLToPath(import.meta.url);
const _ontologyDir = nodePath.dirname(_ontologyFile);
const _projectRoot = nodePath.resolve(_ontologyDir, "../..");
const ONTOLOGY_PATH = nodePath.join(_projectRoot, "pdgms_ontology.json");

// ── Types ─────────────────────────────────────────────────────────────────────

export type AtomicValue = string | number | boolean | string[] | number[];

export interface OntologyField {
  type: "string" | "number" | "boolean" | "array";
  itemType?: "string" | "number";
  enum?: string[];
  format?: string;
  description?: string;
  example?: unknown;
}

export interface OntologyCategory {
  description: string;
  fields: Record<string, OntologyField>;
}

export interface PdgmsOntology {
  name: string;
  version: string;
  description: string;
  categories: Record<string, OntologyCategory>;
  notes?: string[];
}

// ── Loader (cached) ───────────────────────────────────────────────────────────

let cached: PdgmsOntology | null = null;

export async function loadOntology(): Promise<PdgmsOntology> {
  if (cached) return cached;
  const raw = await fs.readFile(ONTOLOGY_PATH, "utf8");
  cached = JSON.parse(raw) as PdgmsOntology;
  return cached;
}

// ── Key validation ────────────────────────────────────────────────────────────

/**
 * Convert a concrete key like "phases.p1.cost_inr" into its ontology pattern
 * "phases.p{n}.cost_inr" by replacing instance markers (p1, r2, m3, k1, d4).
 */
function toOntologyPattern(key: string): string {
  return key
    .replace(/\.p\d+\./g, ".p{n}.")
    .replace(/\.r\d+\./g, ".r{n}.")
    .replace(/\.m\d+\./g, ".m{n}.")
    .replace(/\.k\d+\./g, ".k{n}.")
    .replace(/\.d\d+\./g, ".d{n}.");
}

/**
 * Returns the matching ontology field for a concrete key, or null if invalid.
 */
export async function resolveKey(key: string): Promise<{ category: string; field: OntologyField } | null> {
  const ontology = await loadOntology();
  const pattern = toOntologyPattern(key);

  for (const [categoryName, category] of Object.entries(ontology.categories)) {
    if (category.fields[pattern]) {
      return { category: categoryName, field: category.fields[pattern] };
    }
  }
  return null;
}

/**
 * Check if a concrete key (e.g. "phases.p1.cost_inr") matches an ontology pattern.
 */
export async function isValidKey(key: string): Promise<boolean> {
  return (await resolveKey(key)) !== null;
}

/**
 * Validate that a value matches the ontology field's expected type.
 */
export function isValidValue(value: unknown, field: OntologyField): boolean {
  switch (field.type) {
    case "string":
      if (typeof value !== "string") return false;
      if (field.enum && !field.enum.includes(value)) return false;
      return true;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      if (!Array.isArray(value)) return false;
      if (field.itemType === "string") {
        return value.every((v) => typeof v === "string");
      }
      if (field.itemType === "number") {
        return value.every((v) => typeof v === "number" && Number.isFinite(v));
      }
      return true;
    default:
      return false;
  }
}

/**
 * Validate a key-value pair fully: key must exist in ontology AND value must
 * match the ontology field's type. Returns { ok: true } or { ok: false, reason }.
 */
export async function validateKeyValue(
  key: string,
  value: unknown
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const resolved = await resolveKey(key);
  if (!resolved) {
    return { ok: false, reason: `Key "${key}" does not match any pattern in the PDGMS Ontology.` };
  }
  if (!isValidValue(value, resolved.field)) {
    return {
      ok: false,
      reason: `Value for "${key}" does not match expected type "${resolved.field.type}${
        resolved.field.itemType ? ` of ${resolved.field.itemType}` : ""
      }".`
    };
  }
  return { ok: true };
}

/**
 * Returns a flat list of all known concrete patterns (for prompt building).
 */
export async function listOntologyPatterns(): Promise<string[]> {
  const ontology = await loadOntology();
  const patterns: string[] = [];
  for (const category of Object.values(ontology.categories)) {
    patterns.push(...Object.keys(category.fields));
  }
  return patterns;
}
