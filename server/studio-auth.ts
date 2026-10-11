import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from './studio-db.ts';

const derive = promisify(scrypt);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [scheme, salt, value] = hash.split(':');
  if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(value ?? '')) return false;
  const key = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(value, 'hex'));
}
export interface StudioUser extends Record<string, unknown> { id: string; email: string; name: string }
export async function sessionUser(db: Database, token?: string): Promise<StudioUser | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await db.query<StudioUser>('select u.id, u.email, u.name from studio_sessions s join studio_users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now() and u.verified = true', [tokenHash(token)]);
  return result.rows[0] ?? null;
}
export async function createSession(db: Database, userId: string) {
  const token = newToken();
  await db.query("insert into studio_sessions(token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')", [tokenHash(token), userId]);
  return token;
}
export async function rateLimit(db: Database, key: string, limit: number) {
  const result = await db.query<{ count: number }>("insert into studio_rate_limits(key, count, expires_at) values ($1, 1, now() + interval '15 minutes') on conflict (key) do update set count = case when studio_rate_limits.expires_at < now() then 1 else studio_rate_limits.count + 1 end, expires_at = case when studio_rate_limits.expires_at < now() then now() + interval '15 minutes' else studio_rate_limits.expires_at end returning count", [tokenHash(key)]);
  return result.rows[0].count <= limit;
}
