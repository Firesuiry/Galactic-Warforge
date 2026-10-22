/**
 * 扫描岩石资源加载（第 23 轮 3A 画质地表分支）。
 *
 * 资产：`client-web/public/assets/models/rocks/*.bin`（Poly Haven CC0，减面到 ≤1.8k 三角，
 * 来源与改动见该目录 `THIRD_PARTY.md`）。格式是自定义紧凑二进制，不是 GLB：
 *   uint32 头长 + JSON 头 + uint32 索引数 + uint32 索引 + float32 顶点（pos3, normal3, uv2）
 *
 * 加载是异步的：场景构造后调用一次 `preloadRockMeshes()`，完成前地表装饰用程序化碎石，
 * 完成后回调重建。同一几何/材质在实例间共享（InstancedMesh 合批）。
 */
import * as THREE from 'three';

export interface RockMeshAsset {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  faces: number;
}

const BASE = `${import.meta.env.BASE_URL ?? '/'}assets/models/rocks`;
export const ROCK_MESH_NAMES = ['boulder_a', 'boulder_b', 'boulder_c'] as const;

async function loadBinary(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`岩石资源加载失败：${url}`);
  return response.arrayBuffer();
}

function loadTexture(url: string, colorSpace: THREE.ColorSpace) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = colorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => reject(new Error(`岩石贴图加载失败：${url}`));
    image.src = url;
  });
}

/** 解析自定义岩石二进制。 */
export function parseRockBinary(buffer: ArrayBuffer, name: string): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; faces: number } {
  const view = new DataView(buffer);
  let offset = 0;
  const headerLength = view.getUint32(offset, true); offset += 4;
  offset += headerLength; // JSON 头（faces/verts/license），渲染不需要
  const indexCount = view.getUint32(offset, true); offset += 4;
  const indices = new Uint32Array(buffer, offset, indexCount); offset += indexCount * 4;
  const vertexCount = indexCount > 0 ? (buffer.byteLength - offset) / 8 / 4 : 0;
  const data = new Float32Array(buffer, offset, vertexCount * 8);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i++) {
    const base = i * 8;
    positions[i * 3] = data[base]; positions[i * 3 + 1] = data[base + 1]; positions[i * 3 + 2] = data[base + 2];
    normals[i * 3] = data[base + 3]; normals[i * 3 + 1] = data[base + 4]; normals[i * 3 + 2] = data[base + 5];
    uvs[i * 2] = data[base + 6]; uvs[i * 2 + 1] = data[base + 7];
  }
  return { positions, normals, uvs, indices: indices.slice(), faces: indexCount / 3 };
}

let rockPromise: Promise<RockMeshAsset[]> | null = null;

/** 加载全部扫描岩石（只加载一次，跨场景共享）。 */
export function preloadRockMeshes(): Promise<RockMeshAsset[]> {
  if (rockPromise) return rockPromise;
  rockPromise = Promise.all(ROCK_MESH_NAMES.map(async (name) => {
    const [binary, albedo] = await Promise.all([
      loadBinary(`${BASE}/${name}.bin`),
      loadTexture(`${BASE}/${name}_albedo.webp`, THREE.SRGBColorSpace),
    ]);
    const parsed = parseRockBinary(binary, name);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(parsed.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(parsed.indices, 1));
    geometry.computeBoundingSphere();
    // 扫描岩石本身接近全粗糙；packed 的 B 通道是粗糙度但 three 的 roughnessMap 读 G 通道，
    // 直接用常量（省一张 512² 贴图与一次采样）。
    const material = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.92, metalness: 0 });
    material.name = `rock-${name}`;
    return { name, geometry, material, faces: parsed.faces };
  })).catch((error) => {
    console.warn('[terrain] 扫描岩石加载失败，使用程序化碎石', error);
    return [];
  });
  return rockPromise;
}

export function disposeRockMeshes(assets: RockMeshAsset[]) {
  for (const asset of assets) {
    asset.geometry.dispose();
    (asset.material.map as THREE.Texture | null)?.dispose();
    asset.material.dispose();
  }
  rockPromise = null;
}
