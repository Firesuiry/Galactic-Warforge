#!/usr/bin/env node
/**
 * 视觉夹具截图（Storybook 固定机位，不起服务端）：画面类改动的迭代出图工具。
 *
 * 用法（在仓库根或任意 worktree 根）：
 *   node scripts/fixture-shots.mjs <输出目录> [--port 24606] [--quality high|balanced|low]
 *        [--stories planet-showcasefixture--horizon,planet-beltdspfixture--belt-dsp-top]
 *        [--fps]
 *
 * - 端口上已有 Storybook 就复用，否则在当前 worktree 的 client-web 起一个（结束时只杀自己起的）。
 *   多个 worktree 并行时各用各的端口（建议 24600 + 试玩环境号末两位），别复用别人的 Storybook。
 * - 默认拍 Planet/ShowcaseFixture 全部故事；画质默认 high（3A 画质验收口径）。
 * - 每张等画面稳定（连续两帧截图字节一致，故事壳已 `?freeze=1`）后出 1200×1000 整屏 PNG。
 * - `--fps`：每张额外数 2 秒 requestAnimationFrame（冻结下仍逐帧渲染），写进 stats.json。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'client-web');
const { chromium } = await import(path.join(ROOT, 'node_modules/playwright/index.mjs'));

const SHOWCASE = ['industry-overview', 'assembling-machine', 'barracks-squad', 'smelter-miner', 'mecha', 'horizon', 'mid-orbit']
  .map((name) => `planet-showcasefixture--${name}`);

const args = process.argv.slice(2);
const outDir = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : '';
if (!outDir) {
  console.error('用法: node scripts/fixture-shots.mjs <输出目录> [--port N] [--quality high] [--stories id1,id2] [--fps]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(opt('port', process.env.SW_STORYBOOK_PORT ?? 24606));
const quality = opt('quality', 'high');
const stories = (opt('stories', '') || SHOWCASE.join(',')).split(',').filter(Boolean);
const measureFps = args.includes('--fps');
const entry = `http://127.0.0.1:${port}`;

async function reachable() {
  try {
    return (await fetch(`${entry}/iframe.html`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

let own = null;
if (!(await reachable())) {
  console.log(`[fixture-shots] 在 ${WEB} 起 Storybook :${port}`);
  own = spawn('npx', ['storybook', 'dev', '-p', String(port), '--exact-port', '--ci', '--no-open'], {
    cwd: WEB, stdio: 'ignore', detached: true,
  });
  own.unref();
  const deadline = Date.now() + 150_000;
  while (!(await reachable())) {
    if (Date.now() > deadline || own.exitCode !== null) {
      console.error('[fixture-shots] Storybook 未就绪');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const stats = {};
try {
  for (const id of stories) {
    process.stdout.write(`[fixture-shots] ${id} … `);
    await page.goto(`${entry}/iframe.html?id=${id}&viewMode=story&quality=${quality}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.planet-three__surface canvas').waitFor({ state: 'visible', timeout: 90_000 });
    await page.waitForFunction(() => Boolean(window.__planetThree), null, { timeout: 90_000 });
    await page.waitForTimeout(1500);
    let previous = null;
    for (let i = 0; i < 40; i++) {
      const shot = await page.screenshot({ animations: 'disabled' });
      if (previous && shot.equals(previous)) break;
      previous = shot;
      await page.waitForTimeout(700);
    }
    const name = id.split('--')[1];
    fs.writeFileSync(path.join(outDir, `${name}.png`), previous);
    const entryStats = await page.evaluate(async (fps) => {
      const scene = window.__planetThree;
      const result = { render: typeof scene?.renderStats === 'function' ? scene.renderStats() : null };
      if (fps) {
        result.fps = await new Promise((resolve) => {
          let frames = 0;
          const t0 = performance.now();
          const step = (now) => { frames += 1; if (now - t0 < 2000) requestAnimationFrame(step); else resolve(Math.round(frames * 1000 / (now - t0))); };
          requestAnimationFrame(step);
        });
      }
      return result;
    }, measureFps);
    stats[name] = entryStats;
    console.log(`ok${entryStats.fps ? ` ${entryStats.fps} fps` : ''}`);
  }
} finally {
  fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify({ quality, stats, errors: errors.slice(-20) }, null, 2));
  await browser.close();
  if (own?.pid) {
    try { process.kill(-own.pid, 'SIGTERM'); } catch { /* 已退出 */ }
  }
}
if (errors.length) console.log(`[fixture-shots] 页面报错 ${errors.length} 条，见 stats.json`);
console.log(`[fixture-shots] 完成 → ${outDir}`);
