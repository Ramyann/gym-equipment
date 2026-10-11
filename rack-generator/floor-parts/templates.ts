/** Parametric templates: generic floor parts sized by real measurements. The AI part lookup (src/ai-parts) fills them
 * from a product's published dimensions; people can also size them by hand in the part viewer.
 *
 * Metadata only (main bundle): never import Manifold builders here. Builders: ../parts/templates.ts.
 * Every template's bounding box is exactly `templateEnvelope(id, params)` = [width X, depth Y, height Z] in mm, so a
 * published "L × W × H" lands on the model to the millimetre, and the AI lookup can verify it. Dimensions step 5 mm. */
import { defineFloorPart, type FloorParam } from '../floor-part.ts';
import type { NumericParams } from '../types.ts';
import type { VendorAttribution } from '../vendor-metadata.ts';
import { TEMPLATE_ASSEMBLY } from './generated-model.ts';

export const range = (a: number, b: number, step: number) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => +(a + i * step).toFixed(3));
/** Template colours: [label, hex]. Params store the index. */
export const TEMPLATE_COLORS = [
  ['Black', '#1b1c1e'], ['Matte black', '#2b2c2e'], ['White', '#e9eae7'], ['Red', '#b3242b'], ['Blue', '#1f4f9a'],
  ['Navy', '#1f2a44'], ['Grey', '#6f7377'], ['Silver', '#c4c8cc'], ['Yellow', '#e3b81f'], ['Green', '#2f6b3a'],
  ['Orange', '#d9661f'], ['Purple', '#5b3a8c'], ['Wood', '#c9a26a'], ['Tan', '#b89a72'], ['Pink', '#d9799b'],
] as const;
export const colorHex = (i: number) => (TEMPLATE_COLORS[i] ?? TEMPLATE_COLORS[0])[1];
const COLOR_OPTIONS = TEMPLATE_COLORS.map((_, i) => i);
const color = (key: string, label: string, fallback: number): FloorParam => ({ key, label, default: fallback, options: COLOR_OPTIONS, format: v => TEMPLATE_COLORS[v]?.[0] ?? String(v) });
const mm = (key: string, label: string, fallback: number, min: number, max: number, step = 5): FloorParam => ({ key, label, default: fallback, options: range(min, max, step), format: v => `${v} mm` });
const pick = (key: string, label: string, fallback: number, labels: readonly string[]): FloorParam => ({ key, label, default: fallback, options: labels.map((_, i) => i), format: v => labels[v] ?? String(v) });
export const TUBES = [25, 30, 40, 50, 60, 63, 70, 75, 76, 80, 100] as const;
const tube = (fallback = 60): FloorParam => ({ key: 'tube', label: 'Frame tube', default: fallback, options: [...TUBES], format: v => `${v} mm` });
const vendor = (what: string): VendorAttribution => ({
  vendor: 'Template', url: 'https://github.com/wesbos/gym-equipment', credit: `Parametric template — ${what}`,
  trademark: 'Generic template; no brand shown.',
  reconstruction: 'Generic parametric shape. Its overall size is set from measurements (published or entered); details are simplified.',
});
const deg = (d: number) => d * Math.PI / 180;

