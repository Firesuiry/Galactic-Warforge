/**
 * §2.1 自动搬运前端验收截图（真实显卡）。
 *
 * 起一个 chromium（--use-angle=vulkan 直连本机 GPU），登录到 dev 前端
 * （VITE_SW_PROXY_TARGET 指向验收服务端），先在电塔半径内补建 2 座空熔炉
 * （制造「缺料需求」让自动模式重新派单），再在 3D 星球上选中一台正在执行
 * 任务的自动模式运输机器人，截图「供给→需求虚线 + 自动：送 … → … 胶囊」，
 * 打开详情看「运输模式」行，最后切 2D 再截一张。
 *
 * 在 client-web 目录下运行：
 *   SW_WEB=http://127.0.0.1:15173 SW_BACKEND=http://127.0.0.1:19870 \
 *     node scripts/robot-auto-evidence.mjs
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const web = process.env.SW_WEB ?? 'http://127.0.0.1:15173';
const backend = process.env.SW_BACKEND ?? 'http://127.0.0.1:19870';
const outDir = process.env.SW_SHOT_DIR ?? '../tmp/robot-auto/evidence/shots';
const planetId = 'planet-1-1';
mkdirSync(outDir, { recursive: true });

const auth = { authorization: 'Bearer key_player_1', 'content-type': 'application/json' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let requestSeq = 0;

/** scene 只在带 near_x/near_y/radius 时返回建筑与单位。 */
async function scene(near, half = 30) {
  const query = new URLSearchParams({
    x: String(near.x - half), y: String(near.y - half), width: String(half * 2), height: String(half * 2),
    near_x: String(near.x), near_y: String(near.y), radius: String(Math.max(48, half + 8)),
  });
  const response = await fetch(`${backend}/world/planets/${planetId}/scene?${query}`, { headers: auth });
  if (!response.ok) throw new Error(`scene ${response.status}`);
  return response.json();
}

async function post(commandType, target, payload) {
  requestSeq += 1;
  const response = await fetch(`${backend}/commands`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      request_id: `shot-${requestSeq}-${Date.now()}`,
      issuer_type: 'player',
      issuer_id: 'p1',
      commands: [{ type: commandType, target, payload }],
    }),
  });
  const body = await response.json();
  const result = body.results?.[0];
  console.log(commandType, result?.status, result?.message ?? result?.code);
  return result;
}

function occupied(data) {
  const cells = new Set();
  for (const building of Object.values(data.buildings ?? {})) {
    const footprint = building.runtime?.params?.footprint ?? { width: 1, height: 1 };
    for (let dy = 0; dy < footprint.height; dy++) {
      for (let dx = 0; dx < footprint.width; dx++) cells.add(`${building.position.x + dx}:${building.position.y + dy}`);
    }
  }
  return cells;
}

/** 在 center 附近（曼哈顿距离 ≤ maxDistance、整块 footprint 在窗口内）找空平地。 */
async function findSpot(center, width, height, maxDistance, minDistance = 1) {
  const origin = { x: center.x - 16, y: center.y - 16 };
  const data = await scene(center, 17);
  const cells = occupied(data);
  const inside = (tile) => tile.x >= origin.x && tile.y >= origin.y
    && tile.x + width <= origin.x + 34 && tile.y + height <= origin.y + 34;
  for (let distance = minDistance; distance <= maxDistance; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      const dy = distance - Math.abs(dx);
      for (const offsetY of dy === 0 ? [0] : [-dy, dy]) {
        const tile = { x: center.x + dx, y: center.y + offsetY };
        if (!inside(tile)) continue;
        let ok = true;
        for (let y = 0; y < height && ok; y++) {
          for (let x = 0; x < width; x++) {
            if (data.terrain[tile.y + y - origin.y]?.[tile.x + x - origin.x] !== 'buildable') { ok = false; break; }
            if (cells.has(`${tile.x + x}:${tile.y + y}`)) { ok = false; break; }
          }
        }
        if (ok) return tile;
      }
    }
  }
  throw new Error(`no spot within ${maxDistance} of ${center.x},${center.y}`);
}

async function main() {
  // 0) 造需求：补 2 座空熔炉 + 给仓库补铁矿（自动模式才会重新派单）。
  const base = await scene({ x: 42, y: 26 }, 24);
  const tower = Object.values(base.buildings ?? {}).find((b) => b.type === 'tesla_tower');
  const depot = Object.values(base.buildings ?? {}).find((b) => b.type === 'depot_mk1');
  if (!tower || !depot) throw new Error('tower/depot missing');
  await post('transfer', { layer: 'planet', entity_id: depot.id, planet_id: planetId }, { item_id: 'iron_ore', quantity: 60 });
  for (let i = 0; i < 2; i++) {
    const spot = await findSpot(tower.position, 3, 3, 11, 4);
    await post('build', { layer: 'planet', position: { ...spot, z: 0 }, planet_id: planetId }, { building_type: 'arc_smelter', recipe_id: 'smelt_iron' });
  }

  const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (error) => console.log('pageerror:', error.message));
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
      state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0,
    }));
  }, web);
  await page.goto(`${web}/planet/${planetId}`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.project), null, { timeout: 60_000 });

  // 1) 等一台正在执行任务的自动模式机器人（有 to_building_id）。
  let robot = null;
  for (let attempt = 0; attempt < 90 && !robot; attempt++) {
    const data = await scene({ x: 42, y: 26 }, 30);
    robot = Object.values(data.units ?? {}).find((unit) => unit.type === 'transport_robot'
      && unit.owner_id === 'p1' && unit.haul?.mode === 'auto' && unit.haul?.to_building_id) ?? null;
    if (!robot) await sleep(2000);
  }
  if (!robot) throw new Error('no auto-mode robot with an active task');
  console.log('robot', robot.id, JSON.stringify(robot.haul));

  const clickTile = async (tile) => {
    await page.evaluate((point) => window.__planetThree.focus(point, true), tile);
    await sleep(900);
    const position = await page.evaluate((point) => window.__planetThree.project(point), tile);
    if (!position.visible) throw new Error(`tile ${tile.x},${tile.y} not visible`);
    await page.locator('.planet-three__surface canvas').click({ position: { x: position.x, y: position.y } });
  };

  await clickTile(robot.position);
  await sleep(1800);
  const bar = page.getByTestId('planet-selection-bar');
  await bar.waitFor({ timeout: 15_000 });
  console.log('selection bar:', ((await bar.textContent()) ?? '').replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: `${outDir}/01-3d-auto-robot.png` });

  // 2) 详情抽屉：「运输模式」行。
  await bar.getByRole('button', { name: '详情', exact: true }).click();
  await sleep(1500);
  await page.screenshot({ path: `${outDir}/02-3d-auto-detail.png` });

  // 3) 2D 平面战术视图：任务虚线 + 胶囊。
  await page.getByRole('button', { name: '平面战术' }).click();
  await sleep(2500);
  await page.screenshot({ path: `${outDir}/03-2d-auto-robot.png` });

  const final = await scene({ x: robot.position.x, y: robot.position.y }, 30);
  const robots = Object.values(final.units ?? {}).filter((unit) => unit.type === 'transport_robot');
  console.log('robots at end:', robots.map((unit) => `${unit.id}:${unit.haul?.mode}/${unit.haul?.phase}`).join(' '));
  await browser.close();
  console.log('shots ->', outDir);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
