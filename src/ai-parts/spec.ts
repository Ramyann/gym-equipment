/** AI part lookup: the contract between the AI researcher (server) and the builder (browser).
 *
 * The AI never draws geometry. It identifies the product, finds published measurements with sources, and fills one
 * parametric template (rack-generator/floor-parts/templates.ts). This module turns that answer into a saved custom part
 * and checks it: every value is snapped to the template's options, validated, and the built envelope is compared with
 * the product's published overall size. Shared by the Worker (server/) and the UI; no DOM or Node APIs. */
import { PARTS, TEMPLATE_IDS, TEMPLATE_COLORS, templateEnvelope, isTemplate, type TemplateId } from '../../rack-generator/floor-parts/templates.ts';
import { coerceFloorParams, floorOptions, validateFloorParams } from '../../rack-generator/floor-part.ts';
import type { NumericParams } from '../../rack-generator/types.ts';
import { encodeComponents, SHAPES, MAX_COMPONENTS, type ModelComponent } from '../../rack-generator/floor-parts/generated-model.ts';

export type Basis = 'published' | 'estimated' | 'user';
export interface SpecParam { key: string; value: number; basis: Basis; source_url: string; note: string }
export interface PartSpec {
  status: 'found' | 'partial' | 'not_found';
  brand: string; model: string; category: string; product_url: string;
  template: TemplateId;
  geometry?: ModelComponent[];
  params: SpecParam[];
  /** Published overall size as assembled: length = the template's X, width = Y, height = Z. */
  overall: { length_mm: number; width_mm: number; height_mm: number; basis: Basis; source_url: string };
  sources: { url: string; title: string }[];
  notes: string;
  /** Measurements the AI could not find and needs from the user (e.g. "Pad height from the floor"). */
  questions: string[];
}
/** What the server returns for one lookup. */
export interface LookupResponse { spec: PartSpec; provider: string; model: string; searches: number; ms: number }
export interface LookupRequest { query?: string; url?: string; image?: { media_type: string; data: string }; hint?: string }

const ALL_KEYS = [...new Set(PARTS.flatMap(p => p.params.map(q => q.key)))].sort();
const BASES = ['published', 'estimated'] as const;
/** JSON Schema for the AI's `submit_part_spec` tool (strict: every field required, no numeric bounds). */
export const PART_SPEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'brand', 'model', 'category', 'product_url', 'template', 'geometry', 'params', 'overall', 'sources', 'notes', 'questions'],
  properties: {
    status: { type: 'string', enum: ['found', 'partial', 'not_found'] },
    brand: { type: 'string' }, model: { type: 'string' }, category: { type: 'string' }, product_url: { type: 'string' },
    template: { type: 'string', enum: TEMPLATE_IDS },
    geometry: { type:'array', items:{type:'object',additionalProperties:false,required:['name','shape','position','size','rotation','color'],properties:{
      name:{type:'string'},shape:{type:'string',enum:SHAPES},position:{type:'array',items:{type:'number'},minItems:3,maxItems:3},
      size:{type:'array',items:{type:'number'},minItems:3,maxItems:3},rotation:{type:'array',items:{type:'number'},minItems:3,maxItems:3},color:{type:'integer'},
    }}},
    params: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value', 'basis', 'source_url', 'note'], properties: {
      key: { type: 'string', enum: ALL_KEYS }, value: { type: 'number' }, basis: { type: 'string', enum: BASES }, source_url: { type: 'string' }, note: { type: 'string' },
    } } },
    overall: { type: 'object', additionalProperties: false, required: ['length_mm', 'width_mm', 'height_mm', 'basis', 'source_url'], properties: {
      length_mm: { type: 'number' }, width_mm: { type: 'number' }, height_mm: { type: 'number' }, basis: { type: 'string', enum: BASES }, source_url: { type: 'string' },
    } },
    sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'title'], properties: { url: { type: 'string' }, title: { type: 'string' } } } },
    notes: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** Photo generation constrains the provider tool to assemblies instead of relying on prompt preference. */
export function schemaForLookup(req: LookupRequest) {
  return req.image ? { ...PART_SPEC_SCHEMA, properties:{...PART_SPEC_SCHEMA.properties,
    template:{type:'string',enum:['template-assembly']}, geometry:{...PART_SPEC_SCHEMA.properties.geometry,minItems:3,maxItems:MAX_COMPONENTS},
  }} : PART_SPEC_SCHEMA;
}