// ── Bench ─────────────────────────────────────────────────────────────────────────────────────────
export const BENCH_KINDS = ['Flat', 'Adjustable (incline)'] as const;
/** Bench layout shared by the builder and the envelope. X along the bench (seat end at −X), Y across, Z up. */
export function benchLayout(p: NumericParams) {
  const L = p.length, W = p.width, t = p.tube, padTop = p.padHeight, T = p.padThickness, padLen = p.padLength, gap = p.kind ? 15 : 0;
  const seat = p.kind ? Math.min(p.seatLength, padLen - 200) : padLen, back = padLen - seat - gap, angle = p.kind ? deg(p.incline) : 0;
  const x0 = -padLen / 2, hingeX = x0 + seat + gap, hingeZ = padTop - T;
  // Back pad corners after rotating about the hinge (raising its far end).
  const corners = [[0, 0], [back, 0], [back, T], [0, T]].map(([u, v]) => [hingeX + u * Math.cos(angle) - v * Math.sin(angle), hingeZ + u * Math.sin(angle) + v * Math.cos(angle)]);
  const xs = [-L / 2, L / 2, x0, x0 + seat, ...corners.map(c => c[0])], zs = [padTop, ...corners.map(c => c[1])];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  return { L, W, t, padTop, T, padLen, seat, back, gap, angle, x0, hingeX, hingeZ, minX, maxX, height: Math.max(...zs) };
}
export const TEMPLATE_BENCH = defineFloorPart({
  id: 'template-bench', name: 'Bench (template)', title: 'Bench template', noun: 'bench', section: 'Custom templates',
  description: 'A flat or adjustable bench sized from real measurements: frame length and width, pad length, width, height and thickness, and back-pad incline. Generic template; no brand shown.',
  params: [
    pick('kind', 'Type', 0, BENCH_KINDS),
    mm('length', 'Frame length', 1300, 600, 2400), mm('width', 'Frame width', 500, 200, 1000),
    mm('padLength', 'Pad length (total)', 1200, 500, 2200), mm('padWidth', 'Pad width', 280, 150, 600),
    mm('padHeight', 'Pad height from floor', 430, 250, 800), mm('padThickness', 'Pad thickness', 75, 25, 150),
    mm('seatLength', 'Seat pad length', 380, 200, 700), { key: 'incline', label: 'Back pad angle', default: 0, options: range(0, 85, 5), format: v => `${v}°` },
    tube(60), color('frameColor', 'Frame colour', 0), color('padColor', 'Pad colour', 0),
  ],
  validate: p => {
    if (p.padHeight < p.padThickness + p.tube + 60) throw Error('The bench pad must sit above its frame.');
    if (p.kind && p.seatLength > p.padLength - 200) throw Error('The seat pad must be at least 200 mm shorter than the whole pad.');
  },
  footprint: p => { const b = benchLayout(p); return { width: b.maxX - b.minX, depth: Math.max(p.width, p.padWidth), offset: [(b.maxX + b.minX) / 2, 0] }; },
  placement: { side: 'front', gap: 400 },
  vendor: vendor('bench'),
});

// ── Frame machine ─────────────────────────────────────────────────────────────────────────────────
export const MACHINE_POSTS = ['Two rear posts', 'Four corner posts'] as const;
export const MACHINE_STACKS = ['None (plate loaded)', 'One weight stack', 'Two weight stacks'] as const;
export const MACHINE_SEATS = ['No seat', 'Seat and back pad'] as const;
export const TEMPLATE_MACHINE = defineFloorPart({
  id: 'template-machine', name: 'Machine (template)', title: 'Gym machine template', noun: 'machine', section: 'Custom templates',
  description: 'A steel-frame machine sized from real measurements: footprint, height, frame tube, posts, weight stacks and seat. Use it for cable towers, functional trainers, leg machines and other selectorized or plate-loaded machines. Generic template; no brand shown.',
  params: [
    mm('width', 'Width', 1200, 400, 4000), mm('depth', 'Depth', 1200, 400, 4000), mm('height', 'Height', 2100, 600, 3000),
    tube(75), pick('posts', 'Posts', 0, MACHINE_POSTS), pick('stacks', 'Weight stacks', 1, MACHINE_STACKS),
    pick('seat', 'Seat', 0, MACHINE_SEATS), mm('seatHeight', 'Seat height', 480, 300, 900),
    color('frameColor', 'Frame colour', 0), color('padColor', 'Pad colour', 0),
  ],
  validate: p => {
    if (p.stacks && p.height < 1000) throw Error('A weight stack needs at least 1000 mm of height.');
    if (p.seat && p.seatHeight > p.height - 300) throw Error('The seat must sit below the top of the machine.');
    if (p.width < 3 * p.tube || p.depth < 3 * p.tube) throw Error('The machine is too small for its frame tube.');
    if (p.stacks === 2 && p.width < 900) throw Error('Two weight stacks need at least 900 mm of width.');
  },
  footprint: p => ({ width: p.width, depth: p.depth }),
  placement: { side: 'left', gap: 600 },
  vendor: vendor('machine'),
});

