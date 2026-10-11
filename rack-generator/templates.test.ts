import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { PARTS, TEMPLATE_IDS, templateEnvelope, isTemplate, benchLayout, type TemplateId } from './floor-parts/templates.ts';
import { definitions as builders } from './parts/templates.ts';
import { floorPart, floorOptions, resolveBy, validateFloorParams, coerceFloorParams } from './floor-registry.ts';
import { definitions } from './catalog.ts';
import { partAttribution } from './attribution.ts';
import type { NumericParams } from './types.ts';
const api = await Module(); api.setup();

/** Seeded pseudo-random, so failures reproduce. */
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const choice = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

function build(id: TemplateId, params: NumericParams) {
  const def = builders.find(d => d.id === id)!, parts = def.build(api, params);
  try {
    let tris = 0;
    for (const p of parts) {
      assert.equal(p.solid.status(), 'NoError', `${id} ${p.name}`);
      assert.ok(!p.solid.isEmpty() && p.solid.volume() > 0, `${id} ${p.name} has volume`);
      tris += p.solid.numTri();
    }
    const all = api.Manifold.union(parts.map(p => p.solid)), b = all.boundingBox(); all.delete();
    return { min: b.min as number[], max: b.max as number[], tris };
  } finally { for (const p of parts) p.solid.delete(); }
}
function checkEnvelope(id: TemplateId, params: NumericParams) {
  const part = floorPart(id)!, valid = validateFloorParams(part, params), box = build(id, valid);
  const [w, d, h] = templateEnvelope(id, valid), size = box.max.map((v, i) => v - box.min[i]);
  const where = `${id} ${JSON.stringify(valid)}`;
  assert.ok(Math.abs(size[0] - w) < .6 && Math.abs(size[1] - d) < .6 && Math.abs(size[2] - h) < .6, `${where}: built ${size.map(v => v.toFixed(1))} vs envelope ${[w, d, h]}`);
  assert.ok(Math.abs(box.min[2]) < .01, `${where}: stands on the floor`);
  const fp = resolveBy(part.footprint, valid), [ox, oy] = fp.offset ?? [0, 0];
  assert.ok(Math.abs(fp.width - w) < .6 && Math.abs(fp.depth - d) < .6, `${where}: footprint matches`);
  assert.ok(Math.abs((box.min[0] + box.max[0]) / 2 - ox) < .6 && Math.abs((box.min[1] + box.max[1]) / 2 - oy) < .6, `${where}: footprint centred`);
  assert.ok(box.tris < 80000, `${where}: ${box.tris} triangles`);
}
const validOrNull = (id: TemplateId, params: NumericParams) => { try { return validateFloorParams(floorPart(id)!, params); } catch { return null; } };

test('templates are registered with builders, a section and attribution', () => {
  assert.deepEqual(TEMPLATE_IDS, PARTS.map(p => p.id));
  for (const id of TEMPLATE_IDS) {
    assert.ok(isTemplate(id) && floorPart(id) && definitions.find(d => d.id === id)?.build, id);
    assert.equal(floorPart(id)!.section, 'Custom templates');
    assert.equal(partAttribution(id)?.vendor, 'Template');
  }
  assert.equal(isTemplate('powerblock'), false);
});

test('defaults and the first, middle and last option of every param build to their exact envelope', () => {
  for (const part of PARTS) {
    checkEnvelope(part.id, part.defaults);
    for (const param of part.params) {
      const options = floorOptions(param, part.defaults);
      for (const value of [options[0], options[Math.floor(options.length / 2)], options.at(-1)!]) {
        const params = validOrNull(part.id, { ...part.defaults, [param.key]: value });
        if (params) checkEnvelope(part.id, params);
      }
    }
  }
});

test('random valid combinations build to their exact envelope', () => {
  for (const part of PARTS) {
    let built = 0;
    for (let i = 0; i < 400 && built < 25; i++) {
      const params = Object.fromEntries(part.params.map(p => [p.key, choice(floorOptions(p, part.defaults))]));
      const valid = validOrNull(part.id, params);
      if (valid) { checkEnvelope(part.id, valid); built++; }
    }
    assert.ok(built >= 10, `${part.id}: only ${built} random combinations were valid`);
  }
});

test('published sizes land on the model: a 1270 × 610 × 445 mm bench and a 2235 × 965 × 1625 mm treadmill', () => {
  const bench = validateFloorParams(floorPart('template-bench')!, { length: 1270, width: 610, padLength: 1270, padWidth: 290, padHeight: 445, padThickness: 75 });
  assert.deepEqual(templateEnvelope('template-bench', bench).map(Math.round), [1270, 610, 445]);
  const tread = validateFloorParams(floorPart('template-cardio')!, { kind: 0, length: 2235, width: 965, height: 1625 });
  assert.deepEqual(templateEnvelope('template-cardio', tread), [2235, 965, 1625]);
  checkEnvelope('template-bench', bench); checkEnvelope('template-cardio', tread);
});

test('an inclined back pad raises the bench height and keeps the frame footprint', () => {
  const part = floorPart('template-bench')!, flat = { ...part.defaults, kind: 1, incline: 0 }, steep = { ...flat, incline: 85 };
  const a = benchLayout(flat), b = benchLayout(steep);
  assert.ok(b.height > a.height + 400, 'upright back pad is much taller');
  checkEnvelope('template-bench', steep);
});

test('params are strict for saved docs and snap for UI edits', () => {
  const machine = floorPart('template-machine')!;
  assert.throws(() => validateFloorParams(machine, { width: 1203 }), /machine/);
  assert.throws(() => validateFloorParams(machine, { colour: 1 }), /machine/);
  assert.throws(() => validateFloorParams(machine, { stacks: 1, height: 800 }), /weight stack/);
  assert.equal(coerceFloorParams(machine, { width: 1203 }).width, 1205);
  assert.throws(() => validateFloorParams(floorPart('template-disc')!, { diameter: 100, hole: 80 }), /hole/);
});

test('a bed has separate frame, mattress and pillows rather than a solid footprint block', () => {
  const bed = floorPart('template-bed')!;
  const params = validateFloorParams(bed, { ...bed.defaults, width: 1800, length: 2150, height: 1100 });
  const pieces = builders.find(d => d.id === 'template-bed')!.build(api, params);
  try {
    assert.ok(pieces.some(p => /frame/i.test(p.name)));
    assert.ok(pieces.some(p => /mattress/i.test(p.name)));
    assert.ok(pieces.some(p => /pillows/i.test(p.name)));
    const volume = pieces.reduce((sum, p) => sum + p.solid.volume(), 0);
    assert.ok(volume < params.length * params.width * params.height * .5, 'the bed leaves open space instead of filling the entire bounding box');
  } finally { for (const p of pieces) p.solid.delete(); }
  checkEnvelope('template-bed', params);
  checkEnvelope('template-bed', { ...params, pillows: 0, legHeight: 0 });
  assert.throws(() => validateFloorParams(bed, { ...params, height: 400 }), /headboard/);
});
