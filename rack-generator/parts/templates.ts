/** Builders for the parametric templates in ../floor-parts/templates.ts. Floor axes: Z up, origin on the floor at the
 * footprint centre, X the template's width/length, front at −Y (cardio and benches face −X).
 * Each builder's bounding box is exactly templateEnvelope(id, params): something touches every face of the box. */
import type { Manifold } from 'manifold-3d';
import type { ManifoldAPI, NumericParams, PartDefinition, SolidPart, Vec3 } from '../types.ts';
import { floorDefinition } from '../floor-part.ts';
import { kit, finish, type Kit } from './wall-storage-kit.ts';
import { alongZ, beam, roundRect } from './leftovers-kit.ts';
import { TEMPLATE_ASSEMBLY } from '../floor-parts/generated-model.ts';
import { buildGeneratedModel } from './generated-model.ts';
import {
  TEMPLATE_BENCH, TEMPLATE_MACHINE, TEMPLATE_STORAGE, TEMPLATE_CARDIO, TEMPLATE_BLOCK, TEMPLATE_DISC, TEMPLATE_BED,
  benchLayout, colorHex,
} from '../floor-parts/templates.ts';

const steel = (name: string, i: number) => finish(name, 'source', colorHex(i), .35, .55);
const vinyl = (name: string, i: number) => finish(name, 'source', colorHex(i), 0, .8);
const RUBBER = finish('Rubber feet and grips', 'liner', '#141516', 0, .85);
const BRIGHT = finish('Bright steel hardware', 'fastener', '#c9ccce', .9, .3);
const DARK = finish('Dark trim', 'source', '#232427', .2, .6);

/** Rotates a solid about the Y axis through `pivot` by `angle` radians (positive raises +X). */
function tiltY(k: Kit, s: Manifold, angle: number, pivot: Vec3) {
  return k.k(k.k(k.k(s.translate([-pivot[0], -pivot[1], -pivot[2]])).rotate([0, -angle * 180 / Math.PI, 0])).translate(pivot));
}

// ── Bench ─────────────────────────────────────────────────────────────────────────────────────────
export function buildTemplateBench(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  const b = benchLayout(p), { L, W, t, T, x0, seat, back, angle, hingeX, hingeZ } = b, padW = p.padWidth;
  const FRAME = steel('Bench frame', p.frameColor), PAD = vinyl('Bench pads', p.padColor);
  return kit(api, k => {
    const clampX = (x: number) => Math.max(-L / 2 + t, Math.min(L / 2 - t, x));
    // Feet across the bench at both ends, a spine between them.
    for (const s of [-1, 1]) {
      const fx = s * (L / 2 - t / 2);
      k.add(FRAME, k.span([fx - t / 2, -W / 2 + 15, 0], [fx + t / 2, W / 2 - 15, t]));
      k.add(RUBBER, k.span([fx - t / 2, -W / 2, 0], [fx + t / 2, -W / 2 + 15, t * .8]), k.span([fx - t / 2, W / 2 - 15, 0], [fx + t / 2, W / 2, t * .8]));
    }
    const spineTop = t * 1.15;
    k.add(FRAME, k.span([-L / 2 + t / 2, -t / 2, t * .15], [L / 2 - t / 2, t / 2, spineTop]));
    // Seat (or the whole flat pad): a post under its centre and a support plate.
    const seatMid = clampX(x0 + seat / 2), plate = 8;
    k.add(FRAME, k.span([seatMid - t * .4, -t * .4, spineTop - 1], [seatMid + t * .4, t * .4, hingeZ - plate + 1]));
    k.add(FRAME, k.span([x0 + 30, -padW / 2 + 25, hingeZ - plate], [x0 + seat - 30, padW / 2 - 25, hingeZ]));
    if (!p.kind && seat > 900) { // long flat pads get a second post
      for (const x of [x0 + seat * .2, x0 + seat * .8].map(clampX)) k.add(FRAME, k.span([x - t * .4, -t * .4, spineTop - 1], [x + t * .4, t * .4, hingeZ - plate + 1]));
    }
    k.add(PAD, alongZ(k, roundRect(k, [x0 + seat / 2, 0], seat, padW, Math.min(30, padW / 3)), T, hingeZ));
    if (back > 0) {
      // Back pad and its plate built flat from the hinge, then tilted up; a strut carries it from the spine.
      const pad = alongZ(k, roundRect(k, [back / 2, 0], back, padW, Math.min(30, padW / 3)), T, 0);
      const bplate = k.span([30, -padW / 2 + 25, -plate], [back - 30, padW / 2 - 25, 0]);
      const pivot: Vec3 = [hingeX, 0, hingeZ];
      k.add(PAD, k.k(tiltY(k, pad, angle, [0, 0, 0]).translate(pivot)));
      k.add(FRAME, k.k(tiltY(k, bplate, angle, [0, 0, 0]).translate(pivot)));
      const u = back * .45, top: Vec3 = [hingeX + u * Math.cos(angle), 0, hingeZ + u * Math.sin(angle) - plate];
      const foot: Vec3 = [clampX(top[0]), 0, spineTop - 2];
      k.add(FRAME, beam(k, foot, top, t * .7, t * .7));
      k.add(BRIGHT, k.cyl(padW - 60, 9, 'y', [hingeX, 0, hingeZ - plate - 10], 20));
    }
  });
}

