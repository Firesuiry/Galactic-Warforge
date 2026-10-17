import { expect, test, type Page } from '@playwright/test';

import { footprintFits } from './support/footprint';
import { backendEntry } from './support/scenario';
import { requireScenario } from './support/scenario-gate';

requireScenario('war', '需要官方战争场景（预置战场分析基站/重组制造台），默认遭遇战场景跳过。');

const planetId = 'planet-1-1';
/** 机甲作业半径（cell）：config-war.yaml 的 executor.operate_range = 18（旧 6 tile）。 */
const OPERATE_RANGE_CELLS = 18;
/** 重组式制造台占地（server/data/buildings.yaml：3×3 cell）。 */
const ASSEMBLER_FOOTPRINT = { width: 3, height: 3 };
type Tile = { x: number; y: number };
type Building = { id: string; type: string; owner_id: string; position: Tile; production?: { recipe_id?: string } };
type Scene = { buildings: Record<string, Building>; units: Record<string, Building>; resources: { position: Tile }[]; terrain: string[][]; visible: boolean[][] };
type DebugScene = { getQuality(): string; focus(tile: Tile, close?: boolean): void; project(tile: Tile): { x: number; y: number; visible: boolean } };

async function scene(): Promise<Scene> {
  const response = await fetch(`${backendEntry()}/world/planets/${planetId}/scene?x=0&y=0&width=48&height=48`, {
    headers: { authorization: 'Bearer key_player_1' },
  });
  expect(response.ok).toBeTruthy();
  return response.json();
}

async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
    state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0,
  })));
}

/**
 * §3.2 界面重排后，「生产规划」按钮不再常驻：它在左上行星胶囊的展开态里
 * （胶囊默认收成一行「名称 · 电力 · 研究」，点箭头展开才出现）。
 */
async function openProductionPlanner(page: Page) {
  const plannerButton = page.getByRole('button', { name: '生产规划', exact: true });
  if (!(await plannerButton.isVisible())) {
    await page.getByRole('button', { name: '展开行星信息' }).click();
  }
  await plannerButton.click();
}

/** §3.2 画面质量/镜头俯仰/图层收进左下竖排图标栏的「视角设置」弹出层。 */
async function openViewSettings(page: Page) {
  const quality = page.getByRole('combobox', { name: '画面质量' });
  if (!(await quality.isVisible())) {
    await page.getByRole('button', { name: '视角设置' }).click();
  }
  await expect(quality).toBeVisible();
}

function buildSite(data: Scene, exclude?: ReadonlySet<string>): Tile {
  const executor = Object.values(data.units).find(unit => unit.owner_id === 'p1' && unit.type === 'executor')!;
  // 制造台占地 3×3 cell（server/data/buildings.yaml）：整块占地都要空，且扫描范围按机甲
  // 作业半径（config-war.yaml operate_range = 18 cell，细分网格后不再等价于旧 6 tile）。
  for (let radius = 1; radius <= OPERATE_RANGE_CELLS; radius++) {
    for (let y = executor.position.y - radius; y <= executor.position.y + radius; y++) {
      for (let x = executor.position.x - radius; x <= executor.position.x + radius; x++) {
        if (Math.abs(x - executor.position.x) + Math.abs(y - executor.position.y) !== radius) continue;
        if (exclude?.has(`${x}:${y}`)) continue;
        if (data.terrain[y]?.[x] !== 'buildable' || !data.visible[y]?.[x]) continue;
        if (!footprintFits(data, { x, y }, ASSEMBLER_FOOTPRINT)) continue;
        return { x, y };
      }
    }
  }
  throw new Error('执行体附近无空闲建造位置');
}

