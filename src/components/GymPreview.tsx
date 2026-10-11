import type { RackDoc } from '../../rack-generator/types.ts';
import { ROOM_DEFAULTS } from '../../rack-generator/walls.ts';
import { floorBounds } from '../../rack-generator/floor-items.ts';
export function GymPreview({ doc }: { doc: RackDoc }) {
  const r = doc.room ?? ROOM_DEFAULTS, w = r.left + r.right, h = r.back + r.front, pad = Math.max(w, h) * .09;
  return <svg className="gym-preview" viewBox={`${-r.left-pad} ${-r.back-pad} ${w+2*pad} ${h+2*pad}`} role="img" aria-label="Top-down preview of your gym">
    <rect x={-r.left} y={-r.back} width={w} height={h} fill="#e8ede4" stroke="#7f9284" strokeWidth={Math.max(w,h)*.012} />
    {Array.from({length: 9}, (_, i) => <path key={i} d={`M ${-r.left+w*(i+1)/10} ${-r.back} v ${h} M ${-r.left} ${-r.back+h*(i+1)/10} h ${w}`} stroke="#d5dfd2" strokeWidth={Math.max(w,h)*.0015} />)}
    {doc.connections.filter(e=>!doc.removed.includes(e.id)&&!doc.removed.includes(e.from)&&!doc.removed.includes(e.to)).map(e=><line key={e.id} x1={doc.uprights[e.from].x} y1={-doc.uprights[e.from].y} x2={doc.uprights[e.to].x} y2={-doc.uprights[e.to].y} stroke="#425e4b" strokeWidth={doc.rack.tube} />)}
    {Object.entries(doc.uprights).filter(([id])=>!doc.removed.includes(id)).map(([id,p])=><rect key={id} x={p.x-doc.rack.tube} y={-p.y-doc.rack.tube} width={doc.rack.tube*2} height={doc.rack.tube*2} fill="#253c2c" />)}
    {(doc.floorItems??[]).map(item=>{const b=floorBounds(item);return <rect key={item.id} x={b.min[0]} y={b.min[1]} width={b.max[0]-b.min[0]} height={b.max[1]-b.min[1]} rx={70} fill="#a1b39a" stroke="#52694f" strokeWidth={20}><title>{item.part}</title></rect>;})}
    {(doc.wallItems??[]).length > 0 && <text x={-r.left+100} y={-r.back+250} fontSize={180} fill="#425e4b">Wall equipment: {doc.wallItems!.length}</text>}
  </svg>;
}
