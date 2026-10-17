import { expect, test, type Page } from '@playwright/test';
import { surfaceFace, type SurfacePoint } from '../../shared-client/src/surface';

import { enterBuildMode, revealBuildCard } from './support/build-bar';
import { footprintFits } from './support/footprint';
import { backendEntry } from './support/scenario';
import { requireScenario } from './support/scenario-gate';

requireScenario('war', '需要官方战争场景（固定出生点 132,132 与预置建筑），默认遭遇战场景跳过。');

const planet = 'planet-1-1';
type Entity = { id: string; type: string; owner_id: string; position: SurfacePoint; move_range?: number };
type Patch = { bounds: { x: number; y: number; width: number; height: number }; terrain: string[][]; visible: boolean[][] };
type Scene = Patch & { surface: { face_size: number }; surface_patches?: Patch[]; units: Record<string, Entity>; buildings: Record<string, Entity>; resources: { position: SurfacePoint }[] };
// 用 p2 视角跑 seam 全流程：p1/p2 各有独立 executor 与出生角，避免与同服并行规格（planet-three 等）互相抢同一个执行体
const headers = { authorization: 'Bearer key_player_2' };

/**
 * 战争图 p2 的出生点（server/map-war.yaml 的 spawn_points[1]）。
 *
 * 细分网格后地图是 432×288 cell，窗口 48×48 只覆盖面的一小块——旧代码写死
 * near_x/near_y = 44（那是 p1 的旧坐标），在 p2 视角下窗口里连一个单位都没有，
 * 用例第一行 `Object.values(initial.units)` 就崩了。
 *
 * 这里不写死：不带 near_x/near_y 时服务端按相机窗口回实体，用一个够大的窗口
 * 先把 p2 执行体找出来，再用它的位置取 48×48 的流式窗口。
 */
async function wideScene(): Promise<Scene> {
  const response = await fetch(`${backendEntry()}/world/planets/${planet}/scene?x=0&y=0&width=200&height=200`, { headers });
  expect(response.ok).toBe(true);
  return response.json();
}

let sceneCenter: SurfacePoint | undefined;
/** p2 执行体 id（用例开始时解析，供移动/选中复用）。 */
let p2ExecutorId = '';
function executorUnitId() { return p2ExecutorId; }

async function scene(center: SurfacePoint = sceneCenter ?? { x: 0, y: 0 }): Promise<Scene> {
  const response = await fetch(`${backendEntry()}/world/planets/${planet}/scene?x=0&y=0&width=48&height=48&near_x=${center.x}&near_y=${center.y}&radius=12`, { headers });
  expect(response.ok).toBe(true);
  return response.json();
}
function usable(data: Scene, tile: SurfacePoint) {
  const patch = [data, ...(data.surface_patches ?? [])].find(p => tile.x >= p.bounds.x && tile.y >= p.bounds.y && tile.x < p.bounds.x+p.bounds.width && tile.y < p.bounds.y+p.bounds.height);
  if (!patch || patch.terrain[tile.y-patch.bounds.y]?.[tile.x-patch.bounds.x] !== 'buildable' || !patch.visible[tile.y-patch.bounds.y]?.[tile.x-patch.bounds.x]) return false;
  // 细分网格后风力涡轮机是 2×2 cell：整块占地都要空（只判原点会让前端本地预检
  // 以「该格已有你的建筑」拦下，命令发不出去）。
  if (!footprintFits(data, tile, WIND_TURBINE_FOOTPRINT)) return false;
  return ![...Object.values(data.buildings), ...Object.values(data.units), ...data.resources].some(e => e.position.x === tile.x && e.position.y === tile.y);
}
/**
 * 找一格「跨面接缝」的可建空地。
 *
 * 细分网格后面宽 144 cell，p2 出生点 (132,132) 距最近的立方体棱 12 cell——
 * 旧的 6 步上限是给面宽 48 的旧图写的，在新图上永远走不到接缝。
 * 24 步覆盖「相机窗口（48×48）内能看到的接缝格」。
 */
const SEAM_SEARCH_STEPS = 24;
/** 风力涡轮机占地（server/data/buildings.yaml：2×2 cell）。 */
const WIND_TURBINE_FOOTPRINT = { width: 2, height: 2 };
/** 跨面落点必须落在机甲的作业半径内（config-war.yaml：executor.operate_range = 18 cell）。 */
const OPERATE_RANGE_CELLS = 18;

