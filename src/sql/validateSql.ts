import { parse } from "pgsql-ast-parser";

import type { SchemaCatalog } from "../schema/types.js";

const WRITE_OPERATION_REGEX =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|copy)\b/i;

export interface SqlValidationResult {
  isValid: boolean;
  reasons: string[];
  warnings: string[];
  referencedTables: string[];
  normalizedSql: string;
}

function normalizeSql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return "";
  }

  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function normalizeIdentifier(value: string): string {
  const withoutQuotes = value.replaceAll('"', "").trim().toLowerCase();
  const parts = withoutQuotes.split(".");
  return parts[parts.length - 1];
}

function extractIdentifier(nameNode: unknown): string | null {
  if (typeof nameNode === "string") {
    return normalizeIdentifier(nameNode);
  }

  if (Array.isArray(nameNode)) {
    const flattened = nameNode
      .filter((part): part is string => typeof part === "string")
      .join(".");

    return flattened.length > 0 ? normalizeIdentifier(flattened) : null;
  }

  if (nameNode && typeof nameNode === "object") {
    const candidate = nameNode as Record<string, unknown>;

    if (typeof candidate.name === "string") {
      return normalizeIdentifier(candidate.name);
    }

    if (typeof candidate.value === "string") {
      return normalizeIdentifier(candidate.value);
    }

    if (candidate.name) {
      return extractIdentifier(candidate.name);
    }

    if (candidate.value) {
      return extractIdentifier(candidate.value);
    }
  }

  return null;
}

function collectTableNames(node: unknown, target: Set<string>): void {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectTableNames(entry, target);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const candidate = node as Record<string, unknown>;

  if (candidate.type === "table") {
    const tableName = extractIdentifier(candidate.name);
    if (tableName) {
      target.add(tableName);
    }
  }

  for (const value of Object.values(candidate)) {
    collectTableNames(value, target);
  }
}

function collectCteNamesFromSql(sql: string): Set<string> {
  const cteNames = new Set<string>();
  const cteRegex = /(?:\bwith\b|,)\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+as\s*\(/gi;

  let match: RegExpExecArray | null = cteRegex.exec(sql);
  while (match) {
    cteNames.add(match[1].toLowerCase());
    match = cteRegex.exec(sql);
  }

  return cteNames;
}

function collectCteNamesFromAst(node: unknown, target: Set<string>): void {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectCteNamesFromAst(entry, target);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const candidate = node as Record<string, unknown>;

  if (candidate.type === "with" || candidate.type === "with_query") {
    const alias = extractIdentifier(candidate.alias) ?? extractIdentifier(candidate.name);
    if (alias) {
      target.add(alias);
    }
  }

  if (candidate.with && Array.isArray(candidate.with)) {
    for (const withEntry of candidate.with) {
      const alias = extractIdentifier(
        (withEntry as Record<string, unknown>).alias ??
          (withEntry as Record<string, unknown>).name
      );
      if (alias) {
        target.add(alias);
      }
    }
  }

  for (const value of Object.values(candidate)) {
    collectCteNamesFromAst(value, target);
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function validateSql(
  sql: string,
  catalog: SchemaCatalog,
  allowWriteSql: boolean
): SqlValidationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const normalizedSql = normalizeSql(sql);
  if (!normalizedSql) {
    reasons.push("empty-sql");
  }

  if (!allowWriteSql && WRITE_OPERATION_REGEX.test(normalizedSql)) {
    reasons.push("write-operation-not-allowed");
  }

  const withoutTrailingSemicolon = normalizedSql.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    reasons.push("multi-statement-not-allowed");
  }

  for (const pattern of catalog.forbiddenSqlPatterns) {
    if (allowWriteSql && pattern.includes("insert|update|delete")) {
      continue;
    }

    const matcher = new RegExp(pattern, "i");
    if (matcher.test(normalizedSql)) {
      reasons.push(`forbidden-pattern:${pattern}`);
    }
  }

  let parsedStatements: unknown[] = [];
  try {
    parsedStatements = parse(normalizedSql);
  } catch {
    reasons.push("invalid-sql-syntax");
  }

  if (parsedStatements.length !== 1) {
    reasons.push("must-be-single-statement");
  }

  const firstStatement = parsedStatements[0] as { type?: string } | undefined;
  const statementType = typeof firstStatement?.type === "string" ? firstStatement.type.toLowerCase() : "";

  if (!allowWriteSql && statementType !== "select") {
    reasons.push("statement-type-not-allowed");
  }

  const referenced = new Set<string>();
  if (firstStatement) {
    collectTableNames(firstStatement, referenced);
  }

  const referencedTables = Array.from(referenced).sort();
  const knownObjects = new Set(catalog.objects.map((objectDef) => objectDef.name.toLowerCase()));

  const cteNames = new Set<string>();
  for (const cteName of collectCteNamesFromSql(normalizedSql)) {
    cteNames.add(cteName);
  }
  collectCteNamesFromAst(firstStatement, cteNames);

  const unknownTables = referencedTables.filter(
    (tableName) => !knownObjects.has(tableName) && !cteNames.has(tableName)
  );

  if (unknownTables.length > 0) {
    reasons.push(`unknown-table:${unknownTables.join(",")}`);
  }

  if (
    referencedTables.includes("legacy_object") &&
    !/\bexpireAt\b/i.test(normalizedSql)
  ) {
    warnings.push("legacy_object used without expireAt filtering");
  }

  const dedupedReasons = dedupe(reasons);
  const dedupedWarnings = dedupe(warnings);

  return {
    isValid: dedupedReasons.length === 0,
    reasons: dedupedReasons,
    warnings: dedupedWarnings,
    referencedTables,
    normalizedSql
  };
}
