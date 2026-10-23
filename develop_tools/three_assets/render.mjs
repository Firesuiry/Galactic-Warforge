/** Render original IndustrialModels into transparent HUD thumbnails.
 * Run Vite on :4173, then: node develop_tools/three_assets/render.mjs
 * Optional first argument sets a different Vite URL.
 *
 * 分拣器（sorter_mk1/2/3、pile_sorter）例外：场景里它们由 `sorter-rig` 实例化绘制，
 * `IndustrialModels.building()` 对 `/sorter/` 返回空组（场景依赖这个语义），直接渲染会得到
 * 全透明图。这 4 类改用同一份 `SorterRigs` 组一个静态分拣器：两端各接一格带子、
 * 摆臂收拢在取货端抬起（`staticPose`），档位色（mk1 琥珀 / mk2 绿 / mk3 蓝 / 集装紫）由
 * `tierColor` 写在灯条、端点座与流向三角上，与场景里的配色一致。
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'client-web/package.json'));
const { chromium } = require('@playwright/test');
const definitions = await readFile(resolve(root, 'server/internal/model/building_defs.go'), 'utf8');
const types = [...new Set([...definitions.matchAll(/BuildingType\s*=\s*"([^"]+)"/g)].map(match => match[1]))];
const output = resolve(root, 'client-web/public/assets/buildings');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', error => console.error(error));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4173');
  await page.evaluate(async () => {
    const THREE = await import('/@id/three');
    const { RoomEnvironment } = await import('/@id/three/examples/jsm/environments/RoomEnvironment.js');
    const { IndustrialModels } = await import('/src/features/planet-map/three/industrial-models.ts');
    const { SorterRigs } = await import('/src/features/planet-map/three/sorter-rig.ts');
    const { surfaceTileSize, tileNormal } = await import('/src/features/planet-map/three/projection.ts');
    const { BELT_BASE_LIFT } = await import('/src/features/planet-map/three/conveyor-geometry.ts');
    /** 场景里由 sorter-rig 绘制的类型（`IndustrialModels.building()` 对它们返回空组）。 */
    const SORTER_TYPES = new Set(['sorter_mk1', 'sorter_mk2', 'sorter_mk3', 'pile_sorter']);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(256, 256); renderer.setPixelRatio(1);
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(), models = new IndustrialModels();
    // 缩略图必须画 GLB：先等现成模型加载完再清模板，否则拿到的是程序化回退模型。
    await IndustrialModels.preload();
    models.reloadTemplates();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(); const environment = pmrem.fromScene(room, 0.05);
    scene.environment = environment.texture; scene.environmentIntensity = 0.6;
    scene.add(new THREE.HemisphereLight(0xc6e8ff, 0x526370, 0.7));
    const sun = new THREE.DirectionalLight(0xffe6cb, 3.5); sun.position.set(-3, 5, 4); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {left:-2,right:2,top:2,bottom:-2,near:0.1,far:20});
    sun.shadow.normalBias = 0.012; sun.shadow.bias = -0.0001; scene.add(sun);
    const rim = new THREE.DirectionalLight(0x78c4ff, 2); rim.position.set(3, 2, -4); scene.add(rim);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    /**
     * 静态分拣器：一格分拣器 + 两侧各一格带子（取货端在西、放货端在东，两端都接上），
     * 摆臂收拢在取货端并抬起，不带货物。与场景同一套 `SorterRigs`，配色/几何完全一致。
     */
    const sorterThumbnail = type => {
      const rigs = new SorterRigs({ staticPose: { swing: 0, lift: 1, carrying: false } });
      const sorter = { id: 'sorter', type, position: { x: 8, y: 8, z: 0 }, owner_id: 'p1', rotation: 90,
        runtime: { state: 'running' }, sorter: { cycle_ticks: 6, range: 1 } };
      const belt = (id, x) => ({ id, type: 'conveyor_belt_mk1', position: { x, y: 8, z: 0 }, owner_id: 'p1',
        runtime: { state: 'running' }, conveyor: { input: 'west', output: 'east' } });
      // faceSize 16 / radius 100：与夹具同口径的格宽（缩略图相机会按包围盒自适应，尺度不影响画面）。
      rigs.refresh([sorter], [sorter, belt('west', 7), belt('east', 9)], 16, 100, 0);
      // SorterRigs 按球面坐标把实例放到半径 100 的球面上；缩略图要和其他建筑一样落在原点，
      // 否则会跑出固定光照的阴影相机（[-2,2]）之外，阴影消失、画面比同类缩略图暗一档。
      rigs.group.position.copy(tileNormal({ x: 8, y: 8 }, 16))
        .multiplyScalar(-(100 + surfaceTileSize(100, 16) * BELT_BASE_LIFT));
      return rigs;
    };
    window.renderIndustrialThumbnail = type => {
      models.clearAnimations();
      const rigs = SORTER_TYPES.has(type) ? sorterThumbnail(type) : null;
      const model = rigs ? rigs.group : models.building(type, 1, 1, true);
      scene.add(model);
      // 分拣器：隐藏的 payload 实例矩阵是零缩放、落在原点，直接 setFromObject 会把包围盒拉到原点
      // 导致模型缩成一小团。只量真正画出来的部件（payload 在静态姿势里始终隐藏）。
      // 分拣器的 group 刚被平移到原点，世界矩阵还没算过；不先更新的话 setFromObject 会按球面上的旧位置量。
      if (rigs) rigs.group.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      if (rigs) {
        for (const child of rigs.group.children) {
          if (child.name === 'sorter-payload') continue;
          bounds.union(new THREE.Box3().setFromObject(child));
        }
      } else {
        bounds.setFromObject(model);
      }
      const center = bounds.getCenter(new THREE.Vector3());
      camera.position.copy(center).add(new THREE.Vector3(3, 2.6, 4)); camera.lookAt(center);
      camera.updateMatrixWorld(true);
      const cameraBounds = new THREE.Box3();
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) cameraBounds.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
      const size = cameraBounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x,size.y)*0.56;
      camera.left=-span;camera.right=span;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();
      renderer.render(scene,camera); const image=renderer.domElement.toDataURL('image/png');scene.remove(model);rigs?.dispose();return image;
    };
  });
  for(const type of types) {
    const data = await page.evaluate(type => window.renderIndustrialThumbnail(type), type);
    await writeFile(resolve(output, `${type}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  // Contact sheet is a review artifact, not part of the game's downloadable assets.
  const featured = ['battlefield_analysis_base','wind_turbine','mining_machine','arc_smelter','assembling_machine_mk1','matrix_lab','planetary_logistics_station','depot_mk1','tesla_tower','solar_panel','conveyor_belt_mk1','sorter_mk1','sorter_mk2','sorter_mk3','pile_sorter','splitter'];
  await page.setContent(`<style>body{margin:0;background:#14212b;color:#d9e5e9;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(4,280px);gap:12px;padding:22px}figure{margin:0;background:radial-gradient(ellipse at 50% 38%,#30444f,#1b2b35 75%);border:1px solid #45606b;text-align:center;border-radius:8px}img{width:256px;height:256px}figcaption{padding:0 0 15px}</style><main>${featured.map(type=>`<figure><img src="${process.argv[2]??'http://127.0.0.1:4173'}/assets/buildings/${type}.png"><figcaption>${type}</figcaption></figure>`).join('')}</main>`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({path:'/tmp/industrial-assets.png',fullPage:true});
  console.log(`Rendered ${types.length} transparent 256×256 PNGs to ${output}`);
  console.log('Review sheet: /tmp/industrial-assets.png');
} finally {await browser.close();}
