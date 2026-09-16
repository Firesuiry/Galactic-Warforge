import { useEffect, useState } from 'react';
import type { Building, CatalogView, CardinalDirection, ItemInventory, LogisticsBeltPort, LogisticsStationState, PlanetRuntimeView } from '@shared/types';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { getItemDisplayName } from './model';

const sides: { key: CardinalDirection; label: string }[] = [{ key: 'north', label: '北' }, { key: 'east', label: '东' }, { key: 'south', label: '南' }, { key: 'west', label: '西' }];
const phase: Record<string, string> = { idle: '停靠', takeoff: '起飞', in_flight: '飞行', landing: '降落', waiting_unload: '等待卸货', stranded: '失去基地，保留货物' };
function copyPorts(state: LogisticsStationState) { return Object.fromEntries(Object.entries(state.belt_ports ?? {}).map(([side, port]) => [side, { ...port }])) as Partial<Record<CardinalDirection, LogisticsBeltPort>>; }
export function LogisticsStationControls({ building, state, runtime, catalog, planetId, canControl, inventory }: {
  building: Building; state: LogisticsStationState; runtime?: PlanetRuntimeView; catalog?: CatalogView;
  planetId: string; canControl: boolean; inventory?: ItemInventory;
}) {
  const client = useApiClient();
  const [ports, setPorts] = useState(() => copyPorts(state));
  const [vehicle, setVehicle] = useState('logistics_drone');
  const [source, setSource] = useState<'player' | 'station'>('player');
  const [quantity, setQuantity] = useState('1');
  const [pending, setPending] = useState(false);
  useEffect(() => { setVehicle('logistics_drone'); setQuantity('1'); setSource('player'); }, [building.id]);
  const config = JSON.stringify(state.belt_ports ?? {});
  useEffect(() => { setPorts(copyPorts(state)); }, [building.id, config]);
  const itemIds = [...new Set([...Object.keys(state.settings ?? {}), ...Object.keys(state.interstellar_settings ?? {})])];
  const drones = (runtime?.logistics_drones ?? []).filter(v => v.station_id === building.id);
  const ships = (runtime?.logistics_ships ?? []).filter(v => v.station_id === building.id);
  const installed = vehicle === 'logistics_drone' ? drones.length : ships.length;
  const capacity = vehicle === 'logistics_drone' ? state.drone_capacity : state.interstellar.ship_slots;
  const count = Number(quantity);
  const invalidQuantity = !/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(count) || count + installed > capacity;
  const invalidPorts = Object.values(ports).some(port => !port || !itemIds.includes(port.item_id));
  async function execute(commandType: 'install_logistics_vehicle' | 'configure_logistics_station' | 'configure_logistics_slot', action: () => ReturnType<typeof client.cmdInstallLogisticsVehicle>) {
    if (!canControl || pending) return;
    setPending(true);
    try {
      await submitPlanetCommand({ commandType, planetId, focus: { entityId: building.id }, execute: action,
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }) });
    } finally { setPending(false); }
  }
  return <section className="planet-side-section logistics-station-controls" aria-label="物流站运行与接线">
    <div className="section-title">物流站运行</div>
    <dl className="planet-kv-list">
      <div><dt>航次储能</dt><dd>{state.energy} / {state.energy_capacity}</dd></div>
      <div><dt>最近实际充电</dt><dd>{state.last_charge_amount} / {state.charge_per_tick} 能量/tick</dd></div>
      <div><dt>物品槽位</dt><dd>{itemIds.length} / {state.slot_capacity} · 每项上限 {state.item_capacity}</dd></div>
      <div><dt>已安装无人机</dt><dd>{drones.length} / {state.drone_capacity}</dd></div>
      {building.type === 'interstellar_logistics_station' ? <div><dt>已安装运输船</dt><dd>{ships.length} / {state.interstellar.ship_slots}</dd></div> : null}
    </dl>
    <p className="muted">航次从站内储能预付往返费用，运输器返航完成后才能再次出发。停电不派新航次，已起飞的运输器继续航行。</p>
    <form onSubmit={e => { e.preventDefault(); if (!invalidQuantity) void execute('install_logistics_vehicle', () => client.cmdInstallLogisticsVehicle(building.id, vehicle, count, source)); }}>
      <fieldset disabled={!canControl || pending}>
        <legend>安装运输器</legend>
        <label>安装来源<select aria-label="安装来源" value={source} onChange={e => setSource(e.target.value as 'player' | 'station')}><option value="player">玩家背包</option><option value="station">站内仓库</option></select></label>
        <label>运输器类型<select aria-label="运输器类型" value={vehicle} onChange={e => setVehicle(e.target.value)}>
          <option value="logistics_drone">物流无人机</option>
          {building.type === 'interstellar_logistics_station' ? <option value="logistics_vessel">星际物流运输船</option> : null}
        </select></label>
        <label>安装数量<input aria-label="安装数量" type="number" min="1" max={Math.max(0, capacity - installed)} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
        <p>{source === 'player' ? '背包' : '站内'}可用：{(source === 'player' ? inventory : state.inventory)?.[vehicle] ?? 0} · 安装会消耗对应物品</p>
        {canControl ? <button className="secondary-button" type="submit" disabled={invalidQuantity || pending}>安装运输器</button> : null}
      </fieldset>
    </form>
    <p className="muted">制造台产出的运输器可通过皮带送入站内本地物品槽，再选择“站内仓库”安装。</p>
    <form onSubmit={e => { e.preventDefault(); if (!invalidPorts) void execute('configure_logistics_station', () => client.cmdConfigureLogisticsStation(building.id, { beltPorts: ports })); }}>
      <fieldset disabled={!canControl || pending}>
        <legend>传送带接线</legend>
        {sides.map(({ key, label }) => <div key={key} className="logistics-station-controls__port">
          <label>{label}侧模式<select aria-label={`${label}侧物流端口`} value={ports[key]?.mode ?? 'closed'} onChange={e => {
            const next = { ...ports };
            if (e.target.value === 'closed') delete next[key];
            else next[key] = { mode: e.target.value as 'input' | 'output', item_id: ports[key]?.item_id ?? itemIds[0] ?? '' };
            setPorts(next);
          }}><option value="closed">关闭</option><option value="input">输入站内</option><option value="output">输出到带</option></select></label>
          {ports[key] ? <label>{label}侧物品<select aria-label={`${label}侧物流物品`} value={ports[key]!.item_id} onChange={e => setPorts({ ...ports, [key]: { ...ports[key]!, item_id: e.target.value } })}>
            <option value="">选择已配置槽位</option>
            {itemIds.map(id => <option key={id} value={id}>{getItemDisplayName(catalog, id)}</option>)}
          </select></label> : null}
        </div>)}
        {canControl ? <button type="submit" className="secondary-button" disabled={invalidPorts || pending}>应用物流接线</button> : null}
      </fieldset>
    </form>
    <p className="muted">先在物流工作台配置物品槽，再为对应方向指定进出和物品。每口最多6件/tick；槽位满或站点无电时停止交换。</p>
    <ul className="timeline-list timeline-list--dense" aria-label="运输器航程">
      {[...drones, ...ships].map(v => <li key={v.id}><strong>{v.id} · {v.trip_kind === 'pickup' ? '取货 · ' : ''}{v.returning ? '返航 · ' : ''}{phase[v.status] ?? v.status}</strong>
        <span>载货 {Object.entries(v.cargo ?? {}).map(([id, amount]) => `${getItemDisplayName(catalog, id)} ×${amount}`).join('、') || '空载'} · 本阶段剩余 {v.remaining_ticks} tick</span>
      </li>)}
    </ul>
    {canControl && itemIds.length > 0 ? <details><summary>移除空槽</summary><p className="muted">须先解除端口，清空库存，并等待关联航次结束。</p>
      {(['planetary', 'interstellar'] as const).flatMap(scope => Object.keys((scope === 'planetary' ? state.settings : state.interstellar_settings) ?? {}).map(id =>
        <button className="secondary-button" key={`${scope}:${id}`} disabled={pending} onClick={() => void execute('configure_logistics_slot', () => client.cmdConfigureLogisticsSlot(building.id, { scope, itemId: id, mode: 'none', localStorage: 0, remove: true }))}>
          移除{scope === 'planetary' ? '行星' : '星际'}空槽：{getItemDisplayName(catalog, id)}
        </button>))}
    </details> : null}
  </section>;
}
