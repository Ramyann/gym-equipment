import { decodeComponents, encodeComponents, SHAPES, MAX_COMPONENTS } from '../../rack-generator/floor-parts/generated-model.ts';
import type { NumericParams } from '../../rack-generator/types.ts';
import './component-editor.css';
export function ComponentEditor({ params, onChange }: { params: NumericParams; onChange: (params: NumericParams) => void }) {
  let components;
  try { components = decodeComponents(params); } catch { return <p role="alert">Invalid components. Reset the item or load a saved copy.</p>; }
  function field(key: string, value: number) { if (Number.isFinite(value)) onChange({ ...params, [key]: Math.round(value) }); }
  return <section className="component-editor" aria-label="Component editor"><h3>Build your item</h3><p>Use shapes to model furniture, appliances, or equipment. Positions and sizes are in millimeters.</p>
    {components.map((c,i) => <details key={i}><summary>Component {i+1} · {c.shape}</summary><label>Shape<select aria-label={`Component ${i+1} shape`} value={params[`c${i}_kind`]} onChange={e=>field(`c${i}_kind`,Number(e.target.value))}>{SHAPES.map((s,j)=><option key={s} value={j}>{s}</option>)}</select></label><label>Color<input type="color" aria-label={`Component ${i+1} color`} value={'#'+c.color.toString(16).padStart(6,'0')} onChange={e=>field(`c${i}_color`,parseInt(e.target.value.slice(1),16))}/></label>
      {(['sx','sy','sz','x','y','z','rx','ry','rz'] as const).map((k,j)=><label key={k}>{['Length','Depth','Height','Position X','Position Y','Position Z','Rotate X','Rotate Y','Rotate Z'][j]}<input aria-label={`Component ${i+1} ${k}`} type="number" step="1" min={k.startsWith('s')?1:k.startsWith('r')?-180:-10000} max={k.startsWith('r')?180:10000} value={params[`c${i}_${k}`]} onChange={e=>field(`c${i}_${k}`,Number(e.target.value))}/></label>)}
      <button type="button" disabled={components.length===1} onClick={()=>{const next=components.filter((_,j)=>j!==i);const {length,width,height}=params;onChange({length,width,height,...encodeComponents(next)});}}>Remove component</button></details>)}
    <button type="button" disabled={components.length>=MAX_COMPONENTS} onClick={()=>onChange({ ...params, ...encodeComponents([...components,{name:'New component',shape:'box',position:[0,0,200],size:[200,200,400],rotation:[0,0,0],color:0xc49a6c}]) })}>+ Add shape</button>
  </section>;
}
