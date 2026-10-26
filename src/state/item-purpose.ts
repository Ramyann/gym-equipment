import type { ProjectType } from './space-projects.ts';
import type { CustomPart } from './custom-parts-data.ts';
export type ItemPurpose = 'home' | 'gym' | 'any';
export type ItemContext = ProjectType | 'all';
export const purposeForProject = (type?: ProjectType): ItemPurpose => type === 'home' || type === 'apartment' ? 'home' : 'gym';
const shared = new Set(['decor-interior-door','decor-window','template-block','template-disc','template-assembly']);
/** Structural and training items belong to gyms; household decoration is shared scenery. */
export function catalogPurpose(id: string, category?: string): ItemPurpose {
  if(shared.has(id)) return 'any';
  if((category === 'Room decor' || category === 'Wall decor' || id.startsWith('decor-')) && !/gym|barbell|plate|dumbbell|weight|rack|turf/i.test(id)) return 'any';
  return 'gym';
}
export function customPurpose(part: Pick<CustomPart,'part'|'name'|'purpose'>): ItemPurpose {
  if(part.purpose) return part.purpose;
  if(part.part !== 'template-assembly') return catalogPurpose(part.part);
  if(/treadmill|bench press|dumbbell|barbell|kettlebell|squat|elliptical|rowing machine|exercise bike|strength machine|weight rack/i.test(part.name)) return 'gym';
  if(/bed|chair|table|sofa|couch|bookshelf|bookcase|wardrobe|fridge|refrigerator|lamp|furniture|cabinet|desk|ottoman/i.test(part.name)) return 'home';
  return 'any';
}
export const matchesPurpose = (purpose:ItemPurpose, context:ItemContext) => context === 'all' || purpose === 'any' || purpose === purposeForProject(context);
export const customFitsProject = (part:Pick<CustomPart,'part'|'name'|'purpose'>,context:ItemContext) => matchesPurpose(customPurpose(part),context);
