import { useEffect, useState } from 'react';
import { LocalConfigStorage } from './config-storage.ts';
import { workspaceStorage } from './workspace-storage.ts';
import type { BuilderSnapshot } from './builder-store.ts';
import type { ProjectType } from './space-projects.ts';
export const selectProjectType = (s:BuilderSnapshot):ProjectType => s.configs.find(c=>c.id===s.activeId)?.projectType ?? 'gym';
/** Library follows the active project; account cache changes remount the workspace shell. */
export function useWorkspaceProjectType():ProjectType {
  const [type,setType]=useState<ProjectType>('home');
  useEffect(()=>{let live=true;const read=()=>{void new LocalConfigStorage(workspaceStorage()).read().then(c=>{if(live)setType(c.configs.find(p=>p.id===c.activeId)?.projectType ?? (c.activeId?'gym':'home'));}).catch(()=>{});};read();window.addEventListener('gym-designs-changed',read);return()=>{live=false;window.removeEventListener('gym-designs-changed',read);};},[]);
  return type;
}
