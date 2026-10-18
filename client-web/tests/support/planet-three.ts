import { expect, type Page } from '@playwright/test';

/**
 * 3D 行星地图（`PlanetMapThree`）的 E2E 交互辅助（R20-C1）。
 *
 * 2D 视图删除后（docs/guide/删除2D视图.md D1）不再有 DOM 实体层，所有「点某一格 / 拖一条带 /
 * 框选单位」都必须走 `window.__planetThree` 的投影接口（`VITE_E2E=1` / dev 下暴露）：
 * `tileScreenPos` / `entityScreenPos` 返回**页面 CSS 像素**，可以直接喂给 `page.mouse.*`
 * 或换算成元素内坐标。
 *
 * 优先真实鼠标：`page.mouse.click(point.x, point.y)`；`clickTile` / `dragTiles` 只在
 * 真实鼠标不稳（软渲染吞事件、并行 worker 抢事件）时作为兜底。
 */

export const THREE_CANVAS = '.planet-three__surface canvas';
export const THREE_STATUS = '.planet-three__nav-status';

export interface TilePoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface CameraState {
  center: TilePoint | null;
  altitude: number;
  zoom: number;
  tilt: number;
  groundView: boolean;
}

export interface ThreeTestApi {
  tileScreenPos(tile: TilePoint): ScreenPoint | null;
  entityScreenPos(id: string): ScreenPoint | null;
  clickTile(tile: TilePoint, button?: 0 | 2): unknown;
  dragTiles(from: TilePoint, to: TilePoint, modifiers?: { shift?: boolean; ctrl?: boolean }): boolean;
  project(tile: TilePoint): { x: number; y: number; visible: boolean } | null;
  getCenterTile(): TilePoint | null;
  getCameraState(): CameraState;
  focus(tile: TilePoint, close?: boolean): void;
  zoom(factor: number): void;
  setTilt(value: number): void;
  isGroundView(): boolean;
}

declare global {
  interface Window {
    __planetThree?: ThreeTestApi;
  }
}

/** 等 3D 画布挂载 + 测试接口就绪（dev / VITE_E2E=1）。 */
export async function waitPlanetThree(page: Page) {
  const canvas = page.locator(THREE_CANVAS);
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__planetThree?.tileScreenPos), undefined, { timeout: 30_000 });
  return canvas;
}

/** 投影稳定：focus / zoom 之后要等相机补间与至少两帧渲染。 */
export async function settleProjection(page: Page, ms = 300) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  if (ms > 0) await page.waitForTimeout(ms);
}

export async function cameraState(page: Page): Promise<CameraState> {
  return page.evaluate(() => window.__planetThree!.getCameraState());
}

/**
 * 把格子放到视野内并返回**页面**坐标。
 *
 * 贴地高度 < ~2.8 时相邻格会投到画布外（R20-C 契约），所以聚焦后保持默认高度，
 * 不要在这之后调 `zoom` 把镜头压到贴地。
 */
export async function focusTile(page: Page, tile: TilePoint): Promise<ScreenPoint> {
  await page.evaluate((point) => window.__planetThree!.focus(point), tile);
  await settleProjection(page);
  const point = await page.evaluate((target) => window.__planetThree!.tileScreenPos(target), tile);
  expect(point, `格子 (${tile.x}, ${tile.y}) 应能投影到屏幕`).not.toBeNull();
  return point!;
}

/** 不移动相机，直接取格子的页面坐标（不在视野内时接口会自己聚焦）。 */
export async function tileScreenPos(page: Page, tile: TilePoint): Promise<ScreenPoint> {
  const point = await page.evaluate((target) => window.__planetThree!.tileScreenPos(target), tile);
  expect(point, `格子 (${tile.x}, ${tile.y}) 应能投影到屏幕`).not.toBeNull();
  return point!;
}

export async function entityScreenPos(page: Page, entityId: string): Promise<ScreenPoint> {
  const point = await page.evaluate((id) => window.__planetThree!.entityScreenPos(id), entityId);
  expect(point, `实体 ${entityId} 应能投影到屏幕`).not.toBeNull();
  return point!;
}

/** 真实鼠标点击某一格（页面坐标，不做元素内换算）。 */
export async function clickTileAt(page: Page, tile: TilePoint, button: 0 | 2 = 0) {
  const point = await focusTile(page, tile);
  await page.mouse.click(point.x, point.y, { button: button === 2 ? 'right' : 'left' });
}