/** The template catalogue as prompt text, generated from the registry so it never drifts from the builders. */
export function templateGuide(): string {
  const colors = TEMPLATE_COLORS.map(([name], i) => `${i} ${name}`).join(', ');
  const blocks = PARTS.map(part => {
    const lines = part.params.map(p => {
      const options = floorOptions(p, part.defaults), fmt = p.format ?? String;
      if (p.key.toLowerCase().endsWith('color')) return `  - ${p.key}: ${p.label} — colour index (see colours)`;
      const numeric = options.length > 12 && options.every(v => typeof v === 'number');
      return numeric ? `  - ${p.key}: ${p.label} — ${fmt(options[0])} to ${fmt(options.at(-1)!)} (default ${fmt(p.default)})`
        : `  - ${p.key}: ${p.label} — one of ${options.map(v => `${v} = ${fmt(v)}`).join('; ')} (default ${p.default})`;
    });
    return `${part.id} — ${part.title}. ${part.description}\n${lines.join('\n')}`;
  });
  return `Colours (index name): ${colors}.\nAxes: X = length (the long side for benches, cardio and rowers; width for machines, racks and blocks), Y = the other horizontal side, Z = height.\n\n${blocks.join('\n\n')}`;
}

export const SYSTEM_PROMPT = `You research real gym equipment and room furniture so a 3D room planner can model it at its true size.

Your job:
1. Identify the exact product (brand and model) from the user's text, link or photo. If a photo shows a product you cannot identify with confidence, say so in notes and set status "partial" or "not_found".
2. Find its published measurements. Search the manufacturer's product page, spec table and manual (PDF) first, then 1–2 major retailers. Prefer assembled dimensions over box/shipping dimensions.
3. Pick the ONE template below that best fits the product and fill its params from those measurements.
4. Call submit_part_spec exactly once with the result.

Accuracy rules — these matter more than anything else:
- Never invent a number. Every param is either "published" (with the source_url of the page that states it) or "estimated" (with a note on how you estimated it, e.g. from photo proportions against a published dimension).
- Convert units exactly: inches × 25.4, feet × 304.8, cm × 10. Round to the nearest millimetre.
- "overall" is the published assembled length × width × height. Map it to the template's axes (see Axes); for benches, overall length is the frame or pad length, whichever is longer.
- Leave a param out to keep its default only when nothing better is known, and add a question asking the user to measure it if it matters for planning.
- If the product clearly is not a free-standing floor item (e.g. a rack attachment), still pick the closest template and explain in notes.
- Put every page you used in sources.
- For photo input, use template-assembly unless the user explicitly requests a stock template. Create geometry matching the visible object rather than fitting it to a stock template. Decompose its silhouette into 3–24 meaningful components (frame rails, supports, pads, panels, wheels, headboard, etc). Use only box, cylinder, ellipsoid or tube. Cylinders/tubes run along local Z; rotate them for rails or wheels. Positions and sizes are millimetres, positions are component CENTRES, rotations are XYZ Euler degrees (-180..180), colours are packed RGB integers (white=16777215, black=0). Use component sizes from published measurements or clearly estimated photo proportions, never claim exact reconstruction. Include distinct visible colours. No scripts, meshes or executable code.
- For template-assembly, set params length, width, height to the object's overall X, Y, Z dimensions. Geometry coordinates use the same axes; the renderer fits the assembly to those dimensions. Keep individual coordinates within +/-10000 mm and sizes 1..10000 mm. Prefer simple coherent geometry over dozens of tiny details. For other templates return geometry=[]. A photo bed should have frame, mattress, headboard and legs rather than one box; distinguish mattress dimensions from overall frame dimensions.
- When no template represents the object's structure, template-block is only a footprint placeholder. Explain this in notes, use status "partial", and do not claim the block recreates the object.

Templates:
`;

