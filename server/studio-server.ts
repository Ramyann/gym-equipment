import express from 'express';
import nodemailer from 'nodemailer';
import { resolve } from 'node:path';
import { createStudioApi } from './studio-api.ts';
import { migrateStudio, postgresDatabase } from './studio-db.ts';
import { handle as handlePartsApi } from './index.ts';
import type { Env } from './env.ts';

const production = process.env.NODE_ENV === 'production';
const siteUrl = process.env.SITE_URL ?? 'http://127.0.0.1:5173';
if (production && new URL(siteUrl).protocol !== 'https:') throw Error('SITE_URL must be your public HTTPS domain in production.');
if (!process.env.DATABASE_URL) throw Error('Set DATABASE_URL to your PostgreSQL connection string. See docs/self-hosting.md.');
const verifyEmail = production || process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
const smtp = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined }) : null;
if (production && (!smtp || !process.env.SMTP_FROM)) throw Error('Set SMTP_HOST and SMTP_FROM for account confirmation and password recovery in production.');
const { db, close } = postgresDatabase(process.env.DATABASE_URL);
await migrateStudio(db);
const app = createStudioApi({ db, siteUrl, production, verifyEmail, trustProxy: Number(process.env.TRUST_PROXY ?? 0), sendEmail: smtp ? async (email, subject, text) => { await smtp.sendMail({ from: process.env.SMTP_FROM, to: email, subject, text }); } : undefined });
// Keep the existing AI part API available on the standalone deployment.
const partsEnv: Env = { ...process.env, ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } };
app.use('/api', async (req, res) => {
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 8_000_000) { res.status(413).json({ error: 'The request is too large.' }); return; } chunks.push(buffer); }
    const body = Buffer.concat(chunks).toString('utf8');
    const response = await handlePartsApi(new Request(new URL(req.originalUrl, siteUrl), { method: req.method, headers: { authorization: req.get('authorization') ?? '', 'content-type': 'application/json' }, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}) }), partsEnv);
    res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value)); res.send(await response.text());
  } catch { res.status(500).json({ error: 'The parts service could not complete the request.' }); }
});
const assets = resolve('dist');
app.use((_req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); next(); });
app.use(express.static(assets));
app.get('/{*path}', (_req, res) => { res.sendFile(resolve(assets, 'index.html')); });
const server = app.listen(Number(process.env.PORT ?? 8788), '0.0.0.0', () => { console.log('Gym Studio server is ready.'); });
const cleanup = setInterval(() => { void db.query('delete from studio_sessions where expires_at < now()').then(() => db.query('delete from studio_email_tokens where expires_at < now()')).then(() => db.query('delete from studio_rate_limits where expires_at < now()')).catch(() => {}); }, 60 * 60 * 1000); cleanup.unref();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { clearInterval(cleanup); server.close(() => { void close().then(() => process.exit(0)); }); });
