import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { Database } from './studio-db.ts';
import { createSession, hashPassword, newToken, rateLimit, sessionUser, tokenHash, verifyPassword, type StudioUser } from './studio-auth.ts';
import { LocalConfigStorage } from '../src/state/config-storage.ts';
import { readCustomParts } from '../src/state/custom-parts-data.ts';

export interface StudioOptions { db: Database; siteUrl: string; production: boolean; verifyEmail: boolean; sendEmail?: (email: string, subject: string, text: string) => Promise<void>; trustProxy?: number }
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function cookieToken(request: Request) { return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('studio_session='))?.slice('studio_session='.length); }
function password(value: unknown) { if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new ApiError(400, 'Use a password with 8–128 characters.'); return value; }
function email(value: unknown) { if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ApiError(400, 'Enter a valid email address.'); return value.trim().toLowerCase(); }
const genericEmailMessage = 'Check your email for the next step. If an account exists, we’ll send you a link.';

export function createStudioApi(options: StudioOptions) {
  const { db } = options, app = express(), origin = new URL(options.siteUrl).origin;
  app.disable('x-powered-by'); app.set('trust proxy', options.trustProxy ?? 0);
  app.use('/api/studio', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use('/api/studio', (req, _res, next) => {
    if (req.method !== 'GET' && (req.get('origin') !== origin || req.get('x-studio-request') !== '1')) return next(new ApiError(403, 'Open Studio from its configured website to continue.'));
    next();
  });
  const workspaceBody = express.json({ limit: '10mb' }), accountBody = express.json({ limit: '16kb' });
  app.use('/api/studio', (req, res, next) => { (req.path === '/workspace' ? workspaceBody : accountBody)(req, res, next); });
  function setSession(res: Response, token: string) {
    // Remove the old narrower cookie before issuing the account cookie used by all APIs.
    res.cookie('studio_session', token, { httpOnly: true, secure: options.production, sameSite: 'lax', path: '/api', maxAge: 30 * 86400 * 1000 });
    res.clearCookie('studio_session', { path: '/api/studio' });
  }
  async function requireUser(req: Request) { const user = await sessionUser(db, cookieToken(req)); if (!user || req.get('x-studio-account') !== user.id) throw new ApiError(401, 'Your account changed or your session expired. Sign in again before syncing.'); return user; }
  async function throttle(req: Request, identity: string, max = 20) {
    if (!await rateLimit(db, `ip:${req.ip ?? 'unknown'}`, 100) || !await rateLimit(db, identity, max)) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.');
  }
  async function sendLink(user: StudioUser, purpose: 'verify' | 'reset') {
    if (!options.sendEmail) throw new ApiError(503, 'Email delivery is not configured yet. Contact the workspace owner.');
    const token = newToken();
    await db.query("insert into studio_email_tokens(token_hash, user_id, purpose, expires_at) values ($1, $2, $3, now() + interval '30 minutes')", [tokenHash(token), user.id, purpose]);
    const link = new URL('/account', origin); link.searchParams.set(purpose, token);
    try { await options.sendEmail(user.email, purpose === 'verify' ? 'Confirm your Gym Studio account' : 'Reset your Gym Studio password', `${purpose === 'verify' ? 'Confirm your email' : 'Choose a new password'} using this link within 30 minutes:\n\n${link}\n\nIf you did not request this, you can ignore this email.`); }
    catch { await db.query('delete from studio_email_tokens where token_hash = $1', [tokenHash(token)]); throw new ApiError(503, 'Email could not be sent. Try again later.'); }
  }
  app.get('/api/studio/health', async (_req, res) => { await db.query('select 1'); res.json({ ok: true }); });
  app.get('/api/studio/session', async (req, res) => { res.json({ user: await sessionUser(db, cookieToken(req)) }); });
  app.post('/api/studio/signup', async (req, res) => {
    const address = email(req.body?.email), secret = password(req.body?.password);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    await throttle(req, `signup:${address}`, 5);
    if (options.verifyEmail && !options.sendEmail) throw new ApiError(503, 'Account email delivery is not configured yet.');
    const hash = await hashPassword(secret);
    const result = await db.query<StudioUser>('insert into studio_users(id, email, name, password_hash, verified) values ($1,$2,$3,$4,$5) on conflict (email) do nothing returning id,email,name', [randomUUID(), address, name, hash, !options.verifyEmail]);
    const user = result.rows[0];
    if (!user) { res.json({ user: null, message: genericEmailMessage }); return; }
    if (options.verifyEmail) { await sendLink(user, 'verify'); res.json({ user: null, message: genericEmailMessage }); return; }
    setSession(res, await createSession(db, user.id)); res.status(201).json({ user });
  });
  app.post('/api/studio/signin', async (req, res) => {
    const address = email(req.body?.email), secret = typeof req.body?.password === 'string' && req.body.password.length <= 128 ? req.body.password : '';
    await throttle(req, `signin:${address}`);
    const result = await db.query<StudioUser & { password_hash: string; verified: boolean }>('select id,email,name,password_hash,verified from studio_users where email = $1', [address]);
    const user = result.rows[0];
    const valid = user ? await verifyPassword(secret, user.password_hash) : !!(await hashPassword(secret)) && false;
    if (!valid || !user?.verified) throw new ApiError(401, 'Email or password is incorrect, or your email still needs confirmation.');
    setSession(res, await createSession(db, user.id)); res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });
  app.post('/api/studio/signout', async (req, res) => {
    const token = cookieToken(req); if (token) await db.query('delete from studio_sessions where token_hash = $1', [tokenHash(token)]);
    res.clearCookie('studio_session', { httpOnly: true, secure: options.production, sameSite: 'lax', path: '/api' }); res.json({ ok: true });
  });
  app.post('/api/studio/recover', async (req, res) => {
    const address = email(req.body?.email); await throttle(req, `recover:${address}`, 5);
    if (!options.sendEmail) throw new ApiError(503, 'Password recovery email is not configured yet.');
    const result = await db.query<StudioUser>('select id,email,name from studio_users where email = $1', [address]);
    if (result.rows[0]) await sendLink(result.rows[0], 'reset'); res.json({ message: genericEmailMessage });
  });
  app.post('/api/studio/resend', async (req, res) => {
    const address = email(req.body?.email); await throttle(req, `verify:${address}`, 5);
    if (!options.sendEmail) throw new ApiError(503, 'Confirmation email is not configured yet.');
    const result = await db.query<StudioUser>('select id,email,name from studio_users where email = $1 and verified = false', [address]);
    if (result.rows[0]) await sendLink(result.rows[0], 'verify'); res.json({ message: genericEmailMessage });
  });
  app.post('/api/studio/verify', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : ''; await throttle(req, `verify-token:${req.ip}`, 20);
    const user = await db.transaction(async tx => {
      const result = await tx.query<{ user_id: string }>("delete from studio_email_tokens where token_hash = $1 and purpose = 'verify' and expires_at > now() returning user_id", [tokenHash(token)]);
      if (!result.rows[0]) throw new ApiError(400, 'This confirmation link expired or was already used. Request a new email.');
      return (await tx.query<StudioUser>('update studio_users set verified = true where id = $1 returning id,email,name', [result.rows[0].user_id])).rows[0];
    });
    setSession(res, await createSession(db, user.id)); res.json({ user });
  });
  app.post('/api/studio/reset-password', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '', secret = password(req.body?.password);
    await throttle(req, `reset-token:${req.ip}`, 10);
    const hash = await hashPassword(secret);
    await db.transaction(async tx => {
      const result = await tx.query<{ user_id: string }>("delete from studio_email_tokens where token_hash = $1 and purpose = 'reset' and expires_at > now() returning user_id", [tokenHash(token)]);
      if (!result.rows[0]) throw new ApiError(400, 'This recovery link expired or was already used. Request a new one.');
      const id = result.rows[0].user_id;
      await tx.query('update studio_users set password_hash = $1, verified = true where id = $2', [hash, id]);
      await tx.query('delete from studio_sessions where user_id = $1', [id]);
      await tx.query('delete from studio_email_tokens where user_id = $1', [id]);
    });
    res.clearCookie('studio_session', { httpOnly: true, secure: options.production, sameSite: 'lax', path: '/api' }); res.json({ message: 'Password updated. Sign in with your new password.' });
  });
  app.get('/api/studio/workspace', async (req, res) => {
    const user = await requireUser(req);
    const result = await db.query<{ data: unknown; revision: string }>('select data,revision from studio_workspaces where user_id = $1', [user.id]);
    res.json(result.rows[0] ? { data: result.rows[0].data, revision: Number(result.rows[0].revision) } : { data: { values: {} }, revision: 0 });
  });
  app.put('/api/studio/workspace', async (req, res) => {
    const user = await requireUser(req), revision = req.body?.revision, data = req.body?.data;
    if (!Number.isSafeInteger(revision) || revision < 0 || !data?.values || typeof data.values !== 'object' || Array.isArray(data.values)
      || Object.entries(data.values).some(([key, value]) => !['bos-strength-configurations-v1', 'bos-strength-custom-parts-v1'].includes(key) || typeof value !== 'string')) throw new ApiError(400, 'Invalid workspace data.');
    try {
      const storage = { getItem: (key: string) => data.values[key] ?? null, setItem: () => {} };
      await new LocalConfigStorage(storage).read(); readCustomParts(storage);
    } catch { throw new ApiError(400, 'The workspace contains an invalid gym or equipment record. Download your local backup.'); }
    let result;
    if (revision === 0) result = await db.query<{ revision: string }>('insert into studio_workspaces(user_id, revision, data) values ($1,1,$2) on conflict (user_id) do nothing returning revision', [user.id, JSON.stringify({ values: data.values })]);
    else result = await db.query<{ revision: string }>('update studio_workspaces set data = $1, revision = revision + 1, updated_at = now() where user_id = $2 and revision = $3 returning revision', [JSON.stringify({ values: data.values }), user.id, revision]);
    if (!result.rows[0]) throw new ApiError(409, 'This workspace changed on another device.');
    res.json({ revision: Number(result.rows[0].revision) });
  });
  app.use('/api/studio', (_req, res) => { res.status(404).json({ error: 'Not found.' }); });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) { res.status(error.status).json({ error: error.message }); return; }
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'Your workspace is too large to upload (10 MB maximum). Download a backup.' }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Send a valid JSON request.' }); return; }
    console.error('Studio API request failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(500).json({ error: 'The server could not complete this request. Try again.' });
  });
  return app;
}
