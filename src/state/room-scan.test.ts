import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { parseRoomScan, readRoomScanFile, scanToProject } from './room-scan.ts';
import { LocalConfigStorage, CONFIG_KEY } from './config-storage.ts';
import type { SavedConfig } from './config-storage.ts';
import { floorBounds } from '../../rack-generator/floor-items.ts';
import { wallOpenings } from '../../rack-generator/wall-items.ts';
import { resolveAssembly } from '../../rack-generator/assembly.ts';
import { decodeComponents } from '../../rack-generator/floor-parts/generated-model.ts';

type M = number[];
/** Column-major pose turned `yaw` about +Y: local +X runs along (cos, 0, -sin). */
const pose = (x: number, y: number, z: number, yaw: number): M => { const c = Math.cos(yaw), s = Math.sin(yaw); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1]; };
const mul = (a: M, b: M): M => Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + i % 4] * b[i - i % 4 + k], 0));
const inverse = (m: M): M => { const out = Array(16).fill(0); for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) out[c * 4 + r] = m[r * 4 + c]; out[12 + r] = -[0, 1, 2].reduce((s, k) => s + m[r * 4 + k] * m[12 + k], 0); } out[15] = 1; return out; };

/** A RoomPlan room laid out square on the plan (`centre`, `size` in metres), posed into a capture frame by `place`. */
function room(place: (m: M) => M, [cx, cz]: number[], [w, d]: number[], extra: { doors?: [number[], number, number[], string][]; windows?: [number[], number, number[], string][]; openings?: [number[], number, number[], string][]; objects?: [string, number[], number, number[]][] } = {}) {
  const at = ([x, y, z]: number[], yaw: number) => place(pose(cx + x, y, cz + z, yaw));
  const wall = (identifier: string, x: number, z: number, yaw: number, length: number) => ({ identifier, category: { wall: {} }, confidence: { high: {} }, transform: at([x, 1.25, z], yaw), dimensions: [length, 2.5, 0] });
  const opening = (kind: string) => ([p, yaw, dimensions, parentIdentifier]: [number[], number, number[], string]) => ({ category: { [kind]: kind === 'door' ? { isOpen: false } : {} }, transform: at(p, yaw), dimensions, parentIdentifier });
  return {
    version: 2,
    walls: [wall('back', 0, -d / 2, 0, w), wall('front', 0, d / 2, Math.PI, w), wall('left', -w / 2, 0, Math.PI / 2, d), wall('right', w / 2, 0, -Math.PI / 2, d)],
    floors: [{ category: { floor: {} }, transform: at([0, 0, 0], 0), dimensions: [w, d, 0] }],
    doors: (extra.doors ?? []).map(opening('door')), windows: (extra.windows ?? []).map(opening('window')), openings: (extra.openings ?? []).map(opening('opening')),
    objects: (extra.objects ?? []).map(([category, p, yaw, dimensions]) => ({ category: { [category]: {} }, confidence: { high: {} }, transform: at(p, yaw), dimensions })),
  };
}
/** A 5 × 4 × 2.5 m room posed in ARKit world space turned 20° and offset, like a real capture. */
const ROOM = room(m => mul(pose(2, -1.4, -3, 20 * Math.PI / 180), m), [0, 0], [5, 4], {
  doors: [[[2.5, 1, 0.5], -Math.PI / 2, [0.8, 2, 0], 'right']],
  windows: [[[-1, 1.5, -2], 0, [1.2, 0.9, 0], 'back']],
  openings: [[[1.5, 1, 2], Math.PI, [0.9, 2, 0], 'front']],
  objects: [['sofa', [1, 0.42, -1.55], 0, [2, 0.85, 0.9]], ['bed', [1.5, 0.3, 1], -Math.PI / 2, [1.6, 0.6, 2]], ['television', [-2.3, 1.2, 0], Math.PI / 2, [1, 0.6, 0.08]], ['storage', [-1, 0.9, 1.8], Math.PI, [0.8, 1.8, 0.3]]],
});
const near = (actual: number, expected: number, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** The same storage validation as any saved project. */
async function stored(config: SavedConfig) {
  const raw = JSON.stringify({ version: 2, configs: [config], activeId: config.id, draft: null });
  return (await new LocalConfigStorage({ getItem: k => k === CONFIG_KEY ? raw : null, setItem: () => {} }).read()).configs[0];
}

test('a RoomPlan room becomes a square, measured Studio room with doors, windows and furniture', async () => {
  const scan = parseRoomScan(JSON.parse(JSON.stringify(ROOM)));
  const { config, summary } = scanToProject({ rooms: [{ name: 'Living room', scan }], notes: [] }, { name: 'Scanned flat', projectType: 'apartment' }, 'scan', 0);
  const [living] = summary.rooms;
  assert.deepEqual([living.name, living.width, living.length, living.height, living.doors, living.windows, living.furniture], ['Living room', 5000, 4000, 2500, 1, 1, 4]);
  assert.ok(summary.notes.some(n => n.includes('passage')));
  assert.ok(!summary.notes.some(n => n.includes('rectangular')));
  assert.deepEqual(config.doc.room && [config.doc.room.left, config.doc.room.right, config.doc.room.back, config.doc.room.front, config.doc.room.height], [2500, 2500, 2000, 2000, 2500]);
  assert.deepEqual(config.rooms?.map(r => [r.name, r.position]), [['Living room', [0, 0]]]);

  const door = config.doc.wallItems!.find(i => i.part === 'decor-interior-door')!, window = config.doc.wallItems!.find(i => i.part === 'decor-window')!;
  assert.deepEqual([door.part, door.wall, door.position[0], door.params.width], ['decor-interior-door', 'right', 500, 32]);
  assert.deepEqual([window.part, window.wall, window.position, window.params.width, window.params.height], ['decor-window', 'back', [-1000, 1500], 48, 36]);
  assert.equal(wallOpenings(config.doc).length, 2);

  const [sofa, bed, tv, shelf] = config.doc.floorItems!;
  assert.deepEqual([sofa.label, sofa.params.length, sofa.params.width, sofa.params.height], ['Sofa', 2000, 900, 850]);
  near(sofa.position[0], 1000); near(sofa.position[1], -1550); near(angle(sofa.rotation), 0, 1e-6);
  near(angle(bed.rotation), Math.PI / 2, 1e-6); // headboard (the preset's front) turned to the right wall
  assert.equal(tv.params.height, 1500);
  assert.ok(decodeComponents(tv.params).some(c => c.size[2] === 2), 'raised items keep their height over a footprint plate');
  assert.equal(shelf.label, 'Storage');
  for (const item of config.doc.floorItems!) { const b = floorBounds(item); assert.ok(b.min[0] >= -2500.5 && b.max[0] <= 2500.5 && b.min[1] >= -2000.5 && b.max[1] <= 2000.5, `${item.label} stays in the room`); }
  assert.ok(resolveAssembly(config.doc).length >= 6);
  assert.equal((await stored(config)).doc.floorItems?.length, 4);
});

test('a shared room .zip reads only the room layout and takes its name from the manifest', () => {
  const zip = zipSync({
    'Kitchen 2026-10-20/manifest.json': strToU8(JSON.stringify({ format: 'house-capture/5', rooms: [{ index: 3, name: 'Kitchen' }] })),
    'Kitchen 2026-10-20/rooms/room-3.json': strToU8(JSON.stringify(ROOM)),
    'Kitchen 2026-10-20/rooms/room-3-data.json': strToU8('not json'),
    'Kitchen 2026-10-20/photos/0000.jpg': new Uint8Array(64),
  });
  const file = readRoomScanFile(zip);
  assert.deepEqual([file.rooms.length, file.rooms[0].name, file.rooms[0].scan.walls.length, file.notes], [1, 'Kitchen', 4, []]);
  assert.equal(readRoomScanFile(strToU8(JSON.stringify(ROOM))).rooms[0].scan.objects.length, 4);
  assert.throws(() => readRoomScanFile(zipSync({ 'photos/0000.jpg': new Uint8Array(4) })), /No RoomPlan room/);
});

test('a whole-house .zip places every aligned room on the plan in one direction', async () => {
  // The house frame is turned 30° and offset; each session has its own ARKit frame inside its zone.
  const house = pose(7, 0, -3, 30 * Math.PI / 180), zoneA = pose(1, 0, 2, 0.3), zoneB = pose(-3, 0, 4, -0.7);
  const s1 = pose(-2, -1.4, 0.5, 1.1), s2 = pose(0.2, -1.2, 3, 2), s3 = pose(5, -1, 1, 0.4);
  const inSession = (toHouse: M) => (m: M) => mul(inverse(toHouse), mul(house, m));
  const living = room(inSession(mul(zoneA, s1)), [0, 0], [5, 4]);
  const kitchen = room(inSession(mul(zoneA, s1)), [4, 0], [3, 4], { doors: [[[1.5, 1, 0.5], -Math.PI / 2, [0.8, 2, 0], 'right']], objects: [['table', [0.5, 0.4, 0.5], 0, [1.2, 0.75, 0.8]]] });
  const bedroom = room(inSession(mul(zoneB, s2)), [0.5, -4], [4, 4]);
  const garage = room(m => mul(s3, m), [0, 0], [6, 6]);
  const json = (v: unknown) => strToU8(JSON.stringify(v));
  const zip = zipSync({
    'Maple St/house.json': json({ format: 'house-project/1', id: 'maple', name: 'Maple St',
      zones: [{ id: 'a', name: 'Ground', aligned: true, toHouse: zoneA }, { id: 'b', name: 'Back', aligned: true, toHouse: zoneB }, { id: 'c', name: 'Garage', aligned: false, toHouse: pose(0, 0, 0, 0) }],
      sessions: [{ id: '2026-10-01 10.00.00', zone: 'a', alignment: { method: 'first', toZone: s1 } }, { id: '2026-10-02 09.30.00', zone: 'b', alignment: { method: 'relocalized', toZone: s2 } }, { id: '2026-10-03 15.00.00', zone: 'c', alignment: { method: 'unaligned', toZone: s3 } }],
      rooms: [
        { id: 'r1', name: 'Living', zone: 'a', active: { session: '2026-10-01 10.00.00', index: 0 } },
        { id: 'r2', name: 'Kitchen', zone: 'a', active: { session: '2026-10-01 10.00.00', index: 1 } },
        { id: 'r3', name: 'Bedroom', zone: 'b', active: { session: '2026-10-02 09.30.00', index: 0 } },
        { id: 'r4', name: 'Garage', zone: 'c', active: { session: '2026-10-03 15.00.00', index: 0 } },
        { id: 'r5', name: 'Hallway', zone: 'a' },
      ] }),
    'Maple St/sessions/2026-10-01 10.00.00/rooms/room-0.json': json(living),
    'Maple St/sessions/2026-10-01 10.00.00/rooms/room-1.json': json(kitchen),
    'Maple St/sessions/2026-10-02 09.30.00/rooms/room-0.json': json(bedroom),
    'Maple St/sessions/2026-10-03 15.00.00/rooms/room-0.json': json(garage),
    'Maple St/sessions/2026-10-01 10.00.00/photos/0000.jpg': new Uint8Array(64),
  });
  const file = readRoomScanFile(zip);
  assert.equal(file.houseName, 'Maple St');
  assert.ok(file.notes.some(n => n.includes('Hallway has no saved scan')) && file.notes.some(n => n.startsWith('Garage isn’t aligned')));
  const { config, summary } = scanToProject(file, { name: file.houseName!, projectType: 'home' });
  assert.deepEqual(summary.rooms.map(r => [r.name, r.width, r.length]), [['Living', 5000, 4000], ['Kitchen', 3000, 4000], ['Bedroom', 4000, 4000], ['Garage', 6000, 6000]]);
  // Placed rooms keep their layout, recentred on the house (x −2.5…5.5, z −6…2); the garage waits to the right.
  assert.deepEqual(config.rooms!.map(r => [r.name, r.position]), [['Living', [-1500, 2000]], ['Kitchen', [2500, 2000]], ['Bedroom', [-1000, -2000]], ['Garage', [8000, 0]]]);
  const kitchenDoc = config.rooms![1].doc, table = kitchenDoc.floorItems![0];
  assert.deepEqual([kitchenDoc.wallItems![0].wall, kitchenDoc.wallItems![0].position[0]], ['right', 500]);
  near(table.position[0], 500); near(table.position[1], 500); near(angle(table.rotation), 0, 1e-6);
  const saved = await stored(config);
  assert.deepEqual([saved.rooms?.length, saved.activeRoomId, saved.name], [4, 'main', 'Maple St']);
});

test('an L-shaped converted room keeps its outer bounds and moves inner-wall doors outward', () => {
  const w = (a: [number, number], b: [number, number], openings: unknown[] = []) => ({ a, b, height: 2.4, openings });
  const scan = parseRoomScan({ walls: [w([-2, -1.5], [2, -1.5]), w([2, -1.5], [2, 1.5]), w([2, 1.5], [0, 1.5]), w([0, 1.5], [0, 0.5], [{ kind: 'door', u0: 0.1, u1: 0.9, v0: 0, v1: 2 }]), w([0, 0.5], [-2, 0.5]), w([-2, 0.5], [-2, -1.5])], objects: [] });
  const { config, summary } = scanToProject({ rooms: [{ scan }], notes: [] }, { name: 'L room', projectType: 'home' });
  assert.deepEqual([summary.rooms[0].width, summary.rooms[0].length, summary.rooms[0].doors], [4000, 3000, 1]);
  assert.ok(summary.notes.some(n => n.includes('rectangular')) && summary.notes.some(n => n.includes('moved')));
  assert.equal(config.doc.wallItems?.[0].wall, 'right');
});

test('scans without walls or with broken geometry are rejected with a readable message', () => {
  assert.throws(() => parseRoomScan({}), /RoomPlan room scan/);
  assert.throws(() => parseRoomScan({ walls: [] }), /no walls/);
  assert.throws(() => parseRoomScan({ walls: [{ transform: [1, 2], dimensions: [1, 2, 0] }] }), /invalid transform/);
  assert.throws(() => parseRoomScan({ format: 'house-project/1', rooms: [] }), /house index/);
  assert.throws(() => readRoomScanFile(strToU8('{oops')), /not JSON/);
});
