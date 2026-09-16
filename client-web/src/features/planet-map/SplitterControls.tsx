import { useEffect, useState } from 'react';
import type { Building, CatalogView, CardinalDirection, SplitterConfig } from '@shared/types';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { getItemDisplayName } from './model';

type PortRole = 'input' | 'output' | 'closed';
const PORTS: ReadonlyArray<{ direction: CardinalDirection; label: string }> = [
  { direction: 'north', label: '北' }, { direction: 'east', label: '东' },
  { direction: 'south', label: '南' }, { direction: 'west', label: '西' },
];

function readConfig(building: Building): SplitterConfig {
  const state = building.splitter;
  return {
    input_directions: [...(state?.input_directions ?? [])],
    output_directions: [...(state?.output_directions ?? [])],
    input_priority: state?.input_priority ?? '',
    output_priority: state?.output_priority ?? '',
    output_filters: { ...state?.output_filters },
  };
}

export function SplitterControls({ building, catalog, planetId, canControl }: {
  building: Building; catalog?: CatalogView; planetId: string; canControl: boolean;
}) {
  const client = useApiClient();
  const [draft, setDraft] = useState(() => readConfig(building));
  const [pending, setPending] = useState(false);
  // Statistics change every transport tick; only authoritative configuration
  // changes replace the draft, preserving edits while the factory keeps working.
  const configuration = JSON.stringify(readConfig(building));
  useEffect(() => { setDraft(readConfig(building)); }, [building.id, configuration]);
  const state = building.splitter;
  if (!state) return <section className="planet-side-section"><p>尚未读取分流器配置。</p></section>;

  const roleOf = (direction: CardinalDirection): PortRole => draft.input_directions.includes(direction)
    ? 'input' : draft.output_directions.includes(direction) ? 'output' : 'closed';
  function changeRole(direction: CardinalDirection, role: PortRole) {
    setDraft(current => {
      const inputs = new Set(current.input_directions.filter(port => port !== direction));
      const outputs = new Set(current.output_directions.filter(port => port !== direction));
      if (role === 'input') inputs.add(direction);
      if (role === 'output') outputs.add(direction);
      const filters = { ...current.output_filters };
      if (role !== 'output') delete filters[direction];
      return {
        input_directions: PORTS.map(port => port.direction).filter(port => inputs.has(port)),
        output_directions: PORTS.map(port => port.direction).filter(port => outputs.has(port)),
        input_priority: inputs.has(current.input_priority as CardinalDirection) ? current.input_priority : '',
        output_priority: outputs.has(current.output_priority as CardinalDirection) ? current.output_priority : '',
        output_filters: filters,
      };
    });
  }
  const invalid = draft.input_directions.length === 0 || draft.output_directions.length === 0
    || draft.input_directions.some(direction => draft.output_directions.includes(direction));
  const items = catalog?.items ?? [];
  const buffer = building.conveyor?.buffer ?? [];
  async function submit() {
    if (!canControl || pending || invalid) return;
    setPending(true);
    try {
      await submitPlanetCommand({ commandType: 'configure_splitter', planetId, focus: { entityId: building.id },
        execute: () => client.cmdConfigureSplitter(building.id, draft),
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
      });
    } finally { setPending(false); }
  }

  return <section className="planet-side-section splitter-controls" aria-label="四向分流器设置">
    <div className="section-title">四向分流器</div>
    <dl className="planet-kv-list">
      <div><dt>带内缓存</dt><dd>{buffer.reduce((sum, item) => sum + item.quantity, 0)} / {building.conveyor?.max_stack ?? '—'}</dd></div>
      <div><dt>累计搬运</dt><dd>{state.transferred_items}</dd></div>
      <div><dt>最近搬运</dt><dd>{state.last_transfer_tick > 0 ? `tick ${state.last_transfer_tick}` : '尚未搬运'}</dd></div>
    </dl>
    <p aria-label="分流器缓存物品">{buffer.length ? buffer.map(item => `${getItemDisplayName(catalog, item.item_id)} × ${item.quantity}`).join('、') : '缓存为空'}</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={!canControl || pending}>
        <legend>端口方向</legend>
        <div className="splitter-controls__ports">
          {PORTS.map(({ direction, label }) => <div className="splitter-controls__port" key={direction}>
            <label>{label}侧端口
              <select aria-label={`${label}侧端口`} value={roleOf(direction)} onChange={event => changeRole(direction, event.target.value as PortRole)}>
                <option value="input">输入</option><option value="output">输出</option><option value="closed">关闭</option>
              </select>
            </label>
            {roleOf(direction) === 'output' ? <label>{label}侧输出过滤
              <select aria-label={`${label}侧输出过滤`} value={draft.output_filters?.[direction] ?? ''} onChange={event => {
                const itemId = event.target.value;
                setDraft(current => {
                  const filters = { ...current.output_filters };
                  if (itemId) filters[direction] = itemId; else delete filters[direction];
                  return { ...current, output_filters: filters };
                });
              }}>
                <option value="">所有物品</option>
                {draft.output_filters?.[direction] && !items.some(item => item.id === draft.output_filters?.[direction])
                  ? <option value={draft.output_filters[direction]}>{getItemDisplayName(catalog, draft.output_filters[direction]!)}</option> : null}
                {items.map(item => <option key={item.id} value={item.id}>{getItemDisplayName(catalog, item.id)}</option>)}
              </select>
            </label> : null}
          </div>)}
        </div>
        <label>优先输入
          <select aria-label="优先输入" value={draft.input_priority ?? ''} onChange={event => setDraft(current => ({ ...current, input_priority: event.target.value as CardinalDirection | '' }))}>
            <option value="">轮流输入</option>
            {PORTS.filter(port => draft.input_directions.includes(port.direction)).map(port => <option key={port.direction} value={port.direction}>{port.label}侧</option>)}
          </select>
        </label>
        <label>优先输出
          <select aria-label="优先输出" value={draft.output_priority ?? ''} onChange={event => setDraft(current => ({ ...current, output_priority: event.target.value as CardinalDirection | '' }))}>
            <option value="">轮流输出</option>
            {PORTS.filter(port => draft.output_directions.includes(port.direction)).map(port => <option key={port.direction} value={port.direction}>{port.label}侧</option>)}
          </select>
        </label>
        {invalid ? <p role="status">至少保留一个输入口和一个输出口，同一端口不能同时输入和输出。</p> : null}
        {canControl ? <div className="splitter-controls__actions">
          <button type="submit" className="secondary-button" disabled={invalid || pending}>{pending ? '提交中…' : '应用分流设置'}</button>
          <button type="button" className="secondary-button" onClick={() => setDraft(readConfig(building))}>还原当前配置</button>
        </div> : null}
      </fieldset>
      <p className="muted">过滤只限制对应出口；优先端口不可用时由其他符合过滤条件的可用端口接续。</p>
      {!canControl ? <p className="muted">仅所属玩家可以修改配置。</p> : null}
    </form>
  </section>;
}