// ── Machine ───────────────────────────────────────────────────────────────────────────────────────
export function buildTemplateMachine(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  const W = p.width, D = p.depth, H = p.height, t = p.tube;
  const FRAME = steel('Machine frame', p.frameColor), PAD = vinyl('Machine pads', p.padColor);
  const PLATES = finish('Weight stack plates', 'source', '#2a2b2e', .5, .5);
  return kit(api, k => {
    // Floor perimeter, posts and top beams.
    k.add(FRAME, k.span([-W / 2, -D / 2, 0], [W / 2, -D / 2 + t, t]), k.span([-W / 2, D / 2 - t, 0], [W / 2, D / 2, t]),
      k.span([-W / 2, -D / 2, 0], [-W / 2 + t, D / 2, t]), k.span([W / 2 - t, -D / 2, 0], [W / 2, D / 2, t]));
    const rows = p.posts ? [-1, 1] : [1];
    for (const sy of rows) for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - t / 2), y = sy * (D / 2 - t / 2);
      k.add(FRAME, k.span([x - t / 2, y - t / 2, 0], [x + t / 2, y + t / 2, H]));
    }
    k.add(FRAME, k.span([-W / 2, D / 2 - t, H - t], [W / 2, D / 2, H]));
    if (p.posts) k.add(FRAME, k.span([-W / 2, -D / 2, H - t], [W / 2, -D / 2 + t, H]), k.span([-W / 2, -D / 2, H - t], [-W / 2 + t, D / 2, H]), k.span([W / 2 - t, -D / 2, H - t], [W / 2, D / 2, H]));
    else for (const sx of [-1, 1]) k.add(FRAME, beam(k, [sx * (W / 2 - t / 2), D / 2 - t, H * .55], [sx * (W / 2 - t / 2), -D / 2 + t, t], t * .6, t * .6));
    // Weight stacks against the back: plates between two guide rods, a head plate and a top pulley.
    const n = p.stacks, sw = Math.min(300, (W - 2 * t) / Math.max(n, 1) * .55), sd = Math.min(140, D * .22);
    const sy = D / 2 - t - sd / 2 - 30, stackH = Math.min(H * .42, 950), z0 = t + 30, rodTop = H - t - 60;
    for (let i = 0; i < n; i++) {
      const cx = n === 1 ? 0 : (i ? 1 : -1) * W / 4, count = Math.max(4, Math.round(stackH / 26));
      for (let j = 0; j < count; j++) k.add(PLATES, k.span([cx - sw / 2, sy - sd / 2, z0 + j * 26], [cx + sw / 2, sy + sd / 2, z0 + j * 26 + 23]));
      for (const s of [-1, 1]) k.add(BRIGHT, k.cyl(rodTop - t, 12, 'z', [cx + s * (sw / 2 + 25), sy, (t + rodTop) / 2], 20));
      k.add(FRAME, k.span([cx - sw / 2 - 50, sy - 30, rodTop - 30], [cx + sw / 2 + 50, sy + 30, rodTop]));
      k.add(DARK, k.cyl(30, 55, 'x', [cx, sy, rodTop - 90], 32));
      k.add(BRIGHT, k.cyl(rodTop - 145 - (z0 + count * 26), 3, 'z', [cx, sy - 20, (rodTop - 145 + z0 + count * 26) / 2], 8));
      k.add(FRAME, k.span([cx - sw / 2 - 50, D / 2 - t - 2, z0], [cx + sw / 2 + 50, D / 2 - t, rodTop]));
    }
    if (p.seat) {
      const sdp = Math.min(350, D * .35), swd = Math.min(380, W * .5), ys = -D / 2 + t + sdp / 2 + 20, zs = p.seatHeight;
      k.add(FRAME, k.span([-t / 2, -D / 2, 0], [t / 2, ys, t]), k.span([-t * .45, ys - t * .45, 0], [t * .45, ys + t * .45, zs - 70]));
      k.add(PAD, k.span([-swd / 2, ys - sdp / 2, zs - 70], [swd / 2, ys + sdp / 2, zs]));
      const backTop = Math.min(zs + 600, H - 40);
      k.add(PAD, k.span([-swd * .4, ys + sdp / 2, zs], [swd * .4, ys + sdp / 2 + 70, backTop]));
    }
  });
}

