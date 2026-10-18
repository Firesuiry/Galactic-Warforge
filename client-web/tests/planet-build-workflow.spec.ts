import { expect, test, type Page } from '@playwright/test';

import { backendEntry } from './support/scenario';
import { requireScenario } from './support/scenario-gate';

import { enterBuildMode, openBuildShortageNotice, revealBuildCard } from './support/build-bar';
import { buildingCells, footprintFits, occupiedCells } from './support/footprint';
import {
  captureCommandRequests,
  clickTileAt,
  entityScreenPos,
  focusTile,
  hoveredTile,
  settleProjection,
  statusText,
  waitPlanetThree,
} from './support/planet-three';

requireScenario('war', '需要官方战争场景（预置战场分析基站/重组制造台），默认遭遇战场景跳过。');

/**
 * 群星式建造闭环验收（真实 Go 战争服，3D 视图）：
 * 登录 → 行星页底部建造栏点选建筑卡片（.planet-build-card）→ 在 3D 星球上点格放置
 * → 命令回执出现在工作台（journal 最近结果）。
 *
 * R20-C1：2D 视图删除后（docs/guide/删除2D视图.md D1）不再有 DOM 实体层与
 * `.planet-map-canvas__surface`（2D 已删除），落点一律用 `window.__planetThree.tileScreenPos`
 * 投影成页面像素，再用真实鼠标点击。
 */

const PLANET_ID = 'planet-1-1';
/**
 * 机甲作业半径（cell）：config-war.yaml 的 executor.operate_range = 18（细分网格后按 cell 记，
 * 旧配置写 6 tile）。超出即被服务端 requireBuildRange 拒收，所以扫描范围按同一量纲。
 */
const OPERATE_RANGE = 18;
const BUILDING_ID = 'wind_turbine';
/** 风力涡轮机占地（server/data/buildings.yaml：2×2 cell，细分网格后不再等价于旧 1×1 tile）。 */
const WIND_TURBINE_FOOTPRINT = { width: 2, height: 2 };
/** 采矿机占地（server/data/buildings.yaml：3×3 cell）。 */
const MINING_MACHINE_FOOTPRINT = { width: 3, height: 3 };

/**
 * 服务端 mining_machine 的 collect.allowed_resources（server/data/buildings.yaml）：
 * 只有这些矿种的资源格才能放采矿机，其余（water/sulfuric_acid/crude_oil/log 等）由抽水站、
 * 化工、伐木等建筑开采，服务端会回执「mining_machine 无法开采资源 <kind>」。
 */
const ALLOWED_MINING_RESOURCES = new Set([
  'iron_ore',
  'copper_ore',
  'stone_ore',
  'silicon_ore',
  'titanium_ore',
  'coal',
  'fire_ice',
  'fractal_silicon',
  'grating_crystal',
  'monopole_magnet',
  'kimberlite_ore',
  'spiniform_stalagmite_crystal',
  'organic_crystal',
]);

interface ScenePosition {
  x: number;
  y: number;
  z?: number;
}

interface ScenePayload {
  planet_id: string;
  map_width: number;
  map_height: number;
  terrain: string[][];
  visible?: boolean[][];
  buildings: Record<string, { id?: string; owner_id?: string; position: ScenePosition }>;
  units: Record<string, {
    id: string;
    type: string;
    owner_id: string;
    position: ScenePosition;
  }>;
  resources: Array<{ id?: string; kind?: string; position: ScenePosition }>;
}

async function fetchAuthorized<T>(path: string): Promise<T> {
  const response = await fetch(`${backendEntry()}${path}`, {
    headers: { authorization: 'Bearer key_player_1' },
  });
  expect(response.ok).toBeTruthy();
  return response.json() as Promise<T>;
}

async function installSession(page: Page) {
  // serverUrl 用页面自己的 origin（同源走 vite 代理）：写死入口时换端口会打到旧实例。
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl: window.location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  });
}

/**
 * 识别「前端本地预检拦截」（LOCAL_PREFLIGHT）：命令根本没发到服务端。
 *
 * 战争服长跑后出现这类回执属于合法场景状态而非代码缺陷：p1 开局背包没有可持续的
 * 铁矿来源（config-war.yaml 的 bootstrap 只给铁块 120，地图上无采矿机、机甲也不自动
 * 采矿），跑久后 iron_ingot 归零，而风力涡轮机/采矿机都要铁块 4，于是本地预检直接
 * 拦下建造，journal 记为「建造 · 失败未生效无法建造：缺少 铁块 4」。
 * 这类用例应跳过真实闭环断言，避免把资源枯竭误判成回归失败。
 */
