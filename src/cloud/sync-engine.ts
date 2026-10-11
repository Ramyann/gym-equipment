import { WorkspaceCache, type WorkspaceData } from '../state/workspace-storage.ts';

export interface RemoteWorkspace { data: WorkspaceData; revision: number }
export interface CloudTransport { read(): Promise<RemoteWorkspace>; write(data: WorkspaceData, revision: number): Promise<number> }
export type SyncState = 'opening' | 'saved' | 'pending' | 'syncing' | 'offline' | 'conflict' | 'error';
export class WorkspaceConflict extends Error { constructor() { super('This workspace changed on another device. Your local edits are safe. Resolve the conflict in Account.'); } }

/** Serial uploads acknowledge only their captured snapshot; edits made in flight remain queued. */
export class WorkspaceSync {
  private flight?: Promise<void>;
  state: SyncState = 'opening';
  error = '';
  constructor(readonly cache: WorkspaceCache, private remote: CloudTransport, private changed: () => void) {}
  private update(state: SyncState, error = '') { this.state = state; this.error = error; this.changed(); }
  private conflicted() { return this.state === 'conflict'; }
  async open() {
    try {
      const remote = await this.remote.read(), local = this.cache.read();
      if (local.pending) {
        if (local.revision !== remote.revision) this.update('conflict', new WorkspaceConflict().message);
        else this.update('pending');
      } else { this.cache.replace(remote.data, remote.revision); this.update('saved'); }
    } catch (error) {
      if (!this.cache.exists()) { this.update('error', 'Could not open your cloud workspace. Check your connection and account server, then retry.'); throw error; }
      this.update('offline', 'Using your cached workspace. Local edits will sync when the connection returns.');
    }
  }
  markPending() { if (this.state !== 'conflict') this.update('pending'); }
  invalidate() { this.cache.freeze(); this.update('conflict', 'This workspace changed in another tab. Reload before editing further.'); }
  flush(): Promise<void> {
    if (this.flight) return this.flight;
    const task = this.upload();
    this.flight = task.finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private async upload() {
    if (this.state === 'conflict') throw new WorkspaceConflict();
    try {
      if (!this.cache.read().pending) {
        const remote = await this.remote.read();
        if (remote.revision !== this.cache.read().revision) throw new WorkspaceConflict();
      }
      while (this.cache.read().pending) {
        const snapshot = this.cache.read();
        this.update('syncing');
        const revision = await this.remote.write({ values: snapshot.values }, snapshot.revision);
        if (this.conflicted()) throw new WorkspaceConflict();
        this.cache.acknowledge(revision, snapshot.change);
      }
      this.update('saved');
    } catch (error) {
      if (error instanceof WorkspaceConflict) this.update('conflict', error.message);
      else this.update('offline', 'Saved on this device. Cloud sync failed; retry when you are online.');
      throw error;
    }
  }
  /** User explicitly chooses the cloud copy after backing up local edits. */
  async useCloud() { await this.flight?.catch(() => {}); const remote = await this.remote.read(); this.cache.replace(remote.data, remote.revision); this.update('saved'); }
  /** User explicitly chooses their local copy; another concurrent change still produces a conflict. */
  async useLocal() { await this.flight?.catch(() => {}); const remote = await this.remote.read(), local = this.cache.read(); if (!local.pending) throw Error('There are no local changes to upload. Use the cloud version to reload.'); this.cache.acknowledge(remote.revision, 'force-pending'); this.cache.unfreeze(); this.update('pending'); await this.flush(); }
}
