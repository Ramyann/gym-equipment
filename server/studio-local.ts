/** Local-only development: the actual API backed by embedded PostgreSQL, never used in production. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir } from 'node:fs/promises';
import { createStudioApi } from './studio-api.ts';
import type { Database } from './studio-db.ts';
if (process.env.NODE_ENV === 'production') throw Error('Embedded PostgreSQL is for local development only.');
await mkdir('.verification', { recursive: true });
const pg = new PGlite('.verification/studio-local-db');
await pg.exec(await readFile(new URL('./migrations/001-studio.sql', import.meta.url), 'utf8'));
function wrap(connection: Pick<PGlite, 'query'>): Database {
  const db: Database = { query: (sql, values) => connection.query(sql, values), transaction: action => pg.transaction(tx => action(wrap(tx))) }; return db;
}
const app = createStudioApi({ db: wrap(pg), siteUrl: process.env.SITE_URL ?? 'http://127.0.0.1:5173', production: false, verifyEmail: false });
const server = app.listen(8788, '127.0.0.1', () => console.log('Local Studio API ready on 127.0.0.1:8788 (embedded PostgreSQL, development only).'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { void pg.close().then(() => process.exit(0)); }));
