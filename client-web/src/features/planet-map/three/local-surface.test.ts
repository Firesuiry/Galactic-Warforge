import { it, expect } from 'vitest';
import * as THREE from 'three';
import type { PlanetSceneView } from '@shared/types';
import { createLocalSurface } from './local-surface';
import { tileNormal } from './projection';

it('keeps a 10000² planet near-pole colony grounded within 2% of a tile height', () => {
  const p: PlanetSceneView = { planet_id:'p', discovered:true, tick:1, map_width:10000, map_height:10000, bounds:{x:0,y:0,width:96,height:96} };
  const material = new THREE.MeshStandardMaterial();
  const mesh = createLocalSurface(p,100,material)!;
  for (const tile of [{x:10,y:10},{x:10.25,y:10.25},{x:40.4,y:30.6}]) {
    const normal = tileNormal(tile,10000,10000);
    const ray = new THREE.Raycaster(normal.clone().multiplyScalar(101),normal.clone().negate());
    const hit = ray.intersectObject(mesh)[0];
    expect(hit).toBeDefined();
    const tileSize = 2*Math.PI*100/10000*Math.sqrt(1-normal.y*normal.y);
    expect(Math.abs(hit.point.length()-100)).toBeLessThan(tileSize*.02);
  }
  mesh.geometry.dispose(); material.dispose();
});