// ── Storage rack ──────────────────────────────────────────────────────────────────────────────────
export function buildTemplateStorage(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  const W = p.width, D = p.depth, H = p.height, t = p.tube, n = p.tiers;
  const FRAME = steel('Rack frame', p.frameColor), SHELF = steel('Shelves', p.shelfColor);
  return kit(api, k => {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) k.add(FRAME, k.span([sx * W / 2 - (sx > 0 ? t : 0), sy * D / 2 - (sy > 0 ? t : 0), 0], [sx * W / 2 + (sx < 0 ? t : 0), sy * D / 2 + (sy < 0 ? t : 0), H]));
      k.add(FRAME, k.span([sx > 0 ? W / 2 - t : -W / 2, -D / 2, 0], [sx > 0 ? W / 2 : -W / 2 + t, D / 2, t]));
    }
    const zLow = Math.max(t + 60, 140), levels = n === 1 ? [H] : Array.from({ length: n }, (_, i) => zLow + (H - zLow) * i / (n - 1));
    const x0 = -W / 2 + t, x1 = W / 2 - t;
    for (const z of levels) {
      for (const sx of [-1, 1]) k.add(FRAME, k.span([sx > 0 ? W / 2 - t : -W / 2, -D / 2, z - t], [sx > 0 ? W / 2 : -W / 2 + t, D / 2, z]));
      if (p.shelf === 0) k.add(SHELF, k.span([x0, -D / 2, z - 6], [x1, D / 2, z]));
      else if (p.shelf === 1) {
        const drop = Math.min(D * .2, zLow - 20, 120);
        k.add(SHELF, k.k(k.api.Manifold.hull([k.span([x0, D / 2 - 20, z - 6], [x1, D / 2, z]), k.span([x0, -D / 2, z - drop - 6], [x1, -D / 2 + 20, z - drop])])));
        k.add(SHELF, k.span([x0, -D / 2, z - drop - 6], [x1, -D / 2 + 8, z - drop + 30]));
      } else {
        const r = Math.min(t * .4, 20);
        for (const s of [-1, 1]) k.add(SHELF, k.cyl(x1 - x0, r, 'x', [0, s * D / 4, z - r], 24));
      }
    }
  });
}

