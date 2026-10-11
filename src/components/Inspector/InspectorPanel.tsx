import { useState, type ReactNode } from 'react';
import type { BuilderStore } from '../../state/builder-store.ts';
import { shallowEqual, useStoreSelector } from '../../state/use-store.ts';
import { inspectorRoute } from './inspector-route.ts';
import { swapCandidate } from '../../../rack-generator/swap.ts';
import { FloorInspector } from '../FloorInspector.tsx';
import { WallInspector } from '../WallInspector.tsx';
import { HangInspector } from '../HangInspector.tsx';
import { RoomInspector } from '../RoomInspector.tsx';
import { RackInspector } from './RackInspector.tsx';
import { roomOf } from '../../../rack-generator/wall-items.ts';
import { openGallery } from '../PartGallery/gallery-state.ts';
import './inspector.css';

function Inspector({ store, onResetRack }: { store: BuilderStore; onResetRack?: () => void }) {
  const route = useStoreSelector(store, inspectorRoute, shallowEqual);
  if (route.kind === 'placement') return <PlacementGuide store={store} />;
  if (route.kind === 'overview') return <GymOverview store={store} onResetRack={onResetRack} />;
  if (route.kind === 'room') return <RoomInspector store={store} />;
  if (route.kind === 'floor') return <FloorInspector store={store} id={route.id} />;
  if (route.kind === 'hang') return <HangInspector store={store} id={route.id} />;
  if (route.kind === 'wall') return <WallInspector store={store} id={route.id} />;
  return <RackInspector store={store} onResetRack={onResetRack} />;
}
function PlacementGuide({ store }: { store: BuilderStore }) {
  const hint = useStoreSelector(store, s => ({ name: s.definitions.find(d => d.id === s.placing?.part)?.name ?? s.placing?.part, valid: !!s.proposal }), shallowEqual);
  return <div className="gym-overview"><span className="studio-eyebrow">POSITION EQUIPMENT</span><h2>{hint.name}</h2><p>Choose a position on the gym floor or a compatible mounting point. Select it, or use Place, to confirm.</p><p>You can adjust this equipment after placing it.</p><button type="button" className="primary" disabled={!hint.valid} onClick={store.acceptProposal}>Place in gym</button><button type="button" onClick={store.cancelPlacement}>Cancel placement</button></div>;
}
function GymOverview({ store, onResetRack }: { store: BuilderStore; onResetRack?: () => void }) {
  const [advanced, setAdvanced] = useState(false);
  const summary = useStoreSelector(store, s => {
    const room = roomOf(s.doc);
    return { width: (room.left + room.right) / 1000, length: (room.back + room.front) / 1000, height: room.height / 1000, empty: !s.resolved.length };
  }, shallowEqual);
  if (advanced) return <><button type="button" className="studio-back" onClick={() => setAdvanced(false)}>← Gym overview</button><RackInspector store={store} onResetRack={onResetRack} /></>;
  return <div className="gym-overview">
    <span className="studio-eyebrow">YOUR SPACE</span><h2>Gym overview</h2>
    <p>{summary.empty ? 'Start with your space. Add equipment to bring your gym to life.' : 'Select equipment in your gym to move it or adjust its details.'}</p>
    <div className="studio-room-summary"><strong>{summary.width.toLocaleString()} × {summary.length.toLocaleString()} m</strong><span>{(summary.width * summary.length).toLocaleString()} m² · {summary.height.toLocaleString()} m ceiling</span></div>
    <button type="button" onClick={() => store.openRoom()}>Edit room & finishes</button>
    <div className="studio-next"><span className="studio-eyebrow">MAKE IT YOURS</span><h3>{summary.empty ? 'Your first piece of equipment' : 'Keep building your gym'}</h3><p>Browse benches, racks, weights and more. Preview an item, then add it to your space.</p><button type="button" className="primary" onClick={() => openGallery()}>+ Add equipment</button><button type="button" onClick={() => openGallery({ custom: true })}>My custom equipment</button></div>
    <details className="studio-advanced"><summary>Advanced rack tools</summary><p>Adjust the rack frame, topology and attachment settings.</p><button type="button" onClick={() => setAdvanced(true)}>Open rack settings</button></details>
    <p className="studio-canvas-tip">Drag to orbit · Scroll to zoom<br />Use Top view to arrange your floor plan.</p>
  </div>;
}
/** While placing a new accessory: swap it in for an existing one instead. */
function SwapAccessory({ store }: { store: BuilderStore }) {
  const swap = useStoreSelector(store, s => s.placing && !s.placing.movingId ? { part: s.placing.part, doc: s.doc } : null, shallowEqual);
  if (!swap) return null;
  const buttons = swap.doc.accessories.map(a => {
    const candidate = swapCandidate(swap.doc, a.id, swap.part);
    return candidate.valid ? <button type="button" key={a.id} onClick={() => store.act(() => { store.commit(candidate.doc); store.select(candidate.ownerId); })}>Swap {a.id}</button> : null;
  }).filter(Boolean);
  if (!buttons.length) return null;
  return <details className="insp-section insp-swap-existing"><summary><span className="insp-section-title">Swap an existing accessory</span></summary><div className="insp-section-body insp-stack">{buttons}</div></details>;
}
/** Re-key on history navigation so uncontrolled inputs show the restored document. */
export function InspectorPanel({ store, onResetRack, children }: { store: BuilderStore; onResetRack?: () => void; children?: ReactNode }) {
  const revision = useStoreSelector(store, s => s.inputRevision);
  return <div className="insp"><SwapAccessory store={store} /><Inspector key={revision} store={store} onResetRack={onResetRack} />{children && <div className="insp-extra">{children}</div>}</div>;
}
