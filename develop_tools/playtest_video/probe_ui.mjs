// UI 探针：登录真实 Web 客户端，截图各主页面， dump 可交互元素
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const WEB = 'http://127.0.0.1:5678';
const OUT = process.env.OUT_DIR || '.run/video-playtest/probe';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(`${WEB}/login`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: `${OUT}/01-login.png` });

// 填写登录表单
const inputs = page.locator('.login-form input');
const n = await inputs.count();
console.log('login inputs:', n);
for (let i = 0; i < n; i++) {
  console.log(' input', i, 'placeholder=', await inputs.nth(i).getAttribute('placeholder'), 'type=', await inputs.nth(i).getAttribute('type'));
}
// 依次：Web 入口地址(可能已有默认值)、玩家ID、玩家Key
await inputs.nth(n - 2).fill('p1');
await inputs.nth(n - 1).fill('key_player_1');
await page.screenshot({ path: `${OUT}/02-login-filled.png` });
await page.locator('.login-form button[type="submit"]').click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/03-after-login.png` });
console.log('after login url:', page.url());

// 行星页
await page.goto(`${WEB}/planet/planet-1-1`);
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/04-planet.png` });

// dump tabs 与按钮
const tabs = await page.locator('[role="tab"]').allTextContents();
console.log('tabs:', JSON.stringify(tabs));
const btns = await page.locator('button:visible').allTextContents();
console.log('buttons:', JSON.stringify(btns.slice(0, 60)));

// 建造栏卡片
const cards = await page.locator('.planet-build-card').evaluateAll((els) =>
  els.map((el) => el.getAttribute('data-building-id')),
);
console.log('build cards:', JSON.stringify(cards));

// 工作台 tab 内容
await page.screenshot({ path: `${OUT}/05-planet-workbench.png` });

// 星图页
await page.goto(`${WEB}/galaxy`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/06-galaxy.png` });

// 星系页
await page.goto(`${WEB}/system/sys-1`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/07-system.png` });

// 战争页
await page.goto(`${WEB}/war`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/08-war.png` });

// 概览页
await page.goto(`${WEB}/`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/09-overview.png` });

await browser.close();
console.log('done, screenshots in', OUT);
