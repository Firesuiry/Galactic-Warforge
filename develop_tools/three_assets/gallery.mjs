/**
 * 建筑/单位模型画廊：固定机位 1200×1000，逐项出「程序化模型 / 现成 GLB」成对图。
 *
 * 用途：换素材前后对照（同一套灯光、同一机位、同一比例尺），以及核对每类模型的比例。
 * 用法：
 *   cd client-web && npx vite --port 4173   # 另一个终端
 *   node develop_tools/three_assets/gallery.mjs <输出目录> [vite地址] [--units]
 *
 * 输出 `<type>-before.png`（IndustrialModels 程序化）与 `<type>-after.png`（GLB，没加载到就是程序化）。
 * 机位固定为 3/4 视角正交相机，视锥按占地大小（cell）算，所以同一张图里能直接量比例：
 * 地面棋盘每格 1 cell。
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'client-web/package.json'));
const { chromium } = require('@playwright/test');
const output = resolve(process.argv[2] ?? '/tmp/kenney-gallery');
const viteArg = process.argv.slice(3).find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:4173';
const units = process.argv.includes('--units');
await mkdir(output, { recursive: true });

const BUILDINGS = [
  ['assembling_machine_mk1', 3, 3], ['assembling_machine_mk2', 3, 3], ['assembling_machine_mk3', 3, 3], ['recomposing_assembler', 3, 3],
  ['chemical_plant', 3, 3], ['quantum_chemical_plant', 3, 3], ['barracks', 3, 3], ['supply_station', 3, 3],
  ['vehicle_factory', 5, 5], ['airfield', 5, 5], ['ray_receiver', 5, 5], ['em_rail_ejector', 5, 5],
  ['artificial_star', 5, 5], ['planetary_shield_generator', 5, 5], ['jammer_tower', 2, 2], ['signal_tower', 1, 1],
  ['water_pump', 3, 3], ['orbital_collector', 1, 1], ['automatic_piler', 1, 1],
];
const UNITS = ['worker', 'soldier', 'scout', 'attack_drone', 'logistics_drone', 'logistics_ship', 'logistics_bot', 'transport_robot', 'executor'];

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', error => console.error(error));
  await page.goto(viteArg);
  await page.evaluate(async () => {
    const THREE = await import('/@id/three');
    const { RoomEnvironment } = await import('/@id/three/examples/jsm/environments/RoomEnvironment.js');
    const { IndustrialModels } = await import('/src/features/planet-map/three/industrial-models.ts');
    const gltf = await import('/src/features/planet-map/three/industrial-gltf.ts');
    await gltf.preloadIndustrialGltf();
    const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 1000); renderer.setPixelRatio(1);
    renderer.setClearColor(0x1b2b35); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(), models = new IndustrialModels();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(); const environment = pmrem.fromScene(room, 0.05);
    scene.environment = environment.texture; scene.environmentIntensity = 0.5;
    scene.add(new THREE.HemisphereLight(0xc6e8ff, 0x526370, 0.8));
    const sun = new THREE.DirectionalLight(0xffe6cb, 3.2); sun.position.set(-4, 7, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.1, far: 40 });
    sun.shadow.normalBias = 0.02; scene.add(sun);
    const rim = new THREE.DirectionalLight(0x78c4ff, 1.6); rim.position.set(4, 3, -5); scene.add(rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x2b3a44, roughness: 0.9, metalness: 0.05 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    // 1 cell = 1 单位：地面棋盘就是比例尺。
    const grid = new THREE.GridHelper(60, 60, 0x54707e, 0x3a4d57);
    grid.position.y = 0.002; scene.add(grid);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const DIRECTION = new THREE.Vector3(0.75, 0.85, 1.15).normalize();

    const shoot = (root, span) => {
      scene.add(root);
      camera.left = -span * 0.6; camera.right = span * 0.6;
      camera.top = span * 0.5; camera.bottom = -span * 0.5;
      camera.position.copy(DIRECTION).multiplyScalar(30).add(new THREE.Vector3(0, span * 0.18, 0));
      camera.lookAt(0, span * 0.18, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL('image/png');
      scene.remove(root);
      return image;
    };

    window.gallery = async ({ buildings, units }) => {
      const out = [];
      for (const [type, w, d] of buildings) {
        // 占地 .86 内缩，和场景里 `building(w*.86, d*.86)` 完全一致。
        const width = w * 0.86, depth = d * 0.86;
        const span = Math.max(width, depth) * 2.6 + 0.6;
        out.push({ file: `${type}-before`, image: shoot(models.building(type, width, depth, true), span) });
        const gltfModel = gltf.instantiateBuilding(type, width, depth, true);
        out.push({ file: `${type}-after`, image: shoot(gltfModel ?? models.building(type, width, depth, true), span) });
      }
      if (units) {
        for (const type of units) {
          const span = 2.4;
          out.push({ file: `unit-${type}-before`, image: shoot(models.unit(type, 'own'), span) });
          const gltfModel = gltf.instantiateUnit(type, 'own');
          out.push({ file: `unit-${type}-after`, image: shoot(gltfModel ?? models.unit(type, 'own'), span) });
        }
      }
      return out;
    };
  });
  const shots = await page.evaluate(({ buildings, units }) => window.gallery({ buildings, units }), { buildings: BUILDINGS, units });
  for (const shot of shots) {
    await writeFile(resolve(output, `${shot.file}.png`), Buffer.from(shot.image.split(',')[1], 'base64'));
  }
  console.log(`Rendered ${shots.length} images to ${output}`);
} finally {
  await browser.close();
}