/**
 * 找一格**跨面且可建造**的落点。
 *
 * 不能写死方向：基地在面内的位置决定了最近的接缝在哪一侧（p2 出生点 (132,131) 在
 * +Z 面右下角，接缝在东侧；p1 在另一侧）。按曼哈顿距离在机甲四周螺旋扫描，
 * 取最近的合法跨面格——既保证「跨面」这个被测性质，又天然落在最近的接缝附近
 * （通常只有 1–3 cell，不会超出 operate_range）。
 */
function seamTileNear(data: Scene, origin: SurfacePoint, maxDistance = OPERATE_RANGE_CELLS, excluded?: SurfacePoint) {
  const n = data.surface.face_size, start = surfaceFace(origin, n);
  for (let d = 1; d <= maxDistance; d += 1) {
    for (let dx = -d; dx <= d; dx += 1) {
      for (let dy = -d; dy <= d; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const tile = { x: origin.x + dx, y: origin.y + dy };
        if (excluded?.x === tile.x && excluded?.y === tile.y) continue;
        if (surfaceFace(tile, n) === start || !usable(data, tile)) continue;
        return tile;
      }
    }
  }
  throw new Error(`执行体 ${origin.x},${origin.y} 的 ${maxDistance} cell 内没有可见、可建的跨面接缝格`);
}
async function clickTile(page: Page, tile: SurfacePoint) {
  const point=await page.evaluate(tile => {
    const renderer=(window as any).__planetThree;
    renderer.focus(tile,true);
    return renderer.project(tile);
  },tile);
  expect(point.visible).toBe(true);
  await page.locator('.planet-three__surface canvas').click({position:{x:point.x,y:point.y}});
}

/**
 * 3D 拾取命中：点击后选中条应报出该实体。
 *
 * 用 `renderer.project` 算出的屏幕点未必落在实体上——相机在球面法线上垂直俯视，
 * 高一点的邻居（风机塔）会盖住机甲所在的格（实测：先建风机再点机甲，选中的是风机）。
 * 从格子中心向外螺旋试几个偏移点，直到命中；选不中不算失败，交给调用方决定。
 */
async function pickEntity(page: Page, tile: SurfacePoint, label: string, attempts = 9) {
  const selectionBar = page.getByTestId('planet-selection-bar');
  for (let i = 0; i < attempts; i += 1) {
    const point = await page.evaluate(({ tile, i }) => {
      const renderer = (window as any).__planetThree;
      renderer.focus(tile, true);
      const base = renderer.project(tile);
      const angle = i * 2.399;
      const radius = i === 0 ? 0 : 4 + i * 1.5;
      return { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius, visible: base.visible };
    }, { tile, i });
    if (!point.visible) continue;
    await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } });
    const hit = await expect(selectionBar).toContainText(label, { timeout: 2_000 }).then(() => true).catch(() => false);
    if (hit) return true;
  }
  return false;
}

/**
 * 该建筑是否由本玩家拆除（选中它 → 点「拆除」）。
 *
 * 用途：跨面接缝用例需要一格**跨面且可建造**的落点，而战争图 p2 出生角紧贴 +Z 面
 * 右下角——接缝那侧唯一可见格（144,131）被场景预置的风力涡轮机占着，`accepted` 的
 * build 命令下一 tick 会被服务端静默拒收（回执仍是 202）。这是「场景占位」而不是
 * 客户端缺陷，所以像玩家一样先拆掉它，再走真实建造闭环。
 */
async function demolishOwnBuilding(page: Page) {
  const responsePromise = page.waitForResponse(
    r => r.url().endsWith('/commands') && r.request().postDataJSON()?.commands?.[0]?.type === 'demolish',
    { timeout: 12_000 },
  ).catch(() => null);
  await page.getByTestId('planet-selection-bar').getByRole('button', { name: '拆除', exact: true }).click();
  const response = await responsePromise;
  return Boolean(response);
}

/**
 * 战争图 p2 出生角的接缝：场景预置了一台 2×2 风力涡轮机正好压住它。
 *
 * p2 出生点 (132,131) 在 +Z 面右下角、离东侧立方体棱 12 cell；这一侧唯一可见的
 * 跨面格 (144,131) 被场景预置的 2×2 风机占着。用例要测的是**跨面建造**这个性质，
 * 所以先把挡路的自家风机拆掉（真实 demolish 命令），再在腾出来的跨面格上建自己的
 * 风机——而不是把「场景占位」当成用例失败。建筑 ID 由服务端播种顺序决定，按位置
 * 解析而不是写死。
 */
const SEAM_TILE = { x: 144, y: 131 };
/** 走到接缝格旁需要的移动目标（距出生点 12 cell，机甲的作业半径 18 覆盖得到）。 */
const SEAM_APPROACH = { x: 143, y: 131 };

