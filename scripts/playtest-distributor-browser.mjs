// Reproduce with scripts/fixtures/distributor/README.md; no save-state injection.
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { register } from '../client-cli/node_modules/tsx/dist/esm/api/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
process.env.SW_SERVER ??= 'http://127.0.0.1:19500';
const unregister = register();
const { dispatch } = await import('../client-cli/src/commands/index.ts');
const api = await import('../client-cli/src/api.ts');api.setAuth('p1','key_player_1');
const web=process.env.SW_LOGISTICS_WEB??'http://127.0.0.1:4190',evidence=process.env.SW_LOGISTICS_EVIDENCE??fileURLToPath(new URL('../test-results/distributor',import.meta.url));mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1680,height:1050}});page.setDefaultTimeout(30000);
const errors=[],results={scenario:'Pre-unlocked flat face48; materials and bot items only; real CLI builds and UI configuration; 2 ticks/s'};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const pathRoute=async(_planet,params)=>{const response=await fetch(`${process.env.SW_SERVER}/world/planets/${planetId}/path?${new URLSearchParams(params)}`,{headers:{authorization:'Bearer key_player_1'}});expect(response.ok).toBe(true);return response.json();};
let planetId='planet-1-1';
const scene=(planet=planetId)=>api.fetchPlanetScene(planet,{x:0,y:0,width:48,height:32});
const runtime=(planet=planetId)=>api.fetchPlanetRuntime(planet);
const stored=(b,id)=>(b?.logistics_station?.inventory?.[id]??0)+['inventory','input_buffer','output_buffer'].reduce((n,k)=>n+(b?.storage?.[k]?.[id]??0),0);
async function commandResult(requestId,tick){let event;await expect.poll(async()=>{event=(await api.fetchEventSnapshot({event_types:['command_result'],since_tick:tick,limit:100})).events.find(e=>e.payload.request_id===requestId);return Boolean(event);},{timeout:15000}).toBe(true);expect(event.payload.code,JSON.stringify(event)).toBe('OK');return event;}
async function cli(line){const before=await api.fetchHealth(),output=await dispatch(line,{currentPlayer:'p1'}),id=output.match(/request_id=([^\s]+)/)?.[1];expect(id,output).toBeTruthy();const event=await commandResult(id,before.tick);appendFileSync(`${evidence}/commands.jsonl`,JSON.stringify({channel:'cli',line,output,event})+'\n');console.log(line,'OK');return event;}
async function uiCommand(action){const before=await api.fetchHealth(),response=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');const[r]=await Promise.all([response,action()]);expect(r.ok()).toBe(true);const accepted=await r.json();expect(accepted.accepted).toBe(true);const event=await commandResult(accepted.request_id,before.tick);appendFileSync(`${evidence}/commands.jsonl`,JSON.stringify({channel:'browser',payload:r.request().postDataJSON(),event})+'\n');return event;}
async function build(x,y,type){
 const find=s=>Object.values(s.buildings??{}).find(b=>b.position.x===x&&b.position.y===y&&b.type===type);
 if(!find(await scene())) await cli(`build ${x} ${y} ${type}`);
 await expect.poll(async()=>{const b=find(await scene());return Boolean(b&&!b.job);},{timeout:60000}).toBe(true);
 return find(await scene());
}
let executorId;
async function moveTo(destination){
 for(let step=0;step<30;step++){
  const unit=(await scene()).units[executorId];if((unit.mecha?.energy??100)<40)await cli(`refuel_mecha ${executorId} energetic_graphite 2`);const current=unit.position;if(current.x===destination.x&&current.y===destination.y)return;
  let plan=await pathRoute(planetId,{unit_id:executorId,target_x:destination.x,target_y:destination.y});
  if(!plan.reachable){const local=await scene(),candidates=[],distance=p=>Math.abs(p.x-destination.x)+Math.abs(p.y-destination.y);for(let y=Math.max(0,current.y-5);y<=current.y+5;y++)for(let x=Math.max(0,current.x-5);x<=current.x+5;x++)if(Math.abs(x-current.x)+Math.abs(y-current.y)<=5&&distance({x,y})<distance(current)&&local.terrain[y]?.[x]==='buildable')candidates.push({x,y});candidates.sort((a,b)=>distance(a)-distance(b));for(const p of candidates){const route=await pathRoute(planetId,{unit_id:executorId,target_x:p.x,target_y:p.y});if(route.reachable){plan=route;break;}}}
  expect(plan.reachable,'explored route toward construction site').toBe(true);for(const p of plan.waypoints)await cli(`move ${executorId} ${p.x} ${p.y}`);
 }
 throw new Error('construction site could not be reached');
}
async function focus(tile){await page.evaluate(tile=>window.__planetThree.focus(tile,true),tile);await page.waitForTimeout(250);}
async function clickTile(tile){await focus(tile);const p=await page.evaluate(tile=>window.__planetThree.project(tile),tile);expect(p.visible).toBe(true);await page.locator('.planet-three__surface canvas').click({position:{x:p.x,y:p.y}});}
async function details(tile){await page.keyboard.press('Escape');await clickTile(tile);await page.getByTestId('planet-selection-bar').getByRole('button',{name:/^(机甲详情|详情)$/}).click();}
async function openBrowser(){await page.addInitScript(()=>localStorage.setItem('siliconworld-client-web-session',JSON.stringify({state:{serverUrl:location.origin,playerId:'p1',playerKey:'key_player_1'},version:0})));await page.goto(`${web}/planet/${planetId}?quality=low`);await page.waitForFunction(()=>Boolean(window.__planetThree?.data?.planet?.buildings),null,{timeout:60000});await page.waitForTimeout(1500);}
async function snapshot(){for(let attempt=0;attempt<20;attempt++){const[s,r]=await Promise.all([scene(),runtime()]);if(s.tick===r.tick)return{scene:s,runtime:r,tick:s.tick};}throw new Error('could not capture scene and logistics runtime at the same authoritative tick');}
async function screen(name){const dismiss=page.getByRole('button',{name:'全部忽略',exact:true});if(await dismiss.count())await dismiss.click();await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true});}

