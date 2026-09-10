import { it, expect } from 'vitest';
import * as THREE from 'three';
import type { PlanetSceneView } from '@shared/types';
import { createLocalSurface, createTerrainRelief } from './local-surface';
import { normalTile, tileNormal } from './projection';

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

it('raises only explored rock cells, leaving buildable, water and uncharted cells on the sphere', () => {
  const planet: PlanetSceneView = {
    planet_id: 'p', discovered: true, tick: 1, map_width: 4, map_height: 4,
    bounds: { x: 0, y: 0, width: 4, height: 4 },
    terrain: [['buildable', 'buildable', 'buildable', 'buildable'], ['buildable', 'blocked', 'water', 'buildable'], ['buildable', 'buildable', 'blocked', 'buildable'], ['buildable', 'buildable', 'buildable', 'buildable']],
    explored: [[true, true, true, true], [true, true, true, true], [true, true, false, true], [true, true, true, true]],
  };
  const mesh = createTerrainRelief({ planet }, 100)!;
  expect(mesh).not.toBeNull();
  const positions = mesh.geometry.getAttribute('position');
  let raised = 0, boundary = 0;
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    if (point.length() > 100.0001) {
      expect(normalTile(point.clone().normalize(), 4, 4)).toEqual({ x: 1, y: 1 });
      raised++;
    } else {
      expect(Math.abs(point.length() - 100)).toBeLessThan(0.00002);
      boundary++;
    }
  }
  expect(raised).toBeGreaterThan(0);
  expect(boundary).toBeGreaterThan(0);
  const direction = tileNormal({ x: 1, y: 1 }, 4, 4);
  expect(new THREE.Raycaster(direction.clone().multiplyScalar(200), direction.negate()).intersectObject(mesh)).toHaveLength(0);
  mesh.geometry.dispose(); mesh.material.dispose();
});

it('does not place raised terrain beneath authoritative resource entities', () => {
  const planet: PlanetSceneView = {
    planet_id: 'p', discovered: true, tick: 1, map_width: 4, map_height: 4,
    bounds: { x: 1, y: 1, width: 1, height: 1 }, terrain: [['blocked']], explored: [[true]],
    resources: [{ id: 'ore', planet_id: 'p', kind: 'iron_ore', behavior: 'finite', position: { x: 1, y: 1, z: 0 } }],
  };
  expect(createTerrainRelief({ planet }, 100)).toBeNull();
});