/** 压在跨面格上的自家建筑（按位置解析，返回 null 表示该格已空）。 */
async function seamObstacle() {
  const wide = await wideScene();
  return (Object.values(wide.buildings ?? {}) as Array<{ id: string; type: string; owner_id: string; position: SurfacePoint }>)
    .find((b) => b.owner_id === 'p2' && b.position.x === SEAM_TILE.x && b.position.y === SEAM_TILE.y) ?? null;
}

async function moveExecutorTo(page: Page, tile: SurfacePoint) {
  const me = (await scene()).units?.[executorUnitId()];
  if (me && me.position.x === tile.x && me.position.y === tile.y) return;
  // 先选中机甲（上一段交互留下的选中可能是刚拆掉的风机/空白），再进移动模式。
  expect(await pickEntity(page, me?.position ?? tile, '玩家机甲'), '点选机甲后选中条应报「玩家机甲」').toBe(true);
  await page.getByTestId('planet-selection-bar').getByRole('button', { name: '移动', exact: true }).click();
  const moved = await clickTileExpectingCommand(page, async () => tile, 'move');
  expect(await moved.response.json()).toMatchObject({ accepted: true });
  await expect.poll(async () => {
    const unit = (await scene()).units?.[executorUnitId()];
    return unit ? Math.abs(unit.position.x - tile.x) + Math.abs(unit.position.y - tile.y) : 99;
  }, { timeout: 20_000 }).toBeLessThanOrEqual(1);
}

/** 3D 软渲染下单次点选偶尔被场景吞掉（pick 落空或被当成普通选中），
 * 且并行规格会同服抢建同一空地——每次尝试都重新取场景、重算目标格，
 * 直到目标类型的命令真正发出。返回 { response, tile }（实际命中的格子）。
 */
async function clickTileExpectingCommand(page: Page, pickTile: () => Promise<SurfacePoint>, commandType: string, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const tile = await pickTile();
    const responsePromise = page.waitForResponse(
      r => r.url().endsWith('/commands') && r.request().postDataJSON()?.commands?.[0]?.type === commandType,
      { timeout: 12_000 },
    ).catch(() => null);
    await clickTile(page, tile);
    const response = await responsePromise;
    if (response) return { response, tile };
  }
  throw new Error(`no ${commandType} command issued after ${attempts} tile click attempts`);
}

