import { createAssembly } from '../../rack-generator/assembly.ts';
import { structureSlots } from '../../rack-generator/topology.ts';
import { addFloorItem, floorBounds } from '../../rack-generator/floor-items.ts';
import { cleanDocument } from './history.ts';
import type { SavedConfig } from './config-storage.ts';
import type { RackDoc } from '../../rack-generator/types.ts';

/** A template becomes an independent autosaving gym without copying its editing history. */
export function createGymFromTemplate(doc: RackDoc, name: string, id: string = crypto.randomUUID(), now = Date.now()): SavedConfig {
  if (!name.trim()) throw Error('Give your gym a name.');
  return { id, name: name.trim(), doc: cleanDocument(structuredClone(doc)), gym: { type: 'home', client: '', createdAt: now, updatedAt: now } };
}

export interface GymSetup { name: string; type: 'home' | 'commercial'; client: string; width: number; length: number; height: number; starter: 'empty' | 'strength' }
export function createGym(setup: GymSetup, id: string = crypto.randomUUID(), now = Date.now()): SavedConfig {
  if (!setup.name.trim()) throw Error('Give your gym a name.');
  if (![setup.width, setup.length, setup.height].every(Number.isFinite) || setup.width < 1200 || setup.width > 30000 || setup.length < 1200 || setup.length > 30000 || setup.height < 2100 || setup.height > 6000) throw Error('Use a width and length of 1.2–30 m and a height of 2.1–6 m.');
  if (setup.starter === 'strength' && (setup.width < 4000 || setup.length < 4000)) throw Error('The strength starter needs at least 4 × 4 m. Choose an empty room for a smaller space.');
  let doc = createAssembly({ emptyAccessories: setup.starter === 'empty' });
  doc.room = { left: setup.width / 2, right: setup.width / 2, back: setup.length / 2, front: setup.length / 2, height: setup.height };
  if (setup.starter === 'empty') doc.removed = structureSlots(doc).map(s => s.id);
  else {
    doc = addFloorItem(doc, 'rep-fb-5000', [0, 1100]);
    doc = addFloorItem(doc, 'rep-bar-weight-plate-tree', [1400, -800]);
    for (const item of doc.floorItems ?? []) {
      const b = floorBounds(item);
      if (b.min[0] < -setup.width / 2 || b.max[0] > setup.width / 2 || b.min[1] < -setup.length / 2 || b.max[1] > setup.length / 2) throw Error('Choose a larger room for this starter.');
    }
  }
  return { id, name: setup.name.trim(), doc: cleanDocument(doc), gym: { type: setup.type, client: setup.client.trim(), createdAt: now, updatedAt: now } };
}
export const gymTime = (c: SavedConfig) => c.gym?.updatedAt ?? 0;
