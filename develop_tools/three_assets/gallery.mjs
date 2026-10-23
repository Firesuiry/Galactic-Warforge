/**
 * 建筑/单位模型画廊：固定机位 1200×1000，逐项出「俯视 / 斜视 45° / 侧视」三视图，
 * 每类模型出己方 / 敌方 / 黑雾三套涂装，另出程序化模型对照图（修前）。
 *
 * 用途：主代理选型与验收（同机位、同比例尺、同灯光）。
 * 用法：
 *   cd client-web && npx vite --port 24623   # 另一个终端（本分支专用端口）
 *   node develop_tools/three_assets/gallery.mjs <输出目录> [--only type1,type2] [--alt]
 *
 * 输出：
 *   <type>-<view>-<faction>.png   三视图 × 三涂装（view ∈ top/iso/side，faction ∈ own/enemy/fog）
 *   <type>-procedural.png         程序化模型对照（同机位、己方涂装）
 *   <type>-alt-<view>-<faction>.png 备选模型（--alt 时）
 *   gallery.json                  每个模型的三角数、纹理尺寸、文件大小
 * 比例尺：地面棋盘每格 1 cell。
 *
 * 涂装口径与接入方案一致（step 8）：贴图已在规整阶段去饱和到 35%，这里再乘阵营主色，
 * 自发光件换成阵营发光色。这样主代理看到的就是接入后的观感。
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(resolve(root, 'client-web/package.json'));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const output = resolve(args[0] ?? 'tmp/3a-models/gallery');
const viteArg = args.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:24623';
const withAlt = args.includes('--alt');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1].split(',') : [];

/** 建筑：类型 → 占地（与 server/internal/model/building_defs.go 一致）。 */
const BUILDINGS = [
  ['battlefield_analysis_base', 5, 5], ['barracks', 3, 3], ['vehicle_factory', 5, 5], ['airfield', 5, 5],
  ['ray_receiver', 5, 5], ['em_rail_ejector', 5, 5], ['vertical_launching_silo', 5, 5], ['artificial_star', 5, 5],
  ['oil_extractor', 3, 3], ['mining_machine', 3, 3], ['tesla_tower', 2, 2], ['accumulator', 2, 2],
  ['thermal_power_plant', 3, 3], ['matrix_lab', 3, 3], ['oil_refinery', 3, 3], ['storage_tank', 2, 2],
  ['gauss_turret', 2, 2], ['laser_turret', 2, 2], ['missile_turret', 2, 2], ['plasma_turret', 2, 2],
  ['anti_air_turret', 2, 2],
];
/** 单位：类型 → 场景归一化系数（step 8 口径：executor 1.1 / mecha 1.0 / 车辆 .8 / 步兵 .55 / 无人机 .5）。 */
const UNITS = [
  ['executor', 1.1], ['mecha', 1.0], ['soldier', 0.55], ['worker', 0.55], ['scout', 0.8],
  ['attack_drone', 0.5], ['artillery', 0.8], ['missile_vehicle', 0.8], ['repair_vehicle', 0.8],
  ['supply_truck', 0.8], ['dark_fog', 0.8], ['ship', 0.8], ['cargo_ship', 0.8],
];

