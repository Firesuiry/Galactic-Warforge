/**
 * 地表装饰（第 23 轮 3A 画质地表分支）：草丛、扫描岩石、卵石。
 *
 * 原则（与旧版一致，验收口径不变）：
 * - 只在服务端声明「已探索」的格上生成；未探索格没有几何；
 * - 排除实体占地（建筑占地、单位、资源点）；实体变化时整组重建；
 * - 纯装饰：`raycast` 禁用，拾取永远打在数学球面上；
 * - 确定性：同一份数据每次生成完全相同的实例矩阵（不看 tick/时间）。
 *
 * 新增：按画质档位的实例预算（low 4k / balanced 15k / high 40k）、草丛顶点风摆
 * （冻结/reduced-motion 静止）、按相机距离淡出、岩石用 Poly Haven 扫描网格（异步加载，
 * 未就绪时退回程序化碎石）。
 */
import { surfaceOffset } from '@shared/surface';
import { tileNormal, surfaceTileSize } from './projection';
import * as THREE from 'three';
import { getBuildingFootprint, getFogState } from '../model';
import type { PlanetSurfaceData } from './terrain';
import { createTerrainRelief } from './local-surface';
import { biomeProfile, isRock, isSoil } from './terrain/biome';
import { preloadRockMeshes, type RockMeshAsset } from './terrain/rock-meshes';
import type { PlanetRenderQuality } from './render-quality';

const UP = new THREE.Vector3(0, 1, 0);

/** 每档的总实例预算（草 + 岩石 + 卵石）。 */
export const DRESSING_BUDGET: Record<PlanetRenderQuality, number> = { low: 4000, balanced: 15000, high: 40000 };

