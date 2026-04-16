export type SchemaObjectKind = "table" | "view";

export interface SchemaObject {
  name: string;
  kind: SchemaObjectKind;
  columns: string[];
  description: string;
}

export interface SchemaCatalog {
  sourcePath: string;
  sourceHash: string;
  objects: SchemaObject[];
  keyPatterns: Record<string, string>;
  allowedQueryPatterns: string[];
  forbiddenSqlPatterns: string[];
}
