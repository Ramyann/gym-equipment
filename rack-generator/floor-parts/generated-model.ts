/** Universal declarative models. No AI code is executed; only bounded numeric primitives are accepted. */
import { defineFloorPart } from '../floor-part.ts';
import type { NumericParams } from '../types.ts';
export const MAX_COMPONENTS = 24;
export const SHAPES = ['box','cylinder','ellipsoid','tube'] as const;
export interface ModelComponent { name: string; shape: typeof SHAPES[number]; position: [number,number,number]; size: [number,number,number]; rotation: [number,number,number]; color: number }
const fields = ['kind','x','y','z','sx','sy','sz','rx','ry','rz','color'] as const;
export function componentValue(key: string, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  if (key === 'count') return value >= 1 && value <= MAX_COMPONENTS;
  const match = /^c(\d+)_(kind|x|y|z|sx|sy|sz|rx|ry|rz|color)$/.exec(key);
  if (!match || Number(match[1]) >= MAX_COMPONENTS) return false;
  const field = match[2];
  if (field === 'kind') return value >= 0 && value < SHAPES.length;
  if (field === 'color') return value >= 0 && value <= 0xffffff;
  if (field.startsWith('r')) return Math.abs(value) <= 180;
  if (field.startsWith('s')) return value >= 1 && value <= 10000;
  return Math.abs(value) <= 10000;
}
export function encodeComponents(components: ModelComponent[]): NumericParams {
  if (!components.length || components.length > MAX_COMPONENTS) throw Error(`Use 1–${MAX_COMPONENTS} model components.`);
  const params: NumericParams = { count: components.length };
  components.forEach((c,i) => {
    const values = [SHAPES.indexOf(c.shape),...c.position,...c.size,...c.rotation,c.color];
    fields.forEach((field,j) => { const key = `c${i}_${field}`, value = Math.round(values[j]); if (!componentValue(key,value)) throw Error(`Invalid model component ${i+1} ${field}.`); params[key] = value; });
  });
  return params;
}
export function decodeComponents(p: NumericParams): ModelComponent[] {
  if (!componentValue('count',p.count)) throw Error('Invalid model component count.');
  if (Object.keys(p).some(k => /^c\d+_/.test(k) && Number(k.slice(1,k.indexOf('_'))) >= p.count)) throw Error('Model contains components outside its count.');
  return Array.from({length:p.count},(_,i) => {
    for (const f of fields) if (!componentValue(`c${i}_${f}`,p[`c${i}_${f}`])) throw Error(`Invalid model component ${i+1} ${f}.`);
    const vector = (keys: string[]) => keys.map(k => p[`c${i}_${k}`]) as [number,number,number];
    return { name:`Component ${i+1}`, shape:SHAPES[p[`c${i}_kind`]], position:vector(['x','y','z']), size:vector(['sx','sy','sz']), rotation:vector(['rx','ry','rz']), color:p[`c${i}_color`] };
  });
}
const dimensions = (key: string, label: string, fallback: number) => ({key,label,default:fallback,options:Array.from({length:1197},(_,i) => 20+i*5),format:(v:number) => `${v} mm`});
const part = defineFloorPart({ id:'template-assembly', name:'Component model', title:'Editable component model', noun:'model', section:'Custom templates',
  description:'A general assembly of boxes, cylinders, ellipsoids and hollow tubes. AI-generated components describe the visible shape of equipment or furniture without a product-specific template. Overall dimensions scale the complete assembly.',
  params:[dimensions('length','Overall length',1000),dimensions('width','Overall width',600),dimensions('height','Overall height',800)],
  validateExtraParams:componentValue, validate:p => { decodeComponents(p); }, footprint:p => ({width:p.length,depth:p.width}),
  placement:{side:'front',gap:400}, vendor:{vendor:'Template',url:'https://github.com/wesbos/gym-equipment',credit:'Declarative component model',trademark:'No brand geometry implied.',reconstruction:'Simplified visible geometry generated from image analysis; hidden structure and scale require review.'},
});
export const TEMPLATE_ASSEMBLY = { ...part, defaults:{...part.defaults,...encodeComponents([{name:'Example component',shape:'box',position:[0,0,400],size:[1000,600,800],rotation:[0,0,0],color:0xa0a5a0}])} };
