import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCustomParts, writeCustomPart, type CustomPart } from '../state/custom-parts.ts';
import { parseSpec, provenance, reviewSpec } from './spec.ts';
import { floorPart, validateFloorParams } from '../../rack-generator/floor-registry.ts';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const SRC = 'https://example.com/treadmill';
const spec = parseSpec({
  status: 'found', brand: 'Example', model: 'T-900 Treadmill', category: 'treadmill', product_url: SRC, template: 'template-cardio',
  params: [{ key: 'kind', value: 0, basis: 'published', source_url: SRC, note: '' }, { key: 'length', value: 2032, basis: 'published', source_url: SRC, note: '80 in' },
    { key: 'width', value: 889, basis: 'published', source_url: SRC, note: '35 in' }, { key: 'height', value: 1626, basis: 'published', source_url: SRC, note: '64 in' }],
  overall: { length_mm: 2032, width_mm: 889, height_mm: 1626, basis: 'published', source_url: SRC }, sources: [{ url: SRC, title: 'T-900 specs' }], notes: '', questions: [],
});

test('an AI part saves as a normal custom part with its provenance, and reloads valid', () => {
  const storage = memory(), review = reviewSpec(spec), part = floorPart('template-cardio')!;
  assert.equal(review.confidence, 'high', '2032/889/1626 snap to 2030/890/1625, all within tolerance');
  const saved: CustomPart = { id: 'p1', name: 'Example T-900', part: 'template-cardio', params: review.params, defaults: part.defaults, ai: provenance(spec, review, 'anthropic:test') };
  writeCustomPart(storage, saved);
  const [loaded] = readCustomParts(storage);
  assert.equal(loaded.ai?.brand, 'Example');
  assert.deepEqual(loaded.ai?.sources, [{ url: SRC, title: 'T-900 specs' }]);
  assert.deepEqual(validateFloorParams(part, loaded.params), loaded.params, 'saved params are valid template params');
});

test('editing a saved AI part in the part viewer keeps its provenance', () => {
  const storage = memory(), review = reviewSpec(spec), part = floorPart('template-cardio')!;
  writeCustomPart(storage, { id: 'p1', name: 'Example T-900', part: 'template-cardio', params: review.params, defaults: part.defaults, ai: provenance(spec, review, 'anthropic:test') });
  // The part viewer saves { id, name, part, params, defaults } without `ai`.
  writeCustomPart(storage, { id: 'p1', name: 'Example T-900 (home)', part: 'template-cardio', params: { ...review.params, height: 1600 }, defaults: part.defaults });
  const [loaded] = readCustomParts(storage);
  assert.equal(loaded.name, 'Example T-900 (home)');
  assert.equal(loaded.params.height, 1600);
  assert.equal(loaded.ai?.model, 'T-900 Treadmill');
});

test('a placed custom part shows its saved name and keeps it through undo, redo and reload', async () => {
  const { BuilderStore } = await import('../state/builder-store.ts');
  const { validateAssembly, resolveAssembly } = await import('../../rack-generator/assembly.ts');
  const storage = memory(), store = new BuilderStore(storage);
  await store.ready;
  const part = floorPart('template-cardio')!, review = reviewSpec(spec);
  const preset: CustomPart = { id: 'p2', name: 'Example T-900', part: 'template-cardio', params: review.params, defaults: part.defaults, ai: provenance(spec, review, 'test') };
  store.patch({ definitions: [{ id: preset.part, name: 'Cardio machine template', category: 'Custom templates', defaults: preset.defaults }] });
  assert.equal(store.startCustomPlacement(preset), true);
  store.previewFloor([2500, 0], 0);
  store.acceptProposal();
  const item = store.getSnapshot().doc.floorItems!.at(-1)!;
  assert.equal(item.label, 'Example T-900');
  assert.equal(item.params.length, 2030);
  assert.equal(resolveAssembly(store.getSnapshot().doc).find(r => r.id === item.id)?.label, 'Example T-900');
  store.history('undo'); store.history('redo');
  assert.equal(store.getSnapshot().doc.floorItems!.at(-1)!.label, 'Example T-900');
  const reloaded = validateAssembly(JSON.parse(JSON.stringify(store.getSnapshot().doc)));
  assert.equal(reloaded.floorItems!.at(-1)!.label, 'Example T-900');
  // Ordinary parts carry no label, and junk labels are dropped rather than breaking a saved design.
  const junk = validateAssembly({ ...reloaded, floorItems: reloaded.floorItems!.map(i => ({ ...i, label: 42 })) });
  assert.equal(junk.floorItems!.at(-1)!.label, undefined);
});
