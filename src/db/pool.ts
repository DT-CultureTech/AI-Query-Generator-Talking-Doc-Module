import { Pool } from "pg";

let sharedPool: Pool | null = null;

export function getPool(connectionString: string): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString });
  }
  return sharedPool;
}