test('cube face seam: real GUI construction, movement, neighbor streaming and fixed unit scale', async ({page}) => {
  test.setTimeout(180_000);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(`${message.text()} (${message.location().url})`);});
  // 服务端只回相机窗口（48×48）内的实体：p2 出生点距 p1 出生点很远，
  // 相机窗口必须对准 p2 自己的执行体，否则 units 字段整体缺省（undefined）。
  const wide = await wideScene();
  const p2Executor = Object.values(wide.units ?? {}).find(u => u.type === 'executor' && u.owner_id === 'p2');
  expect(p2Executor, '战争服应预置 p2 执行体（用于跨面接缝用例）').toBeDefined();
  sceneCenter = p2Executor!.position;
  p2ExecutorId = p2Executor!.id;
  const initial=await scene();
  const executor=Object.values(initial.units ?? {}).find(u=>u.type==='executor'&&u.owner_id==='p2')!;
  expect(executor).toBeDefined();
  await page.addInitScript(()=>localStorage.setItem('siliconworld-client-web-session',JSON.stringify({state:{serverUrl:location.origin,playerId:'p2',playerKey:'key_player_2'},version:0})));
  await page.goto(`/planet/${planet}?e2e=1`);
  await page.waitForFunction(()=>Boolean((window as any).__planetThree?.data?.planet?.surface_patches?.length));
  const beforeScale=await page.evaluate(id=>(window as any).__planetThree.moving.get(`unit:${id}`).group.scale.toArray(),executor.id);
  const selectionBar = page.getByTestId('planet-selection-bar');

  // ① 清场：p2 出生角那侧唯一可见的跨面格被场景预置的自家风机占着，先像玩家一样拆掉它。
  //    同一台战争服上跑第二次时它已经被拆掉，此时直接进建造（幂等）。
  if (await seamObstacle()) {
    expect(await pickEntity(page, SEAM_TILE, '风力涡轮机'), '应能点选跨面格上的预置风机').toBe(true);
    expect(await demolishOwnBuilding(page), '拆除命令应发出').toBe(true);
    await expect.poll(async()=>Boolean(await seamObstacle()),{timeout:20_000}).toBe(false);
  }

  // ② 走近接缝（12 cell，超出建造中心半径 72 之外的判定只在机甲作业半径 18 内成立）。
  await moveExecutorTo(page, SEAM_APPROACH);

  // ③ 在跨面格上真实建造（命令跨面接缝落到相邻立方体面）。
  await enterBuildMode(page, 'wind_turbine', /放置 风力涡轮机/);
  const {response:built,tile:buildTile}=await clickTileExpectingCommand(page,async()=>SEAM_TILE,'build');
  expect(await built.json()).toMatchObject({accepted:true,results:[{code:'OK'}]});
  await expect.poll(async()=>Object.values((await scene(buildTile)).buildings).some(b=>b.type==='wind_turbine'&&b.position.x===buildTile.x&&b.position.y===buildTile.y),{timeout:20_000}).toBe(true);
  // 跨面性质：落点与「机甲下达命令时所在的格」必须分属两个立方体面。
  // 不能拿 `executor.position`（用例开头取的）比：同一台长跑战争服上执行体可能已被
  // 上一轮跑到接缝另一侧，那样这条断言就退化成恒真/恒假。用固定几何的接近格比。
  const faceSize = (await scene()).surface.face_size;
  expect(surfaceFace(SEAM_APPROACH, faceSize)).not.toBe(surfaceFace(buildTile, faceSize));
  await page.keyboard.press('Escape');

  // 建造带 auto_approach：机甲会走到落点旁，`initial` 里的位置已经过期。
  // 后续「点自己 → 移动」必须以服务端当前坐标为准，否则点到的可能是刚落成的建筑。
  const liveExecutor = async () => (await scene()).units?.[executor.id] ?? executor;
  const executorNow = await liveExecutor();
  const target=seamTileNear(await scene(executorNow.position),executorNow.position,OPERATE_RANGE_CELLS,buildTile);
  const route=await fetch(`${backendEntry()}/world/planets/${planet}/path?unit_id=${executor.id}&target_x=${target.x}&target_y=${target.y}`,{headers});
  expect(route.ok).toBe(true);
  expect(await route.json()).toMatchObject({reachable:true});
  // 3D 拾取会命中屏幕上叠在格子前的实体（刚落成的 2×2 风机就可能盖住机甲所在格）：
  // 重取实时坐标、重试点选，直到选中条报出机甲。
  let selected = false;
  for (let attempt = 0; attempt < 5 && !selected; attempt += 1) {
    const me = await liveExecutor();
    selected = await pickEntity(page, me.position, '玩家机甲');
  }
  expect(selected, '点选机甲后选中条应报「玩家机甲」').toBe(true);
  await selectionBar.getByRole('button',{name:'移动',exact:true}).click();
  // 等移动模式激活（按钮变为“取消移动”）再点目标格，避免慢渲染下的竞态
  await expect(selectionBar.getByRole('button',{name:'取消移动',exact:true})).toBeVisible();
  const {response:moved,tile:moveTarget}=await clickTileExpectingCommand(page,async()=>{const me=await liveExecutor();return seamTileNear(await scene(me.position),me.position,OPERATE_RANGE_CELLS,buildTile);},'move');
  expect(await moved.json()).toMatchObject({accepted:true,results:[{code:'OK'}]});
  await expect.poll(async()=>(await scene(moveTarget)).units[executor.id]?.position,{timeout:20_000}).toMatchObject(moveTarget);
  await expect.poll(()=>page.evaluate(({id,target})=>{
    const renderer=(window as any).__planetThree;
    const p=renderer.data.planet.units[id]?.position;
    return p?.x===target.x&&p?.y===target.y;
  },{id:executor.id,target:moveTarget})).toBe(true);
  const afterScale=await page.evaluate(id=>(window as any).__planetThree.moving.get(`unit:${id}`).group.scale.toArray(),executor.id);
  expect(afterScale).toEqual(beforeScale);
  await expect.poll(()=>page.evaluate(()=>{
    const renderer=(window as any).__planetThree;
    const mark=renderer.marks.children.find((m:any)=>m.material.color.getHex()===0xfff1a8);
    if(!mark)return null;
    mark.geometry.computeBoundingSphere();
    return renderer.tileFromNormal(mark.geometry.boundingSphere.center.clone().normalize());
  })).toMatchObject(moveTarget);
  await page.screenshot({path:'/tmp/siliconworld-cube-seam.png',fullPage:true});
  await page.getByRole('button',{name:'全球视角',exact:true}).click();
  await page.screenshot({path:'/tmp/siliconworld-cube-globe.png',fullPage:true});
  expect(errors).toEqual([]);
});