async function localPreflightBlock(page: Page): Promise<string | null> {
  const firstEntry = page.locator('.planet-command-history li').first();
  if ((await firstEntry.count()) === 0) {
    return null;
  }
  const text = ((await firstEntry.textContent()) ?? '').trim();
  const isFailure = /失败|未生效/.test(text);
  const isPreflightBlock = /无法建造|无法开采|缺少|LOCAL_PREFLIGHT/.test(text);
  return isFailure && isPreflightBlock ? text : null;
}

/**
 * 服务端建造校验：放置后不得把任何地面单位（含己方机甲）的四邻全部堵死
 * （server/internal/gamecore/build_commands.go 的 buildingEnclosure）。
 * 战争服开局基地被自家建筑群包住，机甲四邻的空地必然被拒；这里把这类格子排除。
 */
function sealsAnyGroundUnit(scene: ScenePayload, tile: { x: number; y: number }): boolean {
  // 服务端口径（unitTileBlockedBeforeBuild）：只有建筑/地形/界外阻挡通行，单位自己不阻挡。
  const blockedCells = buildingCells(scene);
  return Object.values(scene.units ?? {}).some((unit) => {
    const neighbors = [
      { x: unit.position.x + 1, y: unit.position.y },
      { x: unit.position.x - 1, y: unit.position.y },
      { x: unit.position.x, y: unit.position.y + 1 },
      { x: unit.position.x, y: unit.position.y - 1 },
    ];
    const blocked = (point: { x: number; y: number }) => (
      (point.x === tile.x && point.y === tile.y)
      || blockedCells.has(`${point.x}:${point.y}`)
      || scene.terrain?.[point.y]?.[point.x] !== 'buildable'
    );
    return neighbors.every(blocked);
  });
}

/** 在执行体操作范围内挑一块可建造空地（按曼哈顿距离由近及远）。 */
function pickBuildTile(scene: ScenePayload): { x: number; y: number } {
  const executor = Object.values(scene.units ?? {}).find(
    (unit) => unit.owner_id === 'p1' && unit.type === 'executor',
  );
  if (!executor) {
    throw new Error('战争服中应存在 p1 的执行体单位');
  }

  const origin = executor.position;
  for (let distance = 1; distance <= OPERATE_RANGE; distance += 1) {
    for (let dx = -distance; dx <= distance; dx += 1) {
      const dy = distance - Math.abs(dx);
      for (const stepY of distance === 0 || dy === 0 ? [0] : [-dy, dy]) {
        const x = origin.x + dx;
        const y = origin.y + stepY;
        if (x < 0 || y < 0 || x >= scene.map_width || y >= scene.map_height) {
          continue;
        }
        if (scene.terrain?.[y]?.[x] !== 'buildable') {
          continue;
        }
        if (scene.visible && scene.visible[y]?.[x] !== true) {
          continue;
        }
        // 风力涡轮机细分网格后是 2×2 cell：整块占地都要空（只判原点会与旁边建筑重叠，
        // 前端本地预检直接拦下，命令发不出去）。
        if (!footprintFits(scene, { x, y }, WIND_TURBINE_FOOTPRINT)) {
          continue;
        }
        if (sealsAnyGroundUnit(scene, { x, y })) {
          continue;
        }
        return { x, y };
      }
    }
  }
  throw new Error(`执行体 ${executor.id} 周围 ${OPERATE_RANGE} 格内没有可建造空地`);
}

