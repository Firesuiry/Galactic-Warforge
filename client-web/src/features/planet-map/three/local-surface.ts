import { surfaceFace, surfaceOffset } from '@shared/surface';
import * as THREE from 'three';
import { getBuildingFootprint, getFogState, type PlanetRenderView } from '../model';
import { tileNormal, surfaceTileSize } from './projection';
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
    for (let y = 0; y < footprint.height; y++) for (let x = 0; x < footprint.width; x++) { const cell=surfaceOffset(building.position,x,y,planet.surface.face_size); occupied.add(`${cell.x}:${cell.y}`); }
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
    const face = surfaceFace(cell, planet.surface.face_size);
    const tileSize = surfaceTileSize(radius, planet.surface.face_size);
    for (let y = 0; y <= subdivisions; y++) for (let x = 0; x <= subdivisions; x++) {
      const u = x / subdivisions, v = y / subdivisions;
      const tx = cell.x + u - 0.5, ty = cell.y + v - 0.5;
      const normal = tileNormal({ x: tx, y: ty }, planet.surface.face_size, face);
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
  if (!('bounds' in planet) || planet.surface.face_size * 3 <= 512) return null;
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const size = planet.surface.face_size;
  for (const b of [planet.bounds, ...(planet.surface_patches ?? []).map(p=>p.bounds)]) for (let face = 0; face < 6; face++) {
    const left = Math.max(b.x, face % 3 * size), top = Math.max(b.y, Math.floor(face / 3) * size);
    const right = Math.min(b.x + b.width, (face % 3 + 1) * size), bottom = Math.min(b.y + b.height, (Math.floor(face / 3) + 1) * size);
    if (right <= left || bottom <= top) continue;
    const nx = Math.min(320, Math.ceil((right-left)*2)), ny = Math.min(320, Math.ceil((bottom-top)*2));
    const start = positions.length / 3;
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      const normal = tileNormal({x:left-.5+x/nx*(right-left),y:top-.5+y/ny*(bottom-top)},planet.surface.face_size,face);
      normals.push(normal.x,normal.y,normal.z);
      positions.push(normal.x*radius,normal.y*radius,normal.z*radius);
    }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const a=start+y*(nx+1)+x,c=a+nx+1;
      indices.push(a,c,a+1,a+1,c,c+1);
    }
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
