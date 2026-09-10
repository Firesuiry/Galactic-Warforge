import * as THREE from 'three';
import { getBuildingFootprint, getFogState, type PlanetRenderView } from '../model';
import { tileNormal } from './projection';
import type { PlanetSurfaceData } from './terrain';

const RELIEF_TERRAINS = new Set(['blocked', 'rock', 'mountain', 'mountains']);

function reliefNoise(x: number, y: number) {
  const cell = (a: number, b: number) => {
    let n = Math.imul(a + 731, 374761393) ^ Math.imul(b + 977, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(cell(ix, iy), cell(ix + 1, iy), sx), THREE.MathUtils.lerp(cell(ix, iy + 1), cell(ix + 1, iy + 1), sx), sy);
}

/** Curved, low relief exists only inside authoritative explored non-buildable rock cells.
 * All cell borders stay on the mathematical sphere; adjacent construction stays level.
 */
export function createTerrainRelief({ planet, fog }: PlanetSurfaceData, radius: number) {
  if (!planet.terrain?.length) return null;
  const b = 'bounds' in planet ? planet.bounds : { x: 0, y: 0 };
  const visibility = fog ?? ('bounds' in planet ? planet : undefined);
  const occupied = new Set<string>();
  for (const building of Object.values(planet.buildings ?? {})) {
    const footprint = getBuildingFootprint(building);
    for (let y = 0; y < footprint.height; y++) for (let x = 0; x < footprint.width; x++) occupied.add(`${Math.round(building.position.x) + x}:${Math.round(building.position.y) + y}`);
  }
  for (const entity of [...Object.values(planet.units ?? {}), ...(planet.resources ?? [])]) occupied.add(`${Math.round(entity.position.x)}:${Math.round(entity.position.y)}`);
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < planet.terrain.length; row++) for (let col = 0; col < planet.terrain[row].length; col++) {
    if (!RELIEF_TERRAINS.has(planet.terrain[row][col])) continue;
    const x = b.x + col, y = b.y + row;
    if (occupied.has(`${x}:${y}`)) continue;
    if (visibility && !getFogState(visibility, x, y).explored) continue;
    cells.push({ x, y });
  }
  if (!cells.length) return null;
  // Bound decorative geometry even for an unusually large explored scene.
  const cellStride = Math.max(1, Math.ceil(cells.length / 10000));
  const subdivisions = Math.max(2, Math.min(14, Math.floor(Math.sqrt(100000 / Math.ceil(cells.length / cellStride))) - 1));
  const positions: number[] = [], colors: number[] = [], opacity: number[] = [], indices: number[] = [];
  const low = new THREE.Color('#737a6d'), high = new THREE.Color('#a7a99a');
  const ridge = new THREE.Color('#566054');
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += cellStride) {
    const cell = cells[cellIndex];
    const start = positions.length / 3;
    const center = tileNormal(cell, planet.map_width, planet.map_height);
    const latitudeRadius = Math.sqrt(Math.max(0.0025, 1 - center.y * center.y));
    const tileSize = Math.min(2 * Math.PI * radius / planet.map_width * latitudeRadius, 2 * radius / planet.map_height / latitudeRadius);
    for (let y = 0; y <= subdivisions; y++) for (let x = 0; x <= subdivisions; x++) {
      const u = x / subdivisions, v = y / subdivisions;
      const tx = cell.x + u - 0.5, ty = cell.y + v - 0.5;
      const normal = tileNormal({ x: tx, y: ty }, planet.map_width, planet.map_height);
      // Irregular rocky ridges taper into the existing terrain, with no raised
      // platform or hard material rectangle at the tile boundary.
      const edge = Math.min(u, v, 1 - u, 1 - v);
      const envelope = Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * v), 1.7);
      const broad = reliefNoise(tx * 2.1, ty * 2.1);
      const detail = Math.abs(reliefNoise(tx * 7.3, ty * 7.3) * 2 - 1);
      const elevation = tileSize * envelope * (0.10 + broad * 0.16 + detail * 0.26);
      positions.push(normal.x * (radius + elevation), normal.y * (radius + elevation), normal.z * (radius + elevation));
      const color = low.clone().lerp(high, Math.min(1, envelope * (0.35 + broad * 0.4))).lerp(ridge, detail * 0.28);
      colors.push(color.r, color.g, color.b);
      opacity.push(THREE.MathUtils.smoothstep(edge, 0.015, 0.18));
    }
    for (let y = 0; y < subdivisions; y++) for (let x = 0; x < subdivisions; x++) {
      const a = start + y * (subdivisions + 1) + x, c = a + subdivisions + 1;
      indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('reliefOpacity', new THREE.Float32BufferAttribute(opacity, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.98, metalness: 0.025, transparent: true, flatShading: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float reliefOpacity; varying float vReliefOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReliefOpacity = reliefOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vReliefOpacity;')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= vReliefOpacity; if (diffuseColor.a < 0.015) discard;');
  };
  material.customProgramCacheKey = () => 'rocky-relief-feather-v1';
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'explored-rocky-hills';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Picking remains against the mathematical planet; this is decorative geometry.
  mesh.raycast = () => {};
  return mesh;
}

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
