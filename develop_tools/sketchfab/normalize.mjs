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
import { createHash } from 'node:crypto';
import { dirname, resolve, basename } from 'node:path';
import { Matrix4, Vector3 } from 'three';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import {
  dedup, flatten, join, prune, weld, simplify, meshopt,
} from '@gltf-transform/functions';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const RAW = resolve(here, 'raw');
const OUT = resolve(root, 'client-web/public/assets/models/sketchfab');
/** 备选模型不进产物（只在主代理换选型时才拷过去），放 tmp 下供画廊对比。 */
const ALT_OUT = resolve(root, 'tmp/3a-models/alt');
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

/**
 * 材质收敛：贴图/参数完全相同的材质合并成一个；再把贴图按字节哈希去重
 * （同一张图被多个材质引用时只留一份）。只对不透明材质做——透明件（玻璃、发光罩）
 * 的混合顺序依赖各自材质，合并会改变观感。
 */
function mergeMaterials(doc) {
  const root = doc.getRoot();
  const signature = (material) => [
    material.getBaseColorTexture()?.getImage()?.length ?? 0,
    material.getBaseColorTexture()?.getName() ?? '',
    material.getEmissiveTexture()?.getName() ?? '',
    material.getMetallicRoughnessTexture()?.getName() ?? '',
    material.getNormalTexture()?.getName() ?? '',
    material.getBaseColorFactor().map((v) => v.toFixed(3)).join(','),
    material.getMetallicFactor().toFixed(3),
    material.getRoughnessFactor().toFixed(3),
    material.getEmissiveFactor().map((v) => v.toFixed(3)).join(','),
    material.getAlphaMode(),
  ].join('|');
  const bySignature = new Map();
  for (const material of [...root.listMaterials()]) {
    if (material.getAlphaMode() !== 'OPAQUE') continue;
    const key = signature(material);
    const existing = bySignature.get(key);
    if (!existing) { bySignature.set(key, material); continue; }
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) if (prim.getMaterial() === material) prim.setMaterial(existing);
    }
    material.dispose();
  }
  // 贴图字节去重：同一张图（哈希相同）只留一份。
  const byHash = new Map();
  for (const texture of [...root.listTextures()]) {
    const image = texture.getImage();
    if (!image) continue;
    const hash = createHash('sha1').update(Buffer.from(image)).digest('hex');
    const existing = byHash.get(hash);
    if (!existing) { byHash.set(hash, texture); continue; }
    for (const material of root.listMaterials()) {
      for (const slot of ['BaseColor', 'Emissive', 'MetallicRoughness', 'Normal', 'Occlusion']) {
        if (material[`get${slot}Texture`]?.() === texture) material[`set${slot}Texture`]?.(existing);
      }
    }
    texture.dispose();
  }
}

/** 居中落地（X/Z 居中、底面 Y=0）并缩到最长边 1。直接改 POSITION 顶点。 */
function fitToUnit(doc) {
  const meshes = doc.getRoot().listMeshes();
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      for (let v = 0; v < position.getCount(); v++) {
        const p = position.getElement(v, []);
        for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], p[k]); bounds.max[k] = Math.max(bounds.max[k], p[k]); }
      }
    }
  }
  const size = bounds.max.map((value, index) => value - bounds.min[index]);
  const span = Math.max(...size);
  if (!Number.isFinite(span) || span <= 0) return null;
  const scale = 1 / span;
  const offset = [
    -((bounds.min[0] + bounds.max[0]) / 2) * scale,
    -bounds.min[1] * scale,
    -((bounds.min[2] + bounds.max[2]) / 2) * scale,
  ];
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const out = new Float32Array(position.getCount() * 3);
      for (let v = 0; v < position.getCount(); v++) {
        const [x, y, z] = position.getElement(v, []);
        out[v * 3] = x * scale + offset[0];
        out[v * 3 + 1] = y * scale + offset[1];
        out[v * 3 + 2] = z * scale + offset[2];
      }
      position.setArray(out);
    }
  }
  // 节点变换已由 flatten 烘进顶点；清掉残留的平移/缩放，避免二次变换。
  for (const node of doc.getRoot().listNodes()) {
    node.setTranslation([0, 0, 0]);
    node.setScale([1, 1, 1]);
  }
  return { size: size.map((value) => +(value * scale).toFixed(3)) };
}

