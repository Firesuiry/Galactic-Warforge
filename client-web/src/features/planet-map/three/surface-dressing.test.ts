import * as THREE from 'three';
import type { PlanetSceneView } from '@shared/types';
import { createSurfaceDressing } from './surface-dressing';

function scene(size: number): PlanetSceneView {
  return {
    planet_id: 'p', discovered: true, kind: 'rocky', tick: 1, map_width: size, map_height: size,
    bounds: { x: 0, y: 0, width: size, height: size },
    terrain: Array.from({ length: size }, () => Array.from({ length: size }, () => 'blocked')),
    explored: Array.from({ length: size }, () => Array.from({ length: size }, () => true)),
  };
}

describe('non-interactive surface dressing', () => {
  it('has no geometry on uncharted terrain', () => {
    const planet = scene(5);
    planet.explored = planet.explored!.map(row => row.map(() => false));
    expect(createSurfaceDressing({ planet }, 100).children).toHaveLength(0);
  });

  it('avoids authoritative occupied tiles and remains deterministic across ticks', () => {
    const planet = scene(8);
    planet.resources = [{ id: 'ore', planet_id: 'p', kind: 'iron_ore', behavior: 'finite', remaining: 10, position: { x: 3, y: 2, z: 0 } }];
    const first = createSurfaceDressing({ planet }, 100).children[0] as THREE.InstancedMesh;
    const second = createSurfaceDressing({ planet: { ...planet, tick: 2 } }, 100).children[0] as THREE.InstancedMesh;
    expect(Array.from(first.instanceMatrix.array)).toEqual(Array.from(second.instanceMatrix.array));
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (let i = 0; i < first.count; i++) {
      first.getMatrixAt(i, matrix);
      point.setFromMatrixPosition(matrix).normalize();
      const x = Math.floor(((Math.atan2(point.z, -point.x) / (Math.PI * 2) + 1) % 1) * 8);
      const y = Math.floor((1 - point.y) * 0.5 * 8);
      expect(`${x}:${y}`).not.toBe('3:2');
    }
  });

  it('bounds GPU instance counts independently of map size', () => {
    const group = createSurfaceDressing({ planet: scene(100) }, 100);
    const count = group.children.reduce((total, mesh) => total + (mesh as THREE.InstancedMesh).count, 0);
    expect(count).toBeGreaterThan(1000);
    expect(count).toBeLessThanOrEqual(4000);
    expect(group.children.length).toBeLessThanOrEqual(2);
  });
});
