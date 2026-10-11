import type { StorageLike } from './config-storage.ts';

export const WORKSPACE_KEYS = ['bos-strength-configurations-v1', 'bos-strength-custom-parts-v1'] as const;
export interface WorkspaceData { values: Record<string, string> }
export interface CachedWorkspace extends WorkspaceData { version: 1; revision: number; pending: boolean; change: string }
const empty = (): CachedWorkspace => ({ version: 1, revision: 0, pending: false, change: '', values: {} });

/** One atomic browser record per account. Guest storage is never implicitly imported. */
export class WorkspaceCache implements StorageLike {
  readonly key: string;
  private frozen = false;
  constructor(private base: StorageLike, userId: string, private changed: () => void = () => {}) {
    this.key = `gym-studio-workspace:${userId}`;
  }
  exists() { return this.base.getItem(this.key) !== null; }
  read(): CachedWorkspace {
    const raw = this.base.getItem(this.key);
    if (!raw) return empty();
    const value = JSON.parse(raw) as CachedWorkspace;
    if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.pending !== 'boolean' || typeof value.change !== 'string'
      || !value.values || typeof value.values !== 'object' || Array.isArray(value.values) || Object.entries(value.values).some(([key, text]) => !WORKSPACE_KEYS.includes(key as typeof WORKSPACE_KEYS[number]) || typeof text !== 'string')) throw Error('The cached workspace could not be read. Download a backup before clearing storage.');
    return value;
  }
  getItem(key: string) { return this.read().values[key] ?? null; }
  setItem(key: string, value: string) {
    if (this.frozen) throw Error('Your workspace changed in another tab. Reload before saving further edits.');
    if (!WORKSPACE_KEYS.includes(key as typeof WORKSPACE_KEYS[number])) throw Error('Unsupported workspace setting.');
    const current = this.read();
    if (current.values[key] === value) return;
    this.base.setItem(this.key, JSON.stringify({ ...current, values: { ...current.values, [key]: value }, pending: true, change: crypto.randomUUID() }));
    this.changed();
  }
  replace(data: WorkspaceData, revision: number) {
    this.base.setItem(this.key, JSON.stringify({ version: 1, revision, pending: false, change: crypto.randomUUID(), values: data.values } satisfies CachedWorkspace));
    this.frozen = false;
  }
  freeze() { this.frozen = true; }
  unfreeze() { this.frozen = false; }
  acknowledge(revision: number, change: string) {
    const current = this.read();
    this.base.setItem(this.key, JSON.stringify({ ...current, revision, pending: current.change !== change }));
  }
}

let active: StorageLike | undefined;
export function activateWorkspaceStorage(storage?: StorageLike) { active = storage; }
export function workspaceStorage(): StorageLike { return active ?? window.localStorage; }
export function isWorkspaceStorageEvent(key: string | null) {
  return key === null || (active instanceof WorkspaceCache ? key === active.key : WORKSPACE_KEYS.includes(key as typeof WORKSPACE_KEYS[number]));
}
