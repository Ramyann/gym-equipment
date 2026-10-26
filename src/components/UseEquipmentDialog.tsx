import { customFitsProject } from '../state/item-purpose.ts';
import { workspaceStorage } from '../state/workspace-storage.ts';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { LocalConfigStorage, type SavedConfig } from '../state/config-storage.ts';
import { projectLabel, roomsOf } from '../state/space-projects.ts';
import { gymTime } from '../state/gym-designs.ts';
import type { CustomPart } from '../state/custom-parts.ts';
import { GymPreview } from './GymPreview.tsx';
import '../pages/dashboard.css';
import '../pages/studio-library.css';

/** Pick a destination without changing either the reusable preset or the saved gym. Placement is confirmed in the builder. */
export function UseEquipmentDialog({ part, close }: { part: CustomPart; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [gyms, setGyms] = useState<SavedConfig[] | null>(null), [error, setError] = useState('');
  const navigate = useNavigate();
  const [roomChoices,setRoomChoices] = useState<Record<string,string>>({});
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    try { void new LocalConfigStorage(workspaceStorage()).read().then(c => { if (active) setGyms([...c.configs].sort((a, b) => gymTime(b) - gymTime(a))); }).catch(e => { if (active) setError(String(e)); }); } catch (e) { setError(String(e)); }
    return () => { active = false; };
  }, []);
  return <dialog ref={dialog} className="gym-wizard equipment-destination" aria-labelledby="use-equipment-title" onCancel={close}>
    <div className="wizard-title"><div><span className="eyebrow">USE YOUR EQUIPMENT</span><h2 id="use-equipment-title">Choose a space</h2></div><button type="button" className="icon-button" aria-label="Close space chooser" onClick={close}>×</button></div>
    <p>Place “{part.name}” in a saved design. Your library version stays available for other spaces.</p>
    {error && <p role="alert">{error}</p>}
    {!gyms && !error && <p role="status">Loading your spaces…</p>}
    {gyms?.filter(gym=>customFitsProject(part,gym.projectType??'gym')).length === 0 && <div className="library-empty"><h3>Create a matching space</h3><p>Your item is saved and ready. Choose a matching project type or change its “Use for” setting in the item editor. Create a space, then add it from My custom equipment in the builder.</p><Link to="/" onClick={close}>Open workspace →</Link></div>}
    <div className="equipment-destinations">{gyms?.filter(gym=>customFitsProject(part,gym.projectType??'gym')).map(gym => <div key={gym.id}><label>Room in {gym.name}<select aria-label={`Room in ${gym.name}`} value={roomChoices[gym.id]??gym.activeRoomId??'main'} onChange={e=>setRoomChoices(p=>({...p,[gym.id]:e.target.value}))}>{roomsOf(gym).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><button type="button" onClick={() => void navigate({ to: '/builder', search: { design: gym.id, roomId: roomChoices[gym.id]??gym.activeRoomId??'main', customPart: part.id } as never })}><GymPreview doc={gym.doc} /><span><strong>{gym.name}</strong><small>{projectLabel(gym)}{gym.gym?.client ? ` · ${gym.gym.client}` : ''}</small></span><span aria-hidden="true">→</span></button></div>)}</div>
    <footer className="wizard-footer"><button type="button" className="secondary" onClick={close}>Cancel</button></footer>
  </dialog>;
}
