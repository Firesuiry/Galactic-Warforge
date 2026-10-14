/**
 * 运输机器人全局自动模式（§2.1）真实服务端验收：
 * 建 1 仓库（装铁矿）+ 3 熔炉 + 3 机器人，不下任何指令，观察三台熔炉都被喂料、
 * 产出增长；中途实测 auto→route→auto→idle→auto 的模式切换。
 *
 * 现场自建供电（电力感应塔 + 风力涡轮机，无线半径 12 cell），否则熔炉/基站
 * 会停在 no_power，机器人根本没有需求可救。
 *
 * 命令走 shared-client 的真实命令表（CLI 与 agent-gateway 同源），因此本脚本
 * 同时验证了 CLI 动词本身。
 *
 * SW_SERVER=http://127.0.0.1:19870 SW_ROBOT_AUTO_EVIDENCE=<dir> \
 *   node <repo>/client-cli/node_modules/.bin/tsx scripts/playtest-robot-auto.ts
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createApiClient } from '../shared-client/src/api.ts';
import { dispatchCommand } from '../shared-client/src/commands/game-commands.ts';
import { DEFAULT_GALAXY_ID, DEFAULT_PLANET_ID, DEFAULT_SYSTEM_ID } from '../shared-client/src/config.ts';

const evidence = process.env.SW_ROBOT_AUTO_EVIDENCE || '/tmp/sw-robot-auto';
const planet = 'planet-1-1';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const api = createApiClient({
  serverUrl: process.env.SW_SERVER ?? 'http://127.0.0.1:19870',
  defaultGalaxyId: DEFAULT_GALAXY_ID,
  defaultPlanetId: DEFAULT_PLANET_ID,
  defaultSystemId: DEFAULT_SYSTEM_ID,
});
api.setAuth('p1', 'key_player_1');
mkdirSync(evidence, { recursive: true });

type Tile = { x: number; y: number };
type Snapshot = Awaited<ReturnType<typeof scene>>;

/** scene 只在带 near_x/near_y/radius 时返回建筑与单位（radius 决定「关注圈」）。 */
async function scene(bounds = { x: 40, y: 30, width: 40, height: 30 }) {
  const near_x = bounds.x + Math.floor(bounds.width / 2);
  const near_y = bounds.y + Math.floor(bounds.height / 2);
  const radius = Math.max(48, Math.ceil(Math.max(bounds.width, bounds.height) / 2) + 8);
  return api.fetchPlanetScene(planet, { ...bounds, near_x, near_y, radius });
}
function buildingsOf(snapshot: Snapshot) {
  return Object.values(snapshot.buildings ?? {});
}
function unitsOf(snapshot: Snapshot) {
  return Object.values(snapshot.units ?? {});
}
function at(snapshot: Snapshot, x: number, y: number) {
  return buildingsOf(snapshot).find(b => b.position.x === x && b.position.y === y);
}
function ownedUnits(snapshot: Snapshot, type: string) {
  return unitsOf(snapshot).filter(u => u.type === type && u.owner_id === 'p1');
}
const manhattan = (a: Tile, b: Tile) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 已占格（按真实 footprint 展开；服务端 IndexBuilding 也是整块占位）。 */
function occupiedCells(snapshot: Snapshot): Set<string> {
  const cells = new Set<string>();
  for (const building of buildingsOf(snapshot)) {
    const footprint = building.runtime?.params?.footprint ?? { width: 1, height: 1 };
    for (let dy = 0; dy < footprint.height; dy++) {
      for (let dx = 0; dx < footprint.width; dx++) {
        cells.add(`${building.position.x + dx}:${building.position.y + dy}`);
      }
    }
  }
  return cells;
}

/** 视野圈外的地形不参与选址（服务端只回关注圈内的建筑）。 */
async function siteScene(from: Tile) {
  return scene({ x: from.x - 14, y: from.y - 14, width: 48, height: 44 });
}

