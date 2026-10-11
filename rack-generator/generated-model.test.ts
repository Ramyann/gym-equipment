import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { encodeComponents, decodeComponents, TEMPLATE_ASSEMBLY, type ModelComponent } from './floor-parts/generated-model.ts';
import { buildGeneratedModel } from './parts/generated-model.ts';
import { validateFloorParams } from './floor-part.ts';
import { parseSpec, reviewSpec } from '../src/ai-parts/spec.ts';
import { writeCustomPart, readCustomParts } from '../src/state/custom-parts-data.ts';
import { createGym } from '../src/state/gym-designs.ts';
import { addFloorItem, validateFloorItems } from './floor-items.ts';
const components: ModelComponent[] = [
  {name:'Seat',shape:'box',position:[0,0,450],size:[500,500,70],rotation:[0,0,0],color:0x2466aa},
  {name:'Backrest',shape:'box',position:[0,220,720],size:[500,60,500],rotation:[0,0,0],color:0x2466aa},
  ...[-200,200].flatMap(x => [-200,200].map(y => ({name:'Leg',shape:'tube' as const,position:[x,y,200] as [number,number,number],size:[40,40,400] as [number,number,number],rotation:[0,0,0] as [number,number,number],color:0x333333}))),
];
const spec = () => parseSpec({template:'template-assembly',status:'partial',brand:'',model:'Photo chair',category:'chair',params:[{key:'length',value:500},{key:'width',value:500},{key:'height',value:970}],overall:{length_mm:500,width_mm:500,height_mm:970,basis:'estimated'},geometry:components});
test('arbitrary photo components produce separate coloured solids, with exact editable bounds and open space', async () => {
  const api = await Module(); api.setup(); const review = reviewSpec(spec(),{width:600}); assert.equal(review.error,null);
  const solids = buildGeneratedModel(api,review.params);
  try {
    assert.equal(solids.length,6);
    assert.ok(solids.some(p => p.color === '#2466aa'));
    const union = api.Manifold.union(solids.map(p => p.solid));
    try { const b = union.boundingBox(); assert.deepEqual(b.min.map(Math.round),[-250,-300,0]); assert.deepEqual(b.max.map(Math.round),[250,300,970]); assert.ok(union.volume()<500*600*970*.4); }
    finally { union.delete(); }
  } finally { solids.forEach(p => p.solid.delete()); }
});
test('generated components survive custom library save, gym placement and document validation independently', () => {
  const params = reviewSpec(spec()).params; const data = new Map<string,string>();
  const storage = {getItem:(k:string) => data.get(k)??null,setItem:(k:string,v:string) => {data.set(k,v);}};
  writeCustomPart(storage,{id:'photo-chair',name:'My chair',part:'template-assembly',params,defaults:TEMPLATE_ASSEMBLY.defaults});
  const saved = readCustomParts(storage)[0]; assert.deepEqual(decodeComponents(saved.params),decodeComponents(params));
  const gym = createGym({name:'Chair room',type:'home',client:'',width:6000,length:5000,height:3000,starter:'empty'});
  const placed = addFloorItem(gym.doc,saved.part,[0,0],false,saved.params);
  const restored = validateFloorItems(JSON.parse(JSON.stringify(placed.floorItems)));
  assert.deepEqual(restored[0].params,params); saved.params.c0_color=0xffffff; assert.equal(restored[0].params.c0_color,0x2466aa);
});
test('photo geometry rejects scripts, unsupported shapes, excessive nodes and unsafe numeric fields', () => {
  assert.throws(() => parseSpec({...spec(),geometry:[{...components[0],shape:'script'}]}),/shape/);
  assert.throws(() => parseSpec({...spec(),geometry:Array.from({length:25},() => components[0])}),/components/);
  assert.throws(() => encodeComponents([{...components[0],size:[Infinity,1,1]}]),/Invalid/);
  const params = {...TEMPLATE_ASSEMBLY.defaults};
  assert.throws(() => validateFloorParams(TEMPLATE_ASSEMBLY,{...params,c0_sx:0}),/Invalid/);
  assert.throws(() => validateFloorParams(TEMPLATE_ASSEMBLY,{...params,c99_x:0}),/Invalid/);
  assert.throws(() => validateFloorParams(TEMPLATE_ASSEMBLY,{...params,execute:1}),/Invalid/);
});
