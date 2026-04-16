import { createDefaultCatalog } from "../src/schema/defaultCatalog.js";
import { applySqlPolicies } from "../src/sql/policies.js";
import { validateSql } from "../src/sql/validateSql.js";

describe("validateSql", () => {
  const catalog = createDefaultCatalog("test", "test");

  it("accepts read-only SQL on known schema objects", () => {
    const result = validateSql(
      "SELECT value, score FROM legacy_zset WHERE _key = 'topics:votes' ORDER BY score DESC LIMIT 10;",
      catalog,
      false
    );

    expect(result.isValid).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.referencedTables).toEqual(["legacy_zset"]);
  });

  it("rejects write operations when read-only mode is enabled", () => {
    const result = validateSql(
      "DELETE FROM legacy_hash WHERE _key = 'user:1';",
      catalog,
      false
    );

    expect(result.isValid).toBe(false);
    expect(result.reasons).toContain("write-operation-not-allowed");
  });

  it("rejects unknown tables", () => {
    const result = validateSql("SELECT * FROM imaginary_table;", catalog, false);

    expect(result.isValid).toBe(false);
    expect(result.reasons.some((reason) => reason.startsWith("unknown-table:"))).toBe(true);
  });

  it("rewrites legacy_object to legacy_object_live when possible", () => {
    const policyResult = applySqlPolicies("SELECT _key, type FROM legacy_object WHERE type = 'hash';");

    expect(policyResult.sql).toContain("legacy_object_live");
    expect(policyResult.warnings.length).toBeGreaterThan(0);
  });
});
