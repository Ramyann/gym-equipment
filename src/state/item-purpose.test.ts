import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPurpose, matchesPurpose, customPurpose, customFitsProject } from './item-purpose.ts';
import { FURNITURE_PRESETS, furniturePreset } from './furniture-presets.ts';
import { readCustomParts, writeCustomPart, CUSTOM_PARTS_KEY } from './custom-parts-data.ts';
import { buildGalleryItems } from '../components/PartGallery/gallery-model.ts';
test('home and apartment catalogs exclude training and structural equipment, gyms retain it',()=>{
 const items=buildGalleryItems([]);for(const context of ['home','apartment'] as const){const visible=items.filter(p=>matchesPurpose(catalogPurpose(p.id,p.category),context));assert.ok(visible.length);assert.ok(!visible.some(p=>p.kind==='rack'||p.kind==='structure'||p.kind==='system'||['Cardio','Benches','Dumbbells','Barbells','Kettlebells','Machines'].includes(p.category)));}
 for(const id of ['rep-fb-5000','olympic-barbell','upright','template-cardio']){assert.equal(matchesPurpose(catalogPurpose(id),'gym'),true);assert.equal(matchesPurpose(catalogPurpose(id),'home'),false);}
 assert.equal(matchesPurpose(catalogPurpose('decor-interior-door'),'home'),true);
});
test('household starters and classified custom items match the destination project',()=>{
 for(const seed of FURNITURE_PRESETS){const part=furniturePreset(seed.id);assert.equal(customFitsProject(part,'home'),true);assert.equal(customFitsProject(part,'apartment'),true);assert.equal(customFitsProject(part,'gym'),false);}
 assert.equal(customPurpose({part:'template-assembly',name:'AI bookshelf'}),'home');assert.equal(customPurpose({part:'template-assembly',name:'Photo treadmill'}),'gym');assert.equal(customPurpose({part:'template-assembly',name:'Unclassified custom model'}),'any');
 assert.equal(customFitsProject({...furniturePreset('bed'),purpose:'any'},'gym'),true);
});
test('custom purpose persists through editing and invalid classifications are rejected',()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 const bed=furniturePreset('bed');writeCustomPart(storage,bed);writeCustomPart(storage,{...bed,name:'Updated bed',purpose:'any'});assert.equal(readCustomParts(storage)[0].purpose,'any');
 const bad={...bed,purpose:'unknown'};values.set(CUSTOM_PARTS_KEY,JSON.stringify({version:1,parts:[bad]}));assert.throws(()=>readCustomParts(storage),/purpose/);
});