// ── Storage rack ──────────────────────────────────────────────────────────────────────────────────
export const SHELF_TYPES = ['Flat shelves', 'Angled trays (dumbbells)', 'Twin rails (dumbbell saddles)'] as const;
export const TEMPLATE_STORAGE = defineFloorPart({
  id: 'template-storage', name: 'Storage rack (template)', title: 'Storage rack template', noun: 'storage rack', section: 'Custom templates',
  description: 'A free-standing storage rack sized from real measurements: width, depth, height, number of tiers and shelf style. Use it for dumbbell racks, shelving, plate trees on a frame and accessory storage. Generic template; no brand shown.',
  params: [
    mm('width', 'Width', 1200, 300, 4000), mm('depth', 'Depth', 450, 150, 1500), mm('height', 'Height', 800, 200, 2500),
    { key: 'tiers', label: 'Tiers', default: 2, options: range(1, 8, 1), format: v => `${v}` }, pick('shelf', 'Shelf style', 1, SHELF_TYPES),
    tube(50), color('frameColor', 'Frame colour', 0), color('shelfColor', 'Shelf colour', 0),
  ],
  validate: p => {
    if (p.width < 3 * p.tube || p.depth < 2 * p.tube) throw Error('The rack is too small for its frame tube.');
    if (p.height < p.tiers * 80 + p.tube) throw Error('Not enough height for that many tiers.');
  },
  footprint: p => ({ width: p.width, depth: p.depth }),
  placement: { side: 'left', gap: 400 },
  vendor: vendor('storage rack'),
});

// ── Cardio ────────────────────────────────────────────────────────────────────────────────────────
export const CARDIO_KINDS = ['Treadmill', 'Bike (upright or air)', 'Rower', 'Elliptical', 'Stair climber'] as const;
export const TEMPLATE_CARDIO = defineFloorPart({
  id: 'template-cardio', name: 'Cardio machine (template)', title: 'Cardio machine template', noun: 'cardio machine', section: 'Custom templates',
  description: 'A treadmill, bike, rower, elliptical or stair climber sized from the published length, width and height. Generic template; no brand shown.',
  params: [
    pick('kind', 'Type', 0, CARDIO_KINDS), mm('length', 'Length', 1900, 500, 3500), mm('width', 'Width', 850, 300, 1500),
    mm('height', 'Height', 1500, 400, 2400), color('frameColor', 'Frame colour', 0), color('accentColor', 'Accent colour', 6),
  ],
  validate: p => { if (p.kind === 2 && p.length < 1500) throw Error('A rower needs at least 1500 mm of length.'); },
  footprint: p => ({ width: p.length, depth: p.width }),
  placement: { side: 'left', gap: 600 },
  vendor: vendor('cardio machine'),
});

// ── Block ─────────────────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_BLOCK = defineFloorPart({
  id: 'template-block', name: 'Block (template)', title: 'Box / block template', noun: 'block', section: 'Custom templates',
  description: 'A solid box with rounded corners at any size: plyo boxes, cabinets, stands, platforms and mats, or a placeholder at a product’s exact published size. Generic template; no brand shown.',
  params: [
    mm('width', 'Width', 600, 20, 6000), mm('depth', 'Depth', 600, 20, 6000), mm('height', 'Height', 500, 5, 3000),
    mm('radius', 'Corner radius', 10, 0, 200), color('color', 'Colour', 12),
  ],
  validate: p => { if (2 * p.radius >= Math.min(p.width, p.depth)) throw Error('The corner radius is too big for this block.'); },
  footprint: p => ({ width: p.width, depth: p.depth }),
  underlay: false,
  placement: { side: 'front', gap: 400 },
  vendor: vendor('block'),
});

