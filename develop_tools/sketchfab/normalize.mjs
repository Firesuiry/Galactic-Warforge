/**
 * 规整 Sketchfab 原始 GLB：去相机/灯/空节点 → 合并材质 → weld + simplify 到三角预算 →
 * 纹理缩到 1K（executor 2K）转 webp → 只留 position/normal/uv（带动画的保留 skin 属性）→
 * 坐标系统一（Y 上、正面 +Z、底面落 Y=0、水平居中）→ 可选 meshopt 压缩。
 *
 * 用法：
 *   node normalize.mjs                      # 全部首选 + 备选
 *   node normalize.mjs --only executor      # 只处理某些槽位
 *   node normalize.mjs --role primary       # 只处理首选
 * 输入：raw/<槽位>[-备选]/<uid>.glb；输出：client-web/public/assets/models/sketchfab/<类型>.glb
 */
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { Matrix4, Vector3 } from 'three';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import {
  dedup, flatten, join, prune, weld, simplify, textureCompress, meshopt, center, getBounds,
} from '@gltf-transform/functions';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const RAW = resolve(here, 'raw');
const OUT = resolve(root, 'client-web/public/assets/models/sketchfab');
const SELECTION = JSON.parse(await readFile(resolve(here, 'selection.json'), 'utf8'));

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

/** 每个模型的规整参数。三角预算是**简化后**的上限（规整前允许更高）。 */
const CONFIG = {
  executor: { tris: 40000, texture: 2048, hero: true },
  mecha: { tris: 12000, texture: 1024 },
  soldier: { tris: 12000, texture: 1024 },
  worker: { tris: 12000, texture: 1024 },
  scout: { tris: 12000, texture: 1024 },
  attack_drone: { tris: 12000, texture: 1024 },
  artillery: { tris: 12000, texture: 1024 },
  missile_vehicle: { tris: 12000, texture: 1024 },
  repair_vehicle: { tris: 12000, texture: 1024 },
  supply_truck: { tris: 12000, texture: 1024 },
  dark_fog: { tris: 12000, texture: 1024 },
  ship: { tris: 12000, texture: 1024 },
  cargo_ship: { tris: 12000, texture: 1024 },
  battlefield_analysis_base: { tris: 20000, texture: 1024 },
  gauss_turret: { tris: 20000, texture: 1024, turret: true },
  laser_turret: { tris: 20000, texture: 1024, turret: true },
  missile_turret: { tris: 20000, texture: 1024, turret: true },
  plasma_turret: { tris: 20000, texture: 1024, turret: true },
  anti_air_turret: { tris: 20000, texture: 1024, turret: true },
  em_rail_ejector: { tris: 20000, texture: 1024 },
  barracks: { tris: 20000, texture: 1024 },
  vehicle_factory: { tris: 20000, texture: 1024 },
  airfield: { tris: 20000, texture: 1024 },
  ray_receiver: { tris: 20000, texture: 1024 },
  vertical_launching_silo: { tris: 20000, texture: 1024 },
  artificial_star: { tris: 20000, texture: 1024 },
  oil_extractor: { tris: 20000, texture: 1024 },
  mining_machine: { tris: 20000, texture: 1024 },
  tesla_tower: { tris: 20000, texture: 1024 },
  accumulator: { tris: 20000, texture: 1024 },
  thermal_power_plant: { tris: 20000, texture: 1024 },
  matrix_lab: { tris: 20000, texture: 1024 },
  oil_refinery: { tris: 20000, texture: 1024 },
  storage_tank: { tris: 20000, texture: 1024 },
};

/** 三角面总数（简化前后对比用）。 */
function triangleCount(root) {
  let total = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      total += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(total);
}

/** 剥掉蒙皮（骨骼动画在本场景不用：单位只做整体位移 + 轻微起伏）。
 * 蒙皮网格的顶点在绑定姿态下，直接 `setSkin(null)` 会丢失关节变换、整模塌成一团；
 * 先把每个顶点按 skin 矩阵烘进 POSITION（等价于 rest pose），再剥。 */
function stripSkins(doc) {
  const rootNode = doc.getRoot();
  for (const meshNode of rootNode.listNodes()) {
    const skin = meshNode.getSkin();
    if (!skin) continue;
    const joints = skin.listJoints();
    const inverseBind = skin.getInverseBindMatrices();
    if (!inverseBind) continue;
    const jointMatrices = joints.map((joint, index) => {
      const matrix = joint.getWorldMatrix();
      const inverse = inverseBind.getElement(index, []).slice();
      const bind = new Matrix4().fromArray(inverse);
      return new Matrix4().multiplyMatrices(matrix, bind);
    });
    const mesh = meshNode.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const weights = prim.getAttribute('WEIGHTS_0');
      const indices = prim.getAttribute('JOINTS_0');
      if (!position || !weights || !indices) continue;
      const out = new Float32Array(position.getCount() * 3);
      const vertex = new Vector3();
      for (let v = 0; v < position.getCount(); v++) {
        const [x, y, z] = position.getElement(v, []);
        vertex.set(x, y, z);
        // 取权重最大的关节（蒙皮权重在本类模型上是单关节刚绑，混合只会让硬表面变软）。
        const w = weights.getElement(v, []);
        const j = indices.getElement(v, []);
        let best = 0;
        for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
        vertex.applyMatrix4(jointMatrices[j[best]] ?? new Matrix4());
        out[v * 3] = vertex.x; out[v * 3 + 1] = vertex.y; out[v * 3 + 2] = vertex.z;
      }
      position.setArray(out);
      prim.setAttribute('JOINTS_0', null);
      prim.setAttribute('WEIGHTS_0', null);
    }
  }
  for (const skin of rootNode.listSkins()) skin.dispose();
  for (const node of rootNode.listNodes()) node.setSkin(null);
  for (const mesh of rootNode.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prim.setAttribute('JOINTS_0', null);
      prim.setAttribute('WEIGHTS_0', null);
    }
  }
  for (const animation of rootNode.listAnimations()) {
    const targets = animation.listChannels().map((c) => c.getTargetNode());
    if (targets.some((n) => n && n.getSkin())) animation.dispose();
  }
}

