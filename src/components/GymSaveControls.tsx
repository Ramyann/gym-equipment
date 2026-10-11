import { useEffect, useRef, useState } from 'react';
import type { BuilderStore } from '../state/builder-store.ts';
import { shallowEqual, useStoreSelector } from '../state/use-store.ts';
import { recoverDraftWithUndo } from './Toast/undo-actions.ts';
import './gym-save-controls.css';
import { useAccount } from '../cloud/session.ts';
import { CloudStatus } from './CloudStatus.tsx';

/** Subscribe to persistence only: dragging geometry does not rebuild these controls. */
export function GymSaveControls({ store, backup }: { store: BuilderStore; backup: () => void }) {
  const account = useAccount();
  const state = useStoreSelector(store, s => ({
    configs: s.configs, id: s.activeId, dirty: s.dirty, ready: s.storageReady,
    error: s.storageError, saving: s.storageSaving, draftSaved: s.draftSaved, recovery: s.draftAvailable,
  }), shallowEqual);
  const config = state.configs.find(c => c.id === state.id);
  const [expanded, setExpanded] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = state.saving || busy;
  const savedLabel = account.session ? account.sync === 'saved' ? 'Saved to cloud' : account.sync === 'syncing' || account.sync === 'pending' ? 'Saving to cloud…' : 'Saved locally · Check sync' : 'Saved on this device';
  const label = !state.ready ? 'Opening…' : state.error ? 'Save failed' : saving || (config?.gym && state.dirty) ? 'Saving…' : state.draftSaved && state.dirty ? 'Draft saved on this device' : state.dirty ? 'Unsaved changes' : config ? savedLabel : 'New design';
  useEffect(() => {
    if (naming) { dialog.current?.showModal(); dialog.current?.querySelector('input')?.focus(); }
  }, [naming]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function beginSave() { setName(config?.name ?? 'My gym'); setError(''); setNaming(true); }
  return <>
    <details className="gym-save-controls" open={expanded || !!state.error} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary aria-label={`Gym saving: ${label}`}>
        <span className="gym-save-dot" data-error={!!state.error} data-saving={saving || (!!config?.gym && state.dirty)} />
        <strong>{config?.name ?? 'Untitled gym'}</strong><span className="gym-save-label" role="status">{label}</span><span aria-hidden="true">⌄</span>
      </summary>
      <div className="gym-save-panel">
        <CloudStatus/>
        <p>{config?.gym ? account.session ? 'This gym and its editing history save locally and sync to your account.' : 'This gym and its editing history save automatically on this device.' : 'Save this design as a gym to add it to your dashboard and turn on autosave.'}</p>
        {config?.gym && !state.dirty && <small>Last saved {new Date(config.gym.updatedAt).toLocaleString()}</small>}
        {state.error && <p role="alert" className="gym-save-error">{state.error}</p>}
        {error && !naming && <p role="alert" className="gym-save-error">{error}</p>}
        <div className="gym-save-actions">
          {state.error ? <button disabled={saving || !state.ready} onClick={() => void run(store.retryStorage)}>Retry saving</button> : config?.gym ? <button disabled={saving || !state.ready || !state.dirty} onClick={() => void run(store.retryStorage)}>Save now</button> : <button disabled={saving || !state.ready} onClick={beginSave}>Save gym</button>}
          <button onClick={backup}>Download JSON backup</button>
        </div>
        {state.recovery && <div className="gym-recovery"><p>A saved draft is available. You can undo recovering it.</p><button disabled={saving} onClick={() => { recoverDraftWithUndo(store); setExpanded(false); }}>Recover draft</button></div>}
      </div>
    </details>
    {naming && <dialog ref={dialog} className="gym-name-dialog" aria-labelledby="save-gym-title" onCancel={e => { if (busy) e.preventDefault(); else setNaming(false); }}>
      <form onSubmit={e => { e.preventDefault(); void run(async () => { await store.saveGym(name); setNaming(false); setExpanded(false); }); }}>
        <h2 id="save-gym-title">Save your gym</h2>
        <p>Your gym will appear on the dashboard and save automatically{account.session ? ' to your account.' : ' on this device.'}</p>
        <label>Gym name<input value={name} maxLength={120} disabled={busy} onChange={e => setName(e.target.value)} /></label>
        {error && <p role="alert" className="gym-save-error">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={() => setNaming(false)}>Cancel</button><button type="submit" className="primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save gym'}</button></footer>
      </form>
    </dialog>}
  </>;
}
