export interface StudioSession { user: { id: string; email: string; name: string } }
export class CloudApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function studioRequest<T>(path: string, body?: unknown, method = 'POST', accountId?: string): Promise<T> {
  const response = await fetch(`/api/studio/${path}`, {
    method: body === undefined ? 'GET' : method, credentials: 'same-origin',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-studio-request': '1' }), ...(accountId ? { 'x-studio-account': accountId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new CloudApiError(response.status, result?.error || 'Studio could not reach the account server. Try again.');
  if (result === null) throw Error('The account server returned an invalid response.');
  return result as T;
}
export const cloudConfigured = true;
