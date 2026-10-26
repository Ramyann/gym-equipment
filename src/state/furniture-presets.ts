import { encodeComponents, TEMPLATE_ASSEMBLY, type ModelComponent } from '../../rack-generator/floor-parts/generated-model.ts';
import type { CustomPart } from './custom-parts-data.ts';
const wood = 0xc49a6c, fabric = 0x9ca99b;
const box = (name: string, position: [number,number,number], size: [number,number,number], color = wood): ModelComponent => ({ name, position, size, color, shape: 'box', rotation: [0,0,0] });
const legs = (w: number, d: number, h: number) => [-1,1].flatMap(x => [-1,1].map(y => box('Leg', [x*(w/2-45),y*(d/2-45),h/2],[50,50,h])));
export const FURNITURE_PRESETS = [
  { id:'table', name:'Dining table', category:'Furniture', size:[1600,800,750], components:[box('Tabletop',[0,0,730],[1600,800,40]),...legs(1500,700,710)] },
  { id:'chair', name:'Dining chair', category:'Furniture', size:[450,500,900], components:[box('Seat',[0,0,440],[450,500,40]),...legs(450,500,420),box('Backrest',[0,225,700],[450,40,400])] },
  { id:'sofa', name:'Two-seat sofa', category:'Furniture', size:[1800,850,850], components:[box('Base',[0,0,220],[1800,850,260],fabric),box('Seat',[0,-70,400],[1550,670,150],fabric),box('Back',[0,330,640],[1800,190,420],fabric),box('Left arm',[-825,0,550],[150,850,280],fabric),box('Right arm',[825,0,550],[150,850,280],fabric),...legs(1700,750,90)] },
  { id:'bed', name:'Double bed', category:'Furniture', size:[1600,2100,1000], components:[box('Frame',[0,0,200],[1600,2100,300]),box('Mattress',[0,50,450],[1500,2000,200],0xf0ece5),box('Headboard',[0,-1020,650],[1600,60,700]),box('Pillow',[-370,-680,585],[600,350,70],0xe2dfd7),box('Pillow',[370,-680,585],[600,350,70],0xe2dfd7)] },
  { id:'bookshelf', name:'Open bookshelf', category:'Storage', size:[800,350,1800], components:[box('Left side',[-390,0,900],[20,350,1800]),box('Right side',[390,0,900],[20,350,1800]),...[10,455,900,1345,1790].map(z=>box('Shelf',[0,0,z],[760,350,20]))] },
  { id:'wardrobe', name:'Wardrobe', category:'Storage', size:[1200,600,2100], components:[box('Left side',[-590,0,1050],[20,600,2100]),box('Right side',[590,0,1050],[20,600,2100]),box('Back',[0,290,1050],[1160,20,2100]),box('Top',[0,0,2090],[1160,600,20]),box('Base',[0,0,10],[1160,600,20]),box('Left door',[-295,-290,1050],[580,20,2060]),box('Right door',[295,-290,1050],[580,20,2060])] },
  { id:'fridge', name:'Refrigerator', category:'Appliances', size:[700,700,1800], components:[box('Body',[0,0,900],[700,650,1800],0xe2e5e4),box('Fridge door',[0,-340,1070],[690,30,1420],0xc3cac9),box('Freezer door',[0,-340,170],[690,30,320],0xc3cac9),box('Handle',[-260,-375,1170],[25,35,400],0x545c5b)] },
  { id:'lamp', name:'Floor lamp', category:'Lighting', size:[400,400,1700], components:[box('Base',[0,0,20],[350,350,40],0x383d39),box('Stem',[0,0,760],[30,30,1480],0x383d39),box('Shade',[0,0,1560],[400,400,280],0xefe4c8)] },
] as const;
export function furniturePreset(id: string, uid: string = crypto.randomUUID()): CustomPart {
  const seed = FURNITURE_PRESETS.find(s => s.id === id);
  if (!seed) throw Error('Furniture preset not found.');
  const params = { length: seed.size[0], width: seed.size[1], height: seed.size[2], ...encodeComponents([...seed.components]) };
  return { id: uid, purpose: 'home', name: seed.name, part: 'template-assembly', params, defaults: { ...TEMPLATE_ASSEMBLY.defaults } };
}
