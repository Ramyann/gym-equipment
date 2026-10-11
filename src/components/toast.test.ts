import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuilderStore } from '../state/builder-store.ts';
import { ToastStore, withUndo, withCheckpoint } from './Toast/toast-store.ts';
import { resizeAssembly } from '../../rack-generator/assembly.ts';
import { LocalConfigStorage } from '../state/config-storage.ts';
import { recoverDraftWithUndo } from './Toast/undo-actions.ts';
import { toasts as sharedToasts } from './Toast/toast-store.ts';

const setup = () => ({ store: new BuilderStore(), toasts: new ToastStore() });

test('a removal toasts once with an Undo that steps history back and closes the toast', () => {
  const { store, toasts } = setup();
  const before = store.getSnapshot().doc;
  store.select('jhooks-front');
  const id = withUndo(store, 'Deleted Standard J-hook', () => store.removeSelected(), toasts);
  assert.ok(id);
  const [toast] = toasts.getSnapshot();
  assert.equal(toast.message, 'Deleted Standard J-hook');
  assert.equal(toast.undoLabel, 'Undo deleted standard j-hook');
  assert.notEqual(toast.undoLabel, 'Undo', 'never clashes with the toolbar Undo button');
  toast.undo!();
  assert.deepEqual(store.getSnapshot().doc, before);
  assert.equal(toasts.getSnapshot().length, 0);
});

test('no toast when the action changed nothing', () => {
  const { store, toasts } = setup();
  assert.equal(withUndo(store, 'Deleted', () => store.removeSelected(), toasts), null);
  assert.equal(toasts.getSnapshot().length, 0);
});

test('any later history change dismisses the toast so Undo cannot revert something else', () => {
  const { store, toasts } = setup();
  store.select('jhooks-front');
  withUndo(store, 'Deleted', () => store.removeSelected(), toasts);
  assert.equal(toasts.getSnapshot().length, 1);
  store.status('Unrelated status');
  assert.equal(toasts.getSnapshot().length, 1, 'status churn keeps it');
  store.commit(resizeAssembly(store.getSnapshot().doc, { width: 725 }));
  assert.equal(toasts.getSnapshot().length, 0);

  withUndo(store, 'Resized', () => store.commit(resizeAssembly(store.getSnapshot().doc, { width: 1075 })), toasts);
  store.history('undo');
  assert.equal(toasts.getSnapshot().length, 0, 'the toolbar Undo also closes it');
});

test('clearing history is undone from a checkpoint: document, timeline and redo come back', async () => {
  const { store, toasts } = setup();
  store.commit(resizeAssembly(store.getSnapshot().doc, { width: 725 }));
  store.commit(resizeAssembly(store.getSnapshot().doc, { width: 1075 }));
  const timeline = store.getSnapshot().timeline;
  await withCheckpoint(store, 'History cleared', () => store.clearHistory(), toasts);
  assert.equal(store.getSnapshot().canUndo, false);
  toasts.getSnapshot()[0].undo!();
  assert.equal(store.getSnapshot().timeline.latest, timeline.latest);
  assert.equal(store.getSnapshot().canUndo, true);
  store.history('undo');
  assert.equal(store.getSnapshot().doc.rack.width, 725);
});

test('toasts are capped, and dismiss is idempotent', () => {
  const toasts = new ToastStore();
  const ids = [1, 2, 3, 4].map(n => toasts.show({ message: `t${n}` }));
  assert.deepEqual(toasts.getSnapshot().map(t => t.message), ['t2', 't3', 't4']);
  toasts.dismiss(ids[3]); toasts.dismiss(ids[3]);
  assert.deepEqual(toasts.getSnapshot().map(t => t.message), ['t2', 't3']);
});
test('recovering a draft offers Undo restoring the previous gym and its history',async()=>{
  const values=new Map<string,string>();
  const memory={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
  const repo=new LocalConfigStorage(memory),original=new BuilderStore(memory);await original.ready;
  await original.saveGym('Current gym');
  original.commit(resizeAssembly(original.getSnapshot().doc,{width:725}));await original.flushStorage();
  const before=original.checkpoint();
  const collection=await repo.read();await repo.write({...collection,draft:resizeAssembly(before.doc,{width:425}),draftTimeline:undefined});
  const store=new BuilderStore(memory);await store.ready;
  sharedToasts.clear();await recoverDraftWithUndo(store);
  assert.equal(store.getSnapshot().doc.rack.width,425);
  assert.equal(store.getSnapshot().activeId,null);
  sharedToasts.getSnapshot()[0].undo!();
  assert.deepEqual(store.getSnapshot().doc,before.doc);
  assert.equal(store.getSnapshot().activeId,before.activeId);
  assert.equal(store.getSnapshot().canUndo,true);
  await store.flushStorage();sharedToasts.clear();
});
