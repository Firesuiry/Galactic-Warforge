// 快速验证：装料 + 启动研究 + 等待完成（针对当前存档，lab=b-28）
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';

const WEB = 'http://127.0.0.1:5678';
const SERVER = 'http://127.0.0.1:5677';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript((serverUrl) => {
  window.localStorage.setItem(
    'siliconworld-client-web-session',
    JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
  );
}, WEB);
const page = await context.newPage();
await page.goto(`${WEB}/planet/planet-1-1`);
await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
await page.waitForTimeout(4000);

// 展开抽屉 + 工作台 + 研究与装料
const drawer = page.locator('aside.planet-drawer').first();
if (!(await drawer.evaluate((el) => el.className.includes('--open')))) {
  await page.locator('.planet-drawer__handle').first().click();
  await page.waitForTimeout(700);
}
await page.locator('#planet-detail-tab-workbench').click();
await page.waitForTimeout(500);
await page.getByRole('tab', { name: '研究与装料', exact: true }).first().click();
await page.waitForTimeout(800);

// 装料
const panel = page.locator('.planet-panel-stack');
const buildingSelect = panel.locator('label:has-text("建筑 ID") select');
console.log('building options:', JSON.stringify(await buildingSelect.locator('option').evaluateAll((els) => els.map((e) => e.value))));
// 选 matrix_lab（从服务端 scene 确认真实 id）
const scene = await (await fetch(`${SERVER}/world/planets/planet-1-1/scene?x=0&y=0&width=60&height=60`, { headers: { authorization: 'Bearer key_player_1' } })).json();
const labId = Object.values(scene.buildings ?? {}).find((b) => b.type === 'matrix_lab')?.id;
console.log('选择研究站:', labId);
await buildingSelect.selectOption(labId);
await panel.locator('label:has-text("装料物品") select').selectOption('electromagnetic_matrix');
await panel.locator('input[type="number"]').first().fill('10');
await panel.getByRole('button', { name: '装入建筑' }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: '.run/video-playtest/debug-transfer.png' });

// 启动研究
const techBtn = page.locator('#planet-workflow-panel-research').getByRole('button', { name: /^电磁学/ }).first();
console.log('tech btn count:', await techBtn.count());
await techBtn.click();
await page.waitForTimeout(600);
await panel.getByRole('button', { name: '开始研究' }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: '.run/video-playtest/debug-research-start.png' });

// 等服务端确认
for (let i = 0; i < 30; i++) {
  const summary = await (await fetch(`${SERVER}/state/summary`, { headers: { authorization: 'Bearer key_player_1' } })).json();
  const tech = summary.players?.p1?.tech ?? {};
  console.log('current:', JSON.stringify(tech.current_research?.tech_id ?? null), 'done:', JSON.stringify(Object.keys(tech.completed_techs ?? {})));
  if (tech.completed_techs?.electromagnetism) { console.log('研究完成!'); break; }
  await new Promise((r) => setTimeout(r, 3000));
}
await browser.close();
