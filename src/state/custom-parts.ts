import { useSyncExternalStore } from 'react';
import { readCustomParts, writeCustomPart, CUSTOM_PARTS_KEY, type CustomPart } from './custom-parts-data.ts';
export { readCustomParts, writeCustomPart, customChanges, CUSTOM_PARTS_KEY, type CustomPart } from './custom-parts-data.ts';
import { workspaceStorage, isWorkspaceStorageEvent } from './workspace-storage.ts';

interface Snapshot { parts: readonly CustomPart[]; error: string | null }
let snapshot: Snapshot = { parts: [], error: null }, loaded = false;
const listeners = new Set<() => void>();
function refresh() {
  try { snapshot = { parts: readCustomParts(workspaceStorage()), error: null }; }
  catch (error) { snapshot = { parts: [], error: error instanceof Error ? error.message : 'Custom parts storage is unavailable.' }; }
  listeners.forEach(fn => fn());
}
function ensureLoaded() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  refresh();
  window.addEventListener('storage', event => { if (isWorkspaceStorageEvent(event.key)) refresh(); });
  window.addEventListener('workspace-changed', refresh);
}
const subscribe = (fn: () => void) => { ensureLoaded(); listeners.add(fn); return () => { listeners.delete(fn); }; };
const getSnapshot = () => { ensureLoaded(); return snapshot; };
export const useCustomParts = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
export function saveCustomPart(part: CustomPart) {
  writeCustomPart(workspaceStorage(), part);
  refresh();
}
export function deleteCustomPart(id: string) {
  const parts = readCustomParts(workspaceStorage()).filter(p => p.id !== id);
  workspaceStorage().setItem(CUSTOM_PARTS_KEY, JSON.stringify({ version: 1, parts }));
  refresh();
}
export function findCustomPart(id: string): CustomPart | undefined {
  ensureLoaded();
  return snapshot.parts.find(p => p.id === id);
}
