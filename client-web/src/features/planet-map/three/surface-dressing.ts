import * as THREE from 'three';
import { getBuildingFootprint, getFogState } from '../model';
import type { PlanetSurfaceData } from './terrain';
import { createTerrainRelief } from './local-surface';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_INSTANCES = 4000;
const ROCK_TERRAINS = new Set(['blocked', 'rock', 'mountain', 'mountains']);
const SOIL_TERRAINS = new Set(['buildable', 'plains', 'plain', 'grass', 'grassland', 'forest', 'desert', 'sand']);

function hash(x: number, y: number, salt: number) {
  let value = Math.imul(x + 173, 374761393) ^ Math.imul(y + 819, 668265263) ^ Math.imul(salt + 37, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function grassGeometry() {
  const vertices: number[] = [];
  // Five short tapered blades form a single low tuft, never a resource icon.
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * 2.399963;
    const x = Math.cos(angle) * 0.15, z = Math.sin(angle) * 0.15;
    const sideX = Math.cos(angle + Math.PI / 2) * 0.075;
    const sideZ = Math.sin(angle + Math.PI / 2) * 0.075;
    vertices.push(x - sideX, 0, z - sideZ, x + sideX, 0, z + sideZ, x * 2.8, 0.6 + blade * 0.07, z * 2.8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Non-interactive dressing of authoritative explored terrain. No game entities are generated. */
export function createSurfaceDressing({ planet, fog }: PlanetSurfaceData, radius: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'non-interactive-surface-dressing';
  if (!planet.terrain?.length || planet.map_width < 1 || planet.map_height < 1) return group;
  const bounds = 'bounds' in planet ? planet.bounds : { x: 0, y: 0 };
  const visibility = fog ?? ('bounds' in planet ? planet : undefined);
  const occupied = new Set<string>();
  for (const building of Object.values(planet.buildings ?? {})) {
    const footprint = getBuildingFootprint(building);
    for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
      occupied.add(`${Math.round(building.position.x) + dx}:${Math.round(building.position.y) + dy}`);
    }
  }
  for (const entity of [...Object.values(planet.units ?? {}), ...(planet.resources ?? [])]) {
    occupied.add(`${Math.round(entity.position.x)}:${Math.round(entity.position.y)}`);
  }
  const cells: { x: number; y: number; rock: boolean; grass: boolean }[] = [];
  const verdant = planet.kind === 'terrestrial' || planet.kind === 'oceanic';
  for (let row = 0; row < planet.terrain.length; row++) {
    for (let column = 0; column < planet.terrain[row].length; column++) {
      const terrain = planet.terrain[row][column];
      if (!ROCK_TERRAINS.has(terrain) && !SOIL_TERRAINS.has(terrain)) continue;
      const x = bounds.x + column, y = bounds.y + row;
      if (occupied.has(`${x}:${y}`)) continue;
      if (visibility && !getFogState(visibility, x, y).explored) continue;
      cells.push({ x, y, rock: ROCK_TERRAINS.has(terrain), grass: verdant && !ROCK_TERRAINS.has(terrain) && terrain !== 'sand' && terrain !== 'desert' });
    }
  }
  const density = Math.min(1, MAX_INSTANCES / Math.max(1, cells.length * 5));
  const rockTransforms: THREE.Matrix4[] = [], grassTransforms: THREE.Matrix4[] = [];
  const rockColors: THREE.Color[] = [], grassColors: THREE.Color[] = [];
  const dummy = new THREE.Object3D();
  const normal = new THREE.Vector3();
  const twist = new THREE.Quaternion();
  for (const cell of cells) {
    // Keep construction space readable: sparse small stones in soil, clustered
    // wider weathered outcrops exclusively on server-declared rocky terrain.
    const count = cell.rock ? 5 : cell.grass ? 3 : 2;
    if (!cell.rock && hash(cell.x, cell.y, 70) > (cell.grass ? 0.65 : 0.48)) continue;
    for (let i = 0; i < count; i++) {
      if (rockTransforms.length + grassTransforms.length >= MAX_INSTANCES) break;
      if (hash(cell.x, cell.y, i + 80) > density) continue;
      const offsetX = (hash(cell.x, cell.y, i * 7) - 0.5) * 0.72;
      const offsetY = (hash(cell.x, cell.y, i * 7 + 1) - 0.5) * 0.72;
      const y = THREE.MathUtils.clamp(1 - 2 * (cell.y + offsetY + 0.5) / planet.map_height, -1, 1);
      const longitude = (cell.x + offsetX + 0.5) / planet.map_width * Math.PI * 2;
      const latitudeRadius = Math.sqrt(Math.max(0, 1 - y * y));
      normal.set(-Math.cos(longitude) * latitudeRadius, y, Math.sin(longitude) * latitudeRadius);
      const eastSpan = Math.PI * 2 * radius / planet.map_width * latitudeRadius;
      const northSpan = 2 * radius / planet.map_height / Math.max(latitudeRadius, 0.05);
      const tileSize = Math.min(eastSpan, northSpan);
      const variation = hash(cell.x, cell.y, i * 7 + 2);
      const size = tileSize * (cell.rock ? 0.075 + variation * 0.1 : 0.018 + variation * 0.024);
      const grass = cell.grass && i !== 0;
      dummy.position.copy(normal).multiplyScalar(radius + (grass ? 0 : size * 0.18));
      dummy.quaternion.setFromUnitVectors(UP, normal);
      twist.setFromAxisAngle(UP, hash(cell.x, cell.y, i * 7 + 3) * Math.PI * 2);
      dummy.quaternion.multiply(twist);
      dummy.scale.set(size * (0.85 + variation * 0.6), size * (grass ? 1.5 : 0.55 + variation * 0.3), size);
      dummy.updateMatrix();
      if (grass) {
        grassTransforms.push(dummy.matrix.clone());
        grassColors.push(new THREE.Color('#4a6450').lerp(new THREE.Color('#788064'), variation * 0.65));
      } else {
        rockTransforms.push(dummy.matrix.clone());
        rockColors.push(new THREE.Color(cell.rock ? '#65706b' : '#617066').lerp(new THREE.Color('#92958a'), variation * 0.55));
      }
    }
  }
  const add = (transforms: THREE.Matrix4[], colors: THREE.Color[], geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, name: string) => {
    if (!transforms.length) { geometry.dispose(); material.dispose(); return; }
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    mesh.name = name;
    transforms.forEach((matrix, index) => { mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, colors[index]); });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  add(rockTransforms, rockColors, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, metalness: 0, flatShading: true }), 'weathered-stones');
  add(grassTransforms, grassColors, grassGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }), 'short-grass-tufts');
  const relief = createTerrainRelief({ planet, fog }, radius);
  if (relief) group.add(relief);
  return group;
}
