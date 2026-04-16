import type { AppConfig } from "../config/env.js";
import type { SchemaCatalog } from "./types.js";
import { loadSchemaCatalog } from "./loadSchemaDoc.js";

let cacheKey = "";
let cachePromise: Promise<SchemaCatalog> | null = null;

export async function getSchemaCatalog(config: AppConfig): Promise<SchemaCatalog> {
  const nextKey = config.schemaDocPath ?? "__auto__";

  if (!cachePromise || nextKey !== cacheKey) {
    cacheKey = nextKey;
    cachePromise = loadSchemaCatalog(config.schemaDocPath);
  }

  return cachePromise;
}
