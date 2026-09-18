/* W3-Browser evidence: tech tree full render + production planner new recipes. */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const WEB_ENTRY = process.env.SW_WEB_ENTRY ?? 'http://127.0.0.1:4173';
const OUT = process.env.SW_EVIDENCE_DIR ?? '../test-results/w3-browser';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
await page.addInitScript((serverUrl) => {
  window.localStorage.setItem(
    'siliconworld-client-web-session',
    JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
  );
}, WEB_ENTRY);

// 1. Tech page: full tree render
await page.goto(`${WEB_ENTRY}/tech`);
await page.waitForSelector('.tech-node', { timeout: 60_000 });
await page.waitForTimeout(1500);
const nodeCount = await page.locator('.tech-node').count();
console.log('tech nodes rendered:', nodeCount);
await page.screenshot({ path: `${OUT}/tech-tree-full.png`, fullPage: true });

// 2. Planet page production planner: search new recipes
await page.goto(`${WEB_ENTRY}/planet/planet-1-1?view=2d`);
const plannerButton = page.getByRole('button', { name: /生产规划/ });
await plannerButton.waitFor({ timeout: 60_000 });
await plannerButton.click();
const planner = page.locator('.production-planner');
await planner.waitFor({ timeout: 15_000 });
const search = page.getByLabel('搜索生产配方');
const recipeSelect = page.getByLabel('规划配方');

async function searchRecipe(term, shotName) {
  await search.fill(term);
  await page.waitForTimeout(500);
  const options = await recipeSelect.locator('option').allTextContents();
  console.log(`search "${term}":`, JSON.stringify(options));
  await planner.screenshot({ path: `${OUT}/${shotName}` });
}

await searchRecipe('titanium_glass', 'planner-titanium-glass.png');
await searchRecipe('proliferator_mk3', 'planner-proliferator-mk3.png');

await browser.close();
console.log('evidence done ->', OUT);