const bots = r => r.logistics_bots ?? [];
const inventory = async () => (await api.fetchSummary()).players.p1.inventory ?? {};
try {
 executorId=Object.values((await scene()).units).find(u=>u.owner_id==='p1'&&u.type==='executor').id;
 await moveTo({x:8,y:9});
 await build(8,6,'tesla_tower'); await build(7,6,'wind_turbine'); await build(9,6,'wind_turbine');
 const sourceHost=await build(8,8,'depot_mk1');
 const source=await build(8,8,'logistics_distributor');
 await moveTo({x:16,y:9});
 await build(16,6,'tesla_tower'); await build(15,6,'wind_turbine'); await build(17,6,'wind_turbine');
 const targetHost=await build(16,8,'depot_mk1');
 const target=await build(16,8,'logistics_distributor');
 await cli(`configure_distributor ${target.id} motor demand 20`);
 if ((await inventory()).motor >= 30) await cli(`transfer ${sourceHost.id} motor 30`);
 await openBrowser(); await details(source.position);
 const controls=page.getByRole('region',{name:'配送器运行',exact:true});
 await controls.getByLabel('配送物品',{exact:true}).selectOption('motor');
 await controls.getByLabel('配送模式',{exact:true}).selectOption('supply');
 await uiCommand(()=>controls.getByRole('button',{name:'应用配送设置',exact:true}).click());
 const before=(await inventory()).logistics_bot;
 await uiCommand(()=>controls.getByRole('button',{name:'安装机器人',exact:true}).click());
 expect((await inventory()).logistics_bot).toBe(before-1);
 await expect.poll(async()=>stored((await scene()).buildings[targetHost.id],'motor'),{timeout:30000}).toBe(20);
 await expect.poll(async()=>bots(await runtime()).every(b=>b.status==='idle'),{timeout:30000}).toBe(true);
 results.warehouseDelivery=await snapshot();
 // A robot owned by the demand warehouse collects the remaining source stock.
 await cli(`configure_distributor ${source.id} motor supply 0`);
 await cli(`uninstall_logistics_bot ${source.id} 1`);
 await cli(`install_logistics_bot ${target.id} 1`);
 await cli(`configure_distributor ${target.id} motor demand 30`);
 await expect.poll(async()=>stored((await scene()).buildings[targetHost.id],'motor'),{timeout:30000}).toBe(30);
 await expect.poll(async()=>bots(await runtime()).every(b=>b.status==='idle'),{timeout:30000}).toBe(true);
 results.warehousePickup=await snapshot();
 await cli(`configure_distributor ${target.id} motor none 0 --delivery true --collection true`);
 await details((await scene()).units[executorId].position);
 const mecha=page.getByRole('form',{name:'机甲物流请求',exact:true});
 await mecha.getByRole('button',{name:'添加物流请求',exact:true}).click();
 await mecha.getByLabel('物品 1',{exact:true}).selectOption('motor');
 await mecha.getByLabel('补给下限 1',{exact:true}).fill('5');
 await mecha.getByLabel('回收上限 1',{exact:true}).fill('10');
 await uiCommand(()=>mecha.getByRole('button',{name:'应用机甲物流请求',exact:true}).click());
 await expect.poll(async()=>(await inventory()).motor??0,{timeout:30000}).toBe(10);
 results.mechaDelivery=await snapshot();
 await mecha.getByLabel('补给下限 1',{exact:true}).fill('0');
 await mecha.getByLabel('回收上限 1',{exact:true}).fill('3');
 await uiCommand(()=>mecha.getByRole('button',{name:'应用机甲物流请求',exact:true}).click());
 await expect.poll(async()=>(await inventory()).motor??0,{timeout:30000}).toBe(3);
 await expect.poll(async()=>bots(await runtime()).every(b=>b.status==='idle'),{timeout:30000}).toBe(true);
 expect(stored((await scene()).buildings[targetHost.id],'motor')).toBe(27);
 await mecha.scrollIntoViewIfNeeded(); await screen('mecha-logistics');
 await details(target.position); await expect(controls).toContainText('27'); await controls.scrollIntoViewIfNeeded(); await screen('distributor-desktop');
 await cli(`configure_distributor ${source.id} iron_ingot demand 20`);
 await cli(`configure_distributor ${target.id} iron_ingot supply 0 --delivery false --collection false`);
 await page.keyboard.press('Escape'); await focus({x:12,y:8});
 await cli(`transfer ${targetHost.id} iron_ingot 20`);
 await page.waitForFunction(()=>window.__planetThree?.data?.runtime?.logistics_bots?.some(b=>b.status==='in_flight'&&Object.values(b.cargo??{}).some(n=>n>0)),null,{timeout:20000,polling:50});
 await screen('robot-in-flight');
 await expect.poll(async()=>stored((await scene()).buildings[sourceHost.id],'iron_ingot'),{timeout:30000}).toBe(20);
 await details(target.position); await controls.scrollIntoViewIfNeeded();
 await page.setViewportSize({width:390,height:844}); await page.getByRole('button',{name:'收起总览栏',exact:true}).click(); await controls.scrollIntoViewIfNeeded(); await screen('distributor-mobile');
 results.final=await snapshot(); expect(stored(results.final.scene.buildings[sourceHost.id],'motor')+stored(results.final.scene.buildings[targetHost.id],'motor')+(await inventory()).motor).toBe(30); expect(errors).toEqual([]);
 writeFileSync(`${evidence}/browser-results.json`,JSON.stringify({results,errors},null,2));
 console.log('PASS: warehouse delivery/pickup, UI installation, mecha supply/recovery, cargo conserved');
} catch(error) {
 writeFileSync(`${evidence}/failure.json`,JSON.stringify({results,errors,error:String(error)},null,2));
 await page.screenshot({path:`${evidence}/failure.png`}); throw error;
} finally { await browser.close(); await unregister(); }