test('真实产线配方规划可建造带配方的工厂，发展路线可进入工作流，画质可切换', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page);
  await page.goto(`/planet/${planetId}?quality=low&e2e=1`);
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __planetThree?: DebugScene }).__planetThree?.getQuality));
  // §3.2：行星胶囊默认收成一行，「生产规划」在展开态里；画质下拉在左下视角设置弹层里。
  const quality = await openViewSettings(page).then(() => page.getByRole('combobox', { name: '画面质量' }));
  for (const value of ['high', 'balanced', 'low']) {
    await quality.selectOption(value);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __planetThree: DebugScene }).__planetThree.getQuality())).toBe(value);
  }
  expect(await page.evaluate(() => localStorage.getItem('siliconworld-planet-quality'))).toBe('low');

  await openProductionPlanner(page);
  const planner = page.getByRole('region', { name: '生产规划' });
  await expect(planner).toContainText('当前载入区域');
  await expect(planner.getByRole('button', { name: /定位建筑/ }).first()).toBeVisible();
  await planner.getByRole('button', { name: /定位建筑/ }).first().click();
  await expect(page.locator('#planet-detail-panel-selection')).toBeVisible();
  await page.getByRole('tab', { name: '生产', exact: true }).click();
  await planner.getByRole('combobox', { name: '规划配方' }).selectOption('electromagnetic_matrix');
  await planner.getByRole('spinbutton', { name: '生产批次' }).fill('10');
  await expect(planner.locator('.production-planner__recipe')).toContainText('投入 · 10 批');
  await expect(planner.locator('.production-planner__recipe')).toContainText('×10');
  const target = buildSite(await scene());
  await planner.getByRole('button', { name: '建造制造台 Mk.I', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消建造 · Esc' })).toBeVisible();
  // 并行规格会同服抢建同一空地：每次尝试重取场景重算建造点，直到 build 命令真正发出。
  // 命令是「受理即 202、下一 tick 才校验」的：落点被别的建筑/资源/作业范围拒收时
  // 回执仍是 accepted，只有轮询里看不到建筑才暴露出来。因此把「落地」也纳入重试——
  // 每次换一个候选落点重发（被拒的格子不再重复用），直到目标格上真的出现带配方的制造台。
  let response: import('@playwright/test').Response | null = null;
  let builtTarget = target;
  let built = false;
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 6 && !built; attempt++) {
    const candidate = buildSite(await scene(), tried);
    builtTarget = candidate;
    tried.add(`${candidate.x}:${candidate.y}`);
    const point = await page.evaluate(tile => {
      const renderer = (window as unknown as { __planetThree: DebugScene }).__planetThree;
      renderer.focus(tile, true);
      return renderer.project(tile);
    }, builtTarget);
    expect(point.visible).toBe(true);
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().postDataJSON()?.commands?.[0]?.type === 'build', { timeout: 12_000 }).catch(() => null);
    await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } });
    response = (await responsePromise) ?? response;
    for (let poll = 0; poll < 10 && !built; poll += 1) {
      await page.waitForTimeout(500);
      built = Object.values((await scene()).buildings).some(building =>
        building.owner_id === 'p1' && building.position.x === builtTarget.x && building.position.y === builtTarget.y
        && building.production?.recipe_id === 'electromagnetic_matrix');
    }
  }
  expect(response, 'build command should be issued').toBeTruthy();
  expect(response!.ok()).toBe(true);
  expect(response!.request().postDataJSON().commands[0].payload).toMatchObject({ building_type: 'assembling_machine_mk1', recipe_id: 'electromagnetic_matrix' });
  expect(built, `带配方的制造台应落在 ${JSON.stringify(builtTarget)}（命令已受理但落点被服务端拒收时不会落地）`).toBe(true);
  await page.keyboard.press('Escape');

  // 长线发展路线已并入「生产」面板内的折叠区（<summary>进阶：长线发展路线</summary>），不再是独立按钮。
  // Esc 退出建造后抽屉可能已收起，先像玩家一样点「工作台」把手展开。
  if (await page.locator('.planet-drawer--open').count() === 0) {
    await page.getByRole('button', { name: '工作台' }).first().click();
  }
  await page.getByRole('tab', { name: '生产', exact: true }).click();
  // 抽屉打开时建造栏自动收起为一行把手（.planet-build-bar--docked），折叠区标题在抽屉里，
  // 建造栏展开着会盖住它：这里先确保建造栏处于收起态，点折叠区标题前不被遮挡。
  await expect(page.locator('.planet-build-bar--docked')).toBeVisible();
  await page.locator('.planet-advanced-progression summary').click();
  const development = page.getByRole('region', { name: '工业发展导航' });
  await development.getByRole('tab', { name: /戴森能源/ }).click();
  await expect(development).toContainText('恒星能源');
  await development.locator('.colony-progression__action').click();
  await expect(page.locator('#planet-detail-panel-workbench')).toBeVisible();
  await expect(page).toHaveURL(/workflow=research/);
  await expect(page.getByRole('tab', { name: '研究与装料', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('390px 生产与发展入口可操作，配方检索和画质设置不溢出', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.goto(`/planet/${planetId}?quality=low&e2e=1`);
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 30_000 });
  await openProductionPlanner(page);
  const planner = page.getByRole('region', { name: '生产规划' });
  await planner.getByRole('textbox', { name: '搜索生产配方' }).fill('electromagnetic_matrix');
  await expect(planner.getByRole('combobox', { name: '规划配方' })).toHaveValue('electromagnetic_matrix');
  await page.getByRole('tab', { name: '生产', exact: true }).click();
  // 抽屉打开时建造栏自动收起为一行把手，折叠区标题不再被遮挡（见 planet-build-workflow.spec.ts 的几何断言）
  await expect(page.locator('.planet-build-bar--docked')).toBeVisible();
  await page.locator('.planet-advanced-progression summary').click();
  await expect(page.getByRole('region', { name: '工业发展导航' })).toBeVisible();
  await page.getByRole('tab', { name: /戴森能源/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: '/tmp/sw-dsp-review/development-mobile.png' });
  await page.getByRole('button', { name: '工作台', exact: true }).first().click();
  await openViewSettings(page);
  await page.getByRole('combobox', { name: '画面质量' }).selectOption('balanced');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __planetThree: DebugScene }).__planetThree.getQuality())).toBe('balanced');
  await page.getByRole('button', { name: '平面战术', exact: true }).click();
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible();
  await page.getByRole('button', { name: '3D 星球', exact: true }).click();
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
