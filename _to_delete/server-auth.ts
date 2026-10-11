/** Access keys (admin / premium) and daily quotas. Keys live in the ACCESS_KEYS secret; only a hash prefix is stored. */
import type { Account, Env, KV, Role } from './env.ts';

const ROLES: readonly Role[] = ['admin', 'premium'];
export async function sha256(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Constant-time string comparison (avoids leaking how much of a key matched). */
function same(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export function parseAccessKeys(raw: string | undefined): Map<string, { name: string; role: Role }> {
  const out = new Map<string, { name: string; role: Role }>();
  if (!raw) return out;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw Error('Server setup: ACCESS_KEYS is not valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Server setup: ACCESS_KEYS must be a JSON object of key → { role, name }.');
  for (const [key, value] of Object.entries(data as Record<string, { role?: unknown; name?: unknown }>)) {
    if (key.length < 16) throw Error('Server setup: every access key must be at least 16 characters.');
    const role = ROLES.find(r => r === value?.role);
    if (!role) throw Error(`Server setup: the access key for ${String(value?.name ?? 'unknown')} needs role "admin" or "premium".`);
    out.set(key, { role, name: typeof value.name === 'string' ? value.name.slice(0, 80) : role });
  }
  return out;
}
export async function authenticate(request: Request, env: Env): Promise<Account | null> {
  const header = request.headers.get('authorization') ?? '', token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  for (const [key, info] of parseAccessKeys(env.ACCESS_KEYS)) if (same(key, token)) return { id: (await sha256(key)).slice(0, 16), ...info };
  return null;
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
export const dailyLimit = (env: Env, role: Role) => Math.max(0, Number(role === 'admin' ? env.DAILY_LIMIT_ADMIN ?? 200 : env.DAILY_LIMIT_PREMIUM ?? 20) || 0);
const today = () => new Date().toISOString().slice(0, 10);
export async function usage(env: Env, account: Account) {
  const used = Number(await store(env).get(`quota:${account.id}:${today()}`)) || 0;
  return { used, limit: dailyLimit(env, account.role) };
}
export async function consume(env: Env, account: Account) {
  const { used } = await usage(env, account);
  await store(env).put(`quota:${account.id}:${today()}`, String(used + 1), { expirationTtl: 2 * 86400 });
}
