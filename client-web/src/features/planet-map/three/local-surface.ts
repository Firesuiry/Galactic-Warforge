import * as THREE from 'three';
import type { PlanetRenderView } from '../model';
import { tileNormal } from './projection';

/** A curved local mesh keeps the visual ground at the same radius as mathematical picking.
 * A fixed global sphere alone sags by several tile heights on very large worlds.
 * Material is owned by the global surface; this mesh owns only its geometry.
 */
export function createLocalSurface(planet: PlanetRenderView, radius: number, material: THREE.MeshStandardMaterial) {
  if (!('bounds' in planet) || Math.max(planet.map_width, planet.map_height) <= 512) return null;
  const b = planet.bounds;
  const nx = Math.min(320, b.width * 2), ny = Math.min(320, b.height * 2);
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    const normal = tileNormal({ x: b.x - .5 + x / nx * b.width, y: b.y - .5 + y / ny * b.height }, planet.map_width, planet.map_height);
    normals.push(normal.x, normal.y, normal.z);
    positions.push(normal.x * radius, normal.y * radius, normal.z * radius);
  }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = y * (nx + 1) + x, b = a + 1, c = a + nx + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'local-curved-surface'; mesh.receiveShadow = true;
  return mesh;
}
