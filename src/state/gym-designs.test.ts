import test from 'node:test';
import assert from 'node:assert/strict';
import { createGym, createGymFromTemplate, type GymSetup } from './gym-designs.ts';
import { CONFIG_KEY, LocalConfigStorage, type StorageLike } from './config-storage.ts';
import { BuilderStore } from './builder-store.ts';
import { resolveAssembly } from '../../rack-generator/assembly.ts';
import { addFloorItem } from '../../rack-generator/floor-items.ts';
import { WorkspaceCache } from './workspace-storage.ts';
const setup:GymSetup={name:' Garage ',type:'home',client:'',width:6000,length:5000,height:3000,starter:'empty'};
test('template copy saves independently, autosaves edits, and preserves the existing draft', async () => {
  const memory = new Memory(), repo = new LocalConfigStorage(memory);
  const original = createGym(setup, 'original', 100);
  const draft = createGym({...setup, starter:'strength'}, 'draft', 101).doc;
  await repo.write({configs:[original], activeId:original.id, draft});
  const template = createGymFromTemplate(draft, ' My template gym ', 'copy', 200);
  const before = await repo.read();
  await repo.write({...before, configs:[...before.configs, template], activeId:template.id});
  template.doc.room!.height = 4000;
  assert.equal(draft.room!.height, 3000);
  const store = new BuilderStore(memory, 'copy'); await store.ready;
  store.commit(addFloorItem(store.getSnapshot().doc, 'rep-fb-5000', [0,0])); await store.flushStorage();
  const after = await repo.read();
  assert.equal(after.configs.find(c => c.id === 'copy')?.name, 'My template gym');
  assert.equal(after.configs.find(c => c.id === 'copy')?.doc.floorItems?.length, 3);
  assert.deepEqual(after.configs.find(c => c.id === 'original'), original);
  assert.deepEqual(after.draft, draft);
  assert.throws(() => createGymFromTemplate(draft, ' '), /name/);
});
class Memory implements StorageLike {values=new Map<string,string>();getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);}}
test('the builder uses an account cache as browser storage and queues cloud changes', async () => {
  const memory = new Memory(), cache = new WorkspaceCache(memory, 'account');
  const repo = new LocalConfigStorage(cache), gym = createGym(setup, 'account-gym', 123);
  await repo.write({ configs: [gym], activeId: gym.id, draft: null });
  const store = new BuilderStore(cache); await store.ready;
  assert.equal(store.getSnapshot().activeId, gym.id);
  store.commit(addFloorItem(store.getSnapshot().doc, 'rep-fb-5000')); await store.flushStorage();
  assert.equal((await repo.read()).configs[0].doc.floorItems?.length, 1);
  assert.equal(cache.read().pending, true);
  assert.equal(memory.getItem(CONFIG_KEY), null);
});
test('empty gym is a real empty room and strength starter has equipment',()=>{
  const c=createGym(setup,'gym',123);
  assert.equal(c.name,'Garage');assert.equal(c.doc.room?.left,3000);assert.equal(c.doc.room?.front,2500);
  assert.equal(resolveAssembly(c.doc).length,0);
  const s=createGym({...setup,starter:'strength'},'strength',123);
  assert.equal(s.doc.floorItems?.length,2);assert.ok(resolveAssembly(s.doc).some(i=>i.part==='upright'));
});
test('dimensions, starter fit, and names are validated before saving',()=>{
  for(const change of [{name:' '},{width:NaN},{length:1199},{height:2000},{width:31000}]) assert.throws(()=>createGym({...setup,...change}));
  assert.throws(()=>createGym({...setup,starter:'strength',width:3000}),/4 × 4/);
  assert.equal(createGym({...setup,width:4*304.8,length:4*304.8,height:8*304.8}).doc.room?.height,2438.4);
});
test('gym metadata survives storage, autosave, named saving and duplicate',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),gym=createGym(setup,'gym',123);
  await repo.write({configs:[gym],activeId:gym.id,draft:null});
  const store=new BuilderStore(memory);await store.ready;
  store.commit(addFloorItem(store.getSnapshot().doc,'rep-fb-5000',[1000,0]));
  await store.flushStorage();
  const saved=await repo.read();assert.equal(saved.configs[0].doc.floorItems?.length,1);assert.ok(saved.configs[0].gym!.updatedAt>123);assert.equal(store.getSnapshot().dirty,false);assert.equal(saved.draft,null);
  await store.save('Renamed');assert.equal((await repo.read()).configs[0].gym?.createdAt,123);
  await store.save('Copy',true);const copies=(await repo.read()).configs;assert.equal(copies.length,2);assert.ok(copies.find(c=>c.name==='Copy')?.gym);
});
test('a direct design link loads that gym and switching saves the previous one',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),a=createGym(setup,'a',123),b=createGym({...setup,name:'Other'},'b',124);
  await repo.write({configs:[a,b],activeId:'b',draft:null});
  const store=new BuilderStore(memory,'a');await store.ready;assert.equal(store.getSnapshot().activeId,'a');
  store.commit(addFloorItem(store.getSnapshot().doc,'rep-fb-5000',[0,0]));await store.load('b');
  assert.equal((await repo.read()).configs.find(c=>c.id==='a')?.doc.floorItems?.length,1);assert.equal(store.getSnapshot().doc.floorItems?.length??0,0);
});
test('failed autosave keeps edits dirty and saved gym unchanged',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),a=createGym(setup,'a',123);await repo.write({configs:[a],activeId:'a',draft:null});
  const store=new BuilderStore(memory);await store.ready;memory.setItem=()=>{throw Error('Full');};
  store.commit(addFloorItem(store.getSnapshot().doc,'rep-fb-5000'));await store.flushStorage();
  assert.equal(store.getSnapshot().dirty,true);assert.ok(store.getSnapshot().storageError);assert.equal((await repo.read()).configs[0].doc.floorItems?.length??0,0);
});
test('new gym autosave preserves a legacy draft and recovery does not replace the gym',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),a=createGym(setup,'a',123),draft=createGym({...setup,starter:'strength'},'draft',124).doc;
  await repo.write({configs:[a],activeId:'a',draft});
  const store=new BuilderStore(memory);await store.ready;
  store.commit(addFloorItem(store.getSnapshot().doc,'rep-fb-5000',[0,0]));await store.flushStorage();
  assert.deepEqual((await repo.read()).draft,draft);
  await store.save('Saved gym');assert.deepEqual((await repo.read()).draft,draft);
  store.recoverDraft();await store.flushStorage();assert.equal(store.getSnapshot().activeId,null);
  assert.equal((await repo.read()).configs[0].doc.floorItems?.length,1);
});
test('legacy configurations remain readable and malformed metadata is rejected',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),a=createGym(setup,'a',123);
  delete a.gym;await repo.write({configs:[a],activeId:'a',draft:null});assert.equal((await repo.read()).configs[0].gym,undefined);
  memory.setItem(CONFIG_KEY,JSON.stringify({version:2,configs:[{...a,gym:{type:'other'}}],draft:null}));await assert.rejects(repo.read(),/gym details/);
});
test('pagehide persists the latest gym immediately without awaiting a promise',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),a=createGym(setup,'a',123);
  await repo.write({configs:[a],activeId:'a',draft:null});
  const globals=globalThis as {window?:unknown;document?:unknown};
  const previous={window:globals.window,document:globals.document};
  const events=new EventTarget();globals.window=events;globals.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
  try {
    const store=new BuilderStore(memory,undefined,false);await store.ready;const detach=store.watchLifecycle();
    store.beginGesture();store.commit(addFloorItem(store.getSnapshot().doc,'rep-fb-5000',[0,0]));
    events.dispatchEvent(new Event('pagehide'));
    const immediate=JSON.parse(memory.getItem(CONFIG_KEY)!);
    assert.equal(immediate.configs[0].doc.floorItems.length,1);
    assert.equal(immediate.configs[0].timeline.applied,1);
    store.endGesture();await store.flushStorage();detach();
  }finally{globals.window=previous.window;globals.document=previous.document;}
});
test('retry persists failed changes and clears the error without requiring a new edit',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),a=createGym(setup,'a',123);
  await repo.write({configs:[a],activeId:'a',draft:null});
  const store=new BuilderStore(memory);await store.ready;
  const persist=memory.setItem.bind(memory);memory.setItem=()=>{throw Error('Full');};
  store.commit(addFloorItem(store.getSnapshot().doc,'rep-fb-5000',[0,0]));await store.flushStorage();
  assert.equal(store.getSnapshot().dirty,true);assert.ok(store.getSnapshot().storageError);
  memory.setItem=persist;await store.retryStorage();
  assert.equal((await repo.read()).configs[0].doc.floorItems?.length,1);
  assert.equal(store.getSnapshot().dirty,false);assert.equal(store.getSnapshot().storageError,null);
});
test('retrying an unchanged gym does not clear an unrelated recovery draft',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),a=createGym(setup,'a',123),draft=createGym({...setup,starter:'strength'},'draft',123).doc;
  await repo.write({configs:[a],activeId:'a',draft});
  const store=new BuilderStore(memory);await store.ready;await store.retryStorage();
  assert.deepEqual((await repo.read()).draft,draft);
});
test('a saved draft can become an autosaving dashboard gym',async()=>{
  const memory=new Memory(),repo=new LocalConfigStorage(memory),store=new BuilderStore(memory);await store.ready;
  store.commit(createGym(setup,'temp',123).doc);await store.flushStorage();
  assert.equal(store.getSnapshot().draftSaved,true);
  await store.saveGym('Recovered gym');assert.equal(store.getSnapshot().configs[0].gym?.type,'home');
  store.commit(addFloorItem(store.getSnapshot().doc,'rep-fb-5000',[0,0]));await store.flushStorage();
  const c=(await repo.read()).configs[0];assert.equal(c.name,'Recovered gym');assert.equal(c.doc.floorItems?.length,1);assert.equal(store.getSnapshot().dirty,false);
});
