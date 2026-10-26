import { createAssembly } from '../../rack-generator/assembly.ts';
import { structureSlots } from '../../rack-generator/topology.ts';
import { addFloorItem, floorBounds } from '../../rack-generator/floor-items.ts';
import { cleanDocument } from './history.ts';
import type { SavedConfig } from './config-storage.ts';
import type { RackDoc } from '../../rack-generator/types.ts';
import type { ProjectType } from './space-projects.ts';
import { furniturePreset } from './furniture-presets.ts';

/** A template becomes an independent autosaving gym without copying its editing history. */
export function createGymFromTemplate(doc: RackDoc, name: string, id: string = crypto.randomUUID(), now = Date.now()): SavedConfig {
  if (!name.trim()) throw Error('Give your gym a name.');
  return { id, name: name.trim(), doc: cleanDocument(structuredClone(doc)), gym: { type: 'home', client: '', createdAt: now, updatedAt: now } };
}

export interface GymSetup { name: string; type: 'home' | 'commercial'; projectType?: ProjectType; client: string; width: number; length: number; height: number; starter: 'empty' | 'strength' | 'living' | 'bedroom' | 'office' }
export function createGym(setup: GymSetup, id: string = crypto.randomUUID(), now = Date.now()): SavedConfig {
  if (!setup.name.trim()) throw Error('Give your gym a name.');
  if (![setup.width, setup.length, setup.height].every(Number.isFinite) || setup.width < 1200 || setup.width > 30000 || setup.length < 1200 || setup.length > 30000 || setup.height < 2100 || setup.height > 6000) throw Error('Use a width and length of 1.2–30 m and a height of 2.1–6 m.');
  if (setup.starter === 'strength' && (setup.width < 4000 || setup.length < 4000)) throw Error('The strength starter needs at least 4 × 4 m. Choose an empty room for a smaller space.');
  if (setup.starter !== 'empty' && (setup.width < 4000 || setup.length < 4000)) throw Error('Furnished starters need at least 4 × 4 m. Choose an empty room for a smaller space.');
  let doc = createAssembly({ emptyAccessories: setup.starter !== 'strength' });
  doc.room = { left: setup.width / 2, right: setup.width / 2, back: setup.length / 2, front: setup.length / 2, height: setup.height };
  if (setup.projectType && setup.projectType !== 'gym') doc.room = { ...doc.room, floor: 'wood', walls: { finish: 'drywall', color: '#f2f1ec' } };
  if (setup.starter !== 'strength') doc.removed = structureSlots(doc).map(s => s.id);
  if (setup.starter === 'strength') {
    doc = addFloorItem(doc, 'rep-fb-5000', [0, 1100]);
    doc = addFloorItem(doc, 'rep-bar-weight-plate-tree', [1400, -800]);
    for (const item of doc.floorItems ?? []) {
      const b = floorBounds(item);
      if (b.min[0] < -setup.width / 2 || b.max[0] > setup.width / 2 || b.min[1] < -setup.length / 2 || b.max[1] > setup.length / 2) throw Error('Choose a larger room for this starter.');
    }
  }
  if (['living','bedroom','office'].includes(setup.starter)) {
    const items: [string, [number, number]][] = setup.starter === 'living' ? [['sofa',[-1000,0]],['table',[1000,0]],['lamp',[-setup.width/2+450,-setup.length/2+450]]] : setup.starter === 'bedroom' ? [['bed',[0,0]],['wardrobe',[0,-setup.length/2+450]]] : [['table',[0,0]],['chair',[0,1000]],['bookshelf',[-setup.width/2+450,0]]];
    for (const [seed, position] of items) { const item=furniturePreset(seed); doc=addFloorItem(doc,item.part,position,false,item.params);doc.floorItems!.at(-1)!.label=item.name; }
    for (const item of doc.floorItems??[]) { const b=floorBounds(item);if(b.min[0]<-setup.width/2||b.max[0]>setup.width/2||b.min[1]<-setup.length/2||b.max[1]>setup.length/2) throw Error('This starter needs a larger room.'); }
  }
  const savedDoc = cleanDocument(doc);
  return { id, name: setup.name.trim(), doc: savedDoc, gym: { type: setup.type, client: setup.client.trim(), createdAt: now, updatedAt: now }, ...(setup.projectType ? { projectType: setup.projectType, activeRoomId: 'main', rooms: [{ id: 'main', name: setup.projectType === 'gym' ? 'Training floor' : 'Main room', position: [0, 0] as [number, number], doc: savedDoc }] } : {}) };
}
export const gymTime = (c: SavedConfig) => c.gym?.updatedAt ?? 0;