function hash(x: number, y: number, salt: number) {
  let value = Math.imul(x + 173, 374761393) ^ Math.imul(y + 819, 668265263) ^ Math.imul(salt + 37, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** 五片锥形叶片组成一簇草；顶点色由实例色调制，风摆用世界位置相位。 */
export function grassGeometry() {
  const vertices: number[] = [];
  const bladeLength: number[] = [];
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * 2.399963;
    const x = Math.cos(angle) * 0.15, z = Math.sin(angle) * 0.15;
    const sideX = Math.cos(angle + Math.PI / 2) * 0.075;
    const sideZ = Math.sin(angle + Math.PI / 2) * 0.075;
    vertices.push(x - sideX, 0, z - sideZ, x + sideX, 0, z + sideZ, x * 2.8, 0.6 + blade * 0.07, z * 2.8);
    bladeLength.push(0, 0, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('bladeTip', new THREE.Float32BufferAttribute(bladeLength, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** 草丛材质：双面、alpha 不透明、顶点风摆（uSwTime = 0 时静止，冻结帧逐帧一致）。 */
export function grassMaterial(time: { value: number }) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.swTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float bladeTip;\nuniform float swTime;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        // 世界位置相位 + 顶点高度权重：只弯叶尖，根部不动。
        vec4 swWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float swPhase = swWorld.x * 0.35 + swWorld.z * 0.27;
        float swSway = sin(swTime * 1.6 + swPhase) * 0.10 + sin(swTime * 2.7 + swPhase * 1.7) * 0.04;
        transformed.x += swSway * bladeTip;
        transformed.z += swSway * 0.6 * bladeTip;
      `);
  };
  material.customProgramCacheKey = () => 'terrain-grass-sway-v1';
  return material;
}

/** 按相机距离淡出：实例整体 visible 由调用方按距离切换，单实例用材质透明度成本高，不做。 */
export function dressingVisibleAt(altitude: number) {
  return altitude < 190;
}

export interface DressingOptions {
  quality?: PlanetRenderQuality;
  /** 世界时间（秒）驱动草摆；冻结时传常量 0。 */
  time?: { value: number };
  /** 异步扫描岩石（已加载时直接使用）。 */
  rocks?: RockMeshAsset[];
}

/** Non-interactive dressing of authoritative explored terrain. No game entities are generated. */
export function createSurfaceDressing({ planet, fog }: PlanetSurfaceData, radius: number, options: DressingOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = 'non-interactive-surface-dressing';
  if ('surface_patches' in planet && planet.surface_patches?.length) {
    for (const patch of planet.surface_patches) {
      const view = { ...planet, ...patch, surface_patches: undefined };
      group.add(createSurfaceDressing({ planet: view, fog: view }, radius, options));
    }
  }

  if (!planet.terrain?.length || planet.map_width < 1 || planet.map_height < 1) return group;
  const quality = options.quality ?? 'balanced';
  const budget = DRESSING_BUDGET[quality];
  const bounds = 'bounds' in planet ? planet.bounds : { x: 0, y: 0 };
  const visibility = fog ?? ('bounds' in planet ? planet : undefined);
  const occupied = new Set<string>();
  for (const building of Object.values(planet.buildings ?? {})) {
    const footprint = getBuildingFootprint(building);
    for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
      const cell = surfaceOffset(building.position, dx, dy, planet.surface.face_size);
      occupied.add(`${cell.x}:${cell.y}`);
    }
  }
  for (const entity of [...Object.values(planet.units ?? {}), ...(planet.resources ?? [])]) {
    occupied.add(`${Math.round(entity.position.x)}:${Math.round(entity.position.y)}`);
  }
  const profile = biomeProfile(planet.kind, planet.planet_id);
  const cells: { x: number; y: number; rock: boolean; grass: boolean }[] = [];
  for (let row = 0; row < planet.terrain.length; row++) {
    for (let column = 0; column < planet.terrain[row].length; column++) {
      const terrain = planet.terrain[row][column];
      const rock = isRock(terrain), soil = isSoil(terrain);
      if (!rock && !soil) continue;
      const x = bounds.x + column, y = bounds.y + row;
      if (occupied.has(`${x}:${y}`)) continue;
      if (visibility && !getFogState(visibility, x, y).explored) continue;
      // 草：rocky 的 buildable 长草；ice 星球不长草（改碎冰/岩石）；沙地不长草。
      const grass = soil && profile.grassDensity > 0 && terrain !== 'sand' && terrain !== 'desert';
      cells.push({ x, y, rock, grass });
    }
  }
  const rockCells = cells.filter(cell => cell.rock);
  const grassCells = cells.filter(cell => !cell.rock && cell.grass);
  const pebbleCells = cells.filter(cell => !cell.rock && !cell.grass);
  // 冰原不长草：用低矮的碎冰/卵石代替（草预算并入卵石，保证冰面也有近景层次）。
  const ice = profile.kind === 'ice';
  // 预算分配：草占 70%，岩石 22%，卵石 8%；没有草的星球把份额给岩石。
  const grassShare = grassCells.length ? 0.70 : 0;
  const grassBudget = Math.floor(budget * grassShare);
  const rockBudget = Math.floor(budget * (grassCells.length ? 0.22 : 0.9));
  const pebbleBudget = budget - grassBudget - rockBudget + (ice ? Math.floor(budget * 0.55) : 0);
  const dummy = new THREE.Object3D();
  const normal = new THREE.Vector3();
  const twist = new THREE.Quaternion();
  const tileSize = surfaceTileSize(radius, planet.surface.face_size);
  const collect = (list: typeof cells, budgetFor: number, perCell: number, minSize: number, maxSize: number, salt: number) => {
    const transforms: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    if (!list.length) return { transforms, colors };
    const density = Math.min(1, budgetFor / Math.max(1, list.length * perCell));
    for (const cell of list) {
      if (transforms.length >= budgetFor) break;
      if (hash(cell.x, cell.y, salt) > 0.55 + density * 0.45) continue;
      const count = Math.max(1, Math.round(perCell * density));
      for (let i = 0; i < count && transforms.length < budgetFor; i++) {
        const offsetX = (hash(cell.x, cell.y, i * 7 + salt) - 0.5) * 0.72;
        const offsetY = (hash(cell.x, cell.y, i * 7 + salt + 1) - 0.5) * 0.72;
        normal.copy(tileNormal({ x: cell.x + offsetX, y: cell.y + offsetY }, planet.surface.face_size));
        const variation = hash(cell.x, cell.y, i * 7 + salt + 2);
        const size = tileSize * (minSize + variation * (maxSize - minSize));
        dummy.position.copy(normal).multiplyScalar(radius + size * 0.05);
        dummy.quaternion.setFromUnitVectors(UP, normal);
        twist.setFromAxisAngle(UP, hash(cell.x, cell.y, i * 7 + salt + 3) * Math.PI * 2);
        dummy.quaternion.multiply(twist);
        dummy.scale.setScalar(size);
        dummy.updateMatrix();
        transforms.push(dummy.matrix.clone());
        colors.push(new THREE.Color().setScalar(0.75 + variation * 0.5));
      }
    }
    return { transforms, colors };
  };
  // 草：每格 3 簇；根部颜色取地表苔草/草地色。
  const grass = collect(grassCells, grassBudget, 3, 0.045, 0.075, 80);
  const grassColors = grass.transforms.map((_, index) => {
    const variation = (index * 0.61803398875) % 1;
    return new THREE.Color('#5d6b3a').lerp(new THREE.Color('#7d8a4a'), variation * 0.7).multiplyScalar(0.9 + variation * 0.2);
  });
  // 岩石：blocked 格，每格 3–5 块，大小明显大于草。
  const rocks = collect(rockCells, rockBudget, 4, 0.16, 0.34, 120);
  const rockColors = rocks.transforms.map((_, index) => {
    const variation = (index * 0.38196601125) % 1;
    return new THREE.Color('#6a6f68').lerp(new THREE.Color('#9a9c92'), variation * 0.6);
  });
  // 卵石：可建造/沙地上零星小石。
  const pebbles = collect(pebbleCells, pebbleBudget, ice ? 3 : 2, ice ? 0.02 : 0.03, ice ? 0.05 : 0.06, 160);
  const pebbleColors = pebbles.transforms.map((_, index) => new THREE.Color('#8a8d84').multiplyScalar(0.85 + ((index * 0.61803398875) % 1) * 0.3));

  const time = options.time ?? { value: 0 };
  const addInstanced = (
    transforms: THREE.Matrix4[], colors: THREE.Color[], geometry: THREE.BufferGeometry,
    material: THREE.Material, name: string, castShadow: boolean,
  ) => {
    if (!transforms.length) { return; }
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    mesh.name = name;
    transforms.forEach((matrix, index) => { mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, colors[index] ?? new THREE.Color(1, 1, 1)); });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
    group.add(mesh);
  };
  const ownsGeometry = !options.rocks?.length;
  if (grass.transforms.length) addInstanced(grass.transforms, grassColors, grassGeometry(), grassMaterial(time), 'grass-tufts', false);
  // 扫描岩石：三种网格按格哈希分配；异步未就绪时用程序化二十面体。
  const rockAssets = options.rocks ?? [];
  if (rockAssets.length) {
    for (let index = 0; index < rockAssets.length; index++) {
      const asset = rockAssets[index];
      const subset = rocks.transforms.filter((_, i) => (i % rockAssets.length) === index);
      const subsetColors = rockColors.filter((_, i) => (i % rockAssets.length) === index);
      addInstanced(subset, subsetColors, asset.geometry, asset.material, `scanned-rocks-${index}`, true);
    }
  } else if (rocks.transforms.length) {
    addInstanced(rocks.transforms, rockColors, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, metalness: 0, flatShading: true }), 'weathered-stones', true);
  }
  if (pebbles.transforms.length) {
    // 冰原：用扁平碎冰（低多面体，顶点色偏冷白/淡蓝）；温带：普通卵石。
    addInstanced(pebbles.transforms, ice
      ? pebbleColors.map((_, index) => new THREE.Color('#cfe4ea').lerp(new THREE.Color('#8fb6c4'), ((index * 0.61803398875) % 1) * 0.8))
      : pebbleColors,
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: ice ? 0.32 : 0.96, metalness: ice ? 0.05 : 0, flatShading: true }),
      ice ? 'ice-shards' : 'surface-pebbles', false);
  }
  const relief = createTerrainRelief({ planet, fog }, radius);
  if (relief) group.add(relief);
  return group;
}

/** 异步扫描岩石就绪后由场景调用：丢掉旧的程序化岩石组并重建。 */
export function preloadDressingRocks() {
  return preloadRockMeshes();
}

/** 释放装饰组：几何与材质按「共享/自有」区分（扫描岩石的几何/材质跨实例共享，不在这里释放）。 */
export function disposeSurfaceDressing(group: THREE.Object3D, shared?: Set<THREE.Material | THREE.BufferGeometry>) {
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.Mesh) {
      if (!shared?.has(object.geometry)) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (!shared?.has(material)) material.dispose();
    }
  });
  group.clear();
}
