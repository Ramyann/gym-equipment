import { useSyncExternalStore } from 'react';
import { studioRequest, CloudApiError, cloudConfigured, type StudioSession } from './client.ts';
import { WorkspaceConflict, WorkspaceSync, type SyncState } from './sync-engine.ts';
import { WorkspaceCache, activateWorkspaceStorage, type WorkspaceData } from '../state/workspace-storage.ts';
import { LocalConfigStorage } from '../state/config-storage.ts';
import { readCustomParts } from '../state/custom-parts.ts';

interface AccountState { initialized: boolean; ready: boolean; session: StudioSession | null; recovery: boolean; sync: SyncState | 'guest'; error: string; generation: number }
let snapshot: AccountState = { initialized: false, ready: false, session: null, recovery: false, sync: 'guest', error: '', generation: 0 };
const listeners = new Set<() => void>();
let started = false, engine: WorkspaceSync | null = null, timer: ReturnType<typeof setTimeout> | undefined;
const LAST_ACCOUNT = 'gym-studio-last-account';
function rememberSession(session: StudioSession | null) {
  try { window.localStorage.setItem(LAST_ACCOUNT, JSON.stringify(session)); } catch {}
}
function cachedSession(): StudioSession | null {
  try {
    const session = JSON.parse(window.localStorage.getItem(LAST_ACCOUNT) ?? 'null') as StudioSession | null;
    if (!session || typeof session.user?.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(session.user.id) || typeof session.user.email !== 'string' || typeof session.user.name !== 'string') return null;
    return session;
  } catch { return null; }
}
function patch(next: Partial<AccountState>) { snapshot = { ...snapshot, ...next }; listeners.forEach(listener => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useAccount = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
export const currentStudioAccountId = () => snapshot.session?.user.id ?? null;
export { cloudConfigured };

async function validate(data: WorkspaceData) {
  if (!data || typeof data.values !== 'object' || !data.values || Array.isArray(data.values)
    || Object.entries(data.values).some(([key, value]) => !['bos-strength-configurations-v1', 'bos-strength-custom-parts-v1'].includes(key) || typeof value !== 'string')) throw Error('Invalid cloud workspace.');
  const storage = { getItem: (key: string) => data.values[key] ?? null, setItem: () => {} };
  await new LocalConfigStorage(storage).read();
  readCustomParts(storage);
}

async function applySession(session: StudioSession | null, recovery = false) {
  if (snapshot.initialized && snapshot.session?.user.id === session?.user.id) { patch({ session, recovery: recovery || snapshot.recovery }); return; }
  if (timer) clearTimeout(timer);
  engine = null; activateWorkspaceStorage();
  const generation = snapshot.generation + 1;
  patch({ initialized: true, ready: !session, session, recovery, generation, sync: session ? 'opening' : 'guest', error: '' });
  if (!session) return;
  try {
    let ownEngine: WorkspaceSync;
    function uploadSoon(delay = 700) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (engine !== ownEngine) return;
        void ownEngine.flush().catch(() => { if (engine === ownEngine && ownEngine.state === 'offline') uploadSoon(15000); });
      }, delay);
    }
    const cache = new WorkspaceCache(window.localStorage, session.user.id, () => {
      if (engine !== ownEngine) return;
      ownEngine.markPending();
      uploadSoon();
    });
    ownEngine = new WorkspaceSync(cache, {
      async read() {
        if (engine !== ownEngine) throw Error('Your account changed.');
        const result = await studioRequest<{ data: WorkspaceData; revision: number }>('workspace', undefined, 'GET', session.user.id);
        if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw Error('Invalid cloud revision.');
        await validate(result.data);
        return result;
      },
      async write(data, revision) {
        if (engine !== ownEngine) throw Error('Your account changed.');
        try {
          const saved = await studioRequest<{ revision: number }>('workspace', { data, revision }, 'PUT', session.user.id);
          if (!Number.isSafeInteger(saved.revision) || saved.revision <= revision) throw Error('The server did not acknowledge your save.');
          return saved.revision;
        } catch (error) { if (error instanceof CloudApiError && error.status === 409) throw new WorkspaceConflict(); throw error; }
      },
    }, () => { if (engine === ownEngine) patch({ sync: ownEngine.state, error: ownEngine.error }); });
    engine = ownEngine;
    await ownEngine.open();
    if (snapshot.generation !== generation) return;
    activateWorkspaceStorage(cache);
    patch({ ready: true });
    window.dispatchEvent(new Event('workspace-changed'));
    if (cache.read().pending && ownEngine.state !== 'conflict') uploadSoon();
  } catch {
    if (snapshot.generation === generation) patch({ ready: false, sync: 'error', error: 'Your cloud workspace could not be opened. Check your connection and database setup, then retry.' });
  }
}

