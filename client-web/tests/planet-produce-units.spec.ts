import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

/**
 * web-09 回归（真实 Go 战争服）：
 * 行星工作台「战斗与制造」页签 → 选生产建筑 → 单位类型下拉列出可量产单位
 * （production_mode = world_produce，不能是空 select）→ 下达量产 → 服务端回执。
 *
 * 单位与生产建筑是**按 `producer` 配对**的（units.yaml：worker/soldier/scout → 兵营，
 * 战车/补给车等 → 战车工厂，无人机 → 机场），不是任意制造建筑都能造任意单位。
 * 官方战争场景只预置了重组式制造台，没有兵营/战车工厂/机场，因此这里：
 * - 有匹配建筑时：下达量产并断言受理；
 * - 没有匹配建筑时：断言服务端回执给出明确的中文配对错误（配对契约本身也要守住）。
 */

const WEB_ENTRY = 'http://127.0.0.1:4173';
const BACKEND_ENTRY = process.env.SW_BACKEND_ENTRY ?? 'http://127.0.0.1:19481';
const PLANET_ID = 'planet-1-1';

interface CatalogUnit {
  id?: string;
  name?: string;
  producer?: string;
  production_mode?: string;
}

interface SceneBuilding {
  id?: string;
  type?: string;
  owner_id?: string;
}

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  }, WEB_ENTRY);
}

async function ownBuildings(request: APIRequestContext): Promise<SceneBuilding[]> {
  const response = await request.get(`${BACKEND_ENTRY}/world/planets/${PLANET_ID}/scene`, {
    headers: { Authorization: 'Bearer key_player_1' },
  });
  expect(response.ok()).toBe(true);
  const scene = await response.json();
  return (Object.values(scene.buildings ?? {}) as SceneBuilding[])
    .filter((building) => building.owner_id === 'p1');
}

/** 战争服预置建筑 ID 随场景播种顺序变化，按类型动态解析 p1 的建筑 ID。 */
async function findOwnedBuildingId(request: APIRequestContext, buildingType: string): Promise<string> {
  const match = (await ownBuildings(request)).find((building) => building.type === buildingType);
  expect(match?.id, `p1 building of type ${buildingType} should exist`).toBeTruthy();
  return match!.id!;
}

/** 目录里 production_mode = world_produce 的单位（与前端下拉同源）。 */
async function worldProduceUnits(request: APIRequestContext): Promise<CatalogUnit[]> {
  const response = await request.get(`${BACKEND_ENTRY}/catalog`, {
    headers: { Authorization: 'Bearer key_player_1' },
  });
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  return (catalog.world_units ?? []).filter((unit: CatalogUnit) => unit.production_mode === 'world_produce');
}

test('行星工作台可纯 GUI 量产单位', async ({ page, request }) => {
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?view=2d`);

  // 打开命令工作台抽屉并切到「战斗与制造」
  await page.getByRole('button', { name: '工作台' }).click();
  await page.getByRole('tab', { name: '战斗与制造' }).click();

  // 单位类型下拉必须列出全部 world_produce 单位（回归点：早期这里会是空 select）
  const unitSelect = page.getByLabel('单位类型');
  const units = await worldProduceUnits(request);
  expect(units.length).toBeGreaterThan(0);
  for (const unit of units) {
    await expect(unitSelect.locator(`option[value="${unit.id}"]`)).toHaveCount(1);
  }

  // 找一座 p1 拥有的、类型与某个 world_produce 单位 producer 匹配的建筑
  const buildings = await ownBuildings(request);
  const producerTypes = new Set(units.map((unit) => unit.producer));
  const matching = buildings.find((building) => building.type && producerTypes.has(building.type));
  const producerLabel = [...producerTypes].filter(Boolean).join(' / ');

  if (!matching) {
    // 官方战争场景不预置兵营/战车工厂/机场：没有可配对的生产建筑，就验证配对契约本身——
    // 用重组式制造台下达步兵量产，服务端必须回中文配对错误而不是受理。
    const factoryId = await findOwnedBuildingId(request, 'recomposing_assembler');
    await page.getByLabel('生产建筑').selectOption(factoryId);
    await unitSelect.selectOption('soldier');
    await page.getByRole('button', { name: '下达量产' }).click();
    await expect(page.locator('.planet-command-history li').first()).toContainText('失败');
    await expect(page.locator('.planet-command-history li').first()).toContainText('步兵需由兵营生产');
    test.info().annotations.push({
      type: 'skip-reason',
      description: `战争场景没有 ${producerLabel}，改验证「单位需由配对建筑生产」的服务端回执`,
    });
    return;
  }

  // 有匹配建筑：真实下达量产并断言服务端受理（回执出现在最近结果里）
  await page.getByLabel('生产建筑').selectOption(matching.id!);
  const target = units.find((unit) => unit.producer === matching.type)!;
  await unitSelect.selectOption(target.id!);
  await page.getByRole('button', { name: '下达量产' }).click();
  await expect(page.getByText(/已受理/).first()).toBeVisible({ timeout: 10_000 });
});
