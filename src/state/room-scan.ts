/** Room-scan import: rooms scanned with the 3D Model Anything iPhone app become a Space Studio project with their size,
 * doors, windows and furniture. Accepts one RoomPlan room (`rooms/room-N.json`, or the scan-to-threejs skill's converted
 * `room.json`), a room/session .zip, or a whole-house .zip whose house.json places every room on the project plan.
 * Studio rooms are unrotated rectangles, so a house is turned to its dominant wall direction and each non-rectangular
 * room keeps its outer bounds. */
import { unzipSync, strFromU8 } from 'fflate';
import { addFloorItem, floorBounds } from '../../rack-generator/floor-items.ts';
import { addWallItem } from '../../rack-generator/wall-items.ts';
import { wallPart } from '../../rack-generator/wall-registry.ts';
import { coerceFloorParams } from '../../rack-generator/floor-part.ts';
import { wallFrames, type WallId } from '../../rack-generator/walls.ts';
import { encodeComponents, type ModelComponent } from '../../rack-generator/floor-parts/generated-model.ts';
import { inch } from '../../rack-generator/wall-parts/decor.ts';
import type { RackDoc, Vec2 } from '../../rack-generator/types.ts';
import { FURNITURE_PRESETS } from './furniture-presets.ts';
import { createGym } from './gym-designs.ts';
import { cleanDocument } from './history.ts';
import type { SavedConfig } from './config-storage.ts';
import type { ProjectRoom, ProjectType } from './space-projects.ts';

type XZ = [number, number];
type Mat = number[];
export interface ScanOpening { kind: 'door' | 'window' | 'opening'; u0: number; u1: number; v0: number; v1: number }
/** `a` → `b` runs along the wall; openings are measured along it from `a` (u) and up from the floor (v). */
export interface ScanWall { a: XZ; b: XZ; height: number; openings: ScanOpening[] }
/** `rotY` turns the box's local +Z (RoomPlan's front) about +Y. */
export interface ScanObject { category: string; center: [number, number, number]; size: [number, number, number]; rotY: number }
/** Room-local metres, +Y up, floor at y = 0, walls square to X/Z: the skill's bundle_to_room.py `room.json` shape. */
export interface RoomScan { walls: ScanWall[]; objects: ScanObject[] }
/** `centre` is the middle of the room's outer bounds on the shared plan (metres, X right, Z down the plan); it is absent
 * when the export doesn't say where the room is. */
export interface ScannedRoom { name?: string; scan: RoomScan; centre?: XZ }
export interface ScanFile { rooms: ScannedRoom[]; houseName?: string; notes: string[] }
export interface RoomSummary { name: string; width: number; length: number; height: number; doors: number; windows: number; furniture: number }
export interface ScanSummary { rooms: RoomSummary[]; notes: string[] }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numbers = (v: unknown, n: number, what: string): number[] => {
  if (!Array.isArray(v) || v.length !== n || !v.every(finite)) throw Error(`This scan has an invalid ${what}.`);
  return v;
};
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(e => e && typeof e === 'object') : [];
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
/** RoomPlan encodes enum cases as single-key objects: `{"door": {"isOpen": false}}`. */
const categoryOf = (c: unknown) => typeof c === 'string' ? c : c && typeof c === 'object' ? Object.keys(c)[0] ?? 'object' : 'object';
/** simd_float4x4, column-major (translation in the last column); nested columns are accepted too. */
const matrix = (t: unknown): Mat => numbers(Array.isArray(t) && t.every(Array.isArray) ? t.flat() : t, 16, 'transform');
const column = (m: Mat, c: number): [number, number, number] => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
const mul = (a: Mat, b: Mat): Mat => Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + i % 4] * b[(i - i % 4) + k], 0));
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Only a finite, unscaled, unreflected transform can place a room. */
function rigid(m: Mat) {
  const [x, y, z] = [0, 1, 2].map(i => column(m, i)), cross = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  return [3, 7, 11].every(i => Math.abs(m[i]) < 1e-4) && Math.abs(m[15] - 1) < 1e-4 && Math.abs(dot(x, cross) - 1) < 1e-3
    && [x, y, z].every((a, i) => [x, y, z].every((b, j) => Math.abs(dot(a, b) - (i === j ? 1 : 0)) < 1e-3));
}

