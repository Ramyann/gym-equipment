import type { NumericParams, ManifoldAPI, SolidPart } from '../types.ts';
import { decodeComponents } from '../floor-parts/generated-model.ts';
import { kit, finish } from './wall-storage-kit.ts';
export function buildGeneratedModel(api: ManifoldAPI, p: NumericParams): SolidPart[] {
  return kit(api,k => {
    const pieces = decodeComponents(p).map(c => {
      let solid;
      if (c.shape === 'box') solid = k.k(api.Manifold.cube(c.size,true));
      else if (c.shape === 'ellipsoid') solid = k.k(k.k(api.Manifold.sphere(1,24)).scale(c.size.map(v => v/2) as [number,number,number]));
      else {
        solid = k.k(api.Manifold.cylinder(1,1,1,24,true));
        if (c.shape === 'tube') solid = k.cut(solid,[k.k(api.Manifold.cylinder(1.1,.78,.78,24,true))]);
        solid = k.k(solid.scale([c.size[0]/2,c.size[1]/2,c.size[2]]));
      }
      solid = k.k(k.k(solid.rotate(c.rotation)).translate(c.position));
      return {solid,c};
    });
    const boxes = pieces.map(p => p.solid.boundingBox());
    const low = [0,1,2].map(i => Math.min(...boxes.map(b => b.min[i]))), high = [0,1,2].map(i => Math.max(...boxes.map(b => b.max[i])));
    const scale = [p.length,p.width,p.height].map((size,i) => size/(high[i]-low[i])) as [number,number,number];
    for (const {solid,c} of pieces) {
      const at = [-p.length/2,-p.width/2,0] as [number,number,number];
      const fitted = k.k(k.k(k.k(solid.translate(low.map(v => -v) as [number,number,number])).scale(scale)).translate(at));
      k.add(finish(c.name,'source',`#${c.color.toString(16).padStart(6,'0')}`,c.shape==='tube'?.5:0,.7),fitted);
    }
  });
}
