import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_PARTS_KEY, readCustomParts, writeCustomPart, type CustomPart } from './custom-parts.ts';
import { BuilderStore } from './builder-store.ts';
import { floorPart } from '../../rack-generator/floor-registry.ts';
import { encodeComponents, TEMPLATE_ASSEMBLY } from '../../rack-generator/floor-parts/generated-model.ts';
import { wallPart } from '../../rack-generator/wall-registry.ts';
import { getPartDefaults } from '../../rack-generator/assembly.ts';
import { structureCandidates } from '../../rack-generator/structure-candidates.ts';
import { SYSTEM_DEFAULTS } from '../../rack-generator/system-types.ts';
import { applyPreset } from '../../rack-generator/presets.ts';
import type { NumericParams, PartId } from '../../rack-generator/types.ts';

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function preset(part: PartId, changes: NumericParams = {}): CustomPart {
  const defaults = floorPart(part)?.defaults ?? wallPart(part)?.defaults ?? getPartDefaults(part);
  return { id: 'preset-1', name: 'My equipment', part, defaults: { ...defaults }, params: { ...defaults, ...changes } };
}
function catalog(store: BuilderStore, item: CustomPart) {
  store.patch({ definitions: [{ id: item.part, name: item.part, category: 'Test', defaults: item.defaults }] });
}

test('generated multi-component equipment starts builder placement, saves, and reloads with its colours and geometry', async () => {
  const storage = memory(), store = new BuilderStore(storage);
  await store.ready;
  const params = { ...TEMPLATE_ASSEMBLY.defaults, ...encodeComponents([
    {name:'Top',shape:'box',position:[0,0,740],size:[1800,900,40],rotation:[0,0,0],color:0xc49a6c},
    {name:'Left leg',shape:'box',position:[-800,0,360],size:[80,80,720],rotation:[0,0,0],color:0xb8895a},
    {name:'Right leg',shape:'box',position:[800,0,360],size:[80,80,720],rotation:[0,0,0],color:0xb8895a},
  ]) };
  const item = preset('template-assembly', params);
  catalog(store, { ...item, defaults: TEMPLATE_ASSEMBLY.defaults });
  assert.equal(store.startCustomPlacement(item), true, 'component fields beyond the default single component are supported');
  store.previewFloor([1500,1500], 0);
  store.acceptProposal();
  const saved = store.getSnapshot().doc.floorItems!.at(-1)!;
  assert.equal(saved.label, item.name);
  assert.equal(saved.params.count, 3);
  assert.equal(saved.params.c2_color, 0xb8895a);
  assert.equal(saved.params.c2_x, 800);
  await store.save('Generated table gym');
  await store.flushStorage();
  const restored = new BuilderStore(storage);
  await restored.ready;
  assert.deepEqual(restored.getSnapshot().doc.floorItems!.at(-1)!.params, saved.params);
  assert.equal(store.startCustomPlacement({...item, params:{...params,c2_color:0x1000000}}), false, 'unsafe generated fields remain rejected');
});

test('custom presets round-trip, update by ID and stay detached from caller data', () => {
  const storage = memory(), item = preset('pegboard-panel', { width: 610 });
  writeCustomPart(storage, item);
  item.params.width = 1219;
  assert.equal(readCustomParts(storage)[0].params.width, 610);
  writeCustomPart(storage, { ...item, name: ' Updated panel ' });
  assert.equal(readCustomParts(storage).length, 1);
  assert.equal(readCustomParts(storage)[0].name, 'Updated panel');
  assert.equal(readCustomParts(storage)[0].params.width, 1219);
  assert.throws(() => writeCustomPart(storage, { ...item, params: { width: NaN } }));
});

test('corrupt storage is preserved and failed writes do not report success', () => {
  const storage = memory();
  storage.setItem(CUSTOM_PARTS_KEY, 'broken');
  assert.throws(() => writeCustomPart(storage, preset('pegboard-panel')));
  assert.equal(storage.getItem(CUSTOM_PARTS_KEY), 'broken');
  assert.throws(() => writeCustomPart({ getItem: () => null, setItem: () => { throw Error('Full'); } }, preset('pegboard-panel')), /Full/);
});

test('custom floor settings survive movement, commit, history and configuration reload', async () => {
  const storage = memory(), store = new BuilderStore(storage);
  await store.ready;
  const item = preset('rogue-adjustable-bench-3', { backAngle: 45 });
  catalog(store, item);
  const before = store.getSnapshot().doc;
  assert.equal(store.startCustomPlacement(item), true);
  assert.equal(store.getSnapshot().doc, before);
  store.previewFloor([500, 750], Math.PI / 2);
  assert.equal(store.getSnapshot().proposal!.entries[0].params.backAngle, 45);
  store.acceptProposal();
  assert.equal(store.getSnapshot().doc.floorItems!.at(-1)!.params.backAngle, 45);
  item.params.backAngle = 0;
  assert.equal(store.getSnapshot().doc.floorItems!.at(-1)!.params.backAngle, 45);
  store.history('undo'); assert.deepEqual(store.getSnapshot().doc, before);
  store.history('redo');
  await store.save('Custom gym'); await store.flushStorage();
  const restored = new BuilderStore(storage); await restored.ready;
  assert.equal(restored.getSnapshot().doc.floorItems!.at(-1)!.params.backAngle, 45);
  const imported = new BuilderStore(); await imported.ready;
  imported.importJSON(store.exportJSON());
  assert.equal(imported.getSnapshot().doc.floorItems!.at(-1)!.params.backAngle, 45);
  store.seekHistory(0);
  assert.equal(store.startCustomPlacement({ ...item, params: { ...item.params, backAngle: 60 } }), true);
  assert.equal(store.getSnapshot().proposal!.entries[0].params.backAngle, 60);
  store.cancelPlacement();
  store.startPlacement('rogue-adjustable-bench-3');
  assert.equal(store.getSnapshot().proposal!.entries[0].params.backAngle, floorPart(item.part)!.defaults.backAngle);
});