const wallsOf = (input: Record<string, unknown>, frame?: Mat) => list(input.walls).map(w => ({ id: w.identifier, m: frame ? mul(frame, matrix(w.transform)) : matrix(w.transform), size: numbers(w.dimensions, 3, 'wall size') }));
/** Length-weighted wall heading, folded ×4 for 90° symmetry: walls run at the result (+k·90°) in X/Z. */
function heading(walls: { m: Mat; size: number[] }[]) {
  let sx = 0, sy = 0;
  for (const w of walls) { const x = column(w.m, 0), ang = Math.atan2(x[2], x[0]) * 4; sx += Math.cos(ang) * w.size[0]; sy += Math.sin(ang) * w.size[0]; }
  return Math.atan2(sy, sx) / 4;
}
/** Port of bundle_to_room.py: level the floor at y = 0, turn the walls onto X/Z, centre the bounds. `frame` moves the
 * scan into a shared (house) frame first and `theta` is that frame's heading, so placed rooms stay square to each other. */
function fromRoomPlan(input: Record<string, unknown>, frame?: Mat, theta?: number): { scan: RoomScan; centre: XZ } {
  const place = (t: unknown) => frame ? mul(frame, matrix(t)) : matrix(t), walls = wallsOf(input, frame);
  if (!walls.length) throw Error('This scan has no walls. Scan the whole room before exporting it.');
  const floor = list(input.floors)[0];
  const floorY = floor ? place(floor.transform)[13] : Math.min(...walls.map(w => w.m[13] - w.size[1] / 2));
  const angle = theta ?? heading(walls), c = Math.cos(-angle), s = Math.sin(-angle);
  const turn = (p: number[]): XZ => [c * p[0] - s * p[2], s * p[0] + c * p[2]];
  const ends = walls.flatMap(w => { const ctr = column(w.m, 3), x = column(w.m, 0), h = w.size[0] / 2; return [-1, 1].map(k => turn([ctr[0] + x[0] * k * h, 0, ctr[2] + x[2] * k * h])); });
  const cx = (Math.min(...ends.map(e => e[0])) + Math.max(...ends.map(e => e[0]))) / 2, cz = (Math.min(...ends.map(e => e[1])) + Math.max(...ends.map(e => e[1]))) / 2;
  const point = (p: number[]): [number, number, number] => { const [x, z] = turn(p); return [x - cx, p[1] - floorY, z - cz]; };
  const out = walls.map(w => {
    const ctr = point(column(w.m, 3)), u = turn(column(w.m, 0)), a: XZ = [ctr[0] - u[0] * w.size[0] / 2, ctr[2] - u[1] * w.size[0] / 2];
    return { id: w.id, u, wall: { a, b: [a[0] + u[0] * w.size[0], a[1] + u[1] * w.size[0]] as XZ, height: w.size[1], openings: [] as ScanOpening[] } };
  });
  for (const kind of ['door', 'window', 'opening'] as const) for (const e of list(input[`${kind}s`])) {
    const centre = point(column(place(e.transform), 3)), [width, height] = numbers(e.dimensions, 3, `${kind} size`);
    const along = (w: typeof out[number]) => (centre[0] - w.wall.a[0]) * w.u[0] + (centre[2] - w.wall.a[1]) * w.u[1];
    const offWall = (w: typeof out[number]) => Math.abs((centre[0] - w.wall.a[0]) * -w.u[1] + (centre[2] - w.wall.a[1]) * w.u[0]);
    // RoomPlan names the host wall; fall back to the nearest one when it doesn't.
    const host = out.find(w => w.id !== undefined && w.id === e.parentIdentifier) ?? out.reduce((best, w) => offWall(w) < offWall(best) ? w : best);
    const u = along(host), v0 = centre[1] - height / 2;
    host.wall.openings.push({ kind, u0: u - width / 2, u1: u + width / 2, v0: v0 < 0.06 ? 0 : v0, v1: centre[1] + height / 2 });
  }
  const objects = list(input.objects).map(o => {
    const m = place(o.transform), f = turn(column(m, 2)), [w, h, d] = numbers(o.dimensions, 3, 'furniture size');
    return { category: categoryOf(o.category), center: point(column(m, 3)), size: [w, h, d] as [number, number, number], rotY: Math.atan2(f[0], f[1]) };
  });
  return { scan: { walls: out.map(w => w.wall), objects }, centre: [cx, cz] };
}
/** The skill's converted room.json is already room-local; check it before trusting it. */
function fromConverted(input: Record<string, unknown>): RoomScan {
  const walls = list(input.walls).map(w => ({
    a: numbers(w.a, 2, 'wall') as XZ, b: numbers(w.b, 2, 'wall') as XZ, height: numbers([w.height], 1, 'wall height')[0],
    openings: list(w.openings).map(o => ({ kind: o.kind === 'door' || o.kind === 'window' ? o.kind : 'opening' as const, ...Object.fromEntries((['u0', 'u1', 'v0', 'v1'] as const).map(k => [k, numbers([o[k]], 1, 'opening')[0]])) } as ScanOpening)),
  }));
  if (!walls.length) throw Error('This scan has no walls.');
  const objects = list(input.objects).map(o => ({ category: categoryOf(o.category), center: numbers(o.center, 3, 'furniture position') as ScanObject['center'], size: numbers(o.size, 3, 'furniture size') as ScanObject['size'], rotY: numbers([o.rotY], 1, 'furniture rotation')[0] }));
  return { walls, objects };
}
function roomInput(input: unknown) {
  if (record(input).format === 'house-project/1') throw Error('This is a house index. Share the whole house as a .zip and import that.');
  if (!Array.isArray(record(input).walls)) throw Error('Choose a RoomPlan room scan (rooms/room-N.json) or a .zip shared from 3D Model Anything.');
  const source = input as Record<string, unknown>, first = list(source.walls)[0];
  return { source, converted: !!first && 'a' in first && 'b' in first };
}
export function parseRoomScan(input: unknown): RoomScan {
  const { source, converted } = roomInput(input);
  return converted ? fromConverted(source) : fromRoomPlan(source).scan;
}

