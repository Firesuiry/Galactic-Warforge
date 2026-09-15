import { expect, test, type Page } from '@playwright/test';
import { surfaceFace, surfaceStep, type SurfacePoint } from '../../shared-client/src/surface';

const backend = process.env.SW_BACKEND_ENTRY ?? 'http://127.0.0.1:19481';
const planet = 'planet-1-1';
type Entity = { id: string; type: string; owner_id: string; position: SurfacePoint; move_range?: number };
type Patch = { bounds: { x: number; y: number; width: number; height: number }; terrain: string[][]; visible: boolean[][] };
type Scene = Patch & { surface: { face_size: number }; surface_patches?: Patch[]; units: Record<string, Entity>; buildings: Record<string, Entity>; resources: { position: SurfacePoint }[] };
const headers = { authorization: 'Bearer key_player_1' };

async function scene(center = { x: 3, y: 3 }): Promise<Scene> {
  const response = await fetch(`${backend}/world/planets/${planet}/scene?x=0&y=0&width=48&height=48&near_x=${center.x}&near_y=${center.y}&radius=12`, { headers });
  expect(response.ok).toBe(true);
  return response.json();
}
function usable(data: Scene, tile: SurfacePoint) {
  const patch = [data, ...(data.surface_patches ?? [])].find(p => tile.x >= p.bounds.x && tile.y >= p.bounds.y && tile.x < p.bounds.x+p.bounds.width && tile.y < p.bounds.y+p.bounds.height);
  if (!patch || patch.terrain[tile.y-patch.bounds.y]?.[tile.x-patch.bounds.x] !== 'buildable' || !patch.visible[tile.y-patch.bounds.y]?.[tile.x-patch.bounds.x]) return false;
  return ![...Object.values(data.buildings), ...Object.values(data.units), ...data.resources].some(e => e.position.x === tile.x && e.position.y === tile.y);
}
function acrossFace(data: Scene, origin: SurfacePoint, excluded?: SurfacePoint) {
  const n=data.surface.face_size, start=surfaceFace(origin,n), queue=[{tile:origin,distance:0}], seen=new Set<string>();
  for (let i=0;i<queue.length;i++) {
    const {tile,distance}=queue[i];
    if (surfaceFace(tile,n)!==start && usable(data,tile) && (excluded?.x!==tile.x||excluded?.y!==tile.y)) return tile;
    if (distance>=6) continue;
    for(const direction of ['north','east','south','west'] as const) {
      const next=surfaceStep(tile,direction,n).tile,key=`${next.x},${next.y}`;
      if(!seen.has(key)) {seen.add(key);queue.push({tile:next,distance:distance+1});}
    }
  }
  throw new Error('The war fixture must have an available visible tile across a face seam within six steps.');
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

test('cube face seam: real GUI construction, movement, neighbor streaming and fixed unit scale', async ({page}) => {
  test.setTimeout(180_000);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(`${message.text()} (${message.location().url})`);});
  const initial=await scene();
  const executor=Object.values(initial.units).find(u=>u.type==='executor'&&u.owner_id==='p1')!;
  expect(executor).toBeDefined();
  const buildTile=acrossFace(initial,executor.position);
  await page.addInitScript(()=>localStorage.setItem('siliconworld-client-web-session',JSON.stringify({state:{serverUrl:location.origin,playerId:'p1',playerKey:'key_player_1'},version:0})));
  await page.goto(`/planet/${planet}`);
  await page.waitForFunction(()=>Boolean((window as any).__planetThree?.data?.planet?.surface_patches?.length));
  const beforeScale=await page.evaluate(id=>(window as any).__planetThree.moving.get(`unit:${id}`).group.scale.toArray(),executor.id);
  await page.locator('.planet-build-card[data-building-id="wind_turbine"]').click();
  const built=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().postDataJSON()?.commands?.[0]?.type==='build');
  await clickTile(page,buildTile);
  expect(await (await built).json()).toMatchObject({accepted:true,results:[{code:'OK'}]});
  await expect.poll(async()=>Object.values((await scene(buildTile)).buildings).some(b=>b.type==='wind_turbine'&&b.position.x===buildTile.x&&b.position.y===buildTile.y),{timeout:20_000}).toBe(true);
  await page.keyboard.press('Escape');

  const afterBuild=await scene(executor.position);
  const target=acrossFace(afterBuild,executor.position,buildTile);
  const route=await fetch(`${backend}/world/planets/${planet}/path?unit_id=${executor.id}&target_x=${target.x}&target_y=${target.y}`,{headers});
  expect(route.ok).toBe(true);
  expect(await route.json()).toMatchObject({reachable:true});
  await clickTile(page,executor.position);
  await expect(page.getByTestId('planet-selection-bar')).toContainText('执行体');
  await page.getByTestId('planet-selection-bar').getByRole('button',{name:'移动',exact:true}).click();
  const moved=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().postDataJSON()?.commands?.[0]?.type==='move');
  await clickTile(page,target);
  expect(await (await moved).json()).toMatchObject({accepted:true,results:[{code:'OK'}]});
  await expect.poll(async()=>(await scene(target)).units[executor.id]?.position,{timeout:20_000}).toMatchObject(target);
  await expect.poll(()=>page.evaluate(({id,target})=>{
    const renderer=(window as any).__planetThree;
    const p=renderer.data.planet.units[id]?.position;
    return p?.x===target.x&&p?.y===target.y;
  },{id:executor.id,target})).toBe(true);
  const afterScale=await page.evaluate(id=>(window as any).__planetThree.moving.get(`unit:${id}`).group.scale.toArray(),executor.id);
  expect(afterScale).toEqual(beforeScale);
  await expect.poll(()=>page.evaluate(()=>{
    const renderer=(window as any).__planetThree;
    const mark=renderer.marks.children.find((m:any)=>m.material.color.getHex()===0xfff1a8);
    if(!mark)return null;
    mark.geometry.computeBoundingSphere();
    return renderer.tileFromNormal(mark.geometry.boundingSphere.center.clone().normalize());
  })).toMatchObject(target);
  await page.screenshot({path:'/tmp/siliconworld-cube-seam.png',fullPage:true});
  await page.getByRole('button',{name:'全球视角',exact:true}).click();
  await page.screenshot({path:'/tmp/siliconworld-cube-globe.png',fullPage:true});
  expect(errors).toEqual([]);
});
