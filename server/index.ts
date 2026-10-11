/** Cloudflare Worker: serves the static site and the AI part API under /api/ (wrangler.jsonc routes /api/* here first).
 *
 *   GET  /api/health        → { ok, provider, catalogRequests, used, limit }
 *   POST /api/parts/lookup  → LookupResponse (spec + provider info); counts against the shared daily limit
 *   POST /api/parts/request → { issue, url, existing }; opens a `catalog-request` GitHub issue (when GITHUB_TOKEN is set)
 *
 * There are no user accounts here: every lookup uses the site owner's AI key (OPENROUTER_API_KEY or ANTHROPIC_API_KEY),
 * protected by DAILY_LIMIT lookups per UTC day. See docs/ai-parts.md. */
import { parseSpec, SYSTEM_PROMPT, templateGuide, type LookupRequest, type LookupResponse } from '../src/ai-parts/spec.ts';
import { catalogIssue, parseCatalogRequest } from '../src/ai-parts/catalog-request.ts';
import { consume, sha256, store, usage } from './limits.ts';
import { HttpError, makeProvider, providerName } from './providers.ts';
import type { Env } from './env.ts';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BASE64 = 7_000_000; // ≈ 5 MB decoded, the provider's per-image limit
const CACHE_TTL = 30 * 86400;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function readLookup(body: unknown): LookupRequest {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Send a JSON body.');
  const b = body as Record<string, unknown>, out: LookupRequest = {};
  if (b.query !== undefined) { if (typeof b.query !== 'string' || b.query.length > 300) throw new HttpError(400, 'The product name must be text under 300 characters.'); if (b.query.trim()) out.query = b.query.trim(); }
  if (b.url !== undefined && b.url !== '') {
    if (typeof b.url !== 'string' || b.url.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(b.url)) throw new HttpError(400, 'The product link must be an http(s) URL.');
    out.url = b.url;
  }
  if (b.hint !== undefined) { if (typeof b.hint !== 'string' || b.hint.length > 500) throw new HttpError(400, 'Extra details must be text under 500 characters.'); if (b.hint.trim()) out.hint = b.hint.trim(); }
  if (b.image !== undefined && b.image !== null) {
    const img = b.image as Record<string, unknown>;
    if (typeof img.media_type !== 'string' || !IMAGE_TYPES.includes(img.media_type)) throw new HttpError(400, 'Photos must be JPEG, PNG, WebP or GIF.');
    if (typeof img.data !== 'string' || !img.data || img.data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(img.data)) throw new HttpError(400, 'The photo is too large or not valid base64 (max 5 MB).');
    out.image = { media_type: img.media_type, data: img.data };
  }
  if (!out.query && !out.url && !out.image) throw new HttpError(400, 'Give a product name, a link or a photo.');
  return out;
}

const catalogConfigured = (env: Env) => !!env.GITHUB_TOKEN && !!env.GITHUB_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO);

export interface Deps { fetch?: typeof fetch; now?: () => number; beforeLookup?: () => Promise<void> }
export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url), now = deps.now ?? Date.now;
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  try {
    if (url.pathname === '/api/health') return json({ ok: true, provider: providerName(env), catalogRequests: catalogConfigured(env), ...(await usage(env)) });
    if (url.pathname === '/api/parts/lookup' && request.method === 'POST') {
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > 8_000_000) throw new HttpError(413, 'The request is too large.');
      const text = await request.text();
      if (text.length > 8_000_000) throw new HttpError(413, 'The request is too large.');
      let body: unknown; try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Send a JSON body.'); }
      const req = readLookup(body), provider = makeProvider(env, deps.fetch), started = now();
      // Cached answers are free, so they're served even after the daily limit is reached.
      const cacheKey = req.image ? null : `lookup:${await sha256(JSON.stringify([provider.name, provider.model, SYSTEM_PROMPT + templateGuide(), req.query ?? '', req.url ?? '', req.hint ?? '']))}`;
      if (cacheKey) {
        const hit = await store(env).get(cacheKey);
        if (hit) return json({ ...JSON.parse(hit), cached: true });
      }
      const quota = await usage(env);
      if (quota.used >= quota.limit) throw new HttpError(429, `Today's AI lookups are used up (${quota.limit} per day). They reset at midnight UTC.`);
      await deps.beforeLookup?.();
      const result = await provider.lookup(req);
      await consume(env);
      let spec;
      try { spec = parseSpec(result.spec); } catch (e) { throw new HttpError(502, e instanceof Error ? e.message : 'The AI returned an unusable answer.'); }
      if (req.image && provider.name !== 'mock' && (spec.template !== 'template-assembly' || (spec.geometry?.length ?? 0) < 3)) throw new HttpError(502, 'The AI did not generate the requested photo geometry. Please retry with a clear photo of the full object.');
      const response: LookupResponse = { spec, provider: provider.name, model: provider.model, searches: result.searches, ms: now() - started };
      if (cacheKey && spec.status !== 'not_found') await store(env).put(cacheKey, JSON.stringify(response), { expirationTtl: CACHE_TTL });
      return json(response);
    }
    if (url.pathname === '/api/parts/request' && request.method === 'POST') {
      if (!catalogConfigured(env)) throw new HttpError(503, 'Catalog requests are not configured: set the GITHUB_TOKEN secret and the GITHUB_REPO variable.');
      const text = await request.text();
      if (text.length > 200_000) throw new HttpError(413, 'The request is too large.');
      let body: unknown; try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Send a JSON body.'); }
      let req;
      try { req = parseCatalogRequest(body); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Invalid request.'); }
      // One open request per product: the same brand + model (or name) returns the issue already filed.
      const dedupe = `request:${await sha256(`${env.GITHUB_REPO}|${(req.ai.brand + ' ' + req.ai.model).trim().toLowerCase() || req.name.toLowerCase()}`)}`;
      const existing = await store(env).get(dedupe);
      if (existing) return json({ ...JSON.parse(existing), existing: true });
      const issue = catalogIssue(req, 'the Gym Builder app');
      const res = await (deps.fetch ?? fetch)(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'gym-builder-catalog-request', 'content-type': 'application/json' },
        body: JSON.stringify(issue),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null) as { message?: string } | null;
        throw new HttpError(502, res.status === 401 || res.status === 403 || res.status === 404
          ? 'GitHub rejected the request: check that GITHUB_TOKEN can create issues in GITHUB_REPO.' : `GitHub returned an error: ${detail?.message ?? res.status}`);
      }
      const created = await res.json() as { number: number; html_url: string };
      const result = { issue: created.number, url: created.html_url };
      await store(env).put(dedupe, JSON.stringify(result), { expirationTtl: 90 * 86400 });
      return json({ ...result, existing: false });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: 'Something went wrong on the server.' }, 500);
  }
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
