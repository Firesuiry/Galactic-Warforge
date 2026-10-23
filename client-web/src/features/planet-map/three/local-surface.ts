import { surfaceFace, surfaceOffset } from '@shared/surface';
import type { PlanetSceneView } from '@shared/types';
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
  // 岩性掩码（连续场）：格级二值掩码在格心之间双线性插值。逐格正弦包络会让每个阻挡格
  // 变成一块独立的「灰色方块台地」（格边一圈亮缝），这条连续掩码让相邻岩格连成一片岩脊，
  // 只在岩区边界处淡出（L15：岩脊底下用岩石纹理过渡，不留灰色方块）。
  const rockCells = new Set(cells.map(cell => `${cell.x}:${cell.y}`));
  const fieldAt = (set: Set<string>, x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const at = (ax: number, ay: number) => (set.has(`${ax}:${ay}`) ? 1 : 0);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx),
      THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
  };
  // 实体占地（建筑/单位/资源）也把掩码压到 0：相邻建筑的地面必须保持水平（贴地建造的契约）。
  const rockAt = (x: number, y: number) => fieldAt(rockCells, x, y) * (1 - fieldAt(occupied, x, y));
  const positions: number[] = [], colors: number[] = [], opacity: number[] = [], indices: number[] = [];
  // 颜色对齐地表玄武岩（暗冷灰），不再是浅灰白——浅色台地在暗草地上就是一片方格。
  // 颜色对齐地表玄武岩（冷灰），比草地略亮一点以读出起伏，不再是暖褐。
  const low = new THREE.Color('#33363a'), high = new THREE.Color('#565b60');
  const ridge = new THREE.Color('#232528');
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += cellStride) {
    const cell = cells[cellIndex];
    const start = positions.length / 3;
    const face = surfaceFace(cell, planet.surface.face_size);
    const tileSize = surfaceTileSize(radius, planet.surface.face_size);
    for (let y = 0; y <= subdivisions; y++) for (let x = 0; x <= subdivisions; x++) {
      const u = x / subdivisions, v = y / subdivisions;
      const tx = cell.x + u - 0.5, ty = cell.y + v - 0.5;
      const normal = tileNormal({ x: tx, y: ty }, planet.surface.face_size, face);
      // 掩码决定抬升：岩区内部满抬升、边界一格拉到 0（顶点回到数学球面），
      // 于是岩脊是连成一片的缓丘，而不是每格一块台地。
      const mask = THREE.MathUtils.smoothstep(rockAt(tx, ty), 0.55, 0.98);
      const broad = reliefNoise(tx * 2.1, ty * 2.1);
      const detail = Math.abs(reliefNoise(tx * 7.3, ty * 7.3) * 2 - 1);
      const elevation = tileSize * mask * (0.05 + broad * 0.10 + detail * 0.13);
      positions.push(normal.x * (radius + elevation), normal.y * (radius + elevation), normal.z * (radius + elevation));
      const color = low.clone().lerp(high, Math.min(1, mask * (0.35 + broad * 0.5))).lerp(ridge, detail * 0.35);
      colors.push(color.r, color.g, color.b);
      opacity.push(THREE.MathUtils.smoothstep(mask, 0.02, 0.55));
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
  // 平滑法线（不 flatShading）：细分后的缓丘配上平面着色会碎成一地三角块；
  // 细节起伏由顶点高度与顶点色提供，光照按连续曲面走。
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0.03, transparent: true });
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
 * 服务端 scene.height 不抬升地面：建筑/单位/资源与拾取都锚在数学球面上，抬升会把它们埋进地里。
 * A fixed global sphere alone sags by several tile heights on very large worlds.
 * Material is owned by the global surface; this mesh owns only its geometry.
 */
export function createLocalSurface(planet: PlanetRenderView, radius: number, material: THREE.MeshStandardMaterial) {
  if (!('bounds' in planet)) return null;
  if (planet.surface.face_size * 3 <= 512) return null;
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const size = planet.surface.face_size;
  for (const b of [planet.bounds, ...(planet.surface_patches ?? []).map(p=>p.bounds)]) for (let face = 0; face < 6; face++) {
    const left = Math.max(b.x, face % 3 * size), top = Math.max(b.y, Math.floor(face / 3) * size);
    const right = Math.min(b.x + b.width, (face % 3 + 1) * size), bottom = Math.min(b.y + b.height, (Math.floor(face / 3) + 1) * size);
    if (right <= left || bottom <= top) continue;
    const nx = Math.min(320, Math.ceil((right-left)*2)), ny = Math.min(320, Math.ceil((bottom-top)*2));
    const start = positions.length / 3;
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      const tx = left-.5+x/nx*(right-left), ty = top-.5+y/ny*(bottom-top);
      const normal = tileNormal({x:tx,y:ty},planet.surface.face_size,face);
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
