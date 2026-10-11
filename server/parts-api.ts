import type { Express } from 'express';
import { cookieToken } from './studio-api.ts';
import { sessionUser, rateLimit } from './studio-auth.ts';
import type { Database } from './studio-db.ts';
import type { Env, KV } from './env.ts';
import { handle } from './index.ts';
import { HttpError, providerName } from './providers.ts';

/** Unified, session-protected equipment API. Cache and quotas persist in PostgreSQL. */
export function mountPartsApi(app: Express, db: Database, siteUrl: string, settings: Record<string, string | undefined>) {
  const limit = (name: string, fallback: number) => {
    const number = Number(settings[name]);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  };
  const perUser = limit('AI_USER_DAILY_LIMIT', 20), total = limit('DAILY_LIMIT', 100);
  const cache: KV = {
    async get(key) {
      // Quotas are reserved atomically below instead of the Worker's read/modify/write counter.
      if (key.startsWith('quota:')) return '0';
      const result = await db.query<{ value: string }>('select value from studio_parts_cache where key = $1 and expires_at > now()', [key]);
      return result.rows[0]?.value ?? null;
    },
    async put(key, value, options) {
      if (key.startsWith('quota:')) return;
      await db.query("insert into studio_parts_cache(key,value,expires_at) values($1,$2,now()+$3 * interval '1 second') on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at", [key, value, options?.expirationTtl ?? 86400]);
    },
  };
  const env: Env = { ...settings, PARTS_KV: cache, ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } };
  const origin = new URL(siteUrl).origin;
  let active = 0;
  app.use('/api', async (req, res) => {
    const disconnected = new AbortController();
    const onClose = () => { if (!res.writableEnded) disconnected.abort(); };
    res.on('close', onClose);
    let reservation: { user: string; day: string } | undefined;
    let acquired = false;
    try {
      const user = await sessionUser(db, cookieToken(req));
      const day = new Date().toISOString().slice(0, 10);
      if (req.path === '/health' && req.method === 'GET') {
        const result = user ? await db.query<{ count: number }>('select count from studio_ai_usage where key=$1 and day=$2', [user.id, day]) : { rows: [] };
        res.json({ ok: true, provider: providerName(env), catalogRequests: !!env.GITHUB_TOKEN && !!env.GITHUB_REPO, used: result.rows[0]?.count ?? 0, limit: perUser, requiresAccount: true }); return;
      }
      if (!['/parts/lookup', '/parts/request'].includes(req.path)) { res.status(404).json({ error: 'Not found.' }); return; }
      if (!user || req.get('x-studio-account') !== user.id) { res.status(401).json({ error: 'Sign in to your Studio account to create equipment from a photo or product.' }); return; }
      if (req.method !== 'POST' || req.get('origin') !== origin || req.get('x-studio-request') !== '1') { res.status(403).json({ error: 'Open equipment finder from your Studio workspace.' }); return; }
      if (req.path === '/parts/request' && !await rateLimit(db, `catalog:${user.id}`, 5)) { res.status(429).json({ error: 'Too many catalog requests. Try again in 15 minutes.' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size > 8_000_000) { res.status(413).json({ error: 'The photo request is too large.' }); return; }
        chunks.push(buffer);
      }
      if (active >= limit('AI_CONCURRENCY', 2)) { res.status(503).json({ error: 'Equipment analysis is busy. Try again shortly.' }); return; }
      active++; acquired = true;
      const reserveLookup = async () => {
        await db.transaction(async tx => {
          for (const [key, cap] of [['site', total], [user.id, perUser]] as const) {
            const result = await tx.query("insert into studio_ai_usage(key,day,count) values($1,$2,1) on conflict(key,day) do update set count=studio_ai_usage.count+1 where studio_ai_usage.count < $3 returning count", [key, day, cap]);
            if (!result.rows.length) throw new HttpError(429, 'Today’s equipment analysis limit has been reached. Try again tomorrow.');
          }
        });
        reservation = { user: user.id, day };
      };
      const deadline = AbortSignal.any([AbortSignal.timeout(90_000), disconnected.signal]);
      const response = await handle(new Request(new URL(req.originalUrl, siteUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks).toString('utf8') }), env, {
        fetch: (input, init) => fetch(input, { ...init, signal: deadline }),
        beforeLookup: reserveLookup,
      });
      if (!response.ok && reservation) { await db.query('update studio_ai_usage set count=greatest(0,count-1) where day=$1 and key in ($2,$3)', [reservation.day, reservation.user, 'site']); reservation = undefined; }
      if (response.ok) reservation = undefined;
      res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value)); res.send(await response.text());
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 429) res.status(429).json({ error: error.message });
      else { console.error('Equipment request failed:', error instanceof Error ? error.message : 'unknown error'); res.status(500).json({ error: 'Equipment analysis could not finish. Please try again.' }); }
    } finally {
      res.off('close', onClose);
      if (acquired) active--;
      if (reservation) await db.query('update studio_ai_usage set count=greatest(0,count-1) where day=$1 and key in ($2,$3)', [reservation.day, reservation.user, 'site']).catch(() => {});
    }
  });
}
