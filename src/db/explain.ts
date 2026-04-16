import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(connectionString: string): Pool {
  if (!pool) {
    pool = new Pool({ connectionString });
  }

  return pool;
}

export async function explainQuery(connectionString: string, sql: string): Promise<string[]> {
  const safeSql = sql.trim().replace(/;\s*$/, "");
  const statement = `EXPLAIN ${safeSql}`;

  const result = await getPool(connectionString).query(statement);
  return result.rows.map((row: Record<string, unknown>) => {
    const firstColumnValue = Object.values(row)[0];
    return typeof firstColumnValue === "string"
      ? firstColumnValue
      : JSON.stringify(firstColumnValue);
  });
}
