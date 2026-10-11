/** "Find a part with AI": name, link or photo → published measurements (with sources) → a sized template part.
 * The AI only researches; the geometry comes from a parametric template, so the saved part is exactly the size shown
 * in the review. People can correct any number before saving. See docs/ai-parts.md. */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PARTS, isTemplate } from '../../rack-generator/floor-parts/templates.ts';
import { floorOptions } from '../../rack-generator/floor-part.ts';
import { FLOOR_PARTS } from '../../rack-generator/floor-registry.ts';
import { RACK_PARTS } from '../../rack-generator/rack-registry.ts';
import { WALL_PARTS } from '../../rack-generator/wall-registry.ts';
import { HANG_PARTS } from '../../rack-generator/hang-registry.ts';
import type { NumericParams, PartId } from '../../rack-generator/types.ts';
import { catalogMatches, provenance, reviewSpec, type Review, type SpecParam } from '../ai-parts/spec.ts';
import { loadStatus, lookupPart, preparePhoto, requestCatalogPart, type AiStatus, type LookupResult } from '../ai-parts/client.ts';
import { saveCustomPart, type CustomPart } from '../state/custom-parts.ts';
import { PartThumbnail } from './PartThumbnail.tsx';
import './ai-part-finder.css';
import { useAccount } from '../cloud/session.ts';
import { SHAPES } from '../../rack-generator/floor-parts/generated-model.ts';

/** Every catalog part as { id, name, brand }, for "already in the catalog" matches. */
const CATALOG = [...FLOOR_PARTS, ...RACK_PARTS, ...WALL_PARTS, ...HANG_PARTS]
  .filter(p => !isTemplate(p.id)).map(p => ({ id: p.id, name: p.title, brand: p.vendor?.vendor ?? '' }));
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const CONFIDENCE: Record<Review['confidence'], [string, string]> = {
  high: ['High confidence', 'Matches the published size, and most numbers come from published specs.'],
  medium: ['Check the numbers', 'Some numbers are estimated. Compare them with the product or its manual before saving.'],
  low: ['Low confidence', 'The model does not match the published size, or key numbers are missing. Measure and correct them before saving.'],
};

