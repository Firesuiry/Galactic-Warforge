/** Render original IndustrialModels into transparent HUD thumbnails.
 * Run Vite on :4173, then: node develop_tools/three_assets/render.mjs
 * Optional first argument sets a different Vite URL.
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
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { RoomEnvironment } = await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js');
    const { IndustrialModels } = await import('/src/features/planet-map/three/industrial-models.ts');
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(256, 256); renderer.setPixelRatio(1);
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(), models = new IndustrialModels();
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
    window.renderIndustrialThumbnail = type => {
      models.clearAnimations();
      const model = models.building(type, 1, 1, true); scene.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      camera.position.copy(center).add(new THREE.Vector3(3, 2.6, 4)); camera.lookAt(center);
      camera.updateMatrixWorld(true);
      const cameraBounds = new THREE.Box3();
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) cameraBounds.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
      const size = cameraBounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x,size.y)*0.56;
      camera.left=-span;camera.right=span;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();
      renderer.render(scene,camera); const image=renderer.domElement.toDataURL('image/png');scene.remove(model);return image;
    };
  });
  for(const type of types) {
    const data = await page.evaluate(type => window.renderIndustrialThumbnail(type), type);
    await writeFile(resolve(output, `${type}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  // Contact sheet is a review artifact, not part of the game's downloadable assets.
  const featured = ['battlefield_analysis_base','wind_turbine','mining_machine','arc_smelter','assembling_machine_mk1','matrix_lab','planetary_logistics_station','depot_mk1','tesla_tower','solar_panel','conveyor_belt_mk1','sorter_mk1'];
  await page.setContent(`<style>body{margin:0;background:#14212b;color:#d9e5e9;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(4,280px);gap:12px;padding:22px}figure{margin:0;background:radial-gradient(ellipse at 50% 38%,#30444f,#1b2b35 75%);border:1px solid #45606b;text-align:center;border-radius:8px}img{width:256px;height:256px}figcaption{padding:0 0 15px}</style><main>${featured.map(type=>`<figure><img src="${process.argv[2]??'http://127.0.0.1:4173'}/assets/buildings/${type}.png"><figcaption>${type}</figcaption></figure>`).join('')}</main>`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({path:'/tmp/industrial-assets.png',fullPage:true});
  console.log(`Rendered ${types.length} transparent 256×256 PNGs to ${output}`);
  console.log('Review sheet: /tmp/industrial-assets.png');
} finally {await browser.close();}
