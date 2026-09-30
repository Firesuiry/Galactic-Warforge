import {useState} from 'react';
import type {Building,CatalogView} from '@shared/types';
import {useApiClient} from '@/hooks/use-api-client';
import {submitPlanetCommand} from '@/features/planet-commands/executor';
import {PLANET_COMMAND_RECOVERY_EVENT_TYPES} from '@/features/planet-commands/store';
import {formatUnitCost} from './model';
export function UnitProductionControls({building,catalog,planetId,canControl}:{building:Building;catalog?:CatalogView;planetId:string;canControl:boolean}){
 const client=useApiClient();const [pending,setPending]=useState(false);const [x,setX]=useState(building.rally_point?.x??building.position.x);const [y,setY]=useState(building.rally_point?.y??building.position.y);
 const units=catalog?.world_units?.filter(u=>u.producer===building.type)??[];
 if(!units.length)return null;
 async function run(type:string,execute:()=>ReturnType<typeof client.cmdProduce>){if(pending||!canControl)return;setPending(true);try{await submitPlanetCommand({commandType:type,planetId,focus:{entityId:building.id},execute,fetchAuthoritativeSnapshot:()=>client.fetchEventSnapshot({event_types:[...PLANET_COMMAND_RECOVERY_EVENT_TYPES],limit:50})});}finally{setPending(false);}}
 return <section className="planet-side-section" aria-label="单位生产"><div className="section-title">单位生产与集结</div><p>物料从此建筑库存扣除，可用皮带、分拣器或手动装料。</p>
 {units.map(u=><div key={u.id}><strong>{u.name}</strong><p>{formatUnitCost(catalog,u)}</p><button disabled={!canControl||pending||(building.unit_queue?.length??0)>=20} onClick={()=>void run('produce',()=>client.cmdProduce(building.id,u.id,planetId))}>生产{u.name}</button></div>)}
 <ol aria-label="生产队列">{building.unit_queue?.map((q,i)=><li key={i}>{catalog?.world_units?.find(u=>u.id===q.unit_type)?.name??q.unit_type} · 剩余 {q.remaining_ticks}/{q.total_ticks} tick<progress aria-label="生产进度" max={q.total_ticks} value={q.total_ticks-q.remaining_ticks}/></li>)}</ol>
 <form onSubmit={e=>{e.preventDefault();void run('set_rally_point',()=>client.cmdSetRallyPoint(building.id,{x,y,z:0},planetId));}}><label>集结 X<input type="number" aria-label="集结 X" value={x} onChange={e=>setX(Number(e.target.value))}/></label><label>集结 Y<input type="number" aria-label="集结 Y" value={y} onChange={e=>setY(Number(e.target.value))}/></label><button disabled={!canControl||pending}>设置集结点</button></form></section>;
}