const KEEP = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']);

function stripDocument(doc) {
  const rootNode = doc.getRoot();
  // 去相机 / 灯
  for (const node of rootNode.listNodes()) {
    if (node.getCamera()) node.setCamera(null);
  }
  for (const extension of rootNode.listExtensions()) {
    if (/KHR_lights_punctual/.test(extension.extensionName)) extension.dispose();
  }
  // 只留需要的属性
  for (const mesh of rootNode.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        if (!KEEP.has(semantic)) prim.setAttribute(semantic, null);
      }
    }
  }
  // 去空节点（无 mesh、无子节点、无相机）
  const dropEmpty = (node) => {
    for (const child of [...node.listChildren()]) dropEmpty(child);
    if (!node.getMesh() && !node.getCamera() && node.listChildren().length === 0 && node !== rootNode.getDefaultScene()) {
      node.dispose();
    }
  };
  for (const scene of rootNode.listScenes()) for (const child of [...scene.listChildren()]) dropEmpty(child);
}

/** 材质收敛到 1–3 个：这里只做去重（dedup）+ 清理未引用，贴图相同的材质自动合并。 */
async function normalizeOne(type, role) {
  const entry = SELECTION[type]?.[role];
  if (!entry) return null;
  const config = CONFIG[type];
  if (!config) return null;
  const dir = resolve(RAW, role === 'primary' ? type : `${type}-${role}`);
  const src = resolve(dir, `${entry.uid}.glb`);
  if (!existsSync(src)) return { type, role, error: '原始文件不存在' };
  const doc = await io.read(src);
  const before = triangleCount(doc.getRoot());
  stripDocument(doc);
  await doc.transform(prune(), dedup(), flatten(), join({ keepNamed: false }));
  const merged = triangleCount(doc.getRoot());
  // simplify 是**逐 primitive** 按 ratio 减面的：join 之后整模只有一个 primitive 才能按总预算精确收敛。
  // 场景用不到蒙皮（单位是整体位移，没有骨骼动画），所以剥掉 skin 才能把零件合进一个 primitive。
  if (!config.keepSkin) stripSkins(doc);
  await doc.transform(weld());
  const meshCount = doc.getRoot().listMeshes().length;
  const finalMerged = triangleCount(doc.getRoot());
  if (finalMerged > config.tris) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: config.tris / finalMerged, error: 0.002 }));
  }
  // 纹理：只缩放不转格式（gltf-transform 的 resize 走 `fit: fill` 会拉歪非方图）；
  // 缩放后按「1K 以下」的 webp 预算再压一次，超出才转格式。
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const meta = await sharp(Buffer.from(image)).metadata();
    if (Math.max(meta.width ?? 0, meta.height ?? 0) <= config.texture) continue;
    const resized = await sharp(Buffer.from(image)).resize(config.texture, config.texture, { fit: 'inside', kernel: 'lanczos3' }).toBuffer();
    texture.setImage(new Uint8Array(resized));
  }
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82 }));
  // 坐标：居中落地（Y 上、正面 +Z 由原模型决定，yaw 在映射表里修）
  await doc.transform(center({ pivot: 'bottom' }));
  const outName = `${type}.glb`;
  await mkdir(OUT, { recursive: true });
  // meshopt 压缩：GLTFLoader 需 MeshoptDecoder（已在场景侧配置）。
  await doc.transform(meshopt({ encoder: MeshoptEncoder }));
  await io.write(resolve(OUT, outName), doc);
  const after = triangleCount(doc.getRoot());
  const bounds = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  const size = bounds.max.map((v, i) => +(v - bounds.min[i]).toFixed(3));
  return { type, role, out: outName, trisBefore: before, trisMerged: finalMerged, meshes: meshCount, trisAfter: after, size, animated: doc.getRoot().listAnimations().length > 0, skins: doc.getRoot().listSkins().length };
}

const argv = process.argv.slice(2);
const only = argv.flatMap((a, i) => (a === '--only' ? [argv[i + 1]] : []));
const roleFilter = argv.includes('--role') ? argv[argv.indexOf('--role') + 1] : null;

const results = [];
for (const type of Object.keys(CONFIG)) {
  if (only.length && !only.includes(type)) continue;
  for (const role of ['primary', 'fallback']) {
    if (roleFilter && role !== roleFilter) continue;
    const result = await normalizeOne(type, role);
    if (!result) continue;
    results.push(result);
    if (result.error) console.log(`✗ ${type}/${role}: ${result.error}`);
    else console.log(`✓ ${type}/${role} → ${result.out} tris ${result.trisBefore} → ${result.trisAfter}（合并后 ${result.trisMerged}）size ${result.size.join('×')}`);
  }
}
await writeFile(resolve(here, 'normalize-report.json'), JSON.stringify(results, null, 2));
