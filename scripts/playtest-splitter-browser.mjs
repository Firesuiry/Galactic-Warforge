// Isolated preconfigured scenario: config-war starting inventory/technology,
// no scenario factories, flat face_size=48 map, spawns (3,3)/(14,14), 5 ticks/s.
// All factories and inventory transfers use the real CLI; port configuration uses browser controls.
// SW_SERVER=http://127.0.0.1:19495 node scripts/playtest-splitter-browser.mjs
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { register } from '../client-cli/node_modules/tsx/dist/esm/api/index.mjs';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
process.env.SW_SERVER ??= 'http://127.0.0.1:19495';
const unregister = register();
const { dispatch } = await import('../client-cli/src/commands/index.ts');
const api = await import('../client-cli/src/api.ts');
api.setAuth('p1', 'key_player_1');
const web = process.env.SW_SPLITTER_WEB ?? 'http://127.0.0.1:4185';
const evidence = process.env.SW_SPLITTER_EVIDENCE ?? '/tmp/sw-splitter-review';
mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1680,height:1050}});page.setDefaultTimeout(30000);
const errors=[],results={ scenario:'Preconfigured config-war inventory and technology; flat 48-face map; no injected factories or save edits' };
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const scene=()=>api.fetchPlanetScene('planet-1-1',{x:0,y:0,width:16,height:16});
const at=(s,x,y)=>Object.values(s.buildings??{}).find(b=>b.position.x===x&&b.position.y===y);
const stored=(building,item)=>['inventory','input_buffer','output_buffer'].reduce((n,k)=>n+(building?.storage?.[k]?.[item]??0),0);
const cached=b=>(b?.conveyor?.buffer??[]).reduce((n,s)=>n+s.quantity,0);
async function commandResult(requestId,sinceTick) {
 let event;await expect.poll(async()=>{event=(await api.fetchEventSnapshot({event_types:['command_result'],since_tick:sinceTick,limit:100})).events.find(e=>e.payload.request_id===requestId);return event?.payload.code;},{timeout:15000}).toBe('OK');return event;
}
async function cli(line) {
 const before=await api.fetchHealth(),output=await dispatch(line,{currentPlayer:'p1'}),requestId=output.match(/request_id=([^\s]+)/)?.[1];
 expect(requestId,output).toBeTruthy();const event=await commandResult(requestId,before.tick);
 appendFileSync(`${evidence}/commands.jsonl`,JSON.stringify({channel:'cli',line,output,event})+'\n');console.log(line,'OK');return event;
}
async function build(x,y,type,options='') {
 if(!at(await scene(),x,y))await cli(`build ${x} ${y} ${type} ${options}`.trim());
 await expect.poll(async()=>at(await scene(),x,y)?.runtime.state,{timeout:45000}).toBe('running');return at(await scene(),x,y);
}
async function uiCommand(action) {
 const before=await api.fetchHealth(),response=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');
 const [r]=await Promise.all([response,action()]);expect(r.ok()).toBe(true);const accepted=await r.json();expect(accepted.accepted).toBe(true);
 const event=await commandResult(accepted.request_id,before.tick);appendFileSync(`${evidence}/commands.jsonl`,JSON.stringify({channel:'browser',payload:r.request().postDataJSON(),event})+'\n');return event;
}
async function focus(tile) {await page.evaluate(tile=>window.__planetThree.focus(tile,true),tile);await page.waitForTimeout(300);}
async function selectSplitter(){
 await page.keyboard.press('Escape');await focus({x:7,y:7});const point=await page.evaluate(()=>window.__planetThree.project({x:7,y:7}));expect(point.visible).toBe(true);
 await page.locator('.planet-three__surface canvas').click({position:{x:point.x,y:point.y}});
 await page.getByTestId('planet-selection-bar').getByRole('button',{name:'详情',exact:true}).click();
 await expect(page.getByRole('region',{name:'四向分流器设置',exact:true})).toBeVisible();
}
function measure(s){return {tick:s.tick,eastIron:stored(at(s,10,7),'iron_ingot'),eastCopper:stored(at(s,10,7),'copper_ingot'),southIron:stored(at(s,7,10),'iron_ingot'),southCopper:stored(at(s,7,10),'copper_ingot'),eastBuffers:[at(s,8,7),at(s,9,7)].map(b=>({id:b?.id,count:cached(b),capacity:b?.conveyor?.max_stack})),splitter:at(s,7,7)?.splitter,sourceIron:stored(at(s,4,7),'iron_ingot'),sourceCopper:stored(at(s,4,7),'copper_ingot')};}
try {
 results.initialPlayer=(await api.fetchSummary()).players.p1;
 const executor=Object.values((await scene()).units).find(u=>u.owner_id==='p1'&&u.type==='executor');
 await cli(`move ${executor.id} 6 6`);
 const source=await build(4,7,'depot_mk1');
 for(const [x,y,direction]of [[5,7,'east'],[6,7,'east'],[8,7,'east'],[9,7,'east'],[7,8,'south'],[7,9,'south']])await build(x,y,'conveyor_belt_mk1',`--direction ${direction}`);
 const splitter=await build(7,7,'splitter');await build(10,7,'depot_mk1');await build(7,10,'depot_mk1');
 results.initialScene=await scene();
 await page.addInitScript(()=>localStorage.setItem('siliconworld-client-web-session',JSON.stringify({state:{serverUrl:location.origin,playerId:'p1',playerKey:'key_player_1'},version:0})));
 await page.goto(`${web}/planet/planet-1-1?quality=low`);await page.waitForFunction(()=>Boolean(window.__planetThree?.focus),null,{timeout:60000});await selectSplitter();
 const controls=page.getByRole('region',{name:'四向分流器设置',exact:true});
 await controls.getByLabel('北侧端口',{exact:true}).selectOption('closed');await controls.getByLabel('西侧端口',{exact:true}).selectOption('input');
 await controls.getByLabel('东侧端口',{exact:true}).selectOption('output');await controls.getByLabel('南侧端口',{exact:true}).selectOption('output');
 await controls.getByLabel('优先输出',{exact:true}).selectOption('east');await controls.getByLabel('东侧输出过滤',{exact:true}).selectOption('iron_ingot');await controls.getByLabel('南侧输出过滤',{exact:true}).selectOption('copper_ingot');
 results.filterCommand=await uiCommand(()=>controls.getByRole('button',{name:'应用分流设置',exact:true}).click());
 await cli(`transfer ${source.id} iron_ingot 12`);await cli(`transfer ${source.id} copper_ingot 12`);
 await expect.poll(async()=>measure(await scene()).eastIron,{timeout:30000}).toBe(12);await expect.poll(async()=>measure(await scene()).southCopper,{timeout:30000}).toBe(12);
 results.filtered=measure(await scene());expect(results.filtered.eastCopper).toBe(0);expect(results.filtered.southIron).toBe(0);expect(results.filtered.splitter.transferred_items).toBe(24);
 await expect(controls.getByLabel('东侧输出过滤',{exact:true})).toHaveValue('iron_ingot');await expect(controls.getByLabel('南侧输出过滤',{exact:true})).toHaveValue('copper_ingot');
 await page.screenshot({path:`${evidence}/splitter-filtered.png`,fullPage:true});console.log('filtered 12 iron east and 12 copper south');
 // Remove the receiving depot, allowing the real downstream belt buffer to fill.
 const eastDepot=at(await scene(),10,7);results.blockCommand=await cli(`demolish ${eastDepot.id}`);
 await controls.getByLabel('南侧输出过滤',{exact:true}).selectOption('');
 results.bypassConfig=await uiCommand(()=>controls.getByRole('button',{name:'应用分流设置',exact:true}).click());
 await cli(`transfer ${source.id} iron_ingot 20`);
 await expect.poll(async()=>measure(await scene()).southIron,{timeout:30000}).toBeGreaterThan(0);
 await expect.poll(async()=>measure(await scene()).sourceIron,{timeout:30000}).toBe(0);
 await expect.poll(async()=>measure(await scene()).eastBuffers.every(b=>b.count===b.capacity),{timeout:30000}).toBe(true);
 await expect.poll(async()=>measure(await scene()).southIron+measure(await scene()).eastBuffers.reduce((n,b)=>n+b.count,0),{timeout:30000}).toBe(20);
 results.blocked=measure(await scene());expect(results.blocked.eastIron).toBe(0);expect(results.blocked.southCopper).toBe(12);
 await page.screenshot({path:`${evidence}/splitter-blocked-bypass.png`,fullPage:true});console.log('full east belt caused south bypass',results.blocked.southIron);
 results.rebuiltDepot=await build(10,7,'depot_mk1');
 const retained=results.blocked.eastBuffers.reduce((n,b)=>n+b.count,0);
 await expect.poll(async()=>measure(await scene()).eastIron,{timeout:30000}).toBe(retained);
 await cli(`transfer ${source.id} iron_ingot 12`);
 await expect.poll(async()=>measure(await scene()).eastIron,{timeout:30000}).toBe(retained+12);
 results.restored=measure(await scene());expect(results.restored.southIron).toBe(results.blocked.southIron);expect(results.restored.southCopper).toBe(12);expect(results.restored.sourceIron).toBe(0);
 await expect.poll(async()=>at(await scene(),7,7).splitter.transferred_items).toBe(56);
 results.finalScene=await scene();results.finalPlayer=(await api.fetchSummary()).players.p1;
 await selectSplitter();await controls.getByLabel('优先输出',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`${evidence}/splitter-priority-restored.png`,fullPage:true});
 expect(errors).toEqual([]);writeFileSync(`${evidence}/browser-results.json`,JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({filtered:results.filtered,blocked:results.blocked,restored:results.restored,errors},null,2));
}catch(error){writeFileSync(`${evidence}/failure.json`,JSON.stringify({results,errors,error:String(error)},null,2));await page.screenshot({path:`${evidence}/failure.png`});throw error;}
finally{await browser.close();await unregister();}
