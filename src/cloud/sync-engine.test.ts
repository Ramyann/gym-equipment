import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceCache, WORKSPACE_KEYS } from '../state/workspace-storage.ts';
import { WorkspaceConflict, WorkspaceSync, type CloudTransport, type RemoteWorkspace } from './sync-engine.ts';
class Memory { values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } }
const key = WORKSPACE_KEYS[0];
function remote(initial: RemoteWorkspace = { data: { values: {} }, revision: 0 }) {
  let state = structuredClone(initial);
  const transport: CloudTransport = { read: async () => structuredClone(state), write: async (data, revision) => { if (state.revision !== revision) throw new WorkspaceConflict(); state = { data: structuredClone(data), revision: revision + 1 }; return state.revision; } };
  return { transport, current: () => state };
}
test('account caches are isolated from each other and guest storage', () => {
  const memory = new Memory(); memory.setItem(key, 'guest');
  const a = new WorkspaceCache(memory, 'a'), b = new WorkspaceCache(memory, 'b');
  a.setItem(key, 'a'); b.setItem(key, 'b'); assert.equal(a.getItem(key), 'a'); assert.equal(b.getItem(key), 'b'); assert.equal(memory.getItem(key), 'guest');
});
test('a new device loads the cloud snapshot and uploads edits with its revision', async () => {
  const memory = new Memory(), cache = new WorkspaceCache(memory, 'a'), cloud = remote({ data: { values: { [key]: 'old' } }, revision: 3 });
  const sync = new WorkspaceSync(cache, cloud.transport, () => {}); await sync.open(); assert.equal(cache.getItem(key), 'old');
  cache.setItem(key, 'new'); await sync.flush(); assert.equal(sync.state, 'saved'); assert.equal(cloud.current().revision, 4); assert.equal(cache.read().pending, false);
});
test('edits made during an upload remain pending and are uploaded next', async () => {
  const cache = new WorkspaceCache(new Memory(), 'a'), cloud = remote();
  let once = false;
  const sync = new WorkspaceSync(cache, { ...cloud.transport, write: async (data, revision) => { if (!once) { once = true; cache.setItem(key, 'second'); } return cloud.transport.write(data, revision); } }, () => {});
  await sync.open(); cache.setItem(key, 'first'); await sync.flush(); assert.equal(cloud.current().data.values[key], 'second'); assert.equal(cloud.current().revision, 2);
});
test('offline edits survive reloading and retry without reporting a false cloud save', async () => {
  const memory = new Memory(), cache = new WorkspaceCache(memory, 'a'), cloud = remote();
  const sync = new WorkspaceSync(cache, cloud.transport, () => {}); await sync.open(); cache.setItem(key, 'offline');
  const reloaded = new WorkspaceCache(memory, 'a');
  const offline = new WorkspaceSync(reloaded, { read: async () => { throw Error('offline'); }, write: async () => { throw Error('offline'); } }, () => {});
  await offline.open(); assert.equal(reloaded.getItem(key), 'offline'); await assert.rejects(offline.flush()); assert.equal(offline.state, 'offline'); assert.equal(reloaded.read().pending, true);
  const recovered = new WorkspaceSync(reloaded, cloud.transport, () => {}); await recovered.open(); await recovered.flush(); assert.equal(cloud.current().data.values[key], 'offline');
});
test('conflicting devices preserve both snapshots until a user resolves the conflict', async () => {
  const memory = new Memory(), cloud = remote(), cache = new WorkspaceCache(memory, 'a'), sync = new WorkspaceSync(cache, cloud.transport, () => {});
  await sync.open(); cache.setItem(key, 'local'); await cloud.transport.write({ values: { [key]: 'other device' } }, 0);
  await assert.rejects(sync.flush(), WorkspaceConflict); assert.equal(cache.getItem(key), 'local'); assert.equal(cloud.current().data.values[key], 'other device');
  await sync.useLocal(); assert.equal(cloud.current().data.values[key], 'local'); assert.equal(sync.state, 'saved');
});
test('choosing the cloud version replaces the local cache only after explicit resolution', async () => {
  const cloud = remote({ data: { values: { [key]: 'cloud' } }, revision: 2 }), cache = new WorkspaceCache(new Memory(), 'a');
  cache.setItem(key, 'local'); const sync = new WorkspaceSync(cache, cloud.transport, () => {}); await sync.open(); assert.equal(sync.state, 'conflict'); assert.equal(cache.getItem(key), 'local');
  await sync.useCloud(); assert.equal(cache.getItem(key), 'cloud'); assert.equal(cache.read().pending, false);
});
test('a changed browser tab blocks stale saves and a new device cannot pretend to work offline', async () => {
  const cache = new WorkspaceCache(new Memory(), 'a'), cloud = remote(), sync = new WorkspaceSync(cache, cloud.transport, () => {});
  await sync.open(); sync.invalidate(); assert.throws(() => cache.setItem(key, 'stale'), /another tab/); await assert.rejects(sync.flush(), WorkspaceConflict);
  const blank = new WorkspaceSync(new WorkspaceCache(new Memory(), 'b'), { read: async () => { throw Error('offline'); }, write: async () => 1 }, () => {});
  await assert.rejects(blank.open()); assert.equal(blank.state, 'error');
});
test('a tab invalidated during an upload stays in conflict until its latest cloud snapshot is chosen', async () => {
  const cache = new WorkspaceCache(new Memory(), 'a'), cloud = remote();
  let sync: WorkspaceSync;
  sync = new WorkspaceSync(cache, { ...cloud.transport, write: async (data, revision) => { sync.invalidate(); return cloud.transport.write(data, revision); } }, () => {});
  await sync.open(); cache.setItem(key, 'saved in flight');
  await assert.rejects(sync.flush(), WorkspaceConflict); assert.equal(sync.state, 'conflict'); assert.equal(cache.read().pending, true);
  await sync.useCloud(); assert.equal(sync.state, 'saved'); assert.equal(cache.getItem(key), 'saved in flight');
});
