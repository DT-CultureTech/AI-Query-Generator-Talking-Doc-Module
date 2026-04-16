export interface PolicyApplicationResult {
  sql: string;
  warnings: string[];
}

const LEGACY_OBJECT_FROM_OR_JOIN_REGEX = /\b(from|join)\s+"?legacy_object"?\b/gi;

export function applySqlPolicies(inputSql: string): PolicyApplicationResult {
  const warnings: string[] = [];

  const touchesLegacyObject = /\b(from|join)\s+"?legacy_object"?\b/i.test(inputSql);
  const referencesExpireAt = /\bexpireAt\b/i.test(inputSql);

  let sql = inputSql;

  if (touchesLegacyObject && !referencesExpireAt) {
    sql = inputSql.replace(LEGACY_OBJECT_FROM_OR_JOIN_REGEX, (_value, joinKeyword) => {
      return `${joinKeyword} legacy_object_live`;
    });

    if (sql !== inputSql) {
      warnings.push(
        "Rewrote legacy_object to legacy_object_live for non-expired object safety."
      );
    }
  }

  return {
    sql,
    warnings
  };
}
