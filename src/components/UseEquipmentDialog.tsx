import { workspaceStorage } from '../state/workspace-storage.ts';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { LocalConfigStorage, type SavedConfig } from '../state/config-storage.ts';
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
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    try { void new LocalConfigStorage(workspaceStorage()).read().then(c => { if (active) setGyms([...c.configs].sort((a, b) => gymTime(b) - gymTime(a))); }).catch(e => { if (active) setError(String(e)); }); } catch (e) { setError(String(e)); }
    return () => { active = false; };
  }, []);
  return <dialog ref={dialog} className="gym-wizard equipment-destination" aria-labelledby="use-equipment-title" onCancel={close}>
    <div className="wizard-title"><div><span className="eyebrow">USE YOUR EQUIPMENT</span><h2 id="use-equipment-title">Choose a gym</h2></div><button type="button" className="icon-button" aria-label="Close gym chooser" onClick={close}>×</button></div>
    <p>Place “{part.name}” in a saved design. Your library version stays available for other gyms.</p>
    {error && <p role="alert">{error}</p>}
    {!gyms && !error && <p role="status">Loading your gyms…</p>}
    {gyms?.length === 0 && <div className="library-empty"><h3>Create your first gym</h3><p>Your equipment is saved and ready. Create a gym, then add it from My custom equipment in the builder.</p><Link to="/" onClick={close}>Open gym workspace →</Link></div>}
    <div className="equipment-destinations">{gyms?.map(gym => <button type="button" key={gym.id} onClick={() => void navigate({ to: '/builder', search: { design: gym.id, customPart: part.id } as never })}><GymPreview doc={gym.doc} /><span><strong>{gym.name}</strong><small>{gym.gym?.type === 'commercial' ? 'Commercial gym' : 'Home gym'}{gym.gym?.client ? ` · ${gym.gym.client}` : ''}</small></span><span aria-hidden="true">→</span></button>)}</div>
    <footer className="wizard-footer"><button type="button" className="secondary" onClick={close}>Cancel</button></footer>
  </dialog>;
}
