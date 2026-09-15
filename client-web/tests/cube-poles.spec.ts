import { expect, test } from '@playwright/test';
import { surfaceNormal, surfaceStep } from '../../shared-client/src/surface';

// Run with SW_TEST_MAP=<repo>/server/testdata/map-cube-poles.yaml SW_CUBE_POLES=1.
test.skip(process.env.SW_CUBE_POLES !== '1', 'Requires the isolated north/south pole backend fixture.');
const backend=process.env.SW_BACKEND_ENTRY??`http://127.0.0.1:${process.env.SW_BACKEND_PORT??'19481'}`;
for(const [player,key,hemisphere] of [['p1','key_player_1','north'],['p2','key_player_2','south']] as const) {
  test(`${hemisphere} pole: real construction and unit movement`,async({page})=>{
    test.setTimeout(150_000);
    const headers={authorization:`Bearer ${key}`};
    const metadata=await(await fetch(`${backend}/world/planets/planet-1-1/scene?x=0&y=0&width=1&height=1`,{headers})).json();
    const n=metadata.surface.face_size;
    const center={x:(player==='p1'?1.5:2.5)*n,y:1.5*n};
    const scene=async()=>{
      const response=await fetch(`${backend}/world/planets/planet-1-1/scene?x=${center.x-24}&y=${center.y-24}&width=48&height=48`,{headers});
      expect(response.ok).toBe(true);return response.json();
    };
    const initial=await scene();
    const executor:any=Object.values(initial.units).find((u:any)=>u.owner_id===player&&u.type==='executor');
    const normal=surfaceNormal(executor.position,n);
    expect(Math.abs(normal.y)).toBeGreaterThan(.99);
    expect(Math.sign(normal.y)).toBe(hemisphere==='north'?1:-1);
    const empty=(data:any,p:{x:number;y:number})=>{
      const {bounds}=data;
      return data.terrain[p.y-bounds.y]?.[p.x-bounds.x]==='buildable' && data.visible[p.y-bounds.y]?.[p.x-bounds.x]
        && ![...Object.values(data.buildings),...Object.values(data.units),...data.resources].some((e:any)=>e.position.x===p.x&&e.position.y===p.y);
    };
    const moves=[];
    for(const direction of ['north','east','south','west'] as const) {
      const p=surfaceStep(executor.position,direction,n).tile;
      if(initial.terrain[p.y-initial.bounds.y]?.[p.x-initial.bounds.x]==='buildable' && !Object.values(initial.buildings).some((b:any)=>b.position.x===p.x&&b.position.y===p.y))moves.push(p);
    }
    expect(moves.length).toBeGreaterThan(0);
    const moveTile=moves[0];
    const candidates=[];
    const queue=[{tile:executor.position,distance:0}],seen=new Set<string>();
    for(let i=0;i<queue.length;i++) {
      const {tile,distance}=queue[i];
      if(distance>=2&&empty(initial,tile))candidates.push(tile);
      if(distance>=6)continue;
      for(const direction of ['north','east','south','west'] as const) {
        const next=surfaceStep(tile,direction,n).tile,k=`${next.x},${next.y}`;
        if(!seen.has(k)){seen.add(k);queue.push({tile:next,distance:distance+1});}
      }
    }
    expect(candidates.length).toBeGreaterThan(0);
    const buildTile=candidates[0];
    const errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(`${m.text()} (${m.location().url})`);});
    await page.addInitScript(({player,key})=>localStorage.setItem('siliconworld-client-web-session',JSON.stringify({state:{serverUrl:location.origin,playerId:player,playerKey:key},version:0})),{player,key});
    await page.goto('/planet/planet-1-1');
    await page.waitForFunction(()=>Boolean((window as any).__planetThree?.data?.planet));
    if(n>512/3) await expect.poll(()=>page.evaluate(()=>Boolean((window as any).__planetThree.localSurface))).toBe(true);
    const click=async(tile:{x:number;y:number})=>{
      const p=await page.evaluate(t=>{const r=(window as any).__planetThree;r.focus(t,true);return r.project(t);},tile);
      expect(p.visible).toBe(true);
      await page.locator('.planet-three__surface canvas').click({position:{x:p.x,y:p.y}});
    };
    await page.locator('.planet-build-card[data-building-id="wind_turbine"]').click();
    const build=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().postDataJSON()?.commands?.[0]?.type==='build');
    await click(buildTile);
    expect(await(await build).json()).toMatchObject({accepted:true,results:[{code:'OK'}]});
    await expect.poll(async()=>Object.values((await scene()).buildings).some((b:any)=>b.type==='wind_turbine'&&b.position.x===buildTile.x&&b.position.y===buildTile.y),{timeout:20_000}).toBe(true);
    await page.keyboard.press('Escape');
    await click(executor.position);
    await page.getByTestId('planet-selection-bar').getByRole('button',{name:'移动',exact:true}).click();
    const move=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().postDataJSON()?.commands?.[0]?.type==='move');
    await click(moveTile);
    expect(await(await move).json()).toMatchObject({accepted:true,results:[{code:'OK'}]});
    await expect.poll(async()=>(await scene()).units[executor.id]?.position,{timeout:20_000}).toMatchObject(moveTile);
    await page.getByRole('button',{name:'聚焦基地',exact:true}).click();
    await page.screenshot({path:`/tmp/siliconworld-cube-${hemisphere}-${n}.png`,fullPage:true});
    if(hemisphere==='north') {
      const workbench=page.getByRole('button',{name:'工作台',exact:true});
      if(await workbench.getAttribute('aria-expanded')==='true')await workbench.click();
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
      await page.getByRole('button',{name:'平面战术',exact:true}).click();
      await expect(page.locator('.planet-map-canvas__surface')).toBeVisible();
      await page.getByRole('button',{name:'3D 星球',exact:true}).click();
      await expect(page.locator('.planet-three__surface canvas')).toBeVisible({timeout:30_000});
      await page.screenshot({path:`/tmp/siliconworld-cube-mobile-${n}.png`,fullPage:true});
    }
    expect(errors).toEqual([]);
  });
}
