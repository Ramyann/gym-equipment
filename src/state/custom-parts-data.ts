import type { NumericParams, PartId } from '../../rack-generator/types.ts';
import type { AiProvenance } from '../ai-parts/spec.ts';
import type { StorageLike } from './config-storage.ts';
import { decodeComponents } from '../../rack-generator/floor-parts/generated-model.ts';
export interface CustomPart {
  id: string;
  name: string;
  part: PartId;
  params: NumericParams;
  defaults: NumericParams;
  ai?: AiProvenance;
  purpose?: 'home' | 'gym' | 'any';
}
export const CUSTOM_PARTS_KEY = 'bos-strength-custom-parts-v1';
const numeric = (value: unknown): value is NumericParams => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every(n => typeof n === 'number' && Number.isFinite(n));
export function readCustomParts(storage: StorageLike): CustomPart[] {
  const raw = storage.getItem(CUSTOM_PARTS_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.parts)) throw Error('Saved custom parts could not be read.');
  const ids = new Set<string>();
  return data.parts.map((p: CustomPart) => {
    if (!p || typeof p.id !== 'string' || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim()
      || typeof p.part !== 'string' || !numeric(p.params) || !numeric(p.defaults)) throw Error('Invalid saved custom part.');
    if(p.purpose !== undefined && !['home','gym','any'].includes(p.purpose)) throw Error('Invalid item purpose.');
    ids.add(p.id);
    if (p.part === 'template-assembly') decodeComponents(p.params);
    return p;
  });
}
export function writeCustomPart(storage: StorageLike, part: CustomPart): CustomPart[] {
  if (!part.name.trim() || !numeric(part.params) || !numeric(part.defaults)) throw Error('Enter a name and valid parameters.');
  if(part.purpose !== undefined && !['home','gym','any'].includes(part.purpose)) throw Error('Invalid item purpose.');
  if (part.part === 'template-assembly') decodeComponents(part.params);
  const parts = readCustomParts(storage), index = parts.findIndex(p => p.id === part.id);
  // Edits in the part viewer keep the AI lookup's provenance (product, sources, how each number was found).
  const saved = structuredClone({ ...part, name: part.name.trim(), ...(!part.ai && index >= 0 && parts[index].ai ? { ai: parts[index].ai } : {}) });
  if (index < 0) parts.push(saved); else parts[index] = saved;
  storage.setItem(CUSTOM_PARTS_KEY, JSON.stringify({ version: 1, parts }));
  return parts;
}
export function customChanges(preset: CustomPart): NumericParams {
  return Object.fromEntries(Object.entries(preset.params).filter(([key, value]) => value !== preset.defaults[key]));
}