test('custom cable-system settings can be placed and adjusted without being overwritten by the preset', async () => {
  const store = new BuilderStore(); await store.ready;
  store.commit(applyPreset('bos-hydra-four-2133.6-762'));
  const item: CustomPart = { id: 'custom-kraken', name: 'My Kraken', part: 'cable-kraken',
    defaults: { ...SYSTEM_DEFAULTS['cable-kraken'] }, params: { ...SYSTEM_DEFAULTS['cable-kraken'], shroud: 1 } };
  catalog(store, item);
  assert.equal(store.startCustomPlacement(item), true);
  assert.equal(store.getSnapshot().proposal!.doc.systems![0].params.shroud, 1);
  store.previewSystem({ shroud: 0 });
  assert.equal(store.getSnapshot().proposal!.doc.systems![0].params.shroud, 0);
  store.acceptProposal();
  assert.equal(store.getSnapshot().doc.systems![0].params.shroud, 0);
});

test('both copies of a paired custom part retain settings, and cancellation leaves normal placement alone', async () => {
  const store = new BuilderStore(); await store.ready;
  const item = preset('powerblock', { weight: 40 }); catalog(store, item);
  assert.equal(store.startCustomPlacement(item), true);
  assert.equal(store.getSnapshot().proposal!.entries.length, 2);
  store.previewFloor([1000, 500]);
  assert.deepEqual(store.getSnapshot().proposal!.entries.map(e => e.params.weight), [40, 40]);
  store.patch({ paired: false });
  assert.deepEqual(store.getSnapshot().proposal!.entries.map(e => e.params.weight), [40]);
  store.patch({ paired: true });
  store.acceptProposal();
  assert.deepEqual(store.getSnapshot().doc.floorItems!.map(i => i.params.weight), [40, 40]);
  store.startCustomPlacement(item); store.escape();
  store.startPlacement('powerblock');
  assert.deepEqual(store.getSnapshot().proposal!.entries.map(e => e.params.weight), [50, 50]);
});

test('a custom upright keeps its height through structural preview and history', async () => {
  const store = new BuilderStore(); await store.ready;
  const item: CustomPart = { id: 'short-upright', name: 'Short post', part: 'upright', defaults: { height: 2400 }, params: { height: 1800 } };
  catalog(store, item);
  assert.equal(store.startCustomPlacement(item), true);
  const candidate = structureCandidates(store.getSnapshot().doc, 'upright')[0];
  store.patch({ proposal: candidate });
  assert.equal(store.getSnapshot().proposal!.doc.uprights[candidate.ownerId].height, 1800);
  store.acceptProposal();
  assert.equal(store.getSnapshot().doc.uprights[candidate.ownerId].height, 1800);
  store.history('undo');
  assert.equal(store.getSnapshot().doc.uprights[candidate.ownerId], undefined);
});

test('custom wall size is used in the ghost and survives moving onto another wall', async () => {
  const store = new BuilderStore(); await store.ready;
  const item = preset('pegboard-panel', { width: 610 }); catalog(store, item);
  assert.equal(store.startCustomPlacement(item), true);
  store.previewWall('left', [0, 1500]);
  assert.equal(store.getSnapshot().proposal!.entries[0].params.width, 610);
  store.acceptProposal();
  assert.equal(store.getSnapshot().doc.wallItems![0].params.width, 610);
});

test('custom rack settings survive mount changes and invalid fit is rejected without editing the gym', async () => {
  const store = new BuilderStore(); await store.ready;
  const item = preset('safety-pin-pipe', { pipeDiameter: 50 }); catalog(store, item);
  const before = store.getSnapshot().doc;
  assert.equal(store.startCustomPlacement(item), true);
  const proposal = store.getSnapshot().proposal!;
  store.previewMount(proposal.target!);
  assert.equal(store.getSnapshot().proposal!.doc.accessories.at(-1)!.params.pipeDiameter, 50);
  store.acceptProposal();
  assert.equal(store.getSnapshot().doc.accessories.at(-1)!.params.pipeDiameter, 50);
  store.history('undo');
  const invalid = preset('j-hook-standard', { width: 200 }); catalog(store, invalid);
  assert.equal(store.startCustomPlacement(invalid), false);
  assert.deepEqual(store.getSnapshot().doc, before);
  assert.equal(store.getSnapshot().placing, null);
  assert.equal(store.getSnapshot().proposal, null);
});
