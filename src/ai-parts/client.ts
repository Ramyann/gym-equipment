/** Browser side of the AI part lookup: API calls and photo preparation. The server uses the site owner's AI key. */
import type { LookupRequest, LookupResponse } from './spec.ts';
import { currentStudioAccountId } from '../cloud/session.ts';

/** Server status: which AI is configured, whether catalog requests work, and today's shared lookup count. */
export interface AiStatus { ok: boolean; provider: string; catalogRequests: boolean; used: number; limit: number; requiresAccount?: boolean }
export type LookupResult = LookupResponse & { cached?: boolean };
export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    const accountId = currentStudioAccountId();
    res = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-studio-request': '1', ...(accountId ? { 'x-studio-account': accountId } : {}) } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Could not reach the AI server. Check your connection.');
  }
  const body = await res.json().catch(() => null) as { error?: string } | null;
  if (!res.ok || !body) {
    const fallback = res.status === 404 || res.status >= 500 && !body ? 'Equipment finder is temporarily unavailable. Please try again shortly.' : `Request failed (${res.status}).`;
    throw new ApiError(res.status, body?.error ?? fallback);
  }
  return body as T;
}
export const fetchStatus = () => api<AiStatus>('/api/health', { method: 'GET' });
export const lookupPart = (req: LookupRequest, signal?: AbortSignal) =>
  api<LookupResult>('/api/parts/lookup', { method: 'POST', body: JSON.stringify(req), signal });

/** Downscales a photo to at most `max` px on its long side (the AI sees no more detail beyond ~1568 px) as JPEG base64. */
export async function preparePhoto(file: File, max = 1568): Promise<{ media_type: 'image/jpeg'; data: string; preview: string }> {
  if (!file.type.startsWith('image/')) throw Error('Choose an image file.');
  const bitmap = await createImageBitmap(file).catch(() => { throw Error('This photo format could not be read. Try a JPEG or PNG.'); });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const preview = canvas.toDataURL('image/jpeg', .85);
  return { media_type: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1), preview };
}

/** Step 2: ask for a full catalog part. Returns the GitHub issue, or the one already filed for this product. */
export const requestCatalogPart = (part: { name: string; part: string; params: Record<string, number>; ai: unknown }) =>
  api<{ issue: number; url: string; existing: boolean }>('/api/parts/request', { method: 'POST', body: JSON.stringify(part) });

/** Server status, fetched once and shared by every component (call with `fresh` after a lookup to update the count). */
let statusCache: Promise<AiStatus | null> | null = null;
export function loadStatus(fresh = false): Promise<AiStatus | null> {
  if (fresh || !statusCache) statusCache = fetchStatus().catch(() => null);
  return statusCache;
}
