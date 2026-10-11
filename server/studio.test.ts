import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createStudioApi, type StudioOptions } from './studio-api.ts';
import type { Database } from './studio-db.ts';
import { hashPassword, verifyPassword, tokenHash } from './studio-auth.ts';

let pg: PGlite, db: Database;
function wrap(connection: Pick<PGlite, 'query'>): Database { const db: Database = { query: (sql, values) => connection.query(sql, values), transaction: action => pg.transaction(tx => action(wrap(tx))) }; return db; }
before(async () => { pg = new PGlite(); await pg.exec(await readFile(new URL('./migrations/001-studio.sql', import.meta.url), 'utf8')); db = wrap(pg); });
after(async () => { await pg.close(); });
const origin = 'http://127.0.0.1:5173', password = 'Studio-test-password-123';
async function fixture(options: Partial<StudioOptions> = {}) {
  const app = createStudioApi({ db, siteUrl: origin, production: false, verifyEmail: false, ...options });
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const port = address.port;
  async function request(path: string, body?: unknown, cookie?: string, accountId?: string, method = 'POST', requestOrigin = origin) {
    return fetch(`http://127.0.0.1:${port}/api/studio/${path}`, { method: body === undefined ? 'GET' : method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-studio-request': '1', origin: requestOrigin }), ...(cookie ? { cookie } : {}), ...(accountId ? { 'x-studio-account': accountId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function signup(email: string) { const response = await request('signup', { email, password, name: 'Studio user' }); assert.equal(response.status, 201); const body = await response.json() as { user: { id: string } }; return { id: body.user.id, cookie: response.headers.get('set-cookie')!.split(';')[0] }; }
  return { request, signup, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('password hashes are salted, verify correctly and never accept malformed hashes', async () => {
  const one = await hashPassword(password), two = await hashPassword(password);
  assert.notEqual(one, two); assert.ok(!one.includes(password)); assert.equal(await verifyPassword(password, one), true); assert.equal(await verifyPassword('wrong', one), false); assert.equal(await verifyPassword(password, 'bad'), false);
});
test('accounts restore from HttpOnly sessions, reject wrong passwords, and revoke sessions on signout', async () => {
  const f = await fixture();
  try {
    const response = await f.request('signup', { email: 'account-one@example.invalid', password });
    assert.equal(response.status, 201); assert.match(response.headers.get('set-cookie')!, /HttpOnly/); assert.match(response.headers.get('set-cookie')!, /SameSite=Lax/);
    const cookie = response.headers.get('set-cookie')!.split(';')[0], data = await response.json();
    assert.ok(!JSON.stringify(data).includes('password_hash'));
    assert.equal((await (await f.request('session', undefined, cookie)).json()).user.email, 'account-one@example.invalid');
    assert.equal((await f.request('signin', { email: 'account-one@example.invalid', password: 'wrong' })).status, 401);
    assert.equal((await f.request('signout', {}, cookie)).status, 200);
    assert.equal((await (await f.request('session', undefined, cookie)).json()).user, null);
    const signin = await f.request('signin', { email: 'account-one@example.invalid', password }); assert.equal(signin.status, 200);
  } finally { await f.close(); }
});
test('workspace saves are private, survive login, and reject stale revisions and account switches', async () => {
  const f = await fixture();
  try {
    const a = await f.signup('workspace-a@example.invalid'), b = await f.signup('workspace-b@example.invalid');
    const data = { values: { 'bos-strength-custom-parts-v1': JSON.stringify({ version: 1, parts: [] }) } };
    assert.equal((await f.request('workspace')).status, 401);
    assert.equal((await f.request('workspace', { data, revision: 0 }, a.cookie, a.id, 'PUT')).status, 200);
    assert.deepEqual(await (await f.request('workspace', undefined, a.cookie, a.id)).json(), { data, revision: 1 });
    assert.deepEqual(await (await f.request('workspace', undefined, b.cookie, b.id)).json(), { data: { values: {} }, revision: 0 });
    assert.equal((await f.request('workspace', { data, revision: 0 }, a.cookie, a.id, 'PUT')).status, 409);
    assert.equal((await f.request('workspace', { data, revision: 1 }, b.cookie, a.id, 'PUT')).status, 401);
    assert.equal((await f.request('workspace', { data, revision: 1 }, a.cookie, a.id, 'PUT')).status, 200);
    assert.equal((await f.request('workspace', { data, revision: 1 }, a.cookie, a.id, 'PUT')).status, 409);
    assert.equal((await f.request('workspace', { data: { values: { unexpected: 'bad' } }, revision: 2 }, a.cookie, a.id, 'PUT')).status, 400);
  } finally { await f.close(); }
});
test('state-changing requests require the correct origin and CSRF header', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('signup', { email: 'csrf@example.invalid', password }, undefined, undefined, 'POST', 'https://evil.example')).status, 403);
    assert.equal((await f.request('signup', { email: 'csrf@example.invalid', password }, undefined, undefined, 'POST', '')).status, 403);
  } finally { await f.close(); }
});
test('email confirmation uses one-time tokens and sets Secure cookies in production', async () => {
  const messages: string[] = [], f = await fixture({ production: true, verifyEmail: true, sendEmail: async (_email, _subject, text) => { messages.push(text); } });
  try {
    const signup = await f.request('signup', { email: 'confirmation@example.invalid', password }); assert.equal(signup.status, 200); assert.equal(signup.headers.get('set-cookie'), null);
    assert.equal((await f.request('signin', { email: 'confirmation@example.invalid', password })).status, 401);
    const link = messages[0].match(/http[^\s]+/)![0], token = new URL(link).searchParams.get('verify'); assert.ok(token);
    const result = await f.request('verify', { token }); assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie')!, /Secure/);
    assert.equal((await f.request('verify', { token })).status, 400);
    assert.equal((await f.request('signin', { email: 'confirmation@example.invalid', password })).status, 200);
  } finally { await f.close(); }
});
test('password recovery tokens expire, can be used only once and revoke every old session', async () => {
  const messages: string[] = [], f = await fixture({ sendEmail: async (_email, _subject, text) => { messages.push(text); } });
  try {
    const user = await f.signup('recovery@example.invalid');
    assert.equal((await f.request('recover', { email: 'recovery@example.invalid' })).status, 200);
    const token = new URL(messages[0].match(/http[^\s]+/)![0]).searchParams.get('reset')!;
    assert.equal((await f.request('reset-password', { token, password: 'New-Studio-password-123' })).status, 200);
    assert.equal((await (await f.request('session', undefined, user.cookie)).json()).user, null);
    assert.equal((await f.request('reset-password', { token, password })).status, 400);
    assert.equal((await f.request('signin', { email: 'recovery@example.invalid', password })).status, 401);
    assert.equal((await f.request('signin', { email: 'recovery@example.invalid', password: 'New-Studio-password-123' })).status, 200);
    await f.request('recover', { email: 'recovery@example.invalid' });
    const expired = new URL(messages[1].match(/http[^\s]+/)![0]).searchParams.get('reset')!;
    await db.query("update studio_email_tokens set expires_at = now() - interval '1 hour' where token_hash = $1", [tokenHash(expired)]);
    assert.equal((await f.request('reset-password', { token: expired, password })).status, 400);
  } finally { await f.close(); }
});
test('repeated authentication attempts are limited in PostgreSQL', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await f.request('signin', { email: 'rate-limit@example.invalid', password: 'wrong' })).status, 401);
    assert.equal((await f.request('signin', { email: 'rate-limit@example.invalid', password: 'wrong' })).status, 429);
  } finally { await f.close(); }
});
