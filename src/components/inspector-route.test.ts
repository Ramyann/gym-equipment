import test from 'node:test';
import assert from 'node:assert/strict';
import { BuilderStore } from '../state/builder-store.ts';
import { inspectorRoute } from './Inspector/inspector-route.ts';

test('gym overview yields to room, equipment placement and selected equipment', () => {
  const store = new BuilderStore();
  assert.equal(inspectorRoute(store.getSnapshot()).kind, 'overview');
  store.openRoom();
  assert.equal(inspectorRoute(store.getSnapshot()).kind, 'room');
  store.select(null);
  store.startPlacement('rep-fb-5000');
  assert.equal(inspectorRoute(store.getSnapshot()).kind, 'placement');
  store.acceptProposal();
  const item = store.getSnapshot().doc.floorItems!.find(i => i.part === 'rep-fb-5000')!;
  assert.ok(item);
  store.select(item.id);
  assert.deepEqual(inspectorRoute(store.getSnapshot()), { kind: 'floor', id: item.id });
  store.startPlacement(item.part, item.id);
  assert.equal(inspectorRoute(store.getSnapshot()).kind, 'placement');
  store.cancelPlacement();
  store.select(null);
  assert.equal(inspectorRoute(store.getSnapshot()).kind, 'overview');
  store.startPlacement('upright');
  assert.equal(inspectorRoute(store.getSnapshot()).kind, 'full');
});
