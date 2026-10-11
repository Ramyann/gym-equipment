import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { backendModule } from './backend-modules.ts';
import type { Database } from './studio-db.ts';
test('Nest routes preserve account confirmation, session equipment access, recovery and account isolation', async () => {
  const pg = new PGlite(); await pg.exec(await readFile(new URL('./migrations/001-studio.sql', import.meta.url), 'utf8'));
  const wrap = (connection: Pick<PGlite,'query'>): Database => ({ query: (sql, values) => connection.query(sql, values), transaction: action => pg.transaction(tx => action(wrap(tx))) });
  const origin = 'http://127.0.0.1:5173';
  const emails: string[] = [];
  const app = await NestFactory.create(backendModule({ db: wrap(pg), siteUrl: origin, production: false, verifyEmail: true, sendEmail: async (_to, _subject, text) => { emails.push(text); } }, { AI_PROVIDER: 'mock' }, () => pg.close()), new ExpressAdapter(), { bodyParser: false, logger: false });
  await app.listen(0,'127.0.0.1'); const address = app.getHttpServer().address();
  let cookie = '', accountId = '';
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie, 'x-studio-request': '1', 'x-studio-account': accountId, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, data: await response.json() };
  };
  try {
    const credentials = { email: 'nest-flow@example.invalid', password: 'Local-Studio-Test-123' };
    const signup = await request('studio/signup', credentials); assert.equal(signup.response.status, 200); assert.equal(signup.data.user, null);
    assert.equal((await request('studio/signin', credentials)).response.status, 401);
    const verificationToken = new URL(emails[0].match(/http[^\s]+/)![0]).searchParams.get('verify');
    const verified = await request('studio/verify', { token: verificationToken }); assert.equal(verified.response.status, 200);
    cookie = verified.response.headers.get('set-cookie')!.split(';')[0]; accountId = verified.data.user.id;
    assert.equal((await request('studio/session')).data.user.id, accountId);
    assert.equal((await request('health')).data.provider, 'mock');
    assert.equal((await request('parts/lookup', { query: 'bench' })).response.status, 200);
    assert.equal((await request('studio/recover', { email: credentials.email })).response.status, 200);
    const recoveryToken = new URL(emails.at(-1)!.match(/http[^\s]+/)![0]).searchParams.get('reset');
    assert.equal((await request('studio/reset-password', { token: recoveryToken, password: 'New-local-test-123' })).response.status, 200);
    assert.equal((await request('parts/lookup', { query: 'bench' })).response.status, 401);
    assert.equal((await request('studio/signin', credentials)).response.status, 401);
    assert.equal((await request('studio/signin', { ...credentials, password: 'New-local-test-123' })).response.status, 200);
    assert.equal((await request('studio/reset-password', { token: recoveryToken, password: 'Another-local-test-123' })).response.status, 400);
    assert.equal((await request('unknown')).response.status, 404);
  } finally { await app.close(); }
});