/**
 * 真实鼠标拖过一串格子（逐格 move，避免一次跳跃被拾取成起点/终点两点）。
 * `modifiers.shift` 时按住 Shift（3D 的框选 = Shift+左键拖）。
 */
export async function dragThroughTiles(
  page: Page,
  tiles: TilePoint[],
  modifiers: { shift?: boolean; ctrl?: boolean } = {},
) {
  expect(tiles.length, '拖拽至少需要起点与终点').toBeGreaterThanOrEqual(2);
  const start = await focusTile(page, tiles[0]);
  if (modifiers.shift) await page.keyboard.down('Shift');
  if (modifiers.ctrl) await page.keyboard.down('Control');
  try {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // 分步走：框选阈值 4px、铺带逐格判定都要求中间有 move 事件。
    for (const tile of tiles.slice(1)) {
      const point = await page.evaluate((target) => window.__planetThree!.tileScreenPos(target), tile);
      if (!point) continue;
      await page.mouse.move(point.x, point.y, { steps: 4 });
    }
    await page.mouse.up();
  } finally {
    if (modifiers.ctrl) await page.keyboard.up('Control');
    if (modifiers.shift) await page.keyboard.up('Shift');
  }
}

/** 兜底：走场景的合成指针接口（真实鼠标被软渲染吞掉时用）。 */
export async function syntheticClickTile(page: Page, tile: TilePoint, button: 0 | 2 = 0) {
  await page.evaluate(([target, btn]) => window.__planetThree!.clickTile(target, btn as 0 | 2), [tile, button] as const);
}

export async function syntheticDragTiles(
  page: Page,
  from: TilePoint,
  to: TilePoint,
  modifiers: { shift?: boolean; ctrl?: boolean } = {},
) {
  const ok = await page.evaluate(([start, end, mods]) => (
    window.__planetThree!.dragTiles(start, end, mods as { shift?: boolean; ctrl?: boolean })
  ), [from, to, modifiers] as const);
  expect(ok, `dragTiles ${JSON.stringify(from)} → ${JSON.stringify(to)} 应派发成功`).toBe(true);
}

/** 状态行（3D 下替代 2D 的 `.planet-map-canvas__status`）文本。 */
export async function statusText(page: Page): Promise<string> {
  const status = page.locator(THREE_STATUS);
  if (await status.count() === 0) return '';
  return (await status.first().innerText()).trim();
}

/** 状态行里的悬停坐标（`Hover (x, y)`）。 */
export async function hoveredTile(page: Page): Promise<TilePoint | null> {
  const match = (await statusText(page)).match(/Hover \((\d+), (\d+)\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** 记录发往 /commands 的 POST 请求体。 */
export function captureCommandRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/commands')) {
      requests.push(request.postData() ?? '');
    }
  });
  return requests;
}

/** 解析 `build` 命令的落点列表（每条命令一条，payload.building_type 对得上才收）。 */
export function buildCommandPlacements(requests: string[], buildingType: string): Array<{
  position: TilePoint;
  elevation?: number;
  direction?: string;
}> {
  const placements: Array<{ position: TilePoint; elevation?: number; direction?: string }> = [];
  for (const body of requests) {
    let parsed: { commands?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      continue;
    }
    for (const command of parsed.commands ?? []) {
      if (command.type !== 'build') continue;
      const target = command.target as { position?: TilePoint } | undefined;
      const payload = command.payload as { building_type?: string } | undefined;
      if (payload?.building_type !== buildingType || !target?.position) continue;
      placements.push({
        position: { x: target.position.x, y: target.position.y },
        elevation: (target.position as { z?: number }).z,
        direction: (payload as { direction?: string }).direction,
      });
    }
  }
  return placements;
}

/**
 * 等某类命令真的发出（POST /commands 里出现该 type）。
 * 返回请求体，调用方可继续断言 payload。
 */
export async function waitForCommand(page: Page, commandType: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const response = await page.waitForResponse((candidate) => {
    if (candidate.request().method() !== 'POST' || !candidate.url().endsWith('/commands')) return false;
    try {
      const body = candidate.request().postDataJSON() as { commands?: Array<{ type?: string }> };
      return body.commands?.some((command) => command.type === commandType) === true;
    } catch {
      return false;
    }
  }, { timeout: timeoutMs });
  return response.json() as Promise<Record<string, unknown>>;
}
