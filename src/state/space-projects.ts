import type { SavedConfig } from './config-storage.ts';
import { cleanDocument, validateTimeline, type TimelineData } from './history.ts';
import type { RackDoc } from '../../rack-generator/types.ts';
export type ProjectType = 'home' | 'apartment' | 'gym';
export const PROJECT_LABELS: Record<ProjectType, string> = { home: 'Home', apartment: 'Apartment', gym: 'Gym' };
export interface ProjectRoom { id: string; name: string; position: [number, number]; doc: RackDoc; timeline?: TimelineData }
export const projectLabel = (c: SavedConfig) => c.projectType ? PROJECT_LABELS[c.projectType] : c.gym?.type === 'commercial' ? 'Commercial gym' : 'Home gym';
export function roomsOf(c: SavedConfig): ProjectRoom[] {
  return c.rooms ?? [{ id: 'main', name: c.projectType === 'gym' || !c.projectType ? 'Training floor' : 'Main room', position: [0, 0], doc: c.doc, ...(c.timeline ? { timeline: c.timeline } : {}) }];
}
export function validateProjectRooms(c: SavedConfig): Pick<SavedConfig, 'rooms' | 'activeRoomId'> {
  if (c.rooms === undefined) { if (c.activeRoomId !== undefined) throw Error('Room collection missing'); return {}; }
  if (!Array.isArray(c.rooms) || !c.rooms.length || c.rooms.length > 30) throw Error('Use 1–30 rooms per project.');
  const ids = new Set<string>();
  const rooms = c.rooms.map(r => {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || !Array.isArray(r.position) || r.position.length !== 2 || !r.position.every(v => Number.isFinite(v) && Math.abs(v) <= 100000)) throw Error('Invalid project room');
    ids.add(r.id);
    const doc = cleanDocument(r.doc);
    return { id: r.id, name: r.name.trim(), position: [...r.position] as [number, number], doc, ...(r.timeline ? { timeline: validateTimeline(r.timeline, doc) } : {}) };
  });
  if (typeof c.activeRoomId !== 'string' || !ids.has(c.activeRoomId)) throw Error('Invalid active room');
  return { rooms, activeRoomId: c.activeRoomId };
}
/** Keep the legacy document projection and active room in one atomic workspace write. */
export function checkpointRoom(c: SavedConfig, doc: RackDoc, timeline?: TimelineData): SavedConfig {
  return { ...c, doc, timeline, ...(c.rooms ? { rooms: c.rooms.map(r => r.id === c.activeRoomId ? { ...r, doc, timeline } : r) } : {}) };
}
export function projectArea(c: SavedConfig): number {
  return roomsOf(c).reduce((area, r) => area + (r.doc.room ? (r.doc.room.left + r.doc.room.right) * (r.doc.room.back + r.doc.room.front) / 1e6 : 0), 0);
}
