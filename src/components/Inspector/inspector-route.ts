import type { BuilderSnapshot } from '../../state/builder-store.ts';
import { selectionKind } from '../../state/selection-actions.ts';
type InspectorRoute = { kind: 'floor' | 'wall' | 'hang'; id: string } | { kind: 'full' | 'room' | 'overview' | 'placement' };
/** Keep native inspectors during selection and placement; otherwise show the gym overview. */
export function inspectorRoute(s: BuilderSnapshot): InspectorRoute {
  if (s.structureChoice || s.systemChoice) return { kind: 'full' };
  const kind = selectionKind(s);
  if (kind === 'none') return { kind: s.placing ? 'placement' : 'overview' };
  if (kind === 'room') return { kind: 'room' };
  if (kind === 'floor' || kind === 'wall' || kind === 'hang') return { kind, id: s.resolved.find(r => r.id === s.selected)?.id ?? s.resolved.find(r => r.ownerId === s.selected)!.id };
  return { kind: 'full' };
}