async function command(line: string) {
  const before = await api.fetchHealth();
  const output = await dispatchCommand(line, { api });
  const requestId = output.match(/request_id=([^\s]+)/)?.[1];
  if (!requestId) throw new Error(`no request_id: ${output}`);
  for (let attempt = 0; attempt < 120; attempt++) {
    await pause(150);
    const snapshot = await api.fetchEventSnapshot({ event_types: ['command_result'], since_tick: before.tick, limit: 100 });
    const event = snapshot.events.find(e => e.payload.request_id === requestId);
    if (!event) continue;
    appendFileSync(`${evidence}/commands.jsonl`, `${JSON.stringify({ command: line, output, event })}\n`);
    if (event.payload.code !== 'OK') throw new Error(`${line} -> ${event.payload.code} ${event.payload.message}`);
    console.log(line, event.payload.code, event.payload.message ?? '');
    return event;
  }
  throw new Error(`no command_result: ${line}`);
}

/**
 * 找一块能放下 width×height 的平地：以 from 为扫描窗口左上角，窗口内按曼哈顿距离
 * 由近及远取第一块空平地（并保证整块 footprint 都在窗口内，避免越界读成 undefined）。
 */
async function findFlatSpot(width: number, height: number, from: Tile) {
  const window = { x: from.x, y: from.y, width: 60, height: 48 };
  const snapshot = await scene(window);
  const occupied = occupiedCells(snapshot);
  const candidates: { tile: Tile; distance: number }[] = [];
  for (let dy = 0; dy + height <= window.height; dy++) {
    for (let dx = 0; dx + width <= window.width; dx++) {
      const tile = { x: from.x + dx, y: from.y + dy };
      let ok = true;
      for (let y = 0; y < height && ok; y++) for (let x = 0; x < width; x++) {
        if (snapshot.terrain[dy + y]?.[dx + x] !== 'buildable') { ok = false; break; }
        if (occupied.has(`${tile.x + x}:${tile.y + y}`)) { ok = false; break; }
      }
      if (ok) candidates.push({ tile, distance: dx + dy });
    }
  }
  if (!candidates.length) throw new Error(`no flat spot ${width}x${height} from ${from.x},${from.y}`);
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].tile;
}

/**
 * 在 centers[0] 附近按曼哈顿距离由近及远找一块空平地，要求整块 footprint 落在
 * 以 centers[0] 为中心、半径 maxDistance 的窗口内，且与每个 center 的曼哈顿距离
 * 都在 [minDistance, maxDistance]（同面曼哈顿距离 = 服务端 surface.Distance）。
 */
async function findSpotNear(centers: Tile[], width: number, height: number, maxDistance: number, minDistance = 1) {
  const anchor = centers[0];
  const origin = { x: anchor.x - 16, y: anchor.y - 16 };
  const window = { ...origin, width: 34, height: 34 };
  const snapshot = await scene(window);
  const occupied = occupiedCells(snapshot);
  const inside = (tile: Tile) => tile.x >= origin.x && tile.y >= origin.y
    && tile.x + width <= origin.x + window.width && tile.y + height <= origin.y + window.height;
  const fits = (tile: Tile) => centers.every(center => {
    const distance = manhattan(tile, center);
    return distance >= minDistance && distance <= maxDistance;
  });
  for (let distance = minDistance; distance <= maxDistance; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      const dy = distance - Math.abs(dx);
      for (const offsetY of dy === 0 ? [0] : [-dy, dy]) {
        const tile = { x: anchor.x + dx, y: anchor.y + offsetY };
        if (!inside(tile) || !fits(tile)) continue;
        let ok = true;
        for (let y = 0; y < height && ok; y++) for (let x = 0; x < width; x++) {
          const cx = tile.x + x, cy = tile.y + y;
          if (snapshot.terrain[cy - origin.y]?.[cx - origin.x] !== 'buildable') { ok = false; break; }
          if (occupied.has(`${cx}:${cy}`)) { ok = false; break; }
        }
        if (ok) return tile;
      }
    }
  }
  throw new Error(`no spot within ${maxDistance} of ${anchor.x},${anchor.y}`);
}

