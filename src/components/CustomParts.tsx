import { useState } from 'react';
import { customChanges, deleteCustomPart, saveCustomPart, useCustomParts, type CustomPart } from '../state/custom-parts.ts';
import { PartThumbnail } from './PartThumbnail.tsx';
import { AiPartFinder, CatalogRequestButton } from './AiPartFinder.tsx';
import type { PartId } from '../../rack-generator/types.ts';
import './custom-parts.css';

export function CustomParts({ onAdd, onUseCatalog, query = '', addLabel = 'Add to gym', onBrowse }: { onAdd?: (part: CustomPart) => void; onUseCatalog?: (id: PartId) => void; query?: string; addLabel?: string; onBrowse?: () => void }) {
  const { parts, error } = useCustomParts();
  const [deleted, setDeleted] = useState<CustomPart | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [finder, setFinder] = useState(false);
  if (finder) return <section className="custom-parts"><AiPartFinder onClose={() => setFinder(false)} onAdd={onAdd} onUseCatalog={onUseCatalog} /></section>;
  const shown = parts.filter(p => `${p.name} ${p.part}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="custom-parts" aria-label="My custom equipment">
    <div className="custom-parts-head"><h2>My custom equipment <small>{parts.length}</small></h2>
      <button type="button" className="ai-primary" onClick={() => setFinder(true)}>Find equipment with AI</button></div>
    <p>Your saved equipment, ready to reuse. Edit a version here or add an independent copy to your gym.</p>
    {(error || message) && <p role="alert">{error || message}</p>}
    {deleted && <div className="custom-delete-notice" role="status">“{deleted.name}” removed. <button type="button" onClick={() => { try { saveCustomPart(deleted); setDeleted(null); } catch (e) { setMessage(String(e)); } }}>Undo</button></div>}
    {!parts.length && !error && <div className="library-empty"><span aria-hidden="true">◇</span><h3>Your own collection starts here</h3><p>Choose equipment from the collection, customize it, and save your version.</p>{onBrowse ? <button type="button" onClick={onBrowse}>Browse equipment →</button> : <a href="/library">Open equipment library →</a>}</div>}
    {parts.length > 0 && !shown.length && <p>No custom parts match your search.</p>}
    <div className="custom-parts-grid">{shown.map(part => <article className="custom-part-card" key={part.id}>
      <PartThumbnail part={part.part} params={part.params} />
      <h3>{part.name}</h3><small>{part.ai ? [part.ai.brand, part.ai.model].filter(Boolean).join(' ') || 'Found with AI' : `Custom equipment · ${Object.keys(customChanges(part)).length} settings changed`}</small>
      {part.ai && <div className="custom-part-ai">
        <span className={`ai-badge ai-${part.ai.confidence}`}>AI · {part.ai.confidence === 'medium' ? 'check the numbers' : `${part.ai.confidence} confidence`}</span>
        {part.ai.sources.length > 0 && <details><summary>{part.ai.sources.length} source{part.ai.sources.length === 1 ? '' : 's'}</summary>
          <ul>{part.ai.sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a></li>)}</ul></details>}
        <CatalogRequestButton part={part} />
      </div>}
      <div className="custom-part-actions">
        {onAdd && <button type="button" onClick={() => onAdd(part)}>{addLabel}</button>}
        <a href={`/parts/${encodeURIComponent(part.part)}?custom=${encodeURIComponent(part.id)}`}>Edit</a>
        <button type="button" onClick={() => { try { saveCustomPart({ ...part, id: crypto.randomUUID(), name: `${part.name} copy` }); setMessage('Saved a new copy.'); } catch (e) { setMessage(String(e)); } }}>Duplicate</button>
        <button type="button" aria-label={`Delete custom part ${part.name}`} onClick={() => {
          try { deleteCustomPart(part.id); setDeleted(part); setMessage(null); }
          catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete custom part.'); }
        }}>Delete</button>
      </div>
    </article>)}</div>
  </section>;
}
