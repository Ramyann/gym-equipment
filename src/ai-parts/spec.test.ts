import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PART_SPEC_SCHEMA, schemaForLookup, SYSTEM_PROMPT, catalogMatches, lookupPrompt, parseSpec, provenance, reviewSpec, templateGuide, tolerance, type PartSpec } from './spec.ts';
import { PARTS, TEMPLATE_IDS } from '../../rack-generator/floor-parts/templates.ts';

const SRC = 'https://example.com/bench-specs';
/** A flat bench published as 50" × 24" × 17.5" (1270 × 610 × 445 mm). */
const bench = (over: Partial<PartSpec> = {}): PartSpec => parseSpec({
  status: 'found', brand: 'Example Fitness', model: 'FB-100 Flat Bench', category: 'bench', product_url: SRC, template: 'template-bench',
  params: [
    { key: 'kind', value: 0, basis: 'published', source_url: SRC, note: '' },
    { key: 'length', value: 1270, basis: 'published', source_url: SRC, note: '50 in' },
    { key: 'width', value: 610, basis: 'published', source_url: SRC, note: '24 in' },
    { key: 'padLength', value: 1219, basis: 'published', source_url: SRC, note: '48 in' },
    { key: 'padWidth', value: 292, basis: 'published', source_url: SRC, note: '11.5 in' },
    { key: 'padHeight', value: 445, basis: 'published', source_url: SRC, note: '17.5 in' },
    { key: 'padThickness', value: 75, basis: 'estimated', source_url: '', note: 'from photos' },
    { key: 'tube', value: 76, basis: 'published', source_url: SRC, note: '3 in' },
  ],
  overall: { length_mm: 1270, width_mm: 610, height_mm: 445, basis: 'published', source_url: SRC },
  sources: [{ url: SRC, title: 'FB-100 specs' }], notes: '', questions: [], ...over,
});

test('the tool schema covers every template and every template param key', () => {
  assert.deepEqual(PART_SPEC_SCHEMA.properties.template.enum, TEMPLATE_IDS);
  const keys = new Set(PART_SPEC_SCHEMA.properties.params.items.properties.key.enum);
  for (const part of PARTS) for (const p of part.params) assert.ok(keys.has(p.key), p.key);
  const guide = templateGuide();
  for (const id of TEMPLATE_IDS) assert.ok(guide.includes(id), id);
  assert.match(guide, /0 Black/);
  assert.match(SYSTEM_PROMPT, /Never invent a number/);
  assert.match(lookupPrompt({ query: 'Rogue Echo Bike', hint: 'black' }), /Rogue Echo Bike[\s\S]*black/);
});

test('photo lookup tool requires generated assembly geometry instead of a stock product template', () => {
  const schema = schemaForLookup({image:{media_type:'image/jpeg',data:'AAAA'}});
  assert.deepEqual(schema.properties.template.enum,['template-assembly']);
  assert.ok(schema.required.includes('geometry'));
  assert.match(lookupPrompt({image:{media_type:'image/jpeg',data:'AAAA'}}),/required template is template-assembly/);
  assert.equal(schemaForLookup({query:'bench'}),PART_SPEC_SCHEMA);
});

test('a fully published spec builds to its published size with high confidence', () => {
  const review = reviewSpec(bench());
  assert.equal(review.error, null);
  assert.deepEqual(review.checks.map(c => [c.label, c.expected, c.built, c.ok]), [['Length', 1270, 1270, true], ['Width', 610, 610, true], ['Height', 445, 445, true]]);
  assert.equal(review.confidence, 'high');
  // 1219 and 292 are off the 5 mm grid: snapped, and reported.
  assert.deepEqual(review.adjustments.map(a => [a.key, a.asked, a.used]), [['padLength', 1219, 1220], ['padWidth', 292, 290]]);
});

test('a size that disagrees with the published overall size is flagged low', () => {
  const review = reviewSpec(bench({ overall: { length_mm: 1500, width_mm: 610, height_mm: 445, basis: 'published', source_url: SRC } }));
  assert.equal(review.checks[0].ok, false);
  assert.equal(review.confidence, 'low');
  assert.ok(tolerance(445) === 10 && tolerance(3000) === 30);
});

test('user corrections override the AI and are recorded as user measurements', () => {
  const spec = bench(), review = reviewSpec(spec, { padHeight: 430 });
  assert.equal(review.params.padHeight, 430);
  assert.equal(review.checks.find(c => c.label === 'Height')!.ok, false, 'now 15 mm under the published height');
  const p = provenance(spec, review, 'test', { padHeight: 430 });
  assert.deepEqual(p.measurements.find(m => m.key === 'padHeight'), { key: 'padHeight', value: 430, basis: 'user', source_url: '', note: 'Entered by the user' });
  assert.equal(p.brand, 'Example Fitness');
});

test('invalid combinations surface the template error instead of building', () => {
  const review = reviewSpec(bench(), { padHeight: 250, padThickness: 150 });
  assert.match(review.error ?? '', /above its frame/);
  assert.equal(review.confidence, 'low');
});

test('untrusted AI output is sanitised', () => {
  assert.throws(() => parseSpec({ template: 'template-rocket' }), /unknown template/);
  const spec = parseSpec({ template: 'template-block', status: 'weird', params: [{ key: 'width', value: 'x' }, { key: 'height', value: 300, basis: 'published', source_url: 'javascript:alert(1)' }],
    sources: [{ url: 'ftp://x', title: 'no' }, { url: 'https://ok.example', title: 'yes' }], overall: {} });
  assert.equal(spec.status, 'partial');
  assert.deepEqual(spec.params.map(p => [p.key, p.value, p.source_url]), [['height', 300, '']]);
  assert.deepEqual(spec.sources.map(s => s.url), ['https://ok.example']);
  assert.equal(reviewSpec(spec).checks.length, 0, 'no published overall size, nothing to check');
});

test('catalog matches find an existing part by model words and brand', () => {
  const items = [
    { id: 'rogue-echo-bike', name: 'Rogue Echo Bike', brand: 'Rogue Fitness' },
    { id: 'rep-ab-5200', name: 'AB-5200 Adjustable Bench', brand: 'REP Fitness' },
    { id: 'rep-ab-3000', name: 'AB-3000 FID Bench', brand: 'REP Fitness' },
  ];
  assert.deepEqual(catalogMatches({ brand: 'Rogue', model: 'Echo Bike V3' }, items).map(i => i.id), ['rogue-echo-bike']);
  assert.deepEqual(catalogMatches({ brand: 'REP Fitness', model: 'AB-5200 2.0' }, items).map(i => i.id), ['rep-ab-5200']);
  assert.deepEqual(catalogMatches({ brand: 'Titan', model: 'Flat Bench' }, items), []);
});