// ── Cardio ────────────────────────────────────────────────────────────────────────────────────────
export function buildTemplateCardio(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  const L = p.length, Wd = p.width, H = p.height;
  const FRAME = steel('Cardio frame', p.frameColor), ACCENT = steel('Cardio covers', p.accentColor);
  return kit(api, k => {
    const box = (f: ReturnType<typeof finish>, a: Vec3, b: Vec3) => k.add(f, k.span(a, b));
    if (p.kind === 0) { // treadmill: deck, motor hood, uprights, console, handrails; console end at −X
      const deckH = Math.max(120, Math.min(300, H * .12)), hood = Math.max(L * .18, 200), ux = -L / 2 + Math.max(L * .12, 130);
      box(FRAME, [-L / 2, -Wd * .4, 0], [L / 2, Wd * .4, deckH]);
      box(DARK, [-L / 2 + hood, -Wd * .28, deckH - 1], [L / 2 - 60, Wd * .28, deckH + 4]);
      box(ACCENT, [-L / 2, -Wd * .4, 0], [-L / 2 + hood, Wd * .4, deckH + 60]);
      for (const s of [-1, 1]) {
        box(FRAME, [ux - 35, s > 0 ? Wd / 2 - 70 : -Wd / 2, 0], [ux + 35, s > 0 ? Wd / 2 : -Wd / 2 + 70, H * .82]);
        box(RUBBER, [ux, s > 0 ? Wd / 2 - 55 : -Wd / 2 + 15, H * .66], [ux + Math.min(L * .3, 600), s > 0 ? Wd / 2 - 15 : -Wd / 2 + 55, H * .7]);
      }
      box(ACCENT, [ux - 120, -Wd / 2, H * .82], [ux + 140, Wd / 2, H]);
    } else if (p.kind === 1) { // bike: feet, beam, flywheel or fan, seat post, handlebars
      const R = Math.min(H * .28, L * .3), th = Math.min(Wd * .35, 150), fx = -L / 2 + R + 10, sx = L / 2 - L * .3;
      box(FRAME, [-L / 2, -Wd / 2, 0], [-L / 2 + 70, Wd / 2, 60]); box(FRAME, [L / 2 - 70, -Wd / 2, 0], [L / 2, Wd / 2, 60]);
      box(FRAME, [-L / 2 + 35, -30, 30], [L / 2 - 35, 30, 90]);
      k.add(ACCENT, k.cyl(th, R, 'y', [fx, 0, R + 70], 48)); k.add(DARK, k.cyl(th + 10, R * .25, 'y', [fx, 0, R + 70], 24));
      k.add(FRAME, beam(k, [sx, 0, 60], [sx - 40, 0, H * .62], 50, 50));
      box(RUBBER, [sx - 180, -110, H * .62], [sx + 100, 110, H * .62 + 60]);
      const hx = fx + R * .4;
      k.add(FRAME, beam(k, [fx + R * .9, 0, 80], [hx, 0, H - 50], 50, 50));
      box(RUBBER, [hx - 25, -Wd * .45, H - 50], [hx + 25, Wd * .45, H]);
    } else if (p.kind === 2) { // rower: front foot, flywheel, rail, rear leg, seat, monitor arm
      const R = Math.min(H * .25, L * .12, 280), th = Math.min(Wd * .35, 250), fx = -L / 2 + R, railZ0 = Math.min(400, H * .35), rx0 = -L / 2 + 2 * R;
      const railZ = (x: number) => railZ0 + (100 - railZ0) * (x - rx0) / (L / 2 - 30 - rx0);
      box(FRAME, [-L / 2, -Wd / 2, 0], [-L / 2 + 80, Wd / 2, 50]);
      k.add(ACCENT, k.cyl(th, R, 'y', [fx, 0, R + 60], 48));
      k.add(FRAME, beam(k, [rx0, 0, railZ0], [L / 2 - 30, 0, 100], 80, 40), beam(k, [rx0, 0, railZ0], [rx0 - R * .5, 0, 40], 60, 40));
      box(FRAME, [L / 2 - 60, -Wd * .25, 0], [L / 2, Wd * .25, 100]);
      const sxs = rx0 + (L / 2 - rx0) * .45;
      box(RUBBER, [sxs - 150, -140, railZ(sxs) + 20], [sxs + 150, 140, railZ(sxs) + 80]);
      const fy = Math.min(200, Wd / 2 - 10);
      for (const s of [-1, 1]) box(DARK, [rx0 + 40, s > 0 ? 40 : -fy, railZ0 - 20], [rx0 + 200, s > 0 ? fy : -40, railZ0 + 30]);
      const mx = Math.min(fx + L * .1, L / 2 - 80);
      k.add(FRAME, beam(k, [fx, 0, 2 * R + 40], [mx, 0, H - 160], 40, 40));
      box(DARK, [mx - 60, -90, H - 160], [mx + 60, 90, H]);
    } else if (p.kind === 3) { // elliptical: base, stabilizers, rear housing, column, console, arms, pedals
      box(FRAME, [-L / 2, -Wd * .3, 0], [L / 2, Wd * .3, 80]);
      box(FRAME, [-L / 2, -Wd / 2, 0], [-L / 2 + 70, Wd / 2, 60]); box(FRAME, [L / 2 - 70, -Wd / 2, 0], [L / 2, Wd / 2, 60]);
      box(ACCENT, [L / 2 - L * .25, -Wd * .2, 0], [L / 2, Wd * .2, H * .4]);
      box(FRAME, [-L / 2 + 80, -50, 0], [-L / 2 + 180, 50, H * .8]);
      box(DARK, [-L / 2 + 60, -Wd * .3, H * .8], [-L / 2 + 260, Wd * .3, H]);
      for (const s of [-1, 1]) {
        k.add(FRAME, beam(k, [-L / 2 + 130, s * Wd * .3, H * .5], [-L / 2 + 130 + L * .12, s * (Wd / 2 - 25), H - 40], 35, 35));
        const py = Math.min(180, Wd / 2 - 10);
        box(RUBBER, [-L / 2 + L * .35, s > 0 ? 60 : -py, 150], [L / 2 - L * .25, s > 0 ? py : -60, 200]);
      }
    } else { // stair climber: base, ramped step loop, column, console, handrails
      box(FRAME, [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, 80]);
      const sx = -L / 2 + L * .35, sw = Wd * .3;
      k.add(ACCENT, k.k(k.api.Manifold.hull([k.span([L / 2 - 80, -sw, 0], [L / 2, sw, 150]), k.span([sx, -sw, 0], [sx + 80, sw, H * .45])])));
      for (let i = 1; i <= 5; i++) { const x = L / 2 - 80 - (L / 2 - 80 - sx) * i / 6, z = 150 + (H * .45 - 150) * i / 6; box(DARK, [x - 20, -sw, z - 10], [x + 60, sw, z + 15]); }
      box(FRAME, [-L / 2, -Wd * .15, 0], [-L / 2 + 150, Wd * .15, H * .85]);
      box(DARK, [-L / 2, -Wd * .3, H * .85], [-L / 2 + 200, Wd * .3, H]);
      for (const s of [-1, 1]) {
        const y0 = s > 0 ? Wd / 2 - 40 : -Wd / 2, y1 = s > 0 ? Wd / 2 : -Wd / 2 + 40;
        box(FRAME, [sx - 20, y0, 0], [sx + 20, y1, H * .75]);
        box(RUBBER, [-L / 2 + L * .15, y0, H * .73], [L / 2 - L * .25, y1, H * .77]);
      }
    }
  });
}