interface Source { name?: string; json: unknown; frame?: Mat }
/** Placed rooms share one heading; unplaced ones (no frame, or a converted room.json) get their own. A room that fails to
 * parse is skipped with a note when there are others. */
function placeRooms(sources: Source[], notes: string[]): ScannedRoom[] {
  const raw = sources.flatMap(s => { try { const r = roomInput(s.json); return r.converted || !s.frame ? [] : wallsOf(r.source, s.frame); } catch { return []; } });
  const theta = raw.length ? heading(raw) : undefined, rooms: ScannedRoom[] = [];
  for (const s of sources) {
    try {
      const { source, converted } = roomInput(s.json), name = s.name ? { name: s.name } : {};
      if (converted || !s.frame) rooms.push({ ...name, scan: converted ? fromConverted(source) : fromRoomPlan(source).scan });
      else rooms.push({ ...name, ...fromRoomPlan(source, s.frame, theta) });
    } catch (e) { if (sources.length === 1) throw e; notes.push(`${s.name ?? 'A room'} was skipped: ${message(e)}`); }
  }
  return rooms;
}
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ALIGNED = ['first', 'relocalized', 'manual', 'icp'];
/** house-project/1: each room's active scan, placed by zone.toHouse × session.alignment.toZone (house_to_rooms.py). */
function houseSources(house: Record<string, unknown>, prefix: string, read: (path: string) => unknown, notes: string[]): Source[] {
  const zones = list(house.zones), sessions = list(house.sessions), sources: Source[] = [], unplaced: string[] = [];
  for (const room of list(house.rooms)) {
    const name = typeof room.name === 'string' && room.name.trim() ? room.name.trim() : 'Room', active = record(room.active);
    if (typeof active.session !== 'string' || !Number.isInteger(active.index)) { notes.push(`${name} has no saved scan and was skipped.`); continue; }
    const json = read(`${prefix}sessions/${active.session}/rooms/room-${active.index}.json`);
    if (json === undefined) { notes.push(`${name}’s scan is missing from this export and was skipped.`); continue; }
    const session = sessions.find(s => s.id === active.session), zone = zones.find(z => z.id === room.zone), alignment = record(session?.alignment);
    let frame: Mat | undefined;
    try { if (session && zone && session.zone === room.zone && zone.aligned === true && ALIGNED.includes(alignment.method as string)) frame = mul(matrix(zone.toHouse), matrix(alignment.toZone)); } catch { /* unplaced below */ }
    if (frame && !rigid(frame)) frame = undefined;
    if (!frame) unplaced.push(name);
    sources.push({ name, json, ...(frame ? { frame } : {}) });
  }
  if (unplaced.length) notes.push(`${unplaced.join(', ')} ${unplaced.length > 1 ? 'aren’t' : 'isn’t'} aligned with the rest of the house yet, so ${unplaced.length > 1 ? 'they were' : 'it was'} placed beside the plan.`);
  return sources;
}

