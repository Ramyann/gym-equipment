import { useEffect, useRef, useState } from 'react';
import { roomsOf, projectLabel, projectArea, type ProjectRoom } from '../state/space-projects.ts';
import { useStoreSelector, shallowEqual } from '../state/use-store.ts';
import type { BuilderStore } from '../state/builder-store.ts';
import type { SavedConfig } from '../state/config-storage.ts';
import { ROOM_DEFAULTS, wallFrames, wallToFloor } from '../../rack-generator/walls.ts';
import { wallOpenings } from '../../rack-generator/wall-items.ts';
import { floorBounds } from '../../rack-generator/floor-items.ts';
import './project-workspace.css';
function download(blob: Blob, name: string) { const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
export function ProjectPlan({ project, choose }: { project: SavedConfig; choose?: (id:string)=>void }) {
  const rooms=roomsOf(project), boxes=rooms.map(r=>{const d=r.doc.room??ROOM_DEFAULTS;return { x:r.position[0]-d.left,y:r.position[1]-d.back,w:d.left+d.right,h:d.back+d.front };});
  const x=Math.min(...boxes.map(b=>b.x))-500,y=Math.min(...boxes.map(b=>b.y))-500,w=Math.max(...boxes.map(b=>b.x+b.w))-x+500,h=Math.max(...boxes.map(b=>b.y+b.h))-y+500;
  return <svg xmlns="http://www.w3.org/2000/svg" className="project-plan" viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label="Project floor plan">
    {rooms.map((r,i)=>{const b=boxes[i], size=r.doc.room??ROOM_DEFAULTS;return <g key={r.id} transform={`translate(${r.position[0]} ${r.position[1]})`} role={choose?'button':undefined} tabIndex={choose?0:undefined} aria-label={choose?`Edit ${r.name}`:undefined} onClick={()=>choose?.(r.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose?.(r.id);}}}>
      <title>{r.name} · {((b.w*b.h)/1e6).toFixed(1)} m²</title><rect x={-size.left} y={-size.back} width={b.w} height={b.h} fill={r.id===project.activeRoomId?'#e0eadb':'#f4f3ec'} stroke="#52664f" strokeWidth="55"/>
      {(r.doc.floorItems??[]).map(item=>{const f=floorBounds(item);return <rect key={item.id} x={f.min[0]} y={f.min[1]} width={f.max[0]-f.min[0]} height={f.max[1]-f.min[1]} fill="#9bab94" stroke="#52664f" strokeWidth="12"><title>{item.label??item.part}</title></rect>;})}
      {wallOpenings(r.doc).map(o=>{const frame=wallFrames(size)[o.wall],a=wallToFloor(frame,o.min[0]),z=wallToFloor(frame,o.max[0]);return <line key={o.id} x1={a[0]} y1={a[1]} x2={z[0]} y2={z[1]} stroke={r.doc.wallItems?.find(item=>item.id===o.id)?.part==='decor-window'?'#8ebcce':'#fffdf6'} strokeWidth="85"/>;})}
      <text x={(size.right-size.left)/2} y={(size.front-size.back)/2} textAnchor="middle" fontSize={Math.min(420,b.w/Math.max(1,r.name.length*.65))} fill="#25372e">{r.name}</text><text x={(size.right-size.left)/2} y={(size.front-size.back)/2+420} textAnchor="middle" fontSize="280" fill="#52664f">{(b.w/1000).toFixed(1)} × {(b.h/1000).toFixed(1)} m</text>
    </g>;})}
  </svg>;
}
function RoomForm({ room, save, busy }: { room: ProjectRoom; save: (name:string,pos:[number,number])=>void; busy:boolean }) {
  const [name,setName]=useState(room.name),[position,setPosition]=useState(room.position.map(v=>String(v/1000)));
  return <form onSubmit={e=>{e.preventDefault();save(name,[Number(position[0])*1000,Number(position[1])*1000]);}}><h3>Room details</h3><label>Room name<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><div className="project-form-grid">{['Plan position X (m)','Plan position Y (m)'].map((label,i)=><label key={label}>{label}<input required type="number" min="-100" max="100" step="0.05" value={position[i]} onChange={e=>setPosition(p=>p.map((v,j)=>j===i?e.target.value:v))}/></label>)}</div><p>Move rooms in the project plan using their center positions. Each room has its own furnishings and editing history.</p><button disabled={busy}>Save room details</button></form>;
}
export function ProjectWorkspace({ store, fit }: { store: BuilderStore; fit:()=>void }) {
  const state=useStoreSelector(store,s=>({configs:s.configs,id:s.activeId}),shallowEqual), project=state.configs.find(c=>c.id===state.id);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[name,setName]=useState('Bedroom'),[dims,setDims]=useState(['4','3','2.7']),[deleted,setDeleted]=useState<ProjectRoom|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),plan=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  async function run(action:()=>Promise<void>) {setBusy(true);setError('');try{await action();fit();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const rooms=project?roomsOf(project):[], active=rooms.find(r=>r.id===(project?.activeRoomId??'main'));
  return <><button className="project-room-launcher" disabled={!project} onClick={()=>{setOpen(true);void run(store.flushStorage);}}>Rooms <span>{rooms.length}</span></button>
    {open&&project&&<dialog ref={dialog} className="project-dialog" aria-labelledby="project-title" onCancel={e=>{if(busy)e.preventDefault();else setOpen(false);}}><header><div><span>{projectLabel(project)} · {projectArea(project).toFixed(1)} m²</span><h2 id="project-title">{project.name}</h2></div><button aria-label="Close project rooms" disabled={busy} onClick={()=>setOpen(false)}>×</button></header>
      <div ref={plan}><ProjectPlan project={project} choose={id=>void run(()=>store.switchRoom(id))}/></div>
      <nav aria-label="Project rooms">{rooms.map(r=><button key={r.id} disabled={busy} aria-pressed={r.id===(project.activeRoomId??'main')} onClick={()=>void run(()=>store.switchRoom(r.id))}>{r.name}</button>)}</nav>
      <div className="project-form-grid">{active&&<RoomForm key={`${active.id}:${active.name}:${active.position}`} room={active} busy={busy} save={(n,p)=>void run(()=>store.updateProjectRoom(active.id,n,p))}/>}
      <form onSubmit={e=>{e.preventDefault();void run(()=>store.addProjectRoom(name,...dims.map(v=>Number(v)*1000) as [number,number,number]));}}><h3>Add a room</h3><label>New room name<input required value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><div className="project-dimensions">{['Width','Depth','Height'].map((label,i)=><label key={label}>{label} (m)<input required type="number" step="0.1" min={i===2?'2.1':'1.2'} max={i===2?'6':'30'} value={dims[i]} onChange={e=>setDims(p=>p.map((v,j)=>j===i?e.target.value:v))}/></label>)}</div><button disabled={busy||rooms.length>=30}>+ Add room</button><p>Use the Room panel to add doors, windows, and finishes. Rooms are rectangular; the plan shows their placement together.</p></form></div>
      <div className="room-removal">{active&&<button disabled={busy||rooms.length===1} onClick={()=>void run(async()=>{await store.removeProjectRoom(active.id);setDeleted(active);})}>Remove {active.name}</button>}{deleted&&<button disabled={busy} onClick={()=>void run(async()=>{await store.restoreProjectRoom(deleted);setDeleted(null);})}>Undo removing {deleted.name}</button>}</div>
      {error&&<p role="alert">{error}</p>}<footer><button disabled={busy} onClick={()=>{const svg=plan.current?.querySelector('svg');if(svg)download(new Blob([svg.outerHTML],{type:'image/svg+xml'}),'space-floor-plan.svg');}}>Export floor plan SVG</button><button disabled={busy} onClick={()=>download(new Blob([JSON.stringify({format:'space-studio-project',version:1,project},null,2)],{type:'application/json'}),'space-project.json')}>Backup whole project</button><button className="primary" disabled={busy} onClick={()=>setOpen(false)}>Continue editing {active?.name}</button></footer></dialog>}
  </>;
}
