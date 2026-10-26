import { useEffect, useMemo, useRef, useState } from 'react';
import { readRoomScanFile, scanToProject, type ScanFile, type ScanSummary } from '../state/room-scan.ts';
import { PROJECT_LABELS, projectArea, type ProjectType } from '../state/space-projects.ts';
import type { SavedConfig } from '../state/config-storage.ts';
import { GymPreview } from './GymPreview.tsx';
import { ProjectPlan } from './ProjectWorkspace.tsx';

/** Whole-house exports carry photos, depth and meshes; only the room layouts are read, but the archive is loaded whole. */
const MAX_BYTES = 1024 ** 3;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const metres = (mm: number) => (mm / 1000).toFixed(2);
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Preview a 3D Model Anything room or whole-house scan as a new space, then create it. */
export function RoomScanImport({ file, close, create, busy }: { file: File; close: () => void; create: (c: SavedConfig) => Promise<void>; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scan, setScan] = useState<ScanFile | null>(null), [error, setError] = useState('');
  const [name, setName] = useState(''), [projectType, setProjectType] = useState<ProjectType>('home');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let live = true;
    setScan(null); setError('');
    void (async () => {
      if (file.size > MAX_BYTES) throw Error('This export is larger than 1 GB. Unzip it and import rooms/room-N.json instead.');
      const read = readRoomScanFile(new Uint8Array(await file.arrayBuffer()));
      if (live) { setScan(read); setName(read.houseName ?? read.rooms[0]?.name ?? file.name.replace(/\.(zip|json)$/i, '')); }
    })().catch(e => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [file]);
  const built = useMemo((): { config?: SavedConfig; summary?: ScanSummary; error?: string } | null => {
    if (!scan) return null;
    try { return scanToProject(scan, { name: name.trim() || 'Scanned space', projectType }); } catch (e) { return { error: message(e) }; }
  }, [scan, name, projectType]);
  const config = built?.config, summary = built?.summary, problem = error || built?.error, house = (summary?.rooms.length ?? 0) > 1;
  function submit() {
    if (!config) return;
    if (!name.trim()) { setError('Give your project a name.'); return; }
    setError('');
    void create({ ...config, name: name.trim() }).catch(e => setError(message(e)));
  }
  return <dialog ref={dialog} className="gym-wizard" aria-labelledby="room-scan-title" onCancel={e => { if (busy) e.preventDefault(); else close(); }}>
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="wizard-title"><div><span className="eyebrow">ROOM SCAN</span><h2 id="room-scan-title">{scan && scan.rooms.length > 1 ? 'Import a scanned home' : 'Import a scanned room'}</h2></div><button type="button" className="icon-button" aria-label="Close room scan import" disabled={busy} onClick={close}>×</button></div>
      <fieldset disabled={busy} className="wizard-body">
        {!scan && !error && <p>Reading {file.name}…</p>}
        {scan && <>
          <p>From a 3D Model Anything scan: {house ? 'each room’s' : 'the room’s'} size, doors, windows and furniture, matched to editable items at their scanned sizes.{house && ' Rooms keep their places on the project plan.'}</p>
          <label>Project name<input autoFocus value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="e.g. My living room" /></label>
          <div className="choice-grid">{(['home', 'apartment', 'gym'] as const).map(t => <button type="button" key={t} className={projectType === t ? 'choice selected' : 'choice'} aria-pressed={projectType === t} onClick={() => setProjectType(t)}><strong>{PROJECT_LABELS[t]}</strong></button>)}</div>
          {config && summary && (house ? <>
            <div className="room-preview"><ProjectPlan project={config} /><span>{count(summary.rooms.length, 'room')} · {projectArea(config).toLocaleString(undefined, { maximumFractionDigits: 1 })} m²</span></div>
            <div className="gym-summary">{summary.rooms.map(r => <span key={r.name + r.width + r.length}><strong>{r.name}</strong> · {metres(r.width)} × {metres(r.length)} m · {count(r.doors, 'door')} · {count(r.windows, 'window')} · {count(r.furniture, 'furniture item')}</span>)}</div>
          </> : <>
            <div className="room-preview"><GymPreview doc={config.doc} /><span>{metres(summary.rooms[0].width)} × {metres(summary.rooms[0].length)} m · {metres(summary.rooms[0].height)} m ceiling</span></div>
            <div className="gym-summary"><strong>{summary.rooms[0].name}</strong><span>{count(summary.rooms[0].doors, 'door')} · {count(summary.rooms[0].windows, 'window')} · {count(summary.rooms[0].furniture, 'furniture item')}</span></div>
          </>)}
          {summary?.notes.map(n => <p key={n}>{n}</p>)}
        </>}
      </fieldset>
      {problem && <p role="alert" className="dashboard-error">{problem}</p>}
      <footer className="wizard-footer"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy || !config}>{busy ? 'Creating…' : 'Create space & open builder'}</button></footer>
    </form>
  </dialog>;
}