/** A room JSON, or a 3D Model Anything .zip (room, session or whole house): only the room layouts, manifests and house
 * index are inflated, never the photos, depth or meshes. */
export function readRoomScanFile(bytes: Uint8Array): ScanFile {
  const notes: string[] = [];
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    let value: unknown;
    try { value = JSON.parse(strFromU8(bytes)); } catch { throw Error('This file is not JSON or a .zip export.'); }
    return { rooms: [{ scan: parseRoomScan(value) }], notes };
  }
  const files = unzipSync(bytes, { filter: f => /(^|\/)(rooms\/room-\d+|manifest|structure|house)\.json$/.test(f.name) });
  const read = (name: string): unknown => { if (!files[name]) return undefined; try { return JSON.parse(strFromU8(files[name])); } catch { return undefined; } };
  const byDepth = (a: string, b: string) => a.split('/').length - b.split('/').length || a.localeCompare(b, undefined, { numeric: true });
  const houseKey = Object.keys(files).filter(n => /(^|\/)house\.json$/.test(n)).sort(byDepth)[0], house = houseKey ? record(read(houseKey)) : undefined;
  if (house?.format === 'house-project/1') {
    const sources = houseSources(house, houseKey!.slice(0, -'house.json'.length), read, notes);
    if (!sources.length) throw Error('No room in this house has a saved scan yet.');
    const rooms = placeRooms(sources, notes);
    if (!rooms.length) throw Error('None of the scanned rooms could be read.');
    return { rooms, ...(typeof house.name === 'string' && house.name.trim() ? { houseName: house.name.trim() } : {}), notes };
  }
  // Without a house index, rooms of the first session share its ARKit frame; rooms of other sessions can't be placed.
  const index = (name: string) => Number(/room-(\d+)\.json$/.exec(name)?.[1]);
  const folder = (name: string) => name.replace(/rooms\/room-\d+\.json$|structure\.json$/, '');
  const roomFiles = Object.keys(files).filter(n => /(^|\/)rooms\/room-\d+\.json$/.test(n)).sort(byDepth);
  const chosen = roomFiles.length ? roomFiles : Object.keys(files).filter(n => /(^|\/)structure\.json$/.test(n)).sort(byDepth).slice(0, 1);
  if (!chosen.length) throw Error('No RoomPlan room was found in this .zip. Export a room from 3D Model Anything with “Share room”.');
  const sessionFolder = folder(chosen[0]);
  const sources = chosen.map(path => {
    const named = list(record(read(`${folder(path)}manifest.json`)).rooms).find(r => r.index === index(path))?.name;
    return { ...(typeof named === 'string' && named.trim() ? { name: named.trim() } : {}), json: read(path), ...(folder(path) === sessionFolder ? { frame: IDENTITY } : {}) };
  });
  if (sources.some(s => !s.frame)) notes.push('Rooms from other scanning sessions were placed beside the plan. Share the whole house to place them.');
  return { rooms: placeRooms(sources, notes), notes };
}

