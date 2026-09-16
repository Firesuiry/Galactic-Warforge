// Preconfigured verification scenario: config-war inventory/research plus hydrogen,
// critical photons/deuterium/Mk.III proliferator, flat face_size=48, wind=1, 10 ticks/s.
// No factories or save state are injected. CLI builds/loads every facility;
// browser production planning builds the strange-matter collider.
// SW_SERVER=http://127.0.0.1:19496 node scripts/playtest-advanced-processing-browser.mjs
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { register } from '../client-cli/node_modules/tsx/dist/esm/api/index.mjs';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
process.env.SW_SERVER ??= 'http://127.0.0.1:19496';
const unregister = register();
const { dispatch } = await import('../client-cli/src/commands/index.ts');
const api = await import('../client-cli/src/api.ts');api.setAuth('p1','key_player_1');
const web=process.env.SW_ADVANCED_WEB??'http://127.0.0.1:4186',evidence=process.env.SW_ADVANCED_EVIDENCE??'/tmp/sw-advanced-processing-review';mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1680,height:1050}});page.setDefaultTimeout(30000);
const errors=[],results={scenario:'Preconfigured advanced research/materials; flat face48 wind1 map; all factories built and loaded through player commands'};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const pathRoute=async(_planet,params)=>{const response=await fetch(`${process.env.SW_SERVER}/world/planets/planet-1-1/path?${new URLSearchParams(params)}`,{headers:{authorization:'Bearer key_player_1'}});expect(response.ok).toBe(true);return response.json();};
const scene=()=>api.fetchPlanetScene('planet-1-1',{x:0,y:0,width:36,height:30});
const at=(s,x,y)=>Object.values(s.buildings??{}).find(b=>b.position.x===x&&b.position.y===y);
const stored=(b,id)=>['inventory','input_buffer','output_buffer'].reduce((n,k)=>n+(b?.storage?.[k]?.[id]??0),0);
const stackCount=(stacks,id)=>(stacks??[]).reduce((n,s)=>n+(s.item_id===id?s.quantity:0),0);
async function commandResult(requestId,tick){let event;await expect.poll(async()=>{event=(await api.fetchEventSnapshot({event_types:['command_result'],since_tick:tick,limit:100})).events.find(e=>e.payload.request_id===requestId);return event?.payload.code;},{timeout:15000}).toBe('OK');return event;}
async function cli(line){const before=await api.fetchHealth(),output=await dispatch(line,{currentPlayer:'p1'}),id=output.match(/request_id=([^\s]+)/)?.[1];expect(id,output).toBeTruthy();const event=await commandResult(id,before.tick);appendFileSync(`${evidence}/commands.jsonl`,JSON.stringify({channel:'cli',line,output,event})+'\n');console.log(line,'OK');return event;}
async function uiCommand(action){const before=await api.fetchHealth(),response=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');const[r]=await Promise.all([response,action()]);expect(r.ok()).toBe(true);const accepted=await r.json();expect(accepted.accepted).toBe(true);const event=await commandResult(accepted.request_id,before.tick);appendFileSync(`${evidence}/commands.jsonl`,JSON.stringify({channel:'browser',payload:r.request().postDataJSON(),event})+'\n');return event;}
async function build(x,y,type,options='',allowNoPower=false){if(!at(await scene(),x,y))await cli(`build ${x} ${y} ${type} ${options}`.trim());await expect.poll(async()=>{const state=at(await scene(),x,y)?.runtime.state;return state==='running'||(allowNoPower&&state==='no_power');},{timeout:60000}).toBe(true);return at(await scene(),x,y);}
let executorId;
async function moveTo(destination){
 for(let step=0;step<30;step++){
  const current=(await scene()).units[executorId].position;if(current.x===destination.x&&current.y===destination.y)return;
  let plan=await pathRoute('planet-1-1',{unit_id:executorId,target_x:destination.x,target_y:destination.y});
  if(!plan.reachable){const local=await scene(),candidates=[],distance=p=>Math.abs(p.x-destination.x)+Math.abs(p.y-destination.y);for(let y=Math.max(0,current.y-5);y<=current.y+5;y++)for(let x=Math.max(0,current.x-5);x<=current.x+5;x++)if(Math.abs(x-current.x)+Math.abs(y-current.y)<=5&&distance({x,y})<distance(current)&&local.terrain[y]?.[x]==='buildable')candidates.push({x,y});candidates.sort((a,b)=>distance(a)-distance(b));for(const p of candidates){const route=await pathRoute('planet-1-1',{unit_id:executorId,target_x:p.x,target_y:p.y});if(route.reachable){plan=route;break;}}}
  expect(plan.reachable,'explored route toward construction site').toBe(true);for(const p of plan.waypoints)await cli(`move ${executorId} ${p.x} ${p.y}`);
 }
 throw new Error('construction site could not be reached');
}
async function focus(tile){await page.evaluate(tile=>window.__planetThree.focus(tile,true),tile);await page.waitForTimeout(250);}
async function clickTile(tile){await focus(tile);const p=await page.evaluate(tile=>window.__planetThree.project(tile),tile);expect(p.visible).toBe(true);await page.locator('.planet-three__surface canvas').click({position:{x:p.x,y:p.y}});}
async function details(tile){await page.keyboard.press('Escape');await clickTile(tile);await page.getByTestId('planet-selection-bar').getByRole('button',{name:'详情',exact:true}).click();}
async function grid(x,y){await build(x-1,y,'tesla_tower');const winds=[];for(let dx=-2;dx<=0;dx++)winds.push(await build(x+dx,y-1,'wind_turbine'));return winds;}
async function waitTicks(ticks){const start=(await api.fetchHealth()).tick;await expect.poll(async()=>(await api.fetchHealth()).tick,{timeout:30000}).toBeGreaterThanOrEqual(start+ticks);}
function fractionMeasure(s){const buildings=Object.values(s.buildings??{}).filter(b=>b.position.x<=10&&b.position.y<=12);let hydrogen=0,deuterium=0;for(const b of buildings){hydrogen+=stored(b,'hydrogen')+stackCount(b.conveyor?.buffer,'hydrogen');deuterium+=stored(b,'deuterium')+stackCount(b.conveyor?.buffer,'deuterium');if(b.fractionation){hydrogen+=stackCount(b.fractionation.input_buffer,'hydrogen')+stackCount(b.fractionation.hydrogen_buffer,'hydrogen');deuterium+=b.fractionation.deuterium_buffer??0;}if(b.spray_coater){hydrogen+=stackCount(b.spray_coater.input_buffer,'hydrogen')+stackCount(b.spray_coater.output_buffer,'hydrogen');deuterium+=stackCount(b.spray_coater.input_buffer,'deuterium')+stackCount(b.spray_coater.output_buffer,'deuterium');}}return {tick:s.tick,hydrogen,deuterium,total:hydrogen+deuterium,fractionation:at(s,8,8)?.fractionation,coater:at(s,5,8)?.spray_coater,collectedDeuterium:stored(at(s,8,11),'deuterium')};}
try{
 results.initialPlayer=(await api.fetchSummary()).players.p1;executorId=Object.values((await scene()).units).find(u=>u.owner_id==='p1'&&u.type==='executor').id;
 await moveTo({x:6,y:9});await build(6,7,'tesla_tower');await build(5,5,'wind_turbine');await build(6,5,'wind_turbine');
 const source=await build(3,8,'depot_mk1'),coater=await build(5,8,'spray_coater');await build(8,8,'fractionator');
 for(const[x,y,d]of [[4,8,'east'],[6,8,'east'],[7,8,'east'],[9,8,'north'],[9,7,'north'],[9,6,'west'],[8,6,'west'],[7,6,'west'],[6,6,'west'],[5,6,'west'],[4,6,'south'],[4,7,'south'],[8,9,'south'],[8,10,'south']])await build(x,y,'conveyor_belt_mk1',`--direction ${d}`);
 await build(8,11,'depot_mk1');await cli(`transfer ${source.id} hydrogen 100`);
 await expect.poll(async()=>fractionMeasure(await scene()).collectedDeuterium,{timeout:120000}).toBeGreaterThan(0);
 results.unsprayed=fractionMeasure(await scene());expect(results.unsprayed.total).toBe(100);expect(results.unsprayed.fractionation.last_probability).toBe(.01);expect(results.unsprayed.coater.coated_items).toBe(0);
 await cli(`transfer ${coater.id} proliferator_mk3 1`);
 await expect.poll(async()=>fractionMeasure(await scene()).fractionation.last_spray_level,{timeout:60000}).toBe(3);
 results.sprayed=fractionMeasure(await scene());expect(results.sprayed.total).toBe(100);expect(results.sprayed.fractionation.last_probability).toBe(.02);expect(results.sprayed.coater.coated_items).toBeGreaterThan(0);expect(results.sprayed.coater.consumed_proliferator).toBe(1);
 console.log('hydrogen circulation and real proliferator verified',results.unsprayed.deuterium,results.sprayed.coater.coated_items);
 await page.addInitScript(()=>localStorage.setItem('siliconworld-client-web-session',JSON.stringify({state:{serverUrl:location.origin,playerId:'p1',playerKey:'key_player_1'},version:0})));
 await page.goto(`${web}/planet/planet-1-1?quality=low`);await page.waitForFunction(()=>Boolean(window.__planetThree?.focus),null,{timeout:60000});await details({x:8,y:8});await expect(page.getByRole('region',{name:'分馏运行状态',exact:true})).toContainText('累计转化');await page.screenshot({path:`${evidence}/fractionation-hydrogen-loop.png`,fullPage:true});await details({x:5,y:8});await expect(page.getByRole('region',{name:'喷涂运行状态',exact:true})).toContainText('累计喷涂物料');await page.screenshot({path:`${evidence}/spray-coater-status.png`,fullPage:true});
 // A separate collider network: remove every generator to test a genuine blackout.
 await moveTo({x:18,y:9});const antimatter=await build(20,8,'miniature_particle_collider','--recipe antimatter',true);
 await cli(`transfer ${antimatter.id} critical_photon 2`);await cli(`transfer ${antimatter.id} hydrogen 100`);await waitTicks(3);await cli(`transfer ${antimatter.id} hydrogen 18`);
 expect(stored(at(await scene(),20,8),'hydrogen')).toBe(118);expect(stored(at(await scene(),20,8),'critical_photon')).toBe(2);
 const winds=await grid(20,8);await expect.poll(async()=>at(await scene(),20,8).production.remaining_ticks,{timeout:15000}).toBeGreaterThan(0);
 for(const wind of winds)await cli(`demolish ${wind.id}`);await expect.poll(async()=>at(await scene(),20,8).runtime.state,{timeout:15000}).toBe('no_power');
 results.powerPaused=at(await scene(),20,8);await waitTicks(12);results.powerStillPaused=at(await scene(),20,8);expect(results.powerStillPaused.production.remaining_ticks).toBe(results.powerPaused.production.remaining_ticks);expect(results.powerStillPaused.production.pending_outputs).toEqual(results.powerPaused.production.pending_outputs);
 for(let dx=-2;dx<=0;dx++)await build(20+dx,7,'wind_turbine');await expect.poll(async()=>at(await scene(),20,8).production.remaining_ticks??0,{timeout:30000}).toBe(0);
 results.fullOutput=at(await scene(),20,8);expect(results.fullOutput.production.pending_outputs?.length).toBeGreaterThan(0);expect(stored(results.fullOutput,'critical_photon')).toBe(0);expect(stored(results.fullOutput,'antimatter')).toBe(0);expect(stored(results.fullOutput,'hydrogen')).toBe(118);
 await waitTicks(10);expect(at(await scene(),20,8).production.pending_outputs).toEqual(results.fullOutput.production.pending_outputs);
 await details({x:20,y:8});await page.screenshot({path:`${evidence}/collider-full-output.png`,fullPage:true});
 await build(21,8,'conveyor_belt_mk1','--direction east');await build(22,8,'depot_mk1');
 await expect.poll(async()=>stored(at(await scene(),22,8),'antimatter'),{timeout:30000}).toBe(2);await expect.poll(async()=>stored(at(await scene(),22,8),'hydrogen'),{timeout:30000}).toBe(120);
 results.antimatterFinished={machine:at(await scene(),20,8),depot:at(await scene(),22,8)};expect(results.antimatterFinished.machine.production.pending_outputs??[]).toEqual([]);
 // The other two public recipes are exercised in separate, genuinely supplied networks.
 await moveTo({x:18,y:19});await grid(20,20);const deuterium=await build(20,20,'miniature_particle_collider','--recipe deuterium_collision');await cli(`transfer ${deuterium.id} hydrogen 10`);
 await moveTo({x:8,y:19});await grid(8,20);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'生产规划',exact:true}).first().click();const planner=page.getByRole('region',{name:'生产规划',exact:true});await planner.getByLabel('搜索生产配方').fill('strange_matter');await planner.getByLabel('规划配方').selectOption('strange_matter');await expect(planner).toContainText('重氢');await planner.getByRole('button',{name:'建造微型粒子对撞机',exact:true}).click();results.strangeBuild=await uiCommand(()=>clickTile({x:8,y:20}));await expect.poll(async()=>at(await scene(),8,20)?.runtime.state,{timeout:45000}).toBe('running');
 const strange=at(await scene(),8,20);for(const[item,qty]of [['particle_container',2],['deuterium',10],['iron_ingot',2]])await cli(`transfer ${strange.id} ${item} ${qty}`);
 await expect.poll(async()=>stored(at(await scene(),20,20),'deuterium'),{timeout:60000}).toBe(5);await expect.poll(async()=>stored(at(await scene(),8,20),'strange_matter'),{timeout:70000}).toBe(1);
 results.deuteriumFinished=at(await scene(),20,20);results.strangeFinished=at(await scene(),8,20);expect(stored(results.deuteriumFinished,'hydrogen')).toBe(0);for(const item of ['particle_container','deuterium','iron_ingot'])expect(stored(results.strangeFinished,item)).toBe(0);
 results.finalFractionation=fractionMeasure(await scene());expect(results.finalFractionation.total).toBe(100);results.finalPlayer=(await api.fetchSummary()).players.p1;
 await details({x:8,y:20});await page.screenshot({path:`${evidence}/collider-strange-matter.png`,fullPage:true});expect(errors).toEqual([]);
 writeFileSync(`${evidence}/browser-results.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({fractionHydrogenAndDeuterium:results.finalFractionation.total,deuteriumCollected:results.finalFractionation.collectedDeuterium,colliderOutputs:{antimatter:2,hydrogen:120,deuterium:5,strangeMatter:1},errors},null,2));
}catch(error){writeFileSync(`${evidence}/failure.json`,JSON.stringify({results,errors,error:String(error)},null,2));await page.screenshot({path:`${evidence}/failure.png`});throw error;}finally{await browser.close();await unregister();}