test('建造栏点选建筑卡片后在地图点击放置，命令回执出现在工作台', async ({ page }) => {
  // 并行规格共用同一个战争服：别的 spec（产线规划/量产单位等）可能在 pickBuildTile
  // 之后抢建了同一块空地，落点冲突要重试；每轮重试含 10s 的文案等待，
  // 默认 30s 会整例超时，这里给足。
  test.setTimeout(120_000);
  const scene = await fetchAuthorized<ScenePayload>(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
  );
  const tile = pickBuildTile(scene);

  const commandRequests = captureCommandRequests(page);
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}`);

  // 底部建造栏就绪后点选 wind_turbine 卡片，进入建造模式（幽灵预览提示出现）。
  // §3.2 快捷栏按分类页签分页，卡片未必在第一页：helper 会切到它所在的分类并等模式激活。
  await enterBuildMode(page, BUILDING_ID, '放置 风力涡轮机');
  await waitPlanetThree(page);

  // 3D 投影：tile → 页面坐标（不在视野内时接口会先聚焦）。
  await clickTileAt(page, tile);

  // 工作台最近结果：要么是本地预检拦下（战争服资源枯竭，合法场景状态），
  // 要么真的发出 build 命令并被服务端受理（有资源时校验真实闭环）。
  const firstEntry = page.locator('.planet-command-history li').first();
  await expect(firstEntry).toContainText('建造', { timeout: 10_000 });
  const blocked = await localPreflightBlock(page);
  if (blocked) {
    // 并行规格共用同一个战争服：别的 spec（产线规划等）可能在 pickBuildTile 之后
    // 抢建了这块空地——「该格已有你的建筑」是并发场景而非代码缺陷。
    // 重取场景换一个落点重试，重试用尽再按场景状态跳过。
    if (/已有你的建筑|已有其他玩家的建筑|已有你的施工任务/.test(blocked)) {
      let retried = false;
      for (let attempt = 0; attempt < 4 && !retried; attempt += 1) {
        const fresh = await fetchAuthorized<ScenePayload>(
          `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
        );
        const nextTile = pickBuildTile(fresh);
        await clickTileAt(page, nextTile);
        await expect(firstEntry).toContainText('建造', { timeout: 10_000 });
        const again = await localPreflightBlock(page);
        if (!again) {
          retried = true;
          break;
        }
        if (!/已有你的建筑|已有其他玩家的建筑|已有你的施工任务/.test(again)) {
          test.skip(true, `战争服 p1 背包已耗尽建造成本，前端本地预检拦下建造（${again}），跳过真实闭环断言`);
          return;
        }
      }
      if (!retried) {
        test.skip(true, `战争服基地附近的空地已被并行规格占满（${blocked}），跳过真实闭环断言`);
        return;
      }
    } else {
      // 本地预检失败 ⇒ 前端根本没发命令；断言这一点，避免把「假成功」当成通过。
      expect(commandRequests).toHaveLength(0);
      test.skip(true, `战争服 p1 背包已耗尽建造成本，前端本地预检拦下建造（${blocked}），跳过真实闭环断言`);
      return;
    }
  }
  expect(commandRequests.length).toBeGreaterThan(0);
  // 长跑后基地附近可能已被别的用例塞满建筑：服务端会把「把机甲四周完全堵死」的落点拒掉
  // （回执「会把机甲…四周完全堵死，最后一个出口…」）。这与资源枯竭同属场景状态而非代码缺陷，
  // 前端本地预检放行、服务端拒收，仍走真实闭环，只是需要换个落点。
  if (/堵死|围死/.test((await firstEntry.textContent()) ?? '')) {
    test.skip(true, `战争服基地附近已被建筑占满，服务端拒绝「堵死机甲」的落点（${(await firstEntry.textContent())?.trim()}）`);
    return;
  }
  // authoritative 回写为成功（受理→回写有时序，不断言瞬态 pending 文案）。
  await expect(firstEntry).toContainText('成功', { timeout: 30_000 });
});