const LABELS: Record<string, string> = { storage: 'Storage', sofa: 'Sofa', table: 'Table', chair: 'Chair', bed: 'Bed', refrigerator: 'Refrigerator', stove: 'Stove', oven: 'Oven', dishwasher: 'Dishwasher', sink: 'Sink', toilet: 'Toilet', bathtub: 'Bathtub', washerDryer: 'Washer/dryer', fireplace: 'Fireplace', television: 'Television', stairs: 'Stairs' };
/** Shallow storage reads as a shelf, deeper storage as a cabinet; categories without a preset stay labelled boxes. */
const presetFor = (o: ScanObject) => ({ sofa: 'sofa', table: 'table', chair: 'chair', bed: 'bed', refrigerator: 'fridge', storage: o.size[2] < 0.4 ? 'bookshelf' : 'wardrobe' } as Record<string, string>)[o.category];
const box = (name: string, position: [number, number, number], size: [number, number, number], color: number): ModelComponent => ({ name, shape: 'box', position, size, rotation: [0, 0, 0], color });
const dimension = (mm: number) => Math.min(6000, Math.max(20, Math.round(mm / 5) * 5));
/** The preset's shapes stretched to the scanned box. A box raised off the floor (a TV, a wall cabinet) keeps its height
 * with a 2 mm footprint plate under it, because component models are always scaled to stand on the floor. */
function furnitureParams(o: ScanObject) {
  const [w, h, d] = o.size.map(v => v * 1000), bottom = o.center[1] * 1000 - h / 2, raised = bottom > 150 ? bottom : 0;
  const preset = FURNITURE_PRESETS.find(p => p.id === presetFor(o));
  const shapes: ModelComponent[] = preset ? preset.components.map(c => ({ ...c, position: [...c.position], size: [...c.size], rotation: [...c.rotation] })) : [box('Body', [0, 0, h / 2], [w, d, h], 0xb9bcb8)];
  const low = [0, 1, 2].map(i => Math.min(...shapes.map(c => c.position[i] - c.size[i] / 2))), high = [0, 1, 2].map(i => Math.max(...shapes.map(c => c.position[i] + c.size[i] / 2)));
  const scale = [w, d, h].map((v, i) => v / (high[i] - low[i]));
  const fitted = shapes.map(c => ({ ...c, position: c.position.map((v, i) => (v - (i === 2 ? low[2] : 0)) * scale[i] + (i === 2 ? raised : 0)) as ModelComponent['position'], size: c.size.map((v, i) => Math.max(1, v * scale[i])) as ModelComponent['size'] }));
  if (raised) fitted.push(box('Footprint', [0, 0, 1], [w, d, 2], 0xd8d8d2));
  return { length: dimension(w), width: dimension(d), height: dimension(raised + h), ...encodeComponents(fitted) };
}