interface Props { onClose: () => void; onAdd?: (part: CustomPart) => void; onUseCatalog?: (id: PartId) => void }
export function AiPartFinder({ onClose, onAdd, onUseCatalog }: Props) {
  const account = useAccount();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  // Refresh today's count when the finder opens and after each lookup.
  useEffect(() => { let live = true; loadStatus(true).then(s => { if (live) setStatus(s); }); return () => { live = false; }; }, [result]);
  return <section className="ai-finder" aria-label="Find a part with AI">
    <header className="ai-finder-head">
      <div><h2>Create equipment from a photo</h2>
        <p>Take a photo, upload one, or enter a product name. Review its measurements and 3D preview, then save it to your equipment library.</p></div>
      <button type="button" className="ai-quiet" onClick={onClose}>Back to my parts</button>
    </header>
    {status && <p className="ai-account">{status.used} of {status.limit} AI lookups used today
      {status.provider === 'mock' && <> · <span className="ai-badge ai-warn">Demo mode: example numbers</span></>}
      {status.provider === 'unconfigured' && <> · <span className="ai-badge ai-low">Photo analysis is not available yet</span></>}</p>}
    {status?.provider === 'mock' && <p className="ai-card" role="status">Local demo: upload a photo to try the complete workflow. This mode uses the equipment type you choose and example measurements; it does not recognize the photo. Check and edit every size before saving.</p>}
    {status?.requiresAccount && !account.session && <p className="ai-card">Keep your equipment in your private library. <a href="/account">Sign in or create an account</a> to continue.</p>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    {result ? <ResultReview result={result} onBack={() => setResult(null)} onAdd={onAdd} onUseCatalog={onUseCatalog} onSaved={onClose} />
      : status?.requiresAccount && !account.session ? null : <LookupForm demo={status?.provider === 'mock'} unavailable={status?.provider === 'unconfigured'} onResult={r => { setResult(r); setError(null); }} onError={setError} />}
  </section>;
}

function LookupForm({ demo, unavailable, onResult, onError }: { demo: boolean; unavailable: boolean; onResult: (r: LookupResult) => void; onError: (m: string | null) => void }) {
  const [demoType, setDemoType] = useState('bench');
  const [query, setQuery] = useState(''), [url, setUrl] = useState(''), [hint, setHint] = useState('');
  const [photo, setPhoto] = useState<Awaited<ReturnType<typeof preparePhoto>> | null>(null);
  const [busy, setBusy] = useState(false), [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now(), timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [busy]);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try { setPhoto(await preparePhoto(file)); onError(null); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    abort.current = new AbortController(); setBusy(true); setElapsed(0); onError(null);
    try {
      onResult(await lookupPart({ query: query || (demo && photo ? `Photographed ${demoType}` : ''), url, hint, image: photo ? { media_type: photo.media_type, data: photo.data } : undefined }, abort.current.signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  const ready = !!(query.trim() || url.trim() || photo);
  return <form className="ai-card ai-lookup" onSubmit={submit} aria-busy={busy}>
    <label htmlFor="ai-query">Product name <small>(optional with a photo)</small></label>
    <input id="ai-query" value={query} maxLength={300} onChange={e => setQuery(e.target.value)} placeholder="e.g. REP AB-5200 adjustable bench" disabled={busy} />
    <label htmlFor="ai-url">Product link <small>(optional, best accuracy)</small></label>
    <input id="ai-url" type="url" value={url} maxLength={2000} onChange={e => setUrl(e.target.value)} placeholder="https://…" disabled={busy} />
    <span className="ai-label">Photo <small>(optional, to identify the product)</small></span>
    <div className="ai-row ai-photo">
      <label className="ai-button">Take a photo<input type="file" accept="image/*" capture="environment" hidden onChange={e => pick(e.target.files?.[0])} disabled={busy} /></label>
      <label className="ai-button">Choose a photo<input type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0])} disabled={busy} /></label>
      {photo && <><img src={photo.preview} alt="Selected product photo" /><button type="button" className="ai-link" onClick={() => setPhoto(null)} disabled={busy}>Remove</button></>}
    </div>
    {demo && <label>Equipment type for a photo-only demo<select aria-label="Demo equipment type" value={demoType} onChange={e => setDemoType(e.target.value)} disabled={busy}>{['bench','machine','treadmill','bike','rower','storage','plate','block','bed'].map(type => <option key={type} value={type}>{type}</option>)}</select></label>}
    <label htmlFor="ai-hint">Anything else <small>(optional: size, colour, version, a measurement you took)</small></label>
    <input id="ai-hint" value={hint} maxLength={500} onChange={e => setHint(e.target.value)} placeholder="e.g. the 2.0 version, black, pad is 17.5 in high" disabled={busy} />
    <div className="ai-row ai-actions">
      {busy ? <>
        <p role="status" className="ai-status"><span className="ai-spinner" aria-hidden="true" />Researching published specs… {elapsed}s <small>(usually under a minute)</small></p>
        <button type="button" className="ai-quiet" onClick={() => abort.current?.abort()}>Cancel</button>
      </> : <button type="submit" className="ai-primary" disabled={!ready || unavailable}>{demo ? 'Create demo equipment' : 'Analyze equipment'}</button>}
    </div>
  </form>;
}

function basisOf(param: SpecParam | undefined, overridden: boolean) {
  if (overridden) return <span className="ai-badge ai-user">You</span>;
  if (!param) return <span className="ai-badge">Default</span>;
  if (param.basis === 'estimated') return <span className="ai-badge ai-warn" title={param.note || 'Estimated'}>Estimated</span>;
  return param.source_url ? <a className="ai-badge ai-ok" href={param.source_url} target="_blank" rel="noreferrer noopener" title={param.note || 'Published'}>Published ↗</a>
    : <span className="ai-badge ai-ok" title={param.note}>Published</span>;
}

function ResultReview({ result, onBack, onAdd, onUseCatalog, onSaved }: { result: LookupResult; onBack: () => void; onAdd?: (part: CustomPart) => void; onUseCatalog?: (id: PartId) => void; onSaved: () => void }) {
  const account = useAccount();
  const { spec } = result, template = PARTS.find(p => p.id === spec.template)!;
  const [overrides, setOverrides] = useState<NumericParams>({});
  const [name, setName] = useState(() => [spec.brand, spec.model].filter(s => s && s !== 'Example brand').join(' ').trim() || template.title);
  const [message, setMessage] = useState<string | null>(null);
  const review = useMemo(() => reviewSpec(spec, overrides), [spec, overrides]);
  const matches = useMemo(() => catalogMatches(spec, CATALOG), [spec]);
  const byKey = new Map(spec.params.map(p => [p.key, p]));
  const [label, explain] = CONFIDENCE[review.confidence];
  const save = (add: boolean) => {
    try {
      const part: CustomPart = { id: crypto.randomUUID(), name: name.trim(), part: spec.template as PartId, params: { ...review.params }, defaults: { ...template.defaults }, ai: provenance(spec, review, `${result.provider}:${result.model}`, overrides) };
      saveCustomPart(part);
      if (add && onAdd) onAdd(part); else onSaved();
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  };
  return <div className="ai-review">
    <div className="ai-card ai-summary">
      <PartThumbnail part={spec.template} params={review.params} className="ai-thumb" />
      <div>
        <h3>{spec.brand} {spec.model}</h3>
        <p className="ai-meta">{spec.category || template.noun} · built with the {template.title.toLowerCase()} · {result.cached ? 'from the lookup cache' : `${result.searches} web searches, ${Math.round(result.ms / 1000)}s`}</p>
        <p><span className={`ai-badge ai-${review.confidence}`}>{label}</span> {explain}</p>
        {spec.status === 'not_found' && <p className="ai-error">The AI could not identify this product. Try its exact name or link, or enter the measurements yourself below.</p>}
        {spec.template === 'template-block' && <p className="ai-card" role="status">Size placeholder: this preview is a solid box for room planning. It does not recreate the object in your photo. Only save it if a footprint placeholder is useful to you.</p>}
      </div>
    </div>
    {matches.length > 0 && <div className="ai-card ai-match">
      <strong>Already in the catalog with full detail:</strong>
      <ul>{matches.map(m => <li key={m.id}>{m.name} <small>{m.brand}</small>{' '}
        {onUseCatalog ? <button type="button" className="ai-link" onClick={() => onUseCatalog(m.id as PartId)}>Add the catalog part</button>
          : <a href={`/parts/${encodeURIComponent(m.id)}`}>Open it</a>}</li>)}</ul>
    </div>}
    {review.checks.length > 0 && <div className="ai-card">
      <h4>Size check</h4>
      <table className="ai-table"><thead><tr><th>Overall</th><th>Published</th><th>This model</th><th /></tr></thead>
        <tbody>{review.checks.map(c => <tr key={c.label}><td>{c.label}</td><td>{c.expected} mm</td><td>{c.built} mm</td>
          <td>{c.ok ? <span className="ai-ok-text">✓ matches</span> : <span className="ai-bad-text">✗ off by {Math.abs(c.built - c.expected)} mm</span>}</td></tr>)}</tbody></table>
      {spec.overall.source_url && <p className="ai-meta">Published size from <a href={spec.overall.source_url} target="_blank" rel="noreferrer noopener">{host(spec.overall.source_url)}</a>{spec.overall.basis === 'estimated' ? ' (estimated)' : ''}</p>}
    </div>}
    <div className="ai-card">
      <h4>Measurements <small>— change any number before saving</small></h4>
      <table className="ai-table ai-params"><tbody>{template.params.map(p => {
        const options = floorOptions(p, review.params), fmt = p.format ?? String, value = review.params[p.key], overridden = Object.hasOwn(overrides, p.key);
        const set = (v: number) => setOverrides(o => ({ ...o, [p.key]: v }));
        return <tr key={p.key}><td><label htmlFor={`ai-p-${p.key}`}>{p.label}</label></td>
          <td>{options.length > 20
            ? <span className="ai-num"><input id={`ai-p-${p.key}`} type="number" inputMode="numeric" value={value} min={options[0]} max={options.at(-1)} step={options[1] - options[0]} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) set(v); }} /> mm</span>
            : <select id={`ai-p-${p.key}`} value={value} onChange={e => set(Number(e.target.value))}>{options.map(v => <option key={v} value={v}>{fmt(v)}</option>)}</select>}</td>
          <td>{basisOf(byKey.get(p.key), overridden)}{overridden && <button type="button" className="ai-link" onClick={() => setOverrides(({ [p.key]: _, ...rest }) => rest)}>undo</button>}</td></tr>;
      })}</tbody></table>
      {review.adjustments.length > 0 && <p className="ai-meta">Rounded to the nearest supported size: {review.adjustments.map(a => `${a.label} ${a.asked} → ${a.used}`).join(', ')}.</p>}
      {review.error && <p className="ai-error" role="alert">{review.error}</p>}
    </div>
    {spec.template === 'template-assembly' && spec.geometry && <div className="ai-card">
      <h4>Model components</h4>
      <p className="ai-meta">The AI assembled these shapes from the photo. Edit their proportions and colours below; overall measurements scale the complete model. Hidden details and visual likeness are approximate.</p>
      {spec.geometry.map((component,index) => <details key={index}>
        <summary>{component.name} · {SHAPES[review.params[`c${index}_kind`]]}</summary>
        <label>Shape <select value={review.params[`c${index}_kind`]} onChange={e => setOverrides(o => ({...o,[`c${index}_kind`]:Number(e.target.value)}))}>{SHAPES.map((shape,i) => <option key={shape} value={i}>{shape}</option>)}</select></label>
        <label>Colour <input type="color" value={`#${review.params[`c${index}_color`].toString(16).padStart(6,'0')}`} onChange={e => setOverrides(o => ({...o,[`c${index}_color`]:parseInt(e.target.value.slice(1),16)}))} /></label>
        <table className="ai-table ai-params"><tbody>{[['sx','Length'],['sy','Width'],['sz','Height'],['x','Position X'],['y','Position Y'],['z','Position Z'],['rx','Rotate X'],['ry','Rotate Y'],['rz','Rotate Z']].map(([field,label]) => <tr key={field}><td><label htmlFor={`component-${index}-${field}`}>{label}</label></td><td><input id={`component-${index}-${field}`} type="number" step={1} min={field.startsWith('s')?1:field.startsWith('r')?-180:-10000} max={field.startsWith('r')?180:10000} value={review.params[`c${index}_${field}`]} onChange={e => { const value=Number(e.target.value); if(Number.isFinite(value)) setOverrides(o => ({...o,[`c${index}_${field}`]:value})); }} /> {field.startsWith('r')?'°':'mm'}</td></tr>)}</tbody></table>
      </details>)}
    </div>}
    {(spec.questions.length > 0 || spec.notes) && <div className="ai-card">
      {spec.questions.length > 0 && <><h4>Please measure</h4><ul>{spec.questions.map(q => <li key={q}>{q}</li>)}</ul></>}
      {spec.notes && <><h4>Notes from the research</h4><p>{spec.notes}</p></>}
    </div>}
    {spec.sources.length > 0 && <div className="ai-card"><h4>Sources</h4><ul className="ai-sources">{spec.sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a> <small>{host(s.url)}</small></li>)}</ul></div>}
    <div className="ai-card ai-save">
      <label htmlFor="ai-name">Part name</label>
      <input id="ai-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} />
      <div className="ai-row">
        {onAdd && <button type="button" className="ai-primary" disabled={!!review.error || !name.trim()} onClick={() => save(true)}>Save and add to gym</button>}
        <button type="button" className={onAdd ? 'ai-quiet' : 'ai-primary'} disabled={!!review.error || !name.trim()} onClick={() => save(false)}>Save to my parts</button>
        <button type="button" className="ai-quiet" onClick={onBack}>New lookup</button>
      </div>
      <p className="ai-meta">{account.session ? 'Saved to your private equipment library and synced to your account.' : 'Saved to your equipment library on this device.'} Measurements and sources stay with the equipment. {spec.template === 'template-assembly' ? 'The generated model preserves its component geometry when saved and placed. It is an editable approximation of the photo.' : 'The 3D preview uses a customizable template; details can differ from the photographed product.'}</p>
      {message && <p className="ai-error" role="alert">{message}</p>}
    </div>
  </div>;
}

