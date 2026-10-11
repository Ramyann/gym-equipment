import { workspaceStorage } from '../state/workspace-storage.ts';
import { useAccount } from '../cloud/session.ts';
import { StudioSidebar } from '../components/StudioSidebar.tsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { LocalConfigStorage, type ConfigCollection, type SavedConfig } from '../state/config-storage.ts';
import { createGym, gymTime, type GymSetup } from '../state/gym-designs.ts';
import { GymPreview } from '../components/GymPreview.tsx';
import './dashboard.css';

function repository() { return new LocalConfigStorage(workspaceStorage()); }
const area = (c: SavedConfig) => c.doc.room ? ((c.doc.room.left+c.doc.room.right)*(c.doc.room.back+c.doc.room.front)/1e6).toLocaleString(undefined,{maximumFractionDigits:1})+' m²' : 'Room not set';
const date = (c: SavedConfig) => c.gym ? new Date(c.gym.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : 'Previously saved';
function Wizard({ close, create, busy }: { close:()=>void; create:(s:GymSetup)=>Promise<void>; busy:boolean }) {
  const account = useAccount();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step,setStep]=useState(0), [error,setError]=useState('');
  const [name,setName]=useState(''), [type,setType]=useState<'home'|'commercial'>('home'), [client,setClient]=useState('');
  const [unit,setUnit]=useState<'m'|'ft'>('m'), [dims,setDims]=useState(['6','5','3']), [starter,setStarter]=useState<'empty'|'strength'>('empty');
  const factor=unit==='m'?1000:304.8;
  const setup:GymSetup={name,type,client:type==='commercial'?client:'',width:Number(dims[0])*factor,length:Number(dims[1])*factor,height:Number(dims[2])*factor,starter};
  useEffect(()=>{dialog.current?.showModal();dialog.current?.querySelector('input')?.focus();},[]);
  function changeUnit(next:'m'|'ft') { if(next===unit)return; const f=next==='m'?1000:304.8;setDims(dims.map(d=>String(Math.round(Number(d)*factor/f*10000)/10000)));setUnit(next); }
  function advance() {
    setError('');
    try {
      if(step===0 && !name.trim()) throw Error('Give your gym a name.');
      if(step===1) createGym({...setup,starter:'empty'});
      if(step<2) setStep(step+1);
      else void create(setup).catch(e=>setError(e instanceof Error?e.message:String(e)));
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
  }
  let preview:SavedConfig|undefined;
  try { preview=createGym({...setup,name:name||'Preview'},'preview',0); }catch{}
  return <dialog ref={dialog} className="gym-wizard" aria-labelledby="create-gym-title" onCancel={e=>{if(busy)e.preventDefault();else close();}}>
    <form onSubmit={e=>{e.preventDefault();advance();}}>
      <div className="wizard-title"><div><span className="eyebrow">NEW GYM</span><h2 id="create-gym-title">Create your space</h2></div><button type="button" className="icon-button" aria-label="Close create gym" disabled={busy} onClick={close}>×</button></div>
      <ol className="wizard-steps">{['Details','Room','Starting point'].map((s,i)=><li key={s} aria-current={step===i?'step':undefined} className={step===i?'selected':''}><span>{i+1}</span>{s}</li>)}</ol>
      <fieldset disabled={busy} className="wizard-body" key={step}>
        {step===0 ? <><h3>What are you designing?</h3><label>Gym name<input autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="e.g. My garage gym" /></label><div className="choice-grid">{(['home','commercial'] as const).map(t=><button type="button" key={t} className={type===t?'choice selected':'choice'} aria-pressed={type===t} onClick={()=>setType(t)}><strong>{t==='home'?'Home gym':'Commercial gym'}</strong><span>{t==='home'?'A space for your own training':'A studio, facility, or client project'}</span></button>)}</div>{type==='commercial'&&<label>Client or location <small>Optional</small><input value={client} maxLength={120} onChange={e=>setClient(e.target.value)} placeholder="e.g. Northside Fitness" /></label>}</> : step===1 ? <><h3>Set your room size</h3><p>You can refine the room and its finishes in the builder.</p><div className="unit-switch">{(['m','ft'] as const).map(u=><button type="button" className={unit===u?'selected':''} aria-pressed={unit===u} key={u} onClick={()=>changeUnit(u)}>{u==='m'?'Meters':'Feet'}</button>)}</div><div className="dimensions-grid">{['Width','Length','Height'].map((label,i)=><label key={label}>{label} ({unit})<input autoFocus={i===0} type="number" step="any" value={dims[i]} onChange={e=>setDims(dims.map((d,j)=>i===j?e.target.value:d))} /></label>)}</div>{preview&&<div className="room-preview"><GymPreview doc={preview.doc}/><span>{area(preview)} · Room footprint</span></div>}<small>Width and length: 1.2–30 m. Ceiling height: 2.1–6 m.</small></> : <><h3>Choose your starting point</h3><div className="choice-grid">{(['empty','strength'] as const).map(s=><button type="button" key={s} className={starter===s?'choice selected':'choice'} aria-pressed={starter===s} onClick={()=>setStarter(s)}><strong>{s==='empty'?'Empty room':'Strength starter'}</strong><span>{s==='empty'?'Build it your way, piece by piece':'Rack, flat bench, and plate storage · 4 × 4 m minimum'}</span></button>)}</div>{preview&&<div className="room-preview"><GymPreview doc={preview.doc}/></div>}<div className="gym-summary"><strong>{name}</strong><span>{type==='home'?'Home gym':'Commercial gym'}{client&&type==='commercial'?` · ${client}`:''} · {(setup.width/1000).toFixed(2)} × {(setup.length/1000).toFixed(2)} m</span></div><p>Your gym will be saved automatically{account.session ? ' to your account.' : ' on this device.'}</p></>}
      </fieldset>
      {error&&<p role="alert" className="dashboard-error">{error}</p>}
      <footer className="wizard-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>{setError('');step?setStep(step-1):close();}}>{step?'Back':'Cancel'}</button><button className="primary" disabled={busy}>{busy?'Creating…':step===2?'Create gym & open builder':'Continue →'}</button></footer>
    </form>
  </dialog>;
}
export default function DashboardPage() {
  const account = useAccount();
  const navigate=useNavigate();
  const [collection,setCollection]=useState<ConfigCollection|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[wizard,setWizard]=useState(false),[query,setQuery]=useState(''),[deleted,setDeleted]=useState<SavedConfig|null>(null);
  const [rename,setRename]=useState<SavedConfig|null>(null),[newName,setNewName]=useState('');
  const renameDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(rename)renameDialog.current?.showModal();},[rename]);
  useEffect(()=>{let live=true; const refresh=()=>{void repository().read().then(c=>{if(live){setCollection(c);setError('');}}).catch(e=>{if(live)setError(`Could not read saved gyms: ${String(e)}`);});};refresh();window.addEventListener('storage',refresh);window.addEventListener('gym-designs-changed',refresh);return()=>{live=false;window.removeEventListener('storage',refresh);window.removeEventListener('gym-designs-changed',refresh);};},[]);
  async function update(change:(c:ConfigCollection)=>ConfigCollection) { const repo=repository(); const current=await repo.read();const next=change(current);await repo.write(next);setCollection(next); }
  async function run(action:()=>Promise<void>) {setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function open(c:SavedConfig) { await update(current=>({...current,activeId:c.id}));await navigate({to:'/builder',search:{design:c.id} as never}); }
  async function create(s:GymSetup) {setBusy(true);try{const c=createGym(s);await update(current=>({...current,configs:[...current.configs,c],activeId:c.id}));await navigate({to:'/builder',search:{design:c.id} as never});}finally{setBusy(false);}}
  const designs=[...(collection?.configs??[])].sort((a,b)=>gymTime(b)-gymTime(a));
  const filtered=designs.filter(c=>`${c.name} ${c.gym?.client??''}`.toLowerCase().includes(query.toLowerCase()));
  const recent=designs[0];
  return <div className="studio-dashboard"><StudioSidebar active="designs"/>
    <main className="studio-main"><div className="studio-breadcrumb">Workspace <span>/</span> My gym designs</div><header className="studio-heading"><div><h1>My gym designs</h1><p>Pick up where you left off, or start a new space.</p></div><button className="primary" disabled={busy||!collection} onClick={()=>setWizard(true)}>+ Create gym</button></header>
      {error&&<p className="dashboard-error" role="alert">{error}</p>}
      {deleted&&<div className="dashboard-notice" role="status">“{deleted.name}” deleted.<button disabled={busy} onClick={()=>void run(async()=>{await update(c=>({...c,configs:[...c.configs,deleted]}));setDeleted(null);})}>Undo</button></div>}
      {!collection&&!error?<p role="status">Opening your workspace…</p>:!designs.length?<section className="studio-empty"><span className="empty-symbol">▦</span><h2>Your first gym starts here</h2><p>Plan your room, choose your equipment, and make it yours.</p><button className="primary" disabled={busy||!collection} onClick={()=>setWizard(true)}>Create your first gym</button><Link to="/gyms">Explore gym templates →</Link></section>:<>
        {recent&&<section className="studio-continue"><div><span className="eyebrow">CONTINUE DESIGNING</span><h2>{recent.name}</h2><p>{recent.gym?.client||(recent.gym?.type==='commercial'?'Commercial gym':'Home gym')} · {area(recent)}</p><button className="primary" disabled={busy} onClick={()=>void run(()=>open(recent))}>Continue design →</button><small>Edited {date(recent)}</small></div><GymPreview doc={recent.doc}/></section>}
        <div className="recent-heading"><h2>Recent gym designs <span>{designs.length}</span></h2><input type="search" aria-label="Search gym designs" placeholder="Search designs…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <div className="gym-design-grid">{filtered.map(c=><article className="gym-design-card" key={c.id}><button className="preview-button" aria-label={`Open ${c.name}`} disabled={busy} onClick={()=>void run(()=>open(c))}><GymPreview doc={c.doc}/></button><div className="gym-card-body"><h3>{c.name}</h3><p>{c.gym?.client||(c.gym?.type==='commercial'?'Commercial gym':'Home gym')} · {area(c)}</p><small>Edited {date(c)}</small><div className="gym-card-actions"><button disabled={busy} onClick={()=>void run(()=>open(c))}>Open →</button><details><summary aria-label={`Actions for ${c.name}`}>•••</summary><div><button disabled={busy} onClick={()=>{setRename(c);setNewName(c.name);}}>Rename</button><button disabled={busy} onClick={()=>void run(async()=>{const now=Date.now();const copy={...structuredClone(c),id:crypto.randomUUID(),name:`${c.name} copy`,...(c.gym?{gym:{...c.gym,createdAt:now,updatedAt:now}}:{})};await update(current=>({...current,configs:[...current.configs,copy]}));})}>Duplicate</button><button disabled={busy} onClick={()=>void run(async()=>{await update(current=>({...current,configs:current.configs.filter(x=>x.id!==c.id),activeId:current.activeId===c.id?null:current.activeId}));setDeleted(c);})}>Delete</button></div></details></div></div></article>)}<button className="new-gym-card" disabled={busy} onClick={()=>setWizard(true)}><span>+</span><strong>Create a new gym</strong><small>Start with your space</small></button></div>{!filtered.length&&query&&<p>No designs match “{query}”.</p>}
      </>}
      {collection?.draft&&<div className="dashboard-notice">You have an unsaved builder draft.<button disabled={busy} onClick={()=>void navigate({to:'/builder',search:{recover:true} as never})}>Recover draft →</button></div>}
      <footer className="studio-footer">{account.session ? 'Your designs save locally and sync to your private cloud workspace.' : 'Your designs are stored in this browser. Sign in to save across devices.'} Export a JSON copy from the builder to keep a backup.</footer>
    </main>{wizard&&<Wizard close={()=>setWizard(false)} create={create} busy={busy}/>}
    {rename&&<dialog className="gym-wizard rename-dialog" ref={renameDialog} onCancel={()=>setRename(null)}><form onSubmit={e=>{e.preventDefault();void run(async()=>{if(!newName.trim())throw Error('Enter a name.');await update(c=>({...c,configs:c.configs.map(d=>d.id===rename.id?{...d,name:newName.trim(),...(d.gym?{gym:{...d.gym,updatedAt:Date.now()}}:{})}:d)}));setRename(null);});}}><h2>Rename gym</h2><label>Gym name<input autoFocus value={newName} maxLength={120} onChange={e=>setNewName(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<footer className="wizard-footer"><button type="button" disabled={busy} className="secondary" onClick={()=>setRename(null)}>Cancel</button><button disabled={busy} className="primary">Save name</button></footer></form></dialog>}
  </div>;
}