test('采集建筑可直接放置在资源格上（前端不再本地拦截）', async ({ page }) => {
  const scene = await fetchAuthorized<ScenePayload>(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
  );

  // 挑一个可见、地形可建、无建筑占用、矿种在采矿机白名单内、且落在机甲作业范围内的资源格
  // （采矿机必须压资源点，且服务端要求施工点在机甲作业范围内，否则回执 OUT_OF_RANGE）。
  // 战争服开局基地被自家建筑群包住，机甲四邻的矿点都会被「围死校验」拒收；候选按到机甲的
  // 距离由近及远排序，逐个尝试直到服务端受理（accepted）。
  const executor = Object.values(scene.units ?? {}).find(
    (unit) => unit.owner_id === 'p1' && unit.type === 'executor',
  );
  if (!executor) {
    throw new Error('战争服中应存在 p1 的执行体单位，用于筛选机甲作业范围内的采矿机落点');
  }
  const surfaceDistance = (a: ScenePosition, b: ScenePosition) => {
    const wrap = (delta: number, size: number) => {
      const d = Math.abs(delta) % size;
      return Math.min(d, size - d);
    };
    return wrap(a.x - b.x, scene.map_width) + wrap(a.y - b.y, scene.map_height);
  };

  // 采矿机占地（server/data/buildings.yaml：3×3 cell）：整块占地都要空，否则前端本地
  // 预检会以「该格已有你的建筑」拦下（细分网格后 1×1 的老假设不成立）。
  const occupiedByBuilding = buildingCells(scene);
  const candidates = scene.resources.filter((resource) => {
    // 服务端只允许采矿机开采 ALLOWED_MINING_RESOURCES 里的矿种（water/crude_oil/log 等由别的建筑开采）。
    if (!ALLOWED_MINING_RESOURCES.has(resource.kind ?? '')) {
      return false;
    }
    const { x, y } = resource.position;
    if (scene.terrain?.[y]?.[x] !== 'buildable') {
      return false;
    }
    if (scene.visible && scene.visible[y]?.[x] !== true) {
      return false;
    }
    if (!footprintFits(scene, { x, y }, MINING_MACHINE_FOOTPRINT)) {
      return false;
    }
    return surfaceDistance(resource.position, executor.position) <= OPERATE_RANGE;
  });
  // 长跑后基地附近被别的用例的建筑填满，机甲最后的出口可能只剩资源格——那种落点会被服务端
  // 以「会把机甲四周完全堵死」拒收。优先挑不堵死任何地面单位的候选；一个都没有时保留原候选
  // （下面的循环仍会走真实闭环，全被拒时按场景状态跳过）。
  const nonSealing = candidates.filter((resource) => !sealsAnyGroundUnit(scene, resource.position));
  if (candidates.length > 0 && nonSealing.length === 0) {
    test.skip(
      true,
      `机甲 ${executor.id} 的最后一个出口只剩资源格：所有候选落点都会被服务端「围死校验」拒收，`
      + `跳过真实闭环断言（同一份战争服上跑过多轮建造类用例后的场景状态）`,
    );
    return;
  }
  const usableCandidates = nonSealing.length > 0 ? nonSealing : candidates;
  if (candidates.length === 0) {
    const kinds = [...new Set(scene.resources.map((resource) => resource.kind ?? 'unknown'))].join(', ');
    // 战争服长跑后合法场景状态：机甲作业范围内所有可开采资源格都已被采矿机占用
    // （或资源格不可见），此时没有可验证的落点，跳过而不是误判为回归失败。
    // 全新战争服开局必定存在候选格（starter 资源点保证），该断言仍会真实执行。
    test.skip(
      true,
      `机甲 ${executor.id} 周围 ${OPERATE_RANGE} 格内已无可放置采矿机的资源格`
      + `（白名单矿种 + 地形 buildable + 可见 + 无建筑占用），当前场景资源矿种为 [${kinds}]`,
    );
    return;
  }

  const commandRequests = captureCommandRequests(page);
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}`);

  const buildCard = page.locator('.planet-build-card[data-building-id="mining_machine"]');
  // §3.2 DSP 快捷栏一次只显示一个分类页签：采矿机在「采集」下，先切过去再点。
  await expect(page.locator('.planet-build-bar')).toBeVisible({ timeout: 30_000 });
  await revealBuildCard(page, 'mining_machine');
  await expect(buildCard).toBeVisible({ timeout: 10_000 });
  // 缺料卡仍然可点（不 aria-disabled）：点开要么进建造模式，要么摊开缺料清单。
  // 背包已被长跑耗光时没有可验证的落点，按场景状态跳过而不是把 click 等到超时。
  if (!await openBuildShortageNotice(page, 'mining_machine')) {
    test.skip(true, '战争服 p1 背包已不足以建采矿机：建造卡点开的是缺料清单，跳过真实闭环断言');
    return;
  }
  await expect(page.locator('.planet-build-bar__hint')).toContainText('放置 采矿机');
  await waitPlanetThree(page);

  // 与前端 assessBuildTiles 同口径的候选排序：按到机甲的距离由近及远逐个尝试——「被资源点占用」
  // 是采矿机的合法目标，但服务端还会因「围死单位」「超出作业范围」拒收，且并行规格可能刚占了
  // 最近的格子。逐个点到服务端受理（accepted）为止，保证这条真实闭环断言每次都真的跑起来。
  const byDistance = [...usableCandidates].sort((left, right) => (
    surfaceDistance(left.position, executor.position) - surfaceDistance(right.position, executor.position)
  ));
  let firstEntry = page.locator('.planet-command-history li').first();
  let blocked: string | null = null;
  let accepted = false;
  // 只重试「被服务端规则拒绝」的回执（围死/超范围/资源不足/并发上限等）：命令确实发出去了，
  // 换一格继续试；本地预检拦截（LOCAL_PREFLIGHT）说明前端根本没发命令，直接跳出。
  for (const candidate of byDistance) {
    await clickTileAt(page, candidate.position);
    await expect
      .poll(async () => (await page.locator('.planet-command-history li').count()) > 0, { timeout: 5_000 })
      .toBe(true);
    firstEntry = page.locator('.planet-command-history li').first();
    await expect(firstEntry).toContainText('建造', { timeout: 10_000 });
    blocked = await localPreflightBlock(page);
    if (blocked) {
      break;
    }
    if (((await firstEntry.textContent()) ?? '').includes('成功')) {
      accepted = true;
      break;
    }
  }

  if (blocked) {
    // 本地预检失败 ⇒ 前端根本没发命令，且不得是「被资源点占用」这条旧拦截。
    expect(commandRequests).toHaveLength(0);
    expect(blocked).not.toContain('被资源点占用');
    test.skip(true, `战争服 p1 背包已耗尽建造成本，前端本地预检拦下建造（${blocked}），跳过真实闭环断言`);
    return;
  }
  // 服务端「会把机甲四周完全堵死」的拒收同样是长跑后的场景状态：基地附近已被别的用例的
  // 建筑填满，机甲最后一个出口只剩候选资源格。这是真实闭环（命令确实发了），跳过而非失败。
  if (!accepted && /堵死|围死/.test((await firstEntry.textContent()) ?? '')) {
    test.skip(true, `战争服基地附近已被建筑占满，服务端拒绝「堵死机甲」的落点（${(await firstEntry.textContent())?.trim()}）`);
    return;
  }
  expect(commandRequests.length).toBeGreaterThan(0);
  // 采矿机落在资源格上必须被服务端受理（不再是 LOCAL_PREFLIGHT 的「被资源点占用」）。
  await expect(firstEntry).toContainText('成功', { timeout: 10_000 });
  expect(accepted, '至少一个资源格候选应被服务端受理').toBe(true);
  await expect(firstEntry).not.toContainText('被资源点占用');
  await expect(firstEntry).not.toContainText('LOCAL_PREFLIGHT');
});

test('首次进入行星页视角聚焦基地，基地不被信息片遮挡且可点选', async ({ page }) => {
  const scene = await fetchAuthorized<ScenePayload>(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
  );
  // 与前端 resolveHomeTile 同规则：按 id 排序的第一个 p1 建筑即"基地"。
  const home = Object.entries(scene.buildings ?? {})
    .filter(([, building]) => building.owner_id === 'p1')
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))[0];
  if (!home) {
    throw new Error('战争服中应存在 p1 的基地建筑');
  }
  const [homeId, homeBuilding] = home;

  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}`);

  await waitPlanetThree(page);

  // 回家视角：3D 地面视角聚焦基地，基地投影落在画布内且不压在左上行星胶囊区域。
  const canvas = page.locator('.planet-three__surface canvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error('3D 画布不可见');
  }
  const screenPos = await entityScreenPos(page, homeId);
  // 页面坐标 → 画布内坐标（base 建筑 5×5，entityScreenPos 取占地中心）。
  const localX = screenPos.x - canvasBox.x;
  const localY = screenPos.y - canvasBox.y;
  expect(localX).toBeGreaterThan(0);
  expect(localX).toBeLessThan(canvasBox.width);
  expect(localY).toBeGreaterThan(0);
  expect(localY).toBeLessThan(canvasBox.height);
  const chip = await page.locator('.planet-title-chip').boundingBox();
  if (!chip) {
    throw new Error('行星胶囊不可见');
  }
  const underTitleChip =
    screenPos.x >= chip.x && screenPos.x <= chip.x + chip.width
    && screenPos.y >= chip.y && screenPos.y <= chip.y + chip.height;
  expect(underTitleChip, `基地落在行星胶囊 ${JSON.stringify(chip)} 下（点不到）`).toBe(false);

  // 直接点击基地（占地中心）→ 选中该建筑（信息片不阻断画布命中）。
  await page.mouse.click(screenPos.x, screenPos.y);
  await expect(page.locator('.planet-three__nav-status')).toContainText(`建筑 ${homeId}`);
  // 底部选择条与状态行是同一份选中状态的两种呈现。
  await expect(page.getByTestId('planet-selection-bar')).toBeVisible();

  // §3.2：胶囊默认收起（一行），可展开成资源芯片 + 「生产规划」，再折回收起态。
  await expect(page.locator('.planet-title-chip__chips')).toHaveCount(0);
  await page.getByRole('button', { name: '展开行星信息' }).click();
  await expect(page.locator('.planet-title-chip__chips')).toBeVisible();
  await expect(page.getByRole('button', { name: '生产规划', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '折叠行星信息' }).click();
  await expect(page.locator('.planet-title-chip__chips')).toHaveCount(0);
});