/** Step 2 on a saved AI part: open a GitHub issue that the catalog workflow turns into a real part (when the server has GITHUB_TOKEN). */
export function CatalogRequestButton({ part }: { part: CustomPart }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  useEffect(() => { let live = true; loadStatus().then(s => { if (live) setStatus(s); }); return () => { live = false; }; }, []);
  if (!part.ai) return null;
  if (part.ai.catalogRequest) return <a className="ai-badge ai-user" href={part.ai.catalogRequest} target="_blank" rel="noreferrer noopener">Catalog part requested ↗</a>;
  if (!status?.catalogRequests) return null;
  const request = async () => {
    setState({ busy: true });
    try {
      const result = await requestCatalogPart({ name: part.name, part: part.part, params: part.params, ai: part.ai });
      saveCustomPart({ ...part, ai: { ...part.ai!, catalogRequest: result.url } });
      setState({});
    } catch (e) { setState({ error: e instanceof Error ? e.message : String(e) }); }
  };
  return <span className="ai-request">
    <button type="button" className="ai-link" disabled={state.busy} onClick={request} title="Opens a GitHub issue; the catalog workflow models the real product and opens a pull request for review">
      {state.busy ? 'Requesting…' : 'Request full catalog part'}</button>
    {state.error && <span className="ai-bad-text" role="alert">{state.error}</span>}
  </span>;
}
