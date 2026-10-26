import test from 'node:test';
import assert from 'node:assert/strict';
import { BuilderStore } from './builder-store.ts';
import { LocalConfigStorage, CONFIG_KEY } from './config-storage.ts';
import { createGym } from './gym-designs.ts';
import { roomsOf, projectArea } from './space-projects.ts';
import { FURNITURE_PRESETS, furniturePreset } from './furniture-presets.ts';
import { addFloorItem, floorBounds } from '../../rack-generator/floor-items.ts';
import { validateFloorParams } from '../../rack-generator/floor-part.ts';
import { floorPart } from '../../rack-generator/floor-registry.ts';
import { resolveAssembly } from '../../rack-generator/assembly.ts';
function memory() {const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};}
const setup={name:'Apartment',type:'home' as const,projectType:'apartment' as const,client:'',width:6000,length:5000,height:2700,starter:'living' as const};
test('home, apartment, and gym starters are valid models with independent room metadata',()=>{
  for (const projectType of ['home','apartment','gym'] as const) for (const starter of projectType==='gym'?['empty','strength'] as const:['empty','living','bedroom','office'] as const) {
    const p=createGym({...setup,projectType,starter});assert.equal(p.projectType,projectType);assert.equal(p.rooms?.length,1);assert.equal(projectArea(p),30);
    assert.ok(resolveAssembly(p.doc).length>0||starter==='empty');
  }
  for(const f of FURNITURE_PRESETS){const p=furniturePreset(f.id);validateFloorParams(floorPart(p.part)!,p.params);assert.ok(resolveAssembly(addFloorItem(createGym({...setup,starter:'empty'}).doc,p.part,[0,0],false,p.params)).length>0);}
});
test('room switching checkpoints furniture, dimensions, and independent undo histories across reload and duplication',async()=>{
  const m=memory(),repo=new LocalConfigStorage(m),project=createGym({...setup,starter:'empty'},'p');await repo.write({configs:[project],activeId:'p',draft:null});
  const store=new BuilderStore(m,'p');await store.ready;
  const table=furniturePreset('table');store.commit(addFloorItem(store.getSnapshot().doc,table.part,[0,0],false,table.params));
  await store.addProjectRoom('Bedroom',4000,4000,2700);
  const saved=(await repo.read()).configs[0], bedroom=saved.activeRoomId!;
  assert.equal(saved.rooms?.[0].doc.floorItems?.length,1);assert.equal(saved.doc.floorItems?.length??0,0);
  store.setRoom({height:2800});await store.switchRoom('main');assert.equal(store.getSnapshot().doc.room?.height,2700);assert.equal(store.getSnapshot().doc.floorItems?.length,1);
  store.history('undo');assert.equal(store.getSnapshot().doc.floorItems?.length??0,0);store.history('redo');await store.switchRoom(bedroom);assert.equal(store.getSnapshot().doc.room?.height,2800);
  await store.save('Apartment copy',true);const copyId=store.getSnapshot().activeId!;await store.flushStorage();
  const reopened=new BuilderStore(m,copyId);await reopened.ready;await reopened.switchRoom('main');assert.equal(reopened.getSnapshot().doc.floorItems?.length,1);
  const final=await repo.read();assert.equal(final.configs.length,2);assert.equal(roomsOf(final.configs[0]).length,2);assert.equal(projectArea(final.configs[0]),46);
});
test('legacy gyms gain rooms without losing equipment; removed rooms can be restored',async()=>{
  const m=memory(),repo=new LocalConfigStorage(m),p=createGym({...setup,projectType:undefined},'legacy');await repo.write({configs:[p],activeId:p.id,draft:null});
  const store=new BuilderStore(m,p.id);await store.ready;await store.addProjectRoom('Office',4000,4000,2700);
  const room=(await repo.read()).configs[0].rooms!.at(-1)!;
  await store.removeProjectRoom(room.id);assert.equal((await repo.read()).configs[0].rooms?.length,1);
  await store.restoreProjectRoom(room);assert.equal((await repo.read()).configs[0].rooms?.length,2);
  assert.equal((await repo.read()).configs[0].rooms![0].doc.floorItems?.length,3);
  await store.removeProjectRoom(room.id);await assert.rejects(store.removeProjectRoom('main'),/at least one/);
});
test('invalid project rooms are rejected without accepting unbounded positions or duplicate identifiers',async()=>{
  const m=memory(),repo=new LocalConfigStorage(m),p=createGym(setup,'p');
  for (const rooms of [[],[...p.rooms!,...p.rooms!],[{...p.rooms![0],position:[Infinity,0]}],[{...p.rooms![0],name:''}]]) {
    m.setItem(CONFIG_KEY,JSON.stringify({version:2,configs:[{...p,rooms}],draft:null}));await assert.rejects(repo.read());
  }
});

test('a legacy saved configuration retains current unsaved edits when upgraded to rooms',async()=>{
  const m=memory(),repo=new LocalConfigStorage(m),p=createGym({...setup,projectType:undefined,starter:'empty'},'old');delete p.gym;
  await repo.write({configs:[p],activeId:p.id,draft:null});const store=new BuilderStore(m,p.id);await store.ready;
  const item=furniturePreset('chair');store.commit(addFloorItem(store.getSnapshot().doc,item.part,[0,0],false,item.params));
  await store.addProjectRoom('Office',4000,4000,2700);await store.switchRoom('main');assert.equal(store.getSnapshot().doc.floorItems?.length,1);
  store.setRoom({height:2900});await store.switchRoom((await repo.read()).configs[0].rooms![1].id);await store.switchRoom('main');assert.equal(store.getSnapshot().doc.room?.height,2900);
});

test('the suggested furniture placement fits within a small room before confirmation',async()=>{
  const m=memory(),repo=new LocalConfigStorage(m),p=createGym({...setup,width:4000,length:4000,starter:'empty'},'small');await repo.write({configs:[p],activeId:p.id,draft:null});
  const store=new BuilderStore(m,p.id);await store.ready;const bed=furniturePreset('bed');store.patch({definitions:[{id:bed.part,name:'Bed',category:'Furniture',defaults:bed.defaults}]});assert.equal(store.startCustomPlacement(bed),true);
  const item=store.getSnapshot().proposal!.doc.floorItems!.at(-1)!, bounds=floorBounds(item);
  assert.ok(bounds.min[0]>=-2000&&bounds.min[1]>=-2000&&bounds.max[0]<=2000&&bounds.max[1]<=2000);
});
