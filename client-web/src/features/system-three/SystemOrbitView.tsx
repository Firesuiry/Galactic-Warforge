import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translatePlanetKind } from '@/i18n/translate';
import { starTypeLabel } from '@/features/starmap/model';
import { SystemThreeScene } from './system-three-scene';

export function SystemOrbitView({ systemId }: { systemId: string }) {
  const client = useApiClient(), session = useSessionSnapshot();
  const [params] = useSearchParams();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SystemThreeScene | null>(null);
  const [selectedPlanet, selectPlanet] = useState<string | null>(params.get('planet'));
  const [selectedFleet, selectFleet] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const query = useQuery({ queryKey:['system',session.serverUrl,session.playerId,systemId], queryFn:()=>client.fetchSystem(systemId) });
  const runtime = useQuery({ queryKey:['system-runtime',session.serverUrl,session.playerId,systemId], queryFn:()=>client.fetchSystemRuntime(systemId), refetchInterval:2000 });
  useEffect(() => {
    if (!host.current || !query.data?.discovered) return;
    let renderer: SystemThreeScene;
    try {
      renderer = new SystemThreeScene(host.current, {
        onSelectPlanet: id => { selectPlanet(id); selectFleet(null); },
        onSelectFleet: id => { selectFleet(id); selectPlanet(null); },
      });
    } catch { setError('无法启动 3D 星系画面，请切换平面战术视图。'); return; }
    scene.current = renderer; setReady(true);
    if (import.meta.env.DEV) (window as unknown as {__systemThree?:SystemThreeScene}).__systemThree = renderer;
    return () => { renderer.destroy(); scene.current=null; if(import.meta.env.DEV) delete (window as unknown as {__systemThree?:SystemThreeScene}).__systemThree; };
  }, [Boolean(query.data?.discovered)]);
  useEffect(() => {
    if (ready && query.data) scene.current?.setData({system:query.data,runtime:runtime.data});
  }, [ready,query.data,runtime.data]);
  useEffect(() => {
    if (ready) scene.current?.setSelection(selectedPlanet, selectedFleet);
  }, [ready, selectedPlanet, selectedFleet]);
  const system=query.data;
  const planets=(system?.planets??[]).filter(p=>p.discovered);
  const planet=planets.find(p=>p.planet_id===selectedPlanet);
  const orbitAvailable = Boolean(system?.discovered && runtime.data?.discovered && runtime.data.available);
  const fleet=orbitAvailable ? runtime.data?.fleets?.find(f=>f.fleet_id===selectedFleet) : undefined;
  const dyson=orbitAvailable ? runtime.data?.dyson_sphere : undefined;
  const nodes=(dyson?.layers??[]).flatMap(l=>l.nodes??[]).filter(n=>n.built).length;
  const frames=(dyson?.layers??[]).flatMap(l=>l.frames??[]).filter(f=>f.built).length;
  const starType=typeof system?.star?.type==='string'?system.star.type:'';
  return <div className="system-orbit">
    <div ref={host} className="system-orbit__canvas" role="application" aria-label="3D 恒星系地图" />
    <div className="system-orbit__heading">
      <nav aria-label="星际导航"><Link to="/galaxy">银河</Link><span> / </span><span>恒星系</span></nav>
      <h1>{system?.name||systemId}</h1>
      <p>{starTypeLabel(starType)} · 已发现 {planets.length} 颗行星</p>
    </div>
    <div className="system-orbit__tools">
      <button className="secondary-button" onClick={()=>scene.current?.resetView()}>全系视角</button>
      <Link className="secondary-button" to={`/system/${encodeURIComponent(systemId)}?view=2d`}>平面战术与调兵</Link>
    </div>
    {(query.isLoading||runtime.isLoading)&&<div className="system-orbit__notice" role="status">正在同步恒星系...</div>}
    {(error||query.error||runtime.error)&&<div className="system-orbit__notice" role="alert">{error||(query.error||runtime.error)?.message}</div>}
    {system&&!system.discovered&&<div className="system-orbit__notice">此恒星系尚未发现</div>}
    <aside className="system-orbit__telemetry">
      <span className="system-orbit__eyebrow">恒星能源工程</span>
      {orbitAvailable ? <><strong>{(dyson?.total_energy??0).toLocaleString()} <small>能量输出</small></strong>
      <p>{nodes} 个节点 · {frames} 段框架</p>
      <p>{runtime.data?.fleets?.length??0} 支舰队 · {runtime.data?.contacts?.length??0} 个传感器接触</p>
      </> : <p>暂无轨道观测数据</p>}
      <Link to="/war">军事指挥 →</Link>
    </aside>
    {(planet||fleet)&&<aside className="system-orbit__selection">
      <button className="system-orbit__close" aria-label="关闭星体详情" onClick={()=>{selectPlanet(null);selectFleet(null);}}>×</button>
      {planet ? <>
        <span className="system-orbit__eyebrow">行星勘测</span><h2>{planet.name||planet.planet_id}</h2>
        <p>{translatePlanetKind(planet.kind)} · {planet.orbit?.distance_au.toFixed(2)??'—'} AU</p>
        <p>公转周期 {planet.orbit?.period_days.toFixed(1)??'—'} 天 · 卫星 {planet.moon_count??0}</p>
        <Link className="secondary-button" to={`/planet/${encodeURIComponent(planet.planet_id)}`}>进入行星</Link>
        <button className="secondary-button" onClick={()=>scene.current?.focusPlanet(planet.planet_id)}>观测星体</button>
      </> : fleet ? <><span className="system-orbit__eyebrow">舰队态势</span><h2>{fleet.fleet_id}</h2><p>{fleet.transit?'跃迁中':fleet.state==='attacking'?'交战中':'待命'}</p><Link className="secondary-button" to={`/system/${encodeURIComponent(systemId)}?view=2d`}>打开战术调度</Link></> : null}
    </aside>}
    <div className="system-orbit__bodies" aria-label="已发现行星">
      {planets.map((body,i)=><button key={body.planet_id} className="system-orbit__body" aria-pressed={selectedPlanet===body.planet_id} onClick={()=>{selectPlanet(body.planet_id);selectFleet(null);}}>
        <span className={`system-orbit__planet-icon system-orbit__planet-icon--${body.kind??'rocky'}`} aria-hidden="true"/>
        <span><small>0{i+1} / {translatePlanetKind(body.kind)}</small><strong>{body.name||body.planet_id}</strong><small>{body.orbit?.distance_au.toFixed(2)??'—'} AU</small></span>
      </button>)}
    </div>
    <p className="system-orbit__hint">拖动旋转 · 滚轮缩放 · 点击星体观测　<span>轨道与舰队位置为态势示意</span></p>
  </div>;
}
