// 运行器：读档 → 等 tick → 按场景脚本的 shots 逐张拍 → 特写 →（可选）compare.md。
//
// 用法：node scripts/playtest-shots/run.mjs <N> <场景名> <输出目录> [--compare <修前目录>]
// 一般从 scripts/playtest-shots.sh 调用（它会先确认环境与存档版本）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApi, waitTicks, shoot3d, cropAndScale, sleep } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , N, sceneName, outDirArg, ...rest] = process.argv;
if (!N || !sceneName || !outDirArg) {
  console.error('用法: node run.mjs <N> <场景名> <输出目录> [--compare <修前目录>]');
  process.exit(2);
}
let compareDir = '';
let procedural = false;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--procedural') {
    // 只对带 `?procedural-models` 的场景有意义（模型素材对照：强制回退程序化模型）。
    procedural = true;
    continue;
  }
  if (rest[i] === '--compare') {
    const arg = rest[++i];
    if (!arg) {
      console.error('--compare 需要一个修前截图目录参数');
      process.exit(2);
    }
    compareDir = path.resolve(arg);
  } else {
    console.error(`未知参数：${rest[i]}`);
    process.exit(2);
  }
}
const outDir = path.resolve(outDirArg);
if (compareDir && !fs.existsSync(compareDir)) {
  console.error(`--compare 目录不存在：${compareDir}`);
  process.exit(2);
}
const server = `http://127.0.0.1:${Number(N) * 100}`;
const driver = Number(N) * 100 + 2;
const api = makeApi({ server });

const scenePath = path.join(HERE, `${sceneName}.mjs`);
if (!fs.existsSync(scenePath)) {
  console.error(`没有场景脚本：${scenePath}`);
  console.error(`新场景按约定新增 scripts/playtest-shots/<场景名>.mjs（见 docs/guide/试玩速查.md「固定机位截图」）。`);
  process.exit(2);
}
const scene = (await import(scenePath)).default;
if (!scene?.shots?.length) {
  console.error(`场景脚本 ${scenePath} 没有导出 shots 列表`);
  process.exit(2);
}
if (scene.checkpoint !== sceneName) {
  console.error(`场景脚本的 checkpoint=${scene.checkpoint} 与场景名 ${sceneName} 不一致`);
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });

// ---- 读档：只有当前局来源不是这个存档点时才重读 ----
const game = await api.game().catch(() => null);
// `reload: true`：该场景依赖「读档后的确定局面」（例如要先快进到敌军抵达），
// 当前局即使已经来自同一存档点也要重读，否则第二次跑会从被上一轮推进过的局面开始。
if (scene.reload || game?.source_checkpoint !== scene.checkpoint) {
  console.log(`[shots] 当前局来源=${game?.source_checkpoint || '(新局)'}，读档 ${scene.checkpoint}`);
  await api.load(scene.checkpoint);
  const tick = await waitTicks(api, scene.settleTicks ?? 50);
  console.log(`[shots] 读档完成，已到 tick ${tick}`);
} else {
  console.log(`[shots] 当前局已是 ${scene.checkpoint}（tick ${game.tick}），不再重读`);
}

// ---- 场景准备（可选）：读档后、拍照前把局面推到目标状态（如快进到敌军抵达）----
if (typeof scene.prepare === 'function') {
  console.log('[shots] 场景准备 …');
  const info = await scene.prepare(api);
  if (info) console.log(`[shots] 场景准备完成：${JSON.stringify(info)}`);
}

// ---- 驱动就绪 ----
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${driver}/`, { method: 'GET' });
    // 驱动对任意请求都执行片段：空 body 返回 null，能连通即可。
    if (r.ok) break;
  } catch {
    /* 未就绪 */
  }
  await sleep(1000);
}

// ---- 逐张拍 ----
const results = [];
const errors = [];
const stats = [];
for (const shot of scene.shots) {
  process.stdout.write(`[shots] ${shot.name} … `);
  try {
    if (shot.kind !== '3d') throw new Error(`不支持的机位类型 ${shot.kind}（2D 视图已删除，只支持 '3d'）`);
    const outcome = await shoot3d(driver, procedural ? { ...shot, query: '&procedural-models=1' } : shot, outDir);
    if (outcome?.stats) stats.push({ name: shot.name, ...outcome.stats });
    const file = path.join(outDir, `${shot.name}.png`);
    if (!fs.existsSync(file)) throw new Error('截图未生成');
    const size = fs.statSync(file).size;
    console.log(`ok (${(size / 1024).toFixed(0)} KB)`);
    results.push(shot.name);
  } catch (e) {
    console.log('失败');
    errors.push(`${shot.name}: ${e.message}`);
  }
}

if (stats.length) {
  console.log('[shots] 绘制统计：');
  for (const entry of stats) console.log(`  ${entry.name}: ${JSON.stringify(entry.stats)}`);
  // 修前/修后对照要留原始数字：机位 + 绘制统计 + 帧率写进 outDir/stats.json（与 fixture-shots 同口径）。
  fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify({ scene: sceneName, stats }, null, 2));
}

// ---- 2x 特写（裁剪整屏图中心再放大）----
for (const shot of scene.shots) {
  if (!shot.closeup) continue;
  const src = path.join(outDir, `${shot.name}.png`);
  const dst = path.join(outDir, `${shot.name}@2x.png`);
  if (!fs.existsSync(src)) continue;
  try {
    const c = shot.closeup;
    cropAndScale(src, dst, {
      cx: c.cx ?? 600,
      cy: c.cy ?? 500,
      w: c.w ?? 500,
      h: c.h ?? 400,
      scale: c.scale ?? 2,
    });
    console.log(`[shots] 特写 ${path.basename(dst)} ok`);
    results.push(`${shot.name}@2x`);
  } catch (e) {
    console.log(`[shots] 特写 ${shot.name} 跳过：${e.message}`);
  }
}

// ---- compare.md ----
if (compareDir) {
  const rows = [];
  for (const name of results) {
    const beforePath = path.join(compareDir, `${name}.png`);
    if (!fs.existsSync(beforePath)) {
      rows.push(`| ${name} | （修前目录缺这张） | [${name}.png](${name}.png) |`);
      continue;
    }
    // compare.md 写在 outDir，链接相对它计算（compareDir 可能在任意位置）。
    const before = path.relative(outDir, beforePath).split(path.sep).join('/');
    rows.push(`| ${name} | [${name}.png](${before}) | [${name}.png](${name}.png) |`);
  }
  const md = [
    `# 固定机位对比：${scene.title ?? sceneName}`,
    '',
    `- 场景：\`${sceneName}\``,
    `- 修前：\`${compareDir}\``,
    `- 修后：\`${outDir}\``,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '| 机位 | 修前 | 修后 |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '> 图片路径相对本文件。机位定义见 `scripts/playtest-shots/' + sceneName + '.mjs`。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'compare.md'), md);
  console.log(`[shots] compare.md 已写入 ${path.join(outDir, 'compare.md')}`);
}

if (errors.length) {
  console.error(`[shots] ${errors.length} 张失败：\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`[shots] 完成，共 ${results.length} 张 → ${outDir}`);