const selection = JSON.parse(await readFile(resolve(here, '../sketchfab/selection.json'), 'utf8'));
const types = [...BUILDINGS.map(([type]) => type), ...UNITS.map(([type]) => type)]
  .filter((type) => !only.length || only.includes(type));

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const stats = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', (error) => console.error(error));
  page.on('console', (message) => { if (message.type() === 'error') console.error('[page]', message.text()); });
  await page.goto(viteArg);
  // three 的 examples 在仓库根的 node_modules 下（client-web 没有自己的 node_modules），
  // 用 vite 的 /@fs 绝对路径导入 meshopt 解码器。
  await page.evaluate((libs) => { window.__threeLibs = libs; }, resolve(root, 'node_modules/three/examples/jsm/libs'));
  // 备选模型在 tmp/ 下（不入产物），vite 只服务 client-web/public，所以走 /@fs 绝对路径。
  await page.evaluate((dir) => { window.__altDir = dir; }, resolve(root, 'tmp/3a-models/alt'));
  await page.evaluate(async () => {
    const THREE = await import('/@id/three');
    const { RoomEnvironment } = await import('/@id/three/examples/jsm/environments/RoomEnvironment.js');
    const { GLTFLoader } = await import('/@id/three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('/@fs' + window.__threeLibs + '/meshopt_decoder.module.js');
    const { IndustrialModels } = await import('/src/features/planet-map/three/industrial-models.ts');
    const palette = await import('/src/features/planet-map/three/palette.ts');

    const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 1000); renderer.setPixelRatio(1);
    renderer.setClearColor(0x1b2b35); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(); const environment = pmrem.fromScene(room, 0.05);
    scene.environment = environment.texture; scene.environmentIntensity = 0.32;
    scene.add(new THREE.HemisphereLight(0xb6dafa, 0x384044, 0.75));
    const sun = new THREE.DirectionalLight(0xffe5c1, 3.5); sun.position.set(-4, 7, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.1, far: 40 });
    sun.shadow.normalBias = 0.02; scene.add(sun);
    const rim = new THREE.DirectionalLight(0x719dc7, 0.75); rim.position.set(4, 3, -5); scene.add(rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.95, metalness: 0.05 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(60, 60, 0x54707e, 0x3a4d57);
    grid.position.y = 0.002; scene.add(grid);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    // 三个固定机位：俯视 / 斜视 45° / 侧视。
    const VIEWS = {
      top: new THREE.Vector3(0, 1, 0.0001).normalize(),
      iso: new THREE.Vector3(0.75, 0.85, 1.15).normalize(),
      side: new THREE.Vector3(1, 0.12, 0.0001).normalize(),
    };
    const FAC = {
      own: { armor: palette.FACTION.own.ceramic, glow: palette.GLOW.own },
      enemy: { armor: palette.FACTION.enemy.ceramic, glow: palette.GLOW.enemy },
      fog: { armor: palette.FACTION.fog.ceramic, glow: palette.GLOW.fog },
    };

    /** 量 emissive 贴图的平均亮度（4×4 采样即可），低于阈值的不算发光件。 */
    const emissiveMean = async (map) => {
      const image = map.image;
      if (!image) return 0;
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, 8, 8);
      const { data } = context.getImageData(0, 0, 8, 8);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      return sum / (data.length / 4);
    };
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const templates = new Map();
    const loadModel = async (name, url) => {
      if (!templates.has(name)) {
        const gltf = await loader.loadAsync(url ?? `/assets/models/sketchfab/${name}.glb`);
        gltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          const material = object.material;
          if (material?.emissiveMap) material.userData.galleryEmissiveMeanPromise = emissiveMean(material.emissiveMap);
        });
        templates.set(name, gltf.scene);
      }
      const scene = templates.get(name);
      // 先把所有 emissive 亮度量完，再按阵营涂装。
      await Promise.all([...new Set(scene.children)].flatMap(() => []));
      const pending = [];
      scene.traverse((object) => {
        const material = object.material;
        if (material?.userData?.galleryEmissiveMeanPromise) pending.push(material.userData.galleryEmissiveMeanPromise.then((mean) => { material.userData.galleryEmissiveMean = mean; }));
      });
      await Promise.all(pending);
      return scene;
    };

    /** 阵营涂装：底色乘阵营主色、自发光换成阵营发光色；同一份模板只克隆一次材质。 */
    const paint = (sceneRoot, faction) => {
      const { armor, glow } = FAC[faction];
      const armorColor = new THREE.Color(armor);
      const glowColor = new THREE.Color(glow);
      const materials = new Map();
      sceneRoot.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true; object.receiveShadow = true;
        const source = object.material;
        let material = materials.get(source);
        if (!material) {
          material = source.clone();
          // 与 `industrial-gltf.ts` 的 `preparePalette` 同口径：底色一律是阵营装甲色；
          // 发光件（有 emissive 贴图**且** 8×8 采样均值 > 20）只额外点亮自发光。
          // 阈值 8 太低——dark_fog 的躯体贴图均值 13.7，会把整台染成发光色。
          material.color.copy(armorColor);
          const glowPart = Boolean(source.emissiveMap) && (source.userData.galleryEmissiveMean ?? 0) > 20;
          if (glowPart) {
            material.emissive.copy(glowColor);
            material.emissiveIntensity = 2.2;
          } else {
            material.emissive.setRGB(0, 0, 0);
            material.emissiveIntensity = 0;
          }
          if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
          materials.set(source, material);
        }
        object.material = material;
      });
    };

    // 画廊按「最长边」归一化到 span（场景里单位按 footprint 归一化，高模型会被裁出画幅）。
    const fit = (object, span) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const scale = span / Math.max(size.x, size.y, size.z, 1e-4);
      object.scale.setScalar(scale);
      const scaled = new THREE.Box3().setFromObject(object);
      const center = scaled.getCenter(new THREE.Vector3());
      object.position.set(-center.x, -scaled.min.y, -center.z);
      const wrapper = new THREE.Group();
      wrapper.add(object);
      // 机位对准包围盒中心高度（否则高模型会被画幅上沿裁掉）。
      wrapper.userData.aimY = (scaled.max.y - scaled.min.y) / 2;
      return wrapper;
    };

    const shoot = (object, span, view) => {
      scene.add(object);
      const direction = VIEWS[view];
      camera.left = -span * 0.6; camera.right = span * 0.6;
      camera.top = span * 0.68; camera.bottom = -span * 0.68;
      const aimY = object.userData.aimY ?? span * 0.18;
      camera.position.copy(direction).multiplyScalar(30).add(new THREE.Vector3(0, aimY, 0));
      camera.lookAt(0, aimY, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL('image/png');
      scene.remove(object);
      return image;
    };

    /** 首选 + 备选（--alt）：备选 GLB 在 tmp/3a-models/alt/，经 vite 的 /@fs 读，不能走 public 路径。 */
    const variantsFor = (type, withAlt) => {
      const variants = [{ name: type, suffix: '', url: `/assets/models/sketchfab/${type}.glb` }];
      if (withAlt) variants.push({ name: `${type}-alt`, suffix: '-alt', url: `/@fs${window.__altDir}/${type}-alt.glb` });
      return variants;
    };

    window.gallery = async ({ buildings, units, withAlt }) => {
      const models = new IndustrialModels();
      await IndustrialModels.preload();
      models.reloadTemplates();
      const out = [];
      const FACTION_KEYS = ['own', 'enemy', 'fog'];
      for (const [type, w, d] of buildings) {
        const span = Math.max(w * 0.86, d * 0.86) * 2.6 + 0.6;
        for (const variant of variantsFor(type, withAlt)) {
          let template;
          try { template = await loadModel(variant.name, variant.url); } catch { continue; }
          for (const view of ['top', 'iso', 'side']) {
            for (const faction of FACTION_KEYS) {
              const clone = template.clone(true);
              paint(clone, faction);
              out.push({ file: `${type}${variant.suffix}-${view}-${faction}`, image: shoot(fit(clone, span), span, view) });
            }
          }
        }
        const procedural = models.building(type, w * 0.86, d * 0.86, true);
        out.push({ file: `${type}-procedural`, image: shoot(procedural, span, 'iso') });
      }
      for (const [type, scale] of units) {
        const span = 2.4 * scale;
        for (const variant of variantsFor(type, withAlt)) {
          let template;
          try { template = await loadModel(variant.name, variant.url); } catch { continue; }
          for (const view of ['top', 'iso', 'side']) {
            for (const faction of FACTION_KEYS) {
              const clone = template.clone(true);
              paint(clone, faction);
              out.push({ file: `unit-${type}${variant.suffix}-${view}-${faction}`, image: shoot(fit(clone, span), span, view) });
            }
          }
        }
        const procedural = models.unit(type, 'own');
        out.push({ file: `unit-${type}-procedural`, image: shoot(procedural, span, 'iso') });
      }
      return out;
    };
  });

  const shots = await page.evaluate(({ buildings, units, withAlt }) => window.gallery({ buildings, units, withAlt }), {
    buildings: BUILDINGS.filter(([type]) => types.includes(type)),
    units: UNITS.filter(([type]) => types.includes(type)),
    withAlt,
  });

  await mkdir(output, { recursive: true });
  for (const shot of shots) {
    await writeFile(resolve(output, `${shot.file}.png`), Buffer.from(shot.image.split(',')[1], 'base64'));
  }
  console.log(`Rendered ${shots.length} images to ${output}`);

  // 统计：文件大小从产物读；三角数/作者/许可从选型清单读（原始面数，规整后的见 normalize-report.json）。
  const modelsDir = resolve(root, 'client-web/public/assets/models/sketchfab');
  for (const type of types) {
    const entry = selection[type]?.primary;
    if (!entry) continue;
    const file = resolve(modelsDir, `${type}.glb`);
    let bytes = 0;
    try { bytes = (await stat(file)).size; } catch { continue; }
    stats.push({ type, file: `${type}.glb`, bytes, faces: entry.faces, author: entry.author, license: entry.license, name: entry.name });
  }
  await writeFile(resolve(output, 'gallery.json'), JSON.stringify(stats, null, 2));
} finally {
  await browser.close();
}