/** The user turn for one lookup (text parts; the server adds the photo as an image block). */
export function lookupPrompt(req: LookupRequest): string {
  const parts = [req.query && `Product: ${req.query}`, req.url && `Product page: ${req.url}`, req.image && 'A photo of the product is attached.', req.hint && `Extra details from the user: ${req.hint}`].filter(Boolean);
  return `${parts.join('\n')}\n\n${req.image ? 'Generate a component assembly matching the photograph. The required template is template-assembly, with 3–24 geometry components; do not use any stock product template. ' : ''}Research it and call submit_part_spec.`;
}

// ── Checking an AI answer ────────────────────────────────────────────────────────────────────────
const str = (v: unknown, max = 500) => typeof v === 'string' ? v.slice(0, max) : '';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : NaN;
const url = (v: unknown) => { const s = str(v, 2000); return /^https?:\/\//i.test(s) ? s : ''; };
/** Validates untrusted AI output into a PartSpec (throws on anything unusable). */
export function parseSpec(input: unknown): PartSpec {
  if (!input || typeof input !== 'object') throw Error('The AI returned no part details.');
  const o = input as Record<string, unknown>;
  if (!isTemplate(String(o.template))) throw Error('The AI picked an unknown template.');
  const status = (['found', 'partial', 'not_found'] as const).find(s => s === o.status) ?? 'partial';
  const basis = (v: unknown): Basis => v === 'published' || v === 'user' ? v : 'estimated';
  const params = (Array.isArray(o.params) ? o.params : []).slice(0, 40).map((p: Record<string, unknown>) => ({
    key: str(p?.key, 40), value: num(p?.value), basis: basis(p?.basis), source_url: url(p?.source_url), note: str(p?.note),
  })).filter(p => p.key && Number.isFinite(p.value));
  const ov = (o.overall ?? {}) as Record<string, unknown>;
  let geometry: ModelComponent[] | undefined;
  if (o.template === 'template-assembly') {
    if (!Array.isArray(o.geometry) || !o.geometry.length || o.geometry.length > MAX_COMPONENTS) throw Error(`The photo model needs 1–${MAX_COMPONENTS} valid components.`);
    const vector = (value: unknown): [number,number,number] => {
      if (!Array.isArray(value) || value.length !== 3 || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Error('Invalid photo model vector.');
      return value as [number,number,number];
    };
    geometry = o.geometry.map((c: Record<string,unknown>) => {
      if (!c || !SHAPES.includes(c.shape as typeof SHAPES[number])) throw Error('Unsupported photo model shape.');
      return { name:str(c.name,80)||'Component', shape:c.shape as ModelComponent['shape'], position:vector(c.position), size:vector(c.size), rotation:vector(c.rotation), color:num(c.color) };
    });
    encodeComponents(geometry);
  }
  return {
    status, brand: str(o.brand, 120), model: str(o.model, 200), category: str(o.category, 80), product_url: url(o.product_url),
    template: o.template as TemplateId, params, ...(geometry ? { geometry } : {}),
    overall: { length_mm: num(ov.length_mm), width_mm: num(ov.width_mm), height_mm: num(ov.height_mm), basis: basis(ov.basis), source_url: url(ov.source_url) },
    sources: (Array.isArray(o.sources) ? o.sources : []).slice(0, 20).map((s: Record<string, unknown>) => ({ url: url(s?.url), title: str(s?.title, 200) })).filter(s => s.url),
    notes: str(o.notes, 2000),
    questions: (Array.isArray(o.questions) ? o.questions : []).slice(0, 10).map(q => str(q, 200)).filter(Boolean),
  };
}

export interface Check { label: string; expected: number; built: number; ok: boolean }
export interface Adjustment { key: string; label: string; asked: number; used: number; reason: string }
export interface Review {
  template: TemplateId; params: NumericParams; envelope: [number, number, number];
  checks: Check[]; adjustments: Adjustment[]; ignored: string[];
  confidence: 'high' | 'medium' | 'low'; published: number; estimated: number; error: string | null;
}
/** Size tolerance for "matches the published size": 1% or 10 mm, whichever is larger. */
export const tolerance = (mm: number) => Math.max(10, Math.abs(mm) * .01);

/** Builds template params from a spec (with optional user corrections) and checks them against the published size. */
export function reviewSpec(spec: PartSpec, overrides: NumericParams = {}): Review {
  const part = PARTS.find(p => p.id === spec.template)!, labels = new Map(part.params.map(p => [p.key, p.label]));
  const asked: NumericParams = {}, ignored: string[] = [];
  for (const p of spec.params) if (labels.has(p.key)) asked[p.key] = Math.round(p.value); else ignored.push(p.key);
  Object.assign(asked, overrides);
  if (spec.template === 'template-assembly' && spec.geometry) {
    for (const [key,value] of [['length',spec.overall.length_mm],['width',spec.overall.width_mm],['height',spec.overall.height_mm]] as const)
      if (!Object.hasOwn(asked,key) && Number.isFinite(value) && value > 0) asked[key] = Math.round(value);
    Object.assign(asked, encodeComponents(spec.geometry), overrides);
  }
  const params = coerceFloorParams(part, asked), adjustments: Adjustment[] = [];
  for (const [key, value] of Object.entries(asked)) if (params[key] !== value)
    adjustments.push({ key, label: labels.get(key) ?? key, asked: value, used: params[key], reason: 'snapped to the nearest supported value' });
  let error: string | null = null;
  try { validateFloorParams(part, params); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const envelope = templateEnvelope(spec.template, params), o = spec.overall, checks: Check[] = [];
  ([['Length', o.length_mm, envelope[0]], ['Width', o.width_mm, envelope[1]], ['Height', o.height_mm, envelope[2]]] as const).forEach(([label, expected, built]) => {
    if (Number.isFinite(expected) && expected > 0) checks.push({ label, expected: Math.round(expected), built: Math.round(built), ok: Math.abs(built - expected) <= tolerance(expected) });
  });
  const used = spec.params.filter(p => labels.has(p.key)), published = used.filter(p => p.basis !== 'estimated').length + Object.keys(overrides).length, estimated = used.length - used.filter(p => p.basis !== 'estimated').length;
  const allOk = checks.length === 3 && checks.every(c => c.ok) && o.basis !== 'estimated';
  const confidence = error || spec.status === 'not_found' ? 'low' : allOk && published >= estimated && spec.status === 'found' ? 'high' : checks.some(c => !c.ok) || !checks.length ? 'low' : 'medium';
  return { template: spec.template, params, envelope, checks, adjustments, ignored, confidence, published, estimated, error };
}

/** Provenance stored on a saved custom part, so the gallery can show where the numbers came from. */
export interface AiProvenance {
  geometry?: ModelComponent[];
  brand: string; model: string; productUrl: string; sources: { url: string; title: string }[];
  confidence: Review['confidence']; checks: Check[]; notes: string; provider: string; createdAt: string;
  measurements: { key: string; value: number; basis: Basis; source_url: string; note: string }[];
  /** GitHub issue URL once an admin requested a full catalog part for it (step 2). */
  catalogRequest?: string;
}
export function provenance(spec: PartSpec, review: Review, provider: string, overrides: NumericParams = {}): AiProvenance {
  const measurements = spec.params.filter(p => Object.hasOwn(review.params, p.key) && !Object.hasOwn(overrides, p.key))
    .concat(Object.entries(overrides).map(([key, value]) => ({ key, value, basis: 'user' as const, source_url: '', note: 'Entered by the user' })));
  return { brand: spec.brand, model: spec.model, productUrl: spec.product_url, sources: spec.sources, confidence: review.confidence, checks: review.checks,
    notes: spec.notes, provider, createdAt: new Date().toISOString(), measurements, ...(spec.geometry ? {geometry:spec.geometry} : {}) };
}

// ── Already in the catalog? ──────────────────────────────────────────────────────────────────────
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w.length > 1);
/** Catalog parts whose name and brand share the identified product's model words (best first). */
export function catalogMatches<T extends { id: string; name: string; brand: string }>(spec: Pick<PartSpec, 'brand' | 'model'>, items: readonly T[], limit = 3): T[] {
  const model = words(spec.model).filter(w => !words(spec.brand).includes(w)), brand = words(spec.brand);
  if (!model.length) return [];
  return items.map(item => {
    const hay = new Set(words(`${item.name} ${item.brand} ${item.id}`));
    const hits = model.filter(w => hay.has(w)).length, brandHit = brand.some(w => hay.has(w));
    return { item, score: hits / model.length + (brandHit ? .5 : 0) };
  }).filter(r => r.score >= 1.1).sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.item);
}
