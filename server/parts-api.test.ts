import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createStudioApi } from './studio-api.ts';
import { mountPartsApi } from './parts-api.ts';
import type { Database } from './studio-db.ts';
import { createGym } from '../src/state/gym-designs.ts';
import { parseSpec, reviewSpec, provenance } from '../src/ai-parts/spec.ts';

let pg: PGlite, db: Database;
before(async () => { pg = new PGlite(); await pg.exec(await readFile(new URL('./migrations/001-studio.sql', import.meta.url), 'utf8')); const wrap = (connection: Pick<PGlite,'query'>): Database => ({ query: (sql, values) => connection.query(sql, values), transaction: action => pg.transaction(tx => action(wrap(tx))) }); db = wrap(pg); });
after(async () => pg.close());
async function fixture(limit = '20', settings = {}) {
  const siteUrl = 'http://127.0.0.1:5173';
  const app = createStudioApi({ db, siteUrl, production: false, verifyEmail: false });
  mountPartsApi(app, db, siteUrl, { AI_PROVIDER: 'mock', AI_USER_DAILY_LIMIT: limit, DAILY_LIMIT: '100', ...settings });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  let cookie = '', id = '';
  const request = (path: string, body?: unknown, method = 'POST', origin = siteUrl) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: body === undefined ? 'GET' : method, headers: { cookie, 'x-studio-account': id, origin, 'x-studio-request': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async (route = 'signup', email = `parts-${crypto.randomUUID()}@example.invalid`) => { const response = await request(`/api/studio/${route}`, { email, password: 'Studio-flow-test-123' }); assert.ok(response.ok); const data = await response.json(); cookie = response.headers.get('set-cookie')!.split(';')[0]; id = data.user.id; return email; };
  return { request, login, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
test('complete account, photo template, gym and equipment saving survives signout and fresh login', async () => {
  const f = await fixture();
  try {
    const email = await f.login();
    const analysis = await f.request('/api/parts/lookup', { query: 'Photographed bench', image: { media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=' } });
    assert.equal(analysis.status, 200); const result = await analysis.json(); assert.equal(result.provider, 'mock');
    const spec = parseSpec(result.spec), review = reviewSpec(spec);
    const gym = createGym({ name: 'Saved flow gym', type: 'home', client: '', width: 6000, length: 5000, height: 3000, starter: 'empty' });
    const custom = { id: crypto.randomUUID(), name: 'Saved photo bench', part: spec.template, params: review.params, defaults: review.params, ai: provenance(spec, review, 'mock:mock', {}) };
    const data = { values: { 'bos-strength-configurations-v1': JSON.stringify({ version: 2, configs: [gym], activeId: gym.id, draft: null }), 'bos-strength-custom-parts-v1': JSON.stringify({ version: 1, parts: [custom] }) } };
    const saved = await f.request('/api/studio/workspace', { revision: 0, data }, 'PUT'); assert.equal(saved.status, 200);
    assert.equal((await f.request('/api/studio/signout', {})).status, 200);
    assert.equal((await f.request('/api/studio/workspace')).status, 401);
    await f.login('signin', email);
    assert.deepEqual((await (await f.request('/api/studio/workspace')).json()).data, data);
    await f.login();
    assert.deepEqual((await (await f.request('/api/studio/workspace')).json()).data, { values: {} });
  } finally { await f.close(); }
});
test('equipment requires account, same-origin request and valid photo; daily quota is durable', async () => {
  const f = await fixture('1');
  try {
    assert.equal((await f.request('/api/parts/lookup', { query: 'bench' })).status, 401);
    await f.login();
    assert.equal((await f.request('/api/parts/lookup', { query: 'bench' }, 'POST', 'https://attacker.invalid')).status, 403);
    assert.equal((await f.request('/api/parts/lookup', { image: { media_type: 'text/html', data: 'AAAA' } })).status, 400);
    assert.equal((await f.request('/api/parts/lookup', { query: 'bench' })).status, 200);
    assert.equal((await f.request('/api/health')).status, 200);
    assert.equal((await (await f.request('/api/health')).json()).used, 1);
    const cached = await f.request('/api/parts/lookup', { query: 'bench' });
    assert.equal(cached.status, 200);
    assert.equal((await cached.json()).cached, true);
    assert.equal((await (await f.request('/api/health')).json()).used, 1);
    assert.equal((await f.request('/api/parts/lookup', { query: 'bike' })).status, 429);
  } finally { await f.close(); }
});
test('provider failure refunds reserved quota', async () => {
  const f = await fixture('1', { AI_PROVIDER: 'unconfigured' });
  try { await f.login(); assert.equal((await f.request('/api/parts/lookup', { query: 'bench' })).status, 503); assert.equal((await (await f.request('/api/health')).json()).used, 0); }
  finally { await f.close(); }
});