// ── Disc, cylinder or ball ────────────────────────────────────────────────────────────────────────
export const DISC_SHAPES = ['Disc standing on edge', 'Cylinder standing upright', 'Ball'] as const;
export function discEnvelope(p: NumericParams): [number, number, number] {
  if (p.shape === 0) return [p.thickness, p.diameter, p.diameter];
  if (p.shape === 1) return [p.diameter, p.diameter, p.thickness];
  return [p.diameter, p.diameter, p.diameter];
}
export const TEMPLATE_DISC = defineFloorPart({
  id: 'template-disc', name: 'Disc / ball (template)', title: 'Disc, cylinder or ball template', noun: 'disc', section: 'Custom templates',
  description: 'A disc on edge (plates, wheels), an upright cylinder (foam rollers, tyres lying flat, bollards) or a ball (medicine, slam and atlas balls) at any size, with an optional centre hole. Generic template; no brand shown.',
  params: [
    pick('shape', 'Shape', 0, DISC_SHAPES), mm('diameter', 'Diameter', 450, 20, 1500), mm('thickness', 'Thickness / height', 60, 5, 2000),
    mm('hole', 'Centre hole', 51, 0, 300, 1), color('color', 'Colour', 0),
  ],
  validate: p => { if (p.hole && p.hole > p.diameter - 40) throw Error('The centre hole must be at least 40 mm smaller than the diameter.'); },
  footprint: p => { const [w, d] = discEnvelope(p); return { width: w, depth: d }; },
  placement: { side: 'front', gap: 300 },
  vendor: vendor('disc'),
});

// Beds use length along X, width along Y, with the headboard at +X.
export const TEMPLATE_BED = defineFloorPart({
  id: 'template-bed', name: 'Bed (template)', title: 'Bed template', noun: 'bed', section: 'Custom templates',
  description: 'A bedroom bed with frame rails, legs, mattress, headboard and optional pillows. Size the overall frame, not just the mattress. Simplified furniture, not an exact product replica.',
  params: [
    mm('length', 'Overall length', 2100, 1200, 2800), mm('width', 'Overall width', 1700, 700, 2400),
    mm('height', 'Headboard height', 1000, 400, 1800), mm('frameHeight', 'Mattress base height', 300, 150, 650),
    mm('mattressThickness', 'Mattress thickness', 200, 50, 450), mm('boardThickness', 'Frame board thickness', 30, 15, 100),
    mm('legHeight', 'Clearance under frame', 80, 0, 250), pick('pillows', 'Pillows', 1, ['None', 'Include pillows']),
    color('frameColor', 'Frame colour', 2), color('padColor', 'Mattress and pillows colour', 2),
  ],
  validate: p => {
    if (p.frameHeight <= p.legHeight + 40) throw Error('The bed frame must sit above its legs with room for its rails.');
    if (p.height < p.frameHeight + p.mattressThickness + (p.pillows ? 60 : 0)) throw Error('The headboard must be at least as tall as the mattress and pillows.');
    if (p.length <= 4 * p.boardThickness || p.width <= 4 * p.boardThickness) throw Error('The frame boards leave no room for the mattress.');
  },
  footprint: p => ({ width: p.length, depth: p.width }), placement: { side: 'front', gap: 400 }, vendor: vendor('bed'),
});

export const PARTS = [TEMPLATE_BENCH, TEMPLATE_MACHINE, TEMPLATE_STORAGE, TEMPLATE_CARDIO, TEMPLATE_BLOCK, TEMPLATE_DISC, TEMPLATE_BED, TEMPLATE_ASSEMBLY] as const;
export type TemplateId = (typeof PARTS)[number]['id'];
export const TEMPLATE_IDS = PARTS.map(p => p.id) as TemplateId[];
export const isTemplate = (id: string): id is TemplateId => (TEMPLATE_IDS as string[]).includes(id);

/** Exact bounding box [width X, depth Y, height Z] in mm the builder produces for these params. */
export function templateEnvelope(id: TemplateId, p: NumericParams): [number, number, number] {
  switch (id) {
    case 'template-bench': { const b = benchLayout(p); return [b.maxX - b.minX, Math.max(p.width, p.padWidth), b.height]; }
    case 'template-machine': case 'template-storage': return [p.width, p.depth, p.height];
    case 'template-cardio': case 'template-bed': case 'template-assembly': return [p.length, p.width, p.height];
    case 'template-block': return [p.width, p.depth, p.height];
    case 'template-disc': return discEnvelope(p);
  }
}