/** One scanned room as a Studio room document, centred on its outer bounds. */
function roomDoc(scan: RoomScan, projectType: ProjectType): { doc: RackDoc; size: Omit<RoomSummary, 'name'>; notes: string[] } {
  const notes: string[] = [], ends = scan.walls.flatMap(w => [w.a, w.b]);
  const minX = Math.min(...ends.map(e => e[0])), maxX = Math.max(...ends.map(e => e[0])), minZ = Math.min(...ends.map(e => e[1])), maxZ = Math.max(...ends.map(e => e[1]));
  const ox = (minX + maxX) / 2, oz = (minZ + maxZ) / 2, mm = ([x, z]: XZ): Vec2 => [(x - ox) * 1000, (z - oz) * 1000];
  const width = Math.round((maxX - minX) * 100) * 10, length = Math.round((maxZ - minZ) * 100) * 10, tallest = Math.round(Math.max(...scan.walls.map(w => w.height)) * 100) * 10;
  const height = Math.min(6000, Math.max(2100, tallest));
  if (height !== tallest) notes.push(`The scanned ceiling (${(tallest / 1000).toFixed(2)} m) was set to ${(height / 1000).toFixed(1)} m, the supported limit.`);
  const onEdge = (w: ScanWall) => { const flat = Math.abs(w.a[1] - w.b[1]) < Math.abs(w.a[0] - w.b[0]), [p, lo, hi] = flat ? [(w.a[1] + w.b[1]) / 2, minZ, maxZ] : [(w.a[0] + w.b[0]) / 2, minX, maxX]; return Math.min(Math.abs(p - lo), Math.abs(p - hi)); };
  if (scan.walls.some(w => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 0.3 && onEdge(w) > 0.15)) notes.push('The room isn’t rectangular. Its outer bounds were used, so alcoves and corners are filled in.');
  let doc: RackDoc = createGym({ name: 'Scanned room', type: projectType === 'gym' ? 'commercial' : 'home', projectType, client: '', width, length, height, starter: 'empty' }).doc;
  const frames = wallFrames(doc.room), half = { x: width / 2, z: length / 2 };
  let doors = 0, windows = 0, passages = 0, moved = 0, clipped = 0;
  for (const wall of scan.walls) for (const o of wall.openings) {
    if (o.kind === 'opening') { passages++; continue; }
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) || 1, dir: XZ = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len], mid = (o.u0 + o.u1) / 2;
    const [x, z] = mm([wall.a[0] + dir[0] * mid, wall.a[1] + dir[1] * mid]), flat = Math.abs(dir[0]) >= Math.abs(dir[1]);
    const id: WallId = flat ? (z < 0 ? 'back' : 'front') : (x < 0 ? 'left' : 'right'), frame = frames[id];
    if ((flat ? half.z - Math.abs(z) : half.x - Math.abs(x)) > 150) moved++;
    const u = (x - frame.center[0]) * frame.along[0] + (z - frame.center[1]) * frame.along[1], span = (o.u1 - o.u0) * 1000, rise = (o.v1 - o.v0) * 1000;
    const part = wallPart(o.kind === 'door' ? 'decor-interior-door' : 'decor-window')!;
    const params = coerceFloorParams(part, o.kind === 'door' ? { width: span / 25.4 } : { style: 2, width: span / 25.4, height: rise / 25.4 });
    if (o.kind === 'window' && (inch(params.width) < span - 120 || inch(params.height) < rise - 120)) clipped++;
    doc = addWallItem(doc, part.id, { wall: id, position: [u, o.kind === 'door' ? part.height ?? 1048 : (o.v0 + o.v1) / 2 * 1000] }, params);
    if (o.kind === 'door') doors++; else windows++;
  }
  if (passages) notes.push(`${passages} open passage${passages > 1 ? 's' : ''} without a door ${passages > 1 ? 'were' : 'was'} skipped.`);
  if (moved) notes.push(`${moved} door${moved > 1 ? 's and windows' : ' or window'} on inner walls moved to the nearest outer wall.`);
  if (clipped) notes.push(`${clipped} window${clipped > 1 ? 's are' : ' is'} larger than the biggest window size and ${clipped > 1 ? 'were' : 'was'} reduced.`);
  const objects = scan.objects.slice(0, 100);
  if (scan.objects.length > objects.length) notes.push(`Only the first 100 of ${scan.objects.length} furniture items were imported.`);
  for (const o of objects) {
    const params = furnitureParams(o), at = mm([o.center[0], o.center[2]]);
    let rotation = o.rotY;
    if (o.category === 'bed') { // the bed preset's headboard is its front: put it against the nearer wall
      const reach = o.size[2] * 500, gap = (s: number) => { const p = [at[0] + Math.sin(rotation) * reach * s, at[1] + Math.cos(rotation) * reach * s]; return Math.min(half.x - Math.abs(p[0]), half.z - Math.abs(p[1])); };
      if (gap(1) > gap(-1)) rotation += Math.PI;
    }
    doc = addFloorItem(doc, 'template-assembly', at, false, params);
    const item = doc.floorItems!.at(-1)!;
    Object.assign(item, { rotation: Math.atan2(Math.sin(rotation), Math.cos(rotation)), label: LABELS[o.category] ?? o.category });
    const b = floorBounds(item), shift = (lo: number, hi: number, limit: number) => lo < -limit ? -limit - lo : hi > limit ? limit - hi : 0;
    item.position = [item.position[0] + shift(b.min[0], b.max[0], half.x), item.position[1] + shift(b.min[1], b.max[1], half.z)];
  }
  return { doc: cleanDocument(doc), size: { width, length, height, doors, windows, furniture: objects.length }, notes };
}

