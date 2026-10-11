/** Shared daily limit and small KV helpers. Every lookup uses the site owner's AI key, so one limit per UTC day protects
 * it (DAILY_LIMIT, default 100). Cached lookups don't count. */
import type { Env, KV } from './env.ts';

export async function sha256(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
const memory = new Map<string, { value: string; expires: number }>();
/** KV when bound, else a per-instance memory map (fine for local dev; use KV in production). */
export function store(env: Env): KV {
  if (env.PARTS_KV) return env.PARTS_KV;
  return {
    async get(key) { const hit = memory.get(key); return hit && hit.expires > Date.now() ? hit.value : null; },
    async put(key, value, options) { memory.set(key, { value, expires: Date.now() + (options?.expirationTtl ?? 86400) * 1000 }); },
  };
}
export const DEFAULT_DAILY_LIMIT = 100;
export const dailyLimit = (env: Env) => { const n = Number(env.DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT; };
const today = () => new Date().toISOString().slice(0, 10);
export async function usage(env: Env) {
  return { used: Number(await store(env).get(`quota:${today()}`)) || 0, limit: dailyLimit(env) };
}
export async function consume(env: Env) {
  const { used } = await usage(env);
  await store(env).put(`quota:${today()}`, String(used + 1), { expirationTtl: 2 * 86400 });
}
