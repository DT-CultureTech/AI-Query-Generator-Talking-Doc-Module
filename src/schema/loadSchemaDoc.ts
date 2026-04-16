import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { createDefaultCatalog } from "./defaultCatalog.js";
import type { SchemaCatalog, SchemaObject, SchemaObjectKind } from "./types.js";

const AUTO_RESOLVE_CANDIDATES = [
  "BACKEND_DATABASE_SCHEMA.md",
  "Details.md",
  path.join("..", "BACKEND_DATABASE_SCHEMA.md"),
  path.join("..", "Details.md")
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toAbsolute(candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

async function tryResolveExplicitPath(schemaDocPath?: string): Promise<string | null> {
  if (!schemaDocPath) {
    return null;
  }

  const resolved = toAbsolute(schemaDocPath);
  return (await fileExists(resolved)) ? resolved : null;
}

export async function resolveSchemaDocPath(schemaDocPath?: string): Promise<string | null> {
  const explicit = await tryResolveExplicitPath(schemaDocPath);
  if (explicit) {
    return explicit;
  }

  for (const candidate of AUTO_RESOLVE_CANDIDATES) {
    const resolved = toAbsolute(candidate);
    if (await fileExists(resolved)) {
      return resolved;
    }
  }

  return null;
}

function normalizeIdentifier(raw: string): string {
  return raw.replaceAll("\"", "").trim().toLowerCase();
}

function parseTableColumns(createTableBody: string): string[] {
  const columns: string[] = [];
  const columnRegex = /^\s*"([^"]+)"\s+/gm;

  let match: RegExpExecArray | null = columnRegex.exec(createTableBody);
  while (match) {
    columns.push(match[1]);
    match = columnRegex.exec(createTableBody);
  }

  return Array.from(new Set(columns));
}

function parseViewColumns(selectClause: string): string[] {
  const columns = selectClause
    .split(",")
    .map((entry) => entry.replaceAll("\"", "").trim())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(columns));
}

function extractObjectsFromDoc(doc: string): Map<string, SchemaObject> {
  const objects = new Map<string, SchemaObject>();

  const tableRegex = /CREATE\s+TABLE\s+"([^"]+)"\s*\(([\s\S]*?)\);/gi;
  let tableMatch: RegExpExecArray | null = tableRegex.exec(doc);
  while (tableMatch) {
    const name = normalizeIdentifier(tableMatch[1]);
    const columns = parseTableColumns(tableMatch[2]);

    objects.set(name, {
      name,
      kind: "table",
      columns,
      description: "Parsed from schema documentation"
    });

    tableMatch = tableRegex.exec(doc);
  }

  const viewRegex = /CREATE\s+VIEW\s+"([^"]+)"\s+AS\s+SELECT\s+([\s\S]*?)\s+FROM/gi;
  let viewMatch: RegExpExecArray | null = viewRegex.exec(doc);
  while (viewMatch) {
    const name = normalizeIdentifier(viewMatch[1]);
    const columns = parseViewColumns(viewMatch[2]);

    objects.set(name, {
      name,
      kind: "view",
      columns,
      description: "Parsed from schema documentation"
    });

    viewMatch = viewRegex.exec(doc);
  }

  return objects;
}

function extractKeyPatterns(doc: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of doc.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z][a-z0-9:{}_-]+)\s{2,}-\s+(.+)$/i);
    if (!match) {
      continue;
    }

    const keyPattern = match[1].trim();
    if (!keyPattern.includes(":")) {
      continue;
    }

    parsed[keyPattern] = match[2].trim();
  }

  return parsed;
}

function mergeColumns(base: string[], discovered: string[]): string[] {
  const merged = [...base, ...discovered];
  return Array.from(new Set(merged));
}

function mergeObjectKinds(baseKind: SchemaObjectKind, discoveredKind: SchemaObjectKind): SchemaObjectKind {
  if (baseKind === "view" || discoveredKind === "view") {
    return "view";
  }

  return "table";
}

function mergeCatalogObjects(defaultObjects: SchemaObject[], parsedObjects: Map<string, SchemaObject>): SchemaObject[] {
  const merged = defaultObjects.map((defaultObject) => {
    const parsed = parsedObjects.get(defaultObject.name);
    if (!parsed) {
      return defaultObject;
    }

    return {
      ...defaultObject,
      kind: mergeObjectKinds(defaultObject.kind, parsed.kind),
      columns: mergeColumns(defaultObject.columns, parsed.columns),
      description: defaultObject.description
    };
  });

  for (const parsed of parsedObjects.values()) {
    const exists = merged.some((entry) => entry.name === parsed.name);
    if (!exists) {
      merged.push(parsed);
    }
  }

  return merged;
}

export async function loadSchemaCatalog(schemaDocPath?: string): Promise<SchemaCatalog> {
  const resolvedPath = await resolveSchemaDocPath(schemaDocPath);
  if (!resolvedPath) {
    return createDefaultCatalog("embedded-default", "embedded-default");
  }

  const content = await fs.readFile(resolvedPath, "utf8");
  if (content.trim().length === 0) {
    return createDefaultCatalog(
      `embedded-default (empty schema file at ${resolvedPath})`,
      "embedded-default"
    );
  }

  const sourceHash = createHash("sha256").update(content).digest("hex").slice(0, 12);

  const defaults = createDefaultCatalog(resolvedPath, sourceHash);
  const parsedObjects = extractObjectsFromDoc(content);
  const parsedKeyPatterns = extractKeyPatterns(content);

  return {
    ...defaults,
    objects: mergeCatalogObjects(defaults.objects, parsedObjects),
    keyPatterns: {
      ...defaults.keyPatterns,
      ...parsedKeyPatterns
    }
  };
}