// ── Block ─────────────────────────────────────────────────────────────────────────────────────────
export function buildTemplateBlock(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  const F = finish('Block', 'source', colorHex(p.color), .1, .7);
  return kit(api, k => {
    k.add(F, p.radius < .5 ? k.span([-p.width / 2, -p.depth / 2, 0], [p.width / 2, p.depth / 2, p.height]) : alongZ(k, roundRect(k, [0, 0], p.width, p.depth, p.radius), p.height, 0));
  });
}

// ── Disc, cylinder or ball ────────────────────────────────────────────────────────────────────────
export function buildTemplateDisc(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  const F = finish('Disc', 'source', colorHex(p.color), .15, .6), r = p.diameter / 2, T = p.thickness;
  return kit(api, k => {
    if (p.shape === 2) { k.add(F, k.k(k.k(k.api.Manifold.sphere(r, 64)).translate([0, 0, r]))); return; }
    const axis = p.shape === 0 ? 'x' : 'z', at: Vec3 = p.shape === 0 ? [0, 0, r] : [0, 0, T / 2];
    const body = k.cyl(T, r, axis, at, 72);
    if (!p.hole) { k.add(F, body); return; }
    const hole = k.cyl(T + 2, p.hole / 2, axis, at, 40);
    k.add(F, k.cut(body, [k.cyl(T + 2, p.hole / 2 + 12, axis, at, 40)]));
    k.add(BRIGHT, k.cut(k.cyl(T, p.hole / 2 + 12, axis, at, 40), [hole]));
  });
}

