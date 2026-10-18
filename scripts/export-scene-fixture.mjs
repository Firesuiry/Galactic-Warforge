#!/usr/bin/env node
/**
 * 从试玩环境导出「视觉夹具」场景 JSON（3D 行星地图用）。
 *
 * 用法：
 *   node scripts/export-scene-fixture.mjs <N> <x0> <y0> <x1> <y1> <out.json> [--poll-flow <秒>]
 *
 *   N         playtest-up.sh 的基数（服务端 = N*100，见 docs/guide/试玩速查.md）
 *   x0..y1    导出窗口（含右下角，cell 坐标；窗口宽高 = x1-x0+1 / y1-y0+1）
 *   out.json  输出路径（相对仓库根或绝对路径）
 *   --poll-flow <秒>
 *             持续轮询场景，挑「带子上货物件数最多」的那一帧写盘（默认 0 = 只导出当前帧）。
 *             夹具要拍到流动中的传送带时用它：先按文档把料送进源站，再 --poll-flow 60。
 *
 * 只读接口，不需要 admin 权限：GET /catalog、/world/planets/{id}/scene、/runtime、/networks。
 * 导出内容：
 *   - planet   场景窗口（地形/高度/迷雾/建筑/单位/矿脉；3D 渲染的完整输入）
 *   - catalog  建筑占地、物品颜色/名称（3D 模型与分拣器标签用）
 *   - runtime  行星运行时（combat_squads 等，3D 可选输入）
 *   - networks 电网连线（3D 的 power/pipelines 图层）
 *   - meta     导出时的 tick、窗口、来源服务端
 *
 * 环境变量：SW_PLAYER_KEY（默认 key_player_1）、SW_PLANET_ID（默认 planet-1-1）。
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , nArg, x0Arg, y0Arg, x1Arg, y1Arg, outArg, ...rest] = process.argv;

function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error('用法：node scripts/export-scene-fixture.mjs <N> <x0> <y0> <x1> <y1> <out.json> [--poll-flow <秒>]');
  process.exit(1);
}

if (!nArg || !outArg) usage('缺少参数');
const N = Number(nArg);
const x0 = Number(x0Arg);
const y0 = Number(y0Arg);
const x1 = Number(x1Arg);
const y1 = Number(y1Arg);
if (![N, x0, y0, x1, y1].every(Number.isFinite)) usage('N / 坐标必须是数字');
if (x1 < x0 || y1 < y0) usage('窗口右下角必须不小于左上角');

let pollFlowSeconds = 0;
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--poll-flow') {
    pollFlowSeconds = Number(rest[i + 1] ?? 0);
    i += 1;
  } else {
    usage(`未知参数 ${rest[i]}`);
  }
}

const server = `http://127.0.0.1:${N * 100}`;
const key = process.env.SW_PLAYER_KEY ?? 'key_player_1';
const planetId = process.env.SW_PLANET_ID ?? 'planet-1-1';
const width = x1 - x0 + 1;
const height = y1 - y0 + 1;

async function getJson(pathname) {
  const response = await fetch(`${server}${pathname}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    throw new Error(`${pathname} → HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function beltItemCount(scene) {
  let count = 0;
  for (const building of Object.values(scene.buildings ?? {})) {
    for (const stack of building.conveyor?.buffer ?? []) count += stack.quantity ?? 1;
  }
  return count;
}

async function main() {
  const scenePath = `/world/planets/${encodeURIComponent(planetId)}/scene?x=${x0}&y=${y0}&width=${width}&height=${height}`;
  let planet = await getJson(scenePath);
  if (pollFlowSeconds > 0) {
    const deadline = Date.now() + pollFlowSeconds * 1000;
    let best = planet;
    let bestCount = beltItemCount(planet);
    console.log(`轮询 ${pollFlowSeconds}s，当前带面货物 ${bestCount} 件…`);
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 120));
      const next = await getJson(scenePath);
      const count = beltItemCount(next);
      if (count > bestCount) {
        best = next;
        bestCount = count;
        console.log(`  tick ${next.tick}: 带面货物 ${count} 件（采用）`);
      }
    }
    planet = best;
    console.log(`采用 tick ${planet.tick}，带面货物 ${bestCount} 件`);
  }

  const [catalog, runtime, networks] = await Promise.all([
    getJson('/catalog'),
    getJson(`/world/planets/${encodeURIComponent(planetId)}/runtime`),
    getJson(`/world/planets/${encodeURIComponent(planetId)}/networks`),
  ]);

  const fixture = {
    meta: {
      source: `playtest N=${N} (${server})`,
      exported_at: new Date().toISOString(),
      tick: planet.tick,
      window: { x: x0, y: y0, width, height },
      planet_id: planetId,
      belt_items: beltItemCount(planet),
    },
    planet,
    catalog,
    runtime,
    networks,
  };

  const outPath = path.isAbsolute(outArg) ? outArg : path.resolve(process.cwd(), outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(fixture, null, 1)}\n`);
  console.log(`已写入 ${outPath}（${(fs.statSync(outPath).size / 1024).toFixed(0)} KB）`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