export async function startAccount() {
  if (started) return;
  started = true;
  try { const data = await studioRequest<{ user: StudioSession['user'] | null }>('session'); const session = data.user ? { user: data.user } : null; rememberSession(session); await applySession(session); }
  catch {
    const cached = cachedSession();
    if (cached) await applySession(cached);
    else patch({ initialized: true, ready: true, error: 'Could not restore your session. Sign in again.', sync: 'guest' });
  }
  window.addEventListener('online', () => { if (engine && snapshot.ready) void engine.flush().catch(() => {}); });
  window.addEventListener('storage', event => {
    if (engine && event.key === engine.cache.key) engine.invalidate();
    if (event.key === 'gym-studio-auth-change') {
      if (timer) clearTimeout(timer); engine = null; activateWorkspaceStorage();
      patch({ ready: false, initialized: false, session: null });
      void studioRequest<{ user: StudioSession['user'] | null }>('session').then(data => { const session = data.user ? { user: data.user } : null; rememberSession(session); return applySession(session); }).catch(() => applySession(cachedSession()));
    }
  });
}
export async function retryCloud() {
  if (snapshot.ready && engine) { await engine.flush(); return; }
  const session = snapshot.session;
  patch({ initialized: false });
  await applySession(session, snapshot.recovery);
}
export async function signOut(keepOffline = false) {
  // Flush the builder's synchronous browser write before sending the final cloud snapshot.
  window.dispatchEvent(new Event('pagehide'));
  if (!keepOffline && engine && snapshot.ready) await engine.flush();
  await studioRequest('signout', {});
  rememberSession(null);
  await applySession(null);
  window.localStorage.setItem('gym-studio-auth-change', crypto.randomUUID());
}
export async function acceptSession(session: StudioSession | null) {
  rememberSession(session);
  await applySession(session);
  window.localStorage.setItem('gym-studio-auth-change', crypto.randomUUID());
}
export async function resolveCloud(choice: 'cloud' | 'local') {
  if (!engine) throw Error('Sign in first.');
  if (choice === 'cloud') await engine.useCloud(); else await engine.useLocal();
  // Mount a new builder/store after replacing its backing snapshot.
  patch({ generation: snapshot.generation + 1 });
  window.dispatchEvent(new Event('workspace-changed'));
}
export function finishRecovery() { patch({ recovery: false }); }
export function currentWorkspaceBackup(): WorkspaceData { return engine?.cache.read() ?? { values: {} }; }
export async function importGuestWorkspace() {
  if (!engine || !snapshot.ready) throw Error('Open your cloud workspace first.');
  const guest = await new LocalConfigStorage(window.localStorage).read();
  const cloud = await new LocalConfigStorage(engine.cache).read();
  // New IDs make repeat imports and matching local IDs safe, preserving both copies.
  const copies = guest.configs.map(config => ({ ...structuredClone(config), id: crypto.randomUUID(), name: `${config.name} (imported)`, gym: config.gym ?? { type: 'home' as const, client: '', createdAt: Date.now(), updatedAt: Date.now() } }));
  const parts = readCustomParts(window.localStorage).map(part => ({ ...part, id: crypto.randomUUID() }));
  const currentParts = readCustomParts(engine.cache);
  await new LocalConfigStorage(engine.cache).write({ ...cloud, configs: [...cloud.configs, ...copies] });
  engine.cache.setItem('bos-strength-custom-parts-v1', JSON.stringify({ version: 1, parts: [...currentParts, ...parts] }));
  window.dispatchEvent(new Event('workspace-changed'));
  await engine.flush();
  return { gyms: copies.length, parts: parts.length };
}