/** Rooms with a `centre` keep their places on the plan (recentred on the house); the rest line up to its right. */
export function scanToProject(file: ScanFile, setup: { name: string; projectType: ProjectType }, id?: string, now?: number): { config: SavedConfig; summary: ScanSummary } {
  const notes = [...file.notes], many = file.rooms.length > 1, built: { room: ScannedRoom; name: string; doc: RackDoc; size: Omit<RoomSummary, 'name'> }[] = [];
  for (const room of file.rooms.slice(0, 30)) {
    const name = room.name?.trim().slice(0, 80) || (many ? `Room ${built.length + 1}` : 'Main room');
    try { const r = roomDoc(room.scan, setup.projectType); built.push({ room, name, doc: r.doc, size: r.size }); notes.push(...r.notes.map(n => many ? `${name}: ${n}` : n)); }
    catch (e) { if (!many) throw e; notes.push(`${name} was skipped: ${message(e)}`); }
  }
  if (file.rooms.length > 30) notes.push(`A project holds up to 30 rooms; ${file.rooms.length - 30} were left out.`);
  if (!built.length) throw Error('None of the scanned rooms could be imported.');
  const rect = (b: typeof built[number], [x, z]: XZ) => ({ min: [x - b.size.width / 2, z - b.size.length / 2], max: [x + b.size.width / 2, z + b.size.length / 2] });
  const placed = built.filter(b => b.room.centre), at = new Map(placed.map(b => [b, [b.room.centre![0] * 1000, b.room.centre![1] * 1000] as XZ]));
  const span = placed.map(b => rect(b, at.get(b)!)), mid = (i: number) => span.length ? (Math.min(...span.map(r => r.min[i])) + Math.max(...span.map(r => r.max[i]))) / 2 : 0;
  const [mx, mz] = [mid(0), mid(1)];
  let edge = span.length ? Math.max(...span.map(r => r.max[0])) - mx + 1000 : -built[0].size.width / 2;
  const rooms: ProjectRoom[] = built.map((b, i) => {
    const centre = at.get(b);
    let position: XZ;
    if (centre) position = [centre[0] - mx, centre[1] - mz];
    else { position = [edge + b.size.width / 2, 0]; edge += b.size.width + 1000; }
    position = position.map(v => Math.round(v / 10) * 10 + 0) as XZ;
    if (position.some(v => Math.abs(v) > 100000)) throw Error('The scanned rooms spread over more than 100 m, which is too large for one project.');
    return { id: i ? crypto.randomUUID() : 'main', name: b.name, position, doc: b.doc };
  });
  const first = built[0], base = createGym({ name: setup.name, type: setup.projectType === 'gym' ? 'commercial' : 'home', projectType: setup.projectType, client: '', width: first.size.width, length: first.size.length, height: first.size.height, starter: 'empty' }, id, now);
  return { config: { ...base, doc: first.doc, rooms, activeRoomId: 'main' }, summary: { rooms: built.map(b => ({ name: b.name, ...b.size })), notes } };
}
