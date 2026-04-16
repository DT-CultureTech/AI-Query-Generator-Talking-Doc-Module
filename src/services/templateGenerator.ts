export interface TemplateSqlMatch {
  sql: string;
  reason: string;
}

function normalizeInput(value: string): string {
  return value.toLowerCase().trim().replace(/\borganisation\b/g, "organization");
}

function parseLimit(question: string, defaultLimit = 10): number {
  const limitMatch = question.match(/\blimit\s+(\d+)\b/i) ?? question.match(/\btop\s+(\d+)\b/i);
  if (!limitMatch) {
    return defaultLimit;
  }

  const parsed = Number.parseInt(limitMatch[1], 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultLimit;
  }

  return Math.min(parsed, 200);
}

function extractNumericId(question: string, entity: string): string | null {
  const regex = new RegExp(`${entity}\\s*(?:id)?\\s*[:#-]?\\s*(\\d+)`, "i");
  const match = question.match(regex);
  return match ? match[1] : null;
}

export function tryGenerateTemplateSql(naturalLanguageInput: string): TemplateSqlMatch | null {
  const question = normalizeInput(naturalLanguageInput);

  if (
    /(top\s+\d+\s+topics?.*(vote|votes)|trending\s+topics?|topics?\s+by\s+votes?)/i.test(question)
  ) {
    const limit = parseLimit(question, 10);
    return {
      sql: `SELECT value AS tid, score AS votes FROM legacy_zset WHERE _key = 'topics:votes' ORDER BY score DESC LIMIT ${limit};`,
      reason: "topics-votes-template"
    };
  }

  if (/(session\s+rows?|rows?\s+.*session|sessions?\s+.*expire|expire\s+.*sessions?)/i.test(question)) {
    const limit = parseLimit(question, 10);
    const isAscending = /(asc|ascending|oldest|earliest)/i.test(question);

    return {
      sql: `SELECT sid, sess, expire FROM session ORDER BY expire ${isAscending ? "ASC" : "DESC"} LIMIT ${limit};`,
      reason: "session-expire-order-template"
    };
  }

  if (/(organization\s+.*active\s+members|active\s+members\s+.*organization)/i.test(question)) {
    const organizationId = extractNumericId(question, "organization");
    if (organizationId) {
      return {
        sql: `SELECT member AS uid FROM legacy_set WHERE _key = 'organization:${organizationId}:members:active' ORDER BY member;`,
        reason: "organization-active-members-template"
      };
    }

    return {
      sql: "SELECT split_part(_key, ':', 2) AS organization_id, member AS uid FROM legacy_set WHERE _key LIKE 'organization:%:members:active' ORDER BY organization_id, uid;",
      reason: "organization-active-members-all-template"
    };
  }

  if (/(department\s+.*active\s+members|active\s+members\s+.*department)/i.test(question)) {
    const departmentId = extractNumericId(question, "department");
    if (departmentId) {
      return {
        sql: `SELECT member AS uid FROM legacy_set WHERE _key = 'department:${departmentId}:members:active' ORDER BY member;`,
        reason: "department-active-members-template"
      };
    }
  }

  if (/(user\s+.*profile|profile\s+.*user|find\s+user)/i.test(question)) {
    const userId = extractNumericId(question, "user");
    if (userId) {
      return {
        sql: `SELECT data FROM legacy_hash WHERE _key = 'user:${userId}';`,
        reason: "user-profile-template"
      };
    }
  }

  if (/(topic\s+.*(metadata|details|profile)|find\s+topic)/i.test(question)) {
    const topicId = extractNumericId(question, "topic");
    if (topicId) {
      return {
        sql: `SELECT data FROM legacy_hash WHERE _key = 'topic:${topicId}';`,
        reason: "topic-profile-template"
      };
    }
  }

  if (/(membership\s+.*(metadata|details|record)|find\s+membership)/i.test(question)) {
    const membershipId = extractNumericId(question, "membership");
    if (membershipId) {
      return {
        sql: `SELECT data FROM legacy_hash WHERE _key = 'membership:${membershipId}';`,
        reason: "membership-profile-template"
      };
    }
  }

  if (/(role\s+.*(metadata|details|profile)|find\s+role)/i.test(question)) {
    const roleId = extractNumericId(question, "role");
    if (roleId) {
      return {
        sql: `SELECT data FROM legacy_hash WHERE _key = 'role:${roleId}';`,
        reason: "role-profile-template"
      };
    }
  }

  if (/(organization\s+.*details|organization\s+profile|find\s+organization)/i.test(question)) {
    const organizationId = extractNumericId(question, "organization");
    if (organizationId) {
      return {
        sql: `SELECT data FROM legacy_hash WHERE _key = 'organization:${organizationId}';`,
        reason: "organization-profile-template"
      };
    }
  }

  return null;
}
