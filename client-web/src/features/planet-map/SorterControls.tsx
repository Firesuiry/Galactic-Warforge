import { useEffect, useState } from 'react';
import type { Building, CatalogView, CardinalDirection, SorterConfig } from '@shared/types';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { getItemDisplayName } from './model';

const directions: CardinalDirection[] = ['north', 'east', 'south', 'west'];
const names = {north:'北', east:'东', south:'南', west:'西'};
function readConfig(b:Building):SorterConfig {
 return {input_directions:(b.sorter?.input_directions??['west']).filter((d):d is CardinalDirection=>directions.includes(d as CardinalDirection)),output_directions:(b.sorter?.output_directions??['east']).filter((d):d is CardinalDirection=>directions.includes(d as CardinalDirection)),filter_mode:b.sorter?.filter?.mode??'allow',filter_items:[...(b.sorter?.filter?.items??[])]};
}
export function SorterControls({building,catalog,planetId,canControl}:{building:Building;catalog?:CatalogView;planetId:string;canControl:boolean}) {
 const client=useApiClient();const [draft,setDraft]=useState(()=>readConfig(building));const [pending,setPending]=useState(false);
 const config=JSON.stringify(readConfig(building));
 useEffect(()=>setDraft(readConfig(building)),[building.id,config]);
 const invalid=!draft.input_directions.length||!draft.output_directions.length||draft.input_directions.some(d=>draft.output_directions.includes(d));
 async function submit(){
  if(pending||invalid||!canControl)return;setPending(true);
  try{await submitPlanetCommand({commandType:'configure_sorter',planetId,focus:{entityId:building.id},execute:()=>client.cmdConfigureSorter(building.id,draft,planetId),fetchAuthoritativeSnapshot:()=>client.fetchEventSnapshot({event_types:[...PLANET_COMMAND_RECOVERY_EVENT_TYPES],limit:50})});}finally{setPending(false);}
 }
 return <section className="planet-side-section" aria-label="分拣器设置">
  <div className="section-title">分拣器方向与过滤</div>
  <form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={!canControl||pending}>
   <legend>搬运方向</legend>
   {directions.map(d=><label key={d}>{names[d]}侧<select aria-label={names[d]+'侧方向'} value={draft.input_directions.includes(d)?'input':draft.output_directions.includes(d)?'output':'closed'} onChange={e=>{const role=e.target.value;setDraft(current=>({...current,input_directions:directions.filter(v=>v===d?role==='input':current.input_directions.includes(v)),output_directions:directions.filter(v=>v===d?role==='output':current.output_directions.includes(v))}));}}><option value="input">取料</option><option value="output">放料</option><option value="closed">关闭</option></select></label>)}
   <label>过滤模式<select aria-label="过滤模式" value={draft.filter_mode} onChange={e=>setDraft({...draft,filter_mode:e.target.value as 'allow'|'deny'})}><option value="allow">仅搬运所选</option><option value="deny">排除所选</option></select></label>
   <label>过滤物品<select multiple aria-label="过滤物品" value={draft.filter_items} onChange={e=>setDraft({...draft,filter_items:Array.from(e.target.selectedOptions,o=>o.value)})}>{catalog?.items?.map(item=><option key={item.id} value={item.id}>{getItemDisplayName(catalog,item.id)}</option>)}</select></label>
   <p>未选择物品时允许全部。支持皮带与机器上下料，机器只接收当前配方需要的原料。</p>
   {invalid?<p role="status">请选择互不重叠的取料与放料方向。</p>:null}
   <button type="submit" className="secondary-button" disabled={invalid||pending}>{pending?'提交中…':'应用分拣设置'}</button>
  </fieldset></form>
 </section>;
}