/** 把炮塔拆成「底座 + turret-barrel」两个节点：按三角面重心高度切，pivot 以上归炮管组。
 * 炮管节点原点是转轴（水平居中、pivot 高度），几何相对它偏移，场景写 rotation.y 即绕轴转。 */
function splitTurret(doc, pivotRatio) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let minY = Infinity, maxY = -Infinity;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      for (let v = 0; v < position.getCount(); v++) {
        const y = position.getElement(v, [])[1];
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minY)) return;
  const pivotY = minY + (maxY - minY) * pivotRatio;
  const base = doc.createNode('turret-base');
  const barrel = doc.createNode('turret-barrel').setTranslation([0, pivotY, 0]);
  scene.addChild(base);
  scene.addChild(barrel);
  for (const mesh of [...root.listMeshes()]) {
    const upper = doc.createMesh(`${mesh.getName()}-upper`);
    const lower = doc.createMesh(`${mesh.getName()}-lower`);
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : position.getCount();
      const indexAt = (i) => (indices ? indices.getScalar(i) : i);
      const upperIndices = [], lowerIndices = [];
      for (let i = 0; i < count; i += 3) {
        const a = indexAt(i), b = indexAt(i + 1), c = indexAt(i + 2);
        const centroid = (position.getElement(a, [])[1] + position.getElement(b, [])[1] + position.getElement(c, [])[1]) / 3;
        (centroid >= pivotY ? upperIndices : lowerIndices).push(a, b, c);
      }
      const build = (target, list, isBarrel) => {
        if (!list.length) return;
        const outPrim = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
        // 重新打包顶点（只留被引用到的），并把炮管组几何平移到转轴原点。
        const remap = new Map();
        const vertices = [];
        const out = list.map((index) => {
          if (!remap.has(index)) {
            remap.set(index, vertices.length);
            vertices.push(index);
          }
          return remap.get(index);
        });
        for (const semantic of prim.listSemantics()) {
          const source = prim.getAttribute(semantic);
          const size = source.getElementSize();
          const data = new Float32Array(vertices.length * size);
          vertices.forEach((vertex, slot) => {
            const value = source.getElement(vertex, []);
            for (let k = 0; k < size; k++) {
              const component = value[k];
              data[slot * size + k] = semantic === 'POSITION' && isBarrel && k === 1 ? component - pivotY : component;
            }
          });
          outPrim.setAttribute(semantic, doc.createAccessor().setType(source.getType()).setArray(data));
        }
        outPrim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(out)));
        target.addPrimitive(outPrim);
      };
      build(upper, upperIndices, true);
      build(lower, lowerIndices, false);
    }
    mesh.dispose();
  }
  for (const mesh of [...root.listMeshes()]) {
    if (mesh.listPrimitives().length === 0) { mesh.dispose(); continue; }
    if (!mesh.getName().endsWith('-upper') && !mesh.getName().endsWith('-lower')) continue;
    (mesh.getName().endsWith('-upper') ? barrel : base).setMesh(mesh);
  }
  for (const node of root.listNodes()) {
    if (node !== base && node !== barrel && node !== scene) node.dispose();
  }
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
    // glTF 蒙皮公式：顶点在**蒙皮空间**（joint 世界矩阵 × inverseBind），
    // 这里把结果直接烘进 POSITION，节点自身的变换随后由 `fitToUnit()` 清掉。
    const jointMatrices = joints.map((joint, index) => {
      // 没有世界矩阵的关节（不在场景图里的孤立关节）按单位阵处理。
      const elements = joint.getWorldMatrix();
      const matrix = elements ? new Matrix4().fromArray(elements) : new Matrix4();
      const bind = new Matrix4().fromArray(inverseBind.getElement(index, []));
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

/** 贴图去饱和系数（保留原色的 35%，其余向亮度靠拢）。 */
const DESATURATE = 0.35;

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
  let doc;
  try {
    doc = await io.read(src);
  } catch (error) {
    return { type, role, error: `读取失败（可能仍在下载）：${error.message}` };
  }
  const before = triangleCount(doc.getRoot());
  stripDocument(doc);
  // 剥蒙皮必须在 flatten/join **之前**：这两个变换会重排节点层级，蒙皮的关节链与
  // 世界矩阵就对不上了（之前烘出来的顶点被放大到几十万倍）。
  if (!config.keepSkin) stripSkins(doc);
  await doc.transform(prune(), dedup(), flatten(), join({ keepNamed: false }));
  const merged = triangleCount(doc.getRoot());
  // simplify 是**逐 primitive** 按 ratio 减面的：join 之后整模只有一个 primitive 才能按总预算精确收敛。
  await doc.transform(weld());
  const meshCount = doc.getRoot().listMeshes().length;
  const finalMerged = triangleCount(doc.getRoot());
  if (finalMerged > config.tris) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: config.tris / finalMerged, error: 0.002 }));
  }
  // 材质收敛到 1–3 个：贴图完全相同的材质合并（dedup 只处理属性相同的对象，
  // 大量「同一张贴图、不同名字」的材质要靠 palette 之外的显式合并）。
  mergeMaterials(doc);
  // 动画只保留骨骼/节点通道：本场景不读 morph 权重，而泵机这类模型把整段运动烘成
  // 249 个 morph target（每个目标一套 POSITION），一个 glb 能到 8 MB。
  // 同时把 morph target 数据本身也丢掉（只删动画通道不会删 accessor）。
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      if (channel.getTargetPath() === 'weights') animation.removeChannel(channel);
    }
    if (!animation.listChannels().length) animation.dispose();
  }
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) target.dispose();
    }
  }
  // 逐材质烘焙的模型（mining_machine 有 190 张图）按张数反比降分辨率：
  // 远景里每张图只占几十像素，256² 足够；不合并贴图（合并会毁掉零件的独立涂装）。
  const textureCount = doc.getRoot().listTextures().length;
  const textureSize = textureCount > 32 ? Math.min(config.texture, 256)
    : textureCount > 8 ? Math.min(config.texture, 512)
    : config.texture;
  // 纹理：缩放 + 去饱和 + 转 webp 一次做完（gltf-transform 的 resize 走 `fit: fill`
  // 会拉歪非方图，所以缩放自己用 sharp 做）。
  // 去饱和到约 35% 是「不同作者同屏色调统一」的关键：作者们各用一套彩色贴图，
  // 直接搬进场景会五彩斑斓；压到 35% 后由阵营色（乘在 baseColorFactor 上）主导，
  // 只保留贴图里的明暗与材质层次。
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const meta = await sharp(Buffer.from(image)).metadata();
    let pipeline = sharp(Buffer.from(image));
    if (Math.max(meta.width ?? 0, meta.height ?? 0) > textureSize) {
      pipeline = pipeline.resize(textureSize, textureSize, { fit: 'inside', kernel: 'lanczos3' });
    }
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length / info.channels; i++) {
      const offset = i * info.channels;
      const r = data[offset], g = data[offset + 1], b = data[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mix = (channel) => Math.round(luma + (channel - luma) * DESATURATE);
      data[offset] = mix(r); data[offset + 1] = mix(g); data[offset + 2] = mix(b);
    }
    const encoded = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .webp({ quality: 82 })
      .toBuffer();
    texture.setImage(new Uint8Array(encoded)).setMimeType('image/webp');
  }
  // 坐标：居中落地（Y 上、正面 +Z 由原模型决定，yaw 在映射表里修）
  // 坐标：居中落地 + 缩到最长边 1。join/flatten 之后顶点已是世界坐标（节点变换为单位阵），
  // 所以直接改顶点数组——按节点缩放会在嵌套层级上累乘（scout 被压到 0.002）。
  // 炮塔拆分放在 fit 之前：拆分按 pivot 比例切，两者都在未缩放坐标下做。
  if (config.turret) splitTurret(doc, config.turretPivot ?? 0.45);
  const fitted = fitToUnit(doc);
  const outName = role === 'primary' ? `${type}.glb` : `${type}-alt.glb`;
  const outDir = role === 'primary' ? OUT : ALT_OUT;
  await mkdir(outDir, { recursive: true });
  // meshopt 压缩：GLTFLoader 需 MeshoptDecoder（已在场景侧配置）。
  await doc.transform(meshopt({ encoder: MeshoptEncoder }));
  await io.write(resolve(outDir, outName), doc);
  const after = triangleCount(doc.getRoot());
  return { type, role, out: outName, trisBefore: before, trisMerged: finalMerged, meshes: meshCount, trisAfter: after, size: fitted?.size, animated: doc.getRoot().listAnimations().length > 0, skins: doc.getRoot().listSkins().length };
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
    else console.log(`✓ ${type}/${role} → ${result.out} tris ${result.trisBefore} → ${result.trisAfter}（合并后 ${result.trisMerged}）size ${(result.size ?? []).join('×')}`);
  }
}
await writeFile(resolve(here, 'normalize-report.json'), JSON.stringify(results, null, 2));