export function buildTemplateBed(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  const L = p.length, W = p.width, H = p.height, t = p.boardThickness, base = p.frameHeight;
  const FRAME = finish('Bed frame and headboard', 'source', colorHex(p.frameColor), 0, .7);
  const MATTRESS = vinyl('Mattress', p.padColor), PILLOWS = vinyl('Pillows', p.padColor);
  return kit(api, k => {
    k.add(FRAME, k.span([L / 2 - t, -W / 2, 0], [L / 2, W / 2, H]));
    for (const s of [-1, 1]) {
      const y = s > 0 ? W / 2 - t : -W / 2;
      k.add(FRAME, k.span([-L / 2, y, p.legHeight], [L / 2 - t, y + t, base]));
    }
    k.add(FRAME, k.span([-L / 2, -W / 2, p.legHeight], [-L / 2 + t, W / 2, base]));
    if (p.legHeight > 0) for (const x of [-L / 2 + t, L / 2 - 2 * t]) for (const y of [-W / 2 + t, W / 2 - 2 * t])
      k.add(FRAME, k.span([x, y, 0], [x + t, y + t, base]));
    k.add(FRAME, k.span([-L / 2 + t, -W / 2 + t, base - 20], [L / 2 - t, W / 2 - t, base]));
    const mattressL = L - 2 * t, mattressW = W - 2 * t;
    k.add(MATTRESS, alongZ(k, roundRect(k, [0, 0], mattressL, mattressW, 25), p.mattressThickness, base));
    if (p.pillows) {
      const count = W < 1200 ? 1 : 2, pw = Math.min(600, mattressW / count - 40), pl = Math.min(400, mattressL * .25);
      for (let i = 0; i < count; i++) {
        const y = count === 1 ? 0 : (i === 0 ? -1 : 1) * mattressW / 4;
        k.add(PILLOWS, alongZ(k, roundRect(k, [L / 2 - t - pl / 2 - 30, y], pl, pw, 30), 60, base + p.mattressThickness));
      }
    }
  });
}

export const definitions: PartDefinition[] = [
  floorDefinition(TEMPLATE_BENCH, buildTemplateBench),
  floorDefinition(TEMPLATE_MACHINE, buildTemplateMachine),
  floorDefinition(TEMPLATE_STORAGE, buildTemplateStorage),
  floorDefinition(TEMPLATE_CARDIO, buildTemplateCardio),
  floorDefinition(TEMPLATE_BLOCK, buildTemplateBlock),
  floorDefinition(TEMPLATE_DISC, buildTemplateDisc),
  floorDefinition(TEMPLATE_BED, buildTemplateBed),
  floorDefinition(TEMPLATE_ASSEMBLY, buildGeneratedModel),
];