async function waitRunning(x: number, y: number, type: string, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const building = at(await scene({ x: x - 8, y: y - 8, width: 32, height: 24 }), x, y);
    if (building && building.type === type && building.runtime.state === 'running') return building;
    await pause(300);
  }
  throw new Error(`building not running: ${type} @ ${x},${y}`);
}

async function buildAndWait(x: number, y: number, type: string, options = '') {
  await command(`build ${x} ${y} ${type} ${options}`.trim());
  return waitRunning(x, y, type);
}

function storageQty(building: { storage?: Record<string, Record<string, number> | undefined> } | undefined, item: string) {
  if (!building?.storage) return 0;
  return (building.storage.inventory?.[item] ?? 0) + (building.storage.input_buffer?.[item] ?? 0) + (building.storage.output_buffer?.[item] ?? 0);
}

async function main() {
  // 0) 现场供电：电力感应塔（1×1，无线半径 12 cell）+ 3 台风力涡轮机（2×2，各 10/tick）。
  //    战争预设的既有电网（基地附近）覆盖不到新区，熔炉/基站会停在 no_power。
  //    负荷：3 座熔炉 ×4 + 基站 2 = 14/tick，3 台涡轮机 30/tick 留足余量。
  //    无线链路：感应塔的连接件 Range=12，涡轮机是 Line(3)，两两取 max → 12 cell 内可连。
  const POWER_RADIUS = 11;
  const towerSpot = await findFlatSpot(1, 1, { x: 40, y: 26 });
  await buildAndWait(towerSpot.x, towerSpot.y, 'tesla_tower');
  const turbines: Tile[] = [];
  for (let i = 0; i < 3; i++) {
    const spot = await findSpotNear([towerSpot], 2, 2, POWER_RADIUS);
    await buildAndWait(spot.x, spot.y, 'wind_turbine');
    turbines.push(spot);
  }
  for (const turbine of turbines) {
    const distance = manhattan(turbine, towerSpot);
    if (distance > POWER_RADIUS) throw new Error(`turbine ${distance} cells from tower, want <=${POWER_RADIUS}`);
  }
  console.log(`power plant: tower @${towerSpot.x},${towerSpot.y} turbines ${turbines.map(t => `${t.x},${t.y}`).join(' ')}`);

  // 1) 仓库 + 3 熔炉，全部落在电力感应塔的无线半径内。
  const depotSpot = await findSpotNear([towerSpot], 3, 3, POWER_RADIUS);
  await buildAndWait(depotSpot.x, depotSpot.y, 'depot_mk1');
  const depot = at(await scene({ x: depotSpot.x - 8, y: depotSpot.y - 8, width: 32, height: 24 }), depotSpot.x, depotSpot.y)!;

  const smelters = [];
  for (let i = 0; i < 3; i++) {
    const spot = await findSpotNear([towerSpot, ...smelters.map(s => s.position)], 3, 3, POWER_RADIUS, 4);
    await buildAndWait(spot.x, spot.y, 'arc_smelter', '--recipe smelt_iron');
    smelters.push(at(await scene({ x: spot.x - 8, y: spot.y - 8, width: 32, height: 24 }), spot.x, spot.y)!);
  }

  // 2) 给仓库装铁矿（模拟「仓库有料」）。
  await command(`transfer ${depot.id} iron_ore 60`);
  await command('switch_active_planet planet-1-1');

  // 3) 基站在电塔半径内 → 有电 → 可以量产机器人。
  const hqSpot = await findSpotNear([towerSpot, ...smelters.map(s => s.position)], 5, 5, POWER_RADIUS, 5);
  await buildAndWait(hqSpot.x, hqSpot.y, 'battlefield_analysis_base');
  const hq = at(await scene({ x: hqSpot.x - 8, y: hqSpot.y - 8, width: 32, height: 24 }), hqSpot.x, hqSpot.y)!;
  await command(`transfer ${hq.id} iron_ingot 12`);
  await command(`transfer ${hq.id} gear 6`);
  await command(`transfer ${hq.id} magnetic_coil 3`);
  for (let i = 0; i < 3; i++) await command(`produce ${hq.id} transport_robot`);

  // 4) 等机器人出厂，且不下任何指令。
  let robots: ReturnType<typeof ownedUnits> = [];
  for (let attempt = 0; attempt < 400 && robots.length < 3; attempt++) {
    await pause(500);
    robots = ownedUnits(await scene({ x: hqSpot.x - 20, y: hqSpot.y - 20, width: 60, height: 40 }), 'transport_robot');
  }
  if (robots.length < 3) throw new Error(`only ${robots.length} robots spawned`);
  writeFileSync(`${evidence}/robots-spawned.json`, JSON.stringify(robots.map(r => ({ id: r.id, haul: r.haul })), null, 2));
  for (const robot of robots) {
    if (robot.haul?.mode !== 'auto') throw new Error(`robot ${robot.id} mode = ${robot.haul?.mode}, want auto`);
  }
  console.log('3 robots spawned with mode=auto, no orders issued');

  // 4.5) 模式切换（§2.1）：auto → route（haul）→ auto → idle（stop）→ auto。
  const first = robots[0];
  await command(`haul ${first.id} --from ${depot.id} --to ${smelters[0].id} --item iron_ore`);
  await command(`auto_haul ${first.id}`);
  await command(`order ${first.id} stop`);
  await command(`auto_haul ${first.id}`);
  const switched = ownedUnits(await scene({ x: hqSpot.x - 20, y: hqSpot.y - 20, width: 60, height: 40 }), 'transport_robot')
    .find(r => r.id === first.id);
  if (switched?.haul?.mode !== 'auto') throw new Error(`mode switching failed: ${JSON.stringify(switched?.haul)}`);
  console.log('mode switching auto→route→auto→idle→auto OK');

  // 5) 跑一段 tick，记录三座熔炉的产出与机器人的任务。
  const samples = [];
  const start = (await scene()).tick;
  const area = {
    x: Math.min(depotSpot.x, hqSpot.x, ...smelters.map(s => s.position.x)) - 14,
    y: Math.min(depotSpot.y, hqSpot.y, ...smelters.map(s => s.position.y)) - 14,
    width: 96,
    height: 76,
  };
  for (let i = 0; i < 10; i++) {
    await pause(2500);
    const snapshot = await scene(area);
    const current = smelters.map(s => at(snapshot, s.position.x, s.position.y));
    const currentRobots = ownedUnits(snapshot, 'transport_robot');
    const sample = {
      tick: snapshot.tick,
      depotIronOre: storageQty(at(snapshot, depot.position.x, depot.position.y), 'iron_ore'),
      smelters: current.map((b, index) => ({
        id: smelters[index].id,
        ironOre: storageQty(b, 'iron_ore'),
        ironIngot: storageQty(b, 'iron_ingot'),
        state: b?.runtime.state,
      })),
      robots: currentRobots.map(r => ({ id: r.id, mode: r.haul?.mode, phase: r.haul?.phase, from: r.haul?.from_building_id, to: r.haul?.to_building_id, item: r.haul?.item_id, cargo: r.haul?.cargo })),
    };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  }
  writeFileSync(`${evidence}/samples.json`, JSON.stringify(samples, null, 2));

  const last = samples.at(-1)!;
  const fed = last.smelters.filter(s => s.ironIngot > 0 || s.ironOre > 0).length;
  if (fed < 3) throw new Error(`only ${fed}/3 smelters got fed: ${JSON.stringify(last.smelters)}`);
  const totalIngots = last.smelters.reduce((sum, s) => sum + s.ironIngot, 0);
  if (totalIngots <= 0) throw new Error(`no iron ingot produced: ${JSON.stringify(last.smelters)}`);
  console.log('OK', { startTick: start, endTick: last.tick, totalIngots, smelters: last.smelters });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
