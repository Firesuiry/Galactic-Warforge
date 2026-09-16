import { useEffect, useState } from 'react';
import type { Building, TrafficMonitorConfig } from '@shared/types';
import { surfaceStep, type SurfaceDirection } from '@shared/surface';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';

const labels: Record<string, string> = {
  unconfigured: '未绑定传送带', sampling: '正在采样', flowing: '流量正常', idle: '无物料流出',
  low_flow: '流量低于阈值', blocked: '积货且无物料流出', no_power: '断电', paused: '已停止',
  error: '监测异常', target_missing: '目标传送带已移除', target_inactive: '目标传送带未运行',
};
function configuration(building: Building): TrafficMonitorConfig {
  const state = building.traffic_monitor;
  return { target_belt_id: state?.target_belt_id ?? '', window_ticks: state?.window_ticks ?? 60,
    minimum_items_per_tick: state?.minimum_items_per_tick ?? 0, alerts_enabled: state?.alerts_enabled ?? true };
}
export function TrafficMonitorControls({ building, buildings, faceSize, planetId, canControl }: {
  building: Building; buildings: Building[]; faceSize: number; planetId: string; canControl: boolean;
}) {
  const client = useApiClient();
  const [draft, setDraft] = useState(() => configuration(building));
  const [pending, setPending] = useState(false);
  const configKey = JSON.stringify(configuration(building));
  useEffect(() => { setDraft(configuration(building)); }, [building.id, configKey]);
  const state = building.traffic_monitor;
  if (!state) return null;
  const neighbors = (['north', 'east', 'south', 'west'] as SurfaceDirection[]).map(direction => surfaceStep(building.position, direction, faceSize).tile);
  const candidates = buildings.filter(b => b.owner_id === building.owner_id && /^conveyor_belt_mk[123]$/.test(b.type)
    && neighbors.some(p => p.x === b.position.x && p.y === b.position.y));
  const invalid = !Number.isInteger(draft.window_ticks) || draft.window_ticks < 1 || draft.window_ticks > 600
    || !Number.isFinite(draft.minimum_items_per_tick) || draft.minimum_items_per_tick < 0 || draft.minimum_items_per_tick > 60;
  async function submit() {
    if (!canControl || pending || invalid) return;
    setPending(true);
    try {
      await submitPlanetCommand({ commandType: 'configure_traffic_monitor', planetId, focus: { entityId: building.id },
        execute: () => client.cmdConfigureTrafficMonitor(building.id, draft),
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
      });
    } finally { setPending(false); }
  }
  return <section className="planet-side-section traffic-monitor-controls" aria-label="流速监测器设置">
    <div className="section-title">传送带流速监测</div>
    <dl className="planet-kv-list">
      <div><dt>监测状态</dt><dd>{labels[state.state] ?? state.state}</dd></div>
      <div><dt>窗口平均流量</dt><dd>{state.items_per_tick.toFixed(3)} 件/tick</dd></div>
      <div><dt>采样进度</dt><dd>{state.sample_count} / {state.window_ticks} tick</dd></div>
      <div><dt>窗口 / 累计流出</dt><dd>{state.window_items} / {state.total_items} 件</dd></div>
      <div><dt>告警</dt><dd>{state.alert_active ? '告警中' : state.alerts_enabled ? '已开启' : '已关闭'}</dd></div>
    </dl>
    {state.alert_active ? <p role="status">{labels[state.state]}，请检查供料和下游出口。</p> : null}
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={!canControl || pending}>
        <legend>监测配置</legend>
        <label>监测传送带<select aria-label="监测传送带" value={draft.target_belt_id} onChange={e => setDraft({ ...draft, target_belt_id: e.target.value })}>
          <option value="">不绑定</option>
          {draft.target_belt_id && !candidates.some(b => b.id === draft.target_belt_id) ? <option value={draft.target_belt_id}>{draft.target_belt_id}（目标不可用）</option> : null}
          {candidates.map(b => <option key={b.id} value={b.id}>{b.id} · ({b.position.x}, {b.position.y})</option>)}
        </select></label>
        <label>采样窗口（tick）<input aria-label="采样窗口" type="number" min="1" max="600" step="1" value={Number.isFinite(draft.window_ticks) ? draft.window_ticks : ''} onChange={e => setDraft({ ...draft, window_ticks: e.target.valueAsNumber })} /></label>
        <label>最低流量（件/tick）<input aria-label="最低流量" type="number" min="0" max="60" step="any" value={Number.isFinite(draft.minimum_items_per_tick) ? draft.minimum_items_per_tick : ''} onChange={e => setDraft({ ...draft, minimum_items_per_tick: e.target.valueAsNumber })} /></label>
        <label className="traffic-monitor-controls__toggle"><input aria-label="启用流量告警" type="checkbox" checked={draft.alerts_enabled} onChange={e => setDraft({ ...draft, alerts_enabled: e.target.checked })} />启用流量告警</label>
        {canControl ? <button className="secondary-button" type="submit" disabled={invalid || pending}>{pending ? '提交中…' : '应用监测设置'}</button> : null}
      </fieldset>
      <p className="muted">统计相邻传送带实际流出的物料。完整窗口都积货且零流出时报告堵塞；关闭告警仍继续采样。应用配置会重新开始统计。</p>
    </form>
  </section>;
}
