import pg from 'pg';
import { readFile } from 'node:fs/promises';

export interface Database {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(action: (db: Database) => Promise<T>): Promise<T>;
}
export function postgresDatabase(url: string): { db: Database; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  function wrap(query: Database['query']): Database {
    return { query, async transaction(action) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const db: Database = { query: async (sql, values) => client.query(sql, values), transaction: async inner => inner(db) };
        const result = await action(db); await client.query('COMMIT'); return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    } };
  }
  return { db: wrap(async (sql, values) => pool.query(sql, values)), close: () => pool.end() };
}
export async function migrateStudio(db: Database) {
  const sql = await readFile(new URL('./migrations/001-studio.sql', import.meta.url), 'utf8');
  await db.transaction(async tx => { await tx.query('select pg_advisory_xact_lock(1840327521)'); await tx.query(sql); });
}