/**
 * 建造栏与工作台抽屉的几何关系（战争服开局即有可建造卡片）：
 * - 抽屉打开时建造栏自动收起成一行把手，不与抽屉重叠；
 * - 手动点「建造栏」把手展开后，建造栏（含横向滚动区）必须落在抽屉左侧的可用区域里，
 *   右缘不得越到抽屉左缘之上（宽屏），窄屏则让抽屉让位后同样不重叠。
 */
for (const viewport of [
  { width: 400, height: 844, label: '窄屏 400px' },
  { width: 1280, height: 900, label: '宽屏 1280px' },
]) {
  test(`工作台抽屉打开时建造栏自动收起，展开后不与抽屉重叠（${viewport.label}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installSession(page);
    await page.goto(`/planet/${PLANET_ID}`);
    await expect(page.locator('.planet-build-card').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: '工作台' }).first().click();
    await expect(page.getByRole('tab', { name: '工作台' })).toBeVisible();

    const geometry = () => page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
      };
      return {
        drawer: rect('.planet-drawer__body'),
        drawerOpen: Boolean(document.querySelector('.planet-drawer--open')),
        buildBar: rect('[data-testid="planet-build-bar"]'),
        scroller: rect('.planet-build-bar__scroller'),
        viewportWidth: window.innerWidth,
        docked: Boolean(document.querySelector('.planet-build-bar--docked')),
      };
    });
    const overlapsOf = (
      left: { x: number; y: number; width: number; height: number } | null,
      right: { x: number; y: number; width: number; height: number } | null,
    ) => {
      if (!left || !right) return false;
      return !(
        left.x + left.width <= right.x
        || left.x >= right.x + right.width
        || left.y + left.height <= right.y
        || left.y >= right.y + right.height
      );
    };

    const collapsed = await geometry();
    expect(collapsed.docked, '抽屉打开时建造栏应自动收起成一行把手').toBe(true);
    expect(collapsed.buildBar).not.toBeNull();
    expect(collapsed.drawer).not.toBeNull();
    expect(
      overlapsOf(collapsed.buildBar, collapsed.drawer),
      `收起态建造栏 ${JSON.stringify(collapsed.buildBar)} 与抽屉 ${JSON.stringify(collapsed.drawer)} 不应重叠`,
    ).toBe(false);

    // 手动点把手展开建造栏：卡片恢复可见，展开后的建造栏与滚动区都不得压到抽屉上。
    await page.getByRole('button', { name: '建造栏', exact: true }).click();
    await expect(page.locator('.planet-build-card').first()).toBeVisible();
    // 窄屏让位时抽屉走 transform 过渡（translate 300px），要等它滑出后才量最终几何。
    await expect.poll(async () => {
      const current = await geometry();
      return overlapsOf(current.buildBar, current.drawer) || overlapsOf(current.scroller, current.drawer);
    }, { timeout: 5_000, message: '展开后建造栏与抽屉不得重叠' }).toBe(false);
    const expanded = await geometry();
    expect(expanded.docked).toBe(false);
    expect(expanded.buildBar).not.toBeNull();
    expect(expanded.scroller).not.toBeNull();
    if (expanded.drawerOpen) {
      // 抽屉仍打开（宽屏）：建造栏必须收缩到抽屉左侧的可用区域
      expect(expanded.buildBar!.right).toBeLessThanOrEqual(expanded.drawer!.x + 1);
      expect(expanded.scroller!.right).toBeLessThanOrEqual(expanded.drawer!.x + 1);
    }
    // 两种宽度下展开的建造栏都必须在视口内（卡片改横向滚动，不能把整页撑宽）
    expect(expanded.buildBar!.x).toBeGreaterThanOrEqual(0);
    expect(expanded.buildBar!.right).toBeLessThanOrEqual(expanded.viewportWidth);
    expect(expanded.scroller!.x).toBeGreaterThanOrEqual(0);
    expect(expanded.scroller!.right).toBeLessThanOrEqual(expanded.viewportWidth);
  });
}
