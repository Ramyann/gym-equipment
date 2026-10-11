import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { backendModule } from './backend-modules.ts';
import type { StudioOptions } from './studio-api.ts';
import { validateBackendSettings } from './backend-config.ts';
import { migrateStudio, postgresDatabase, type Database } from './studio-db.ts';

validateBackendSettings(process.env);
const production = process.env.NODE_ENV === 'production';
const siteUrl = process.env.SITE_URL ?? 'http://127.0.0.1:5173';
const dataDir = resolve(process.env.DATA_DIR ?? '.data');
if (production && (new URL(siteUrl).protocol !== 'https:' || !process.env.DATABASE_URL)) throw Error('Production requires an HTTPS SITE_URL and PostgreSQL DATABASE_URL.');
if (!production && (!process.env.DATABASE_URL || !process.env.SMTP_HOST)) await mkdir(dataDir, { recursive: true });
let db: Database, close: () => Promise<void>;
if (process.env.DATABASE_URL) ({ db, close } = postgresDatabase(process.env.DATABASE_URL));
else {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(resolve(dataDir, 'postgres'));
  await pg.exec(await readFile(new URL('./migrations/001-studio.sql', import.meta.url), 'utf8'));
  const wrap = (connection: Pick<typeof pg, 'query'>): Database => ({ query: (sql, values) => connection.query(sql, values), transaction: action => pg.transaction(tx => action(wrap(tx))) });
  db = wrap(pg); close = () => pg.close();
}
if (process.env.DATABASE_URL) await migrateStudio(db);
const smtp = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined }) : null;
if (production && (!smtp || !process.env.SMTP_FROM)) throw Error('Production requires SMTP_HOST and SMTP_FROM.');
const inbox: { to: string; subject: string; text: string; sentAt: string }[] = [];
if (!production && !smtp) {
  try {
    const saved: unknown = JSON.parse(await readFile(resolve(dataDir, 'development-inbox.json'), 'utf8'));
    if (Array.isArray(saved)) inbox.push(...saved.filter(mail => mail && ['to','subject','text','sentAt'].every(key => typeof mail[key] === 'string')).slice(0, 50));
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) console.warn('Previous development inbox could not be restored. New emails will still be delivered locally.');
  }
}
const options: StudioOptions = { db, siteUrl, production, verifyEmail: production || process.env.REQUIRE_EMAIL_VERIFICATION === 'true', trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  sendEmail: smtp ? async (to, subject, text) => { await smtp.sendMail({ from: process.env.SMTP_FROM, to, subject, text }); }
    : async (to, subject, text) => { inbox.unshift({ to, subject, text, sentAt: new Date().toISOString() }); inbox.splice(50); await writeFile(resolve(dataDir, 'development-inbox.json'), JSON.stringify(inbox, null, 2)); console.log(`Development email to ${to}: ${subject}. Open http://127.0.0.1:${process.env.PORT ?? 8788}/dev/inbox`); },
};
const app = express(); app.disable('x-powered-by'); app.set('trust proxy', options.trustProxy ?? 0);
app.use((_req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store'); next(); });
if (!production) {
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  app.get('/dev/inbox', (_req, res) => res.type('html').send(`<!doctype html><html><meta name="viewport" content="width=device-width"><title>Studio development inbox</title><style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:20px;background:#f5f5ef}article{background:white;padding:24px;margin:16px 0;border-radius:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#315b47}</style><h1>Development inbox</h1><p>Local testing only. Refresh after requesting confirmation or password recovery.</p>${inbox.map(mail => `<article><h2>${escape(mail.subject)}</h2><p>To: ${escape(mail.to)}</p><pre>${escape(mail.text).replace(/(http[^\s<]+)/g, '<a href="$1">$1</a>')}</pre></article>`).join('') || '<p>No messages yet.</p>'}</html>`));
}
const settings = { ...process.env };
if (!production && !settings.AI_PROVIDER && !settings.ANTHROPIC_API_KEY && !settings.OPENROUTER_API_KEY) settings.AI_PROVIDER = 'mock';
if (production && settings.AI_PROVIDER === 'mock') throw Error('Demo AI must not be used in production. Configure a real AI provider or leave AI unavailable.');
const cleanup = setInterval(() => { void db.query('delete from studio_parts_cache where expires_at < now()').then(() => db.query("delete from studio_ai_usage where day < current_date - 32")).then(() => db.query('delete from studio_sessions where expires_at < now()')).then(() => db.query('delete from studio_email_tokens where expires_at < now()')).then(() => db.query('delete from studio_rate_limits where expires_at < now()')).catch(() => {}); }, 3600000); cleanup.unref();
const nest = await NestFactory.create(backendModule(options, settings, async () => { clearInterval(cleanup); await close(); }), new ExpressAdapter(app), { bodyParser: false });
nest.enableShutdownHooks();
await nest.listen(Number(process.env.PORT ?? 8788), process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'));
console.log(`Studio backend ready on ${process.env.PORT ?? 8788}. Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'local persistent PostgreSQL'}. AI: ${settings.AI_PROVIDER ?? 'configured provider'}.`);
