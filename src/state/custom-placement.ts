import type { CustomPart } from './custom-parts.ts';
import { customChanges } from './custom-parts.ts';
import { resolveAssembly, validateAssembly } from '../../rack-generator/assembly.ts';
import type { PlacementProposal } from '../../rack-generator/placement-proposals.ts';

/** Copy settings into native document owners, so history, export and reload need no preset lookup. */
export function customizeProposal(proposal: PlacementProposal, preset: CustomPart): PlacementProposal {
  const doc = structuredClone(proposal.doc), id = proposal.ownerId, changes = customChanges(preset);
  const floor = doc.floorItems?.filter(i => proposal.entries.some(e => e.ownerId === i.id));
  const wall = doc.wallItems?.find(i => i.id === id), accessory = doc.accessories.find(i => i.id === id);
  const system = doc.systems?.find(i => i.id === id), hang = doc.hangItems?.find(i => i.id === id);
  if (floor?.length) for (const item of floor) { item.params = { ...item.params, ...changes }; item.label = preset.name; }
  else if (wall) wall.params = { ...wall.params, ...changes };
  else if (accessory) accessory.params = { ...accessory.params, ...changes };
  else if (system) system.params = { ...system.params, ...changes };
  else if (hang) {
    if (Object.keys(changes).some(key => key !== 'hook')) throw Error('This hanging part does not support custom dimensions in the builder.');
    // A panel attachment always uses the hanging pose, regardless of its viewer pose.
  } else if (doc.uprights[id]) {
    if (Object.keys(changes).some(key => key !== 'height')) throw Error('Upright mounting dimensions are controlled by the rack profile. Customize the rack in the builder.');
    if (changes.height !== undefined) {
      if (changes.height > doc.rack.height) throw Error('Increase the rack height before adding this custom upright.');
      doc.uprights[id].height = changes.height;
    }
  } else if (doc.structure[id]) doc.structure[id].params = { ...doc.structure[id].params, ...changes };
  else if (Object.keys(changes).length) doc.structure[id] = { part: preset.part, params: changes };
  const valid = validateAssembly(doc);
  const owners = new Set(proposal.entries.map(e => e.ownerId).concat(id));
  return { ...proposal, doc: valid, entries: resolveAssembly(valid).filter(e => owners.has(e.ownerId)), label: preset.name };
}
