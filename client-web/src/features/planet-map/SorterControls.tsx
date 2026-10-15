/**
 * 分拣器设置（第 16 轮契约 §4）：只配过滤。
 *
 * 方向不再由玩家配置——分拣器有朝向，背面取货、正面放货，跟随建造时的 rotation。
 * 这里只读地展示由 rotation 推出的取/放方向；提交的载荷只有过滤字段
 * （`configure_sorter` 服务端也不再接受方向）。
 */
import { useEffect, useState } from 'react';
import type { Building, CatalogView, SorterConfig } from '@shared/types';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { DIRECTION_NAMES, logisticsArrows } from './logistics-direction';
import { getItemDisplayName } from './model';

/** 只取过滤字段；方向由 rotation 决定，不进载荷。 */
function readConfig(b: Building): SorterConfig {
  return {
    filter_mode: b.sorter?.filter?.mode ?? 'allow',
    filter_items: [...(b.sorter?.filter?.items ?? [])],
  };
}

export function SorterControls({ building, catalog, planetId, canControl }: { building: Building; catalog?: CatalogView; planetId: string; canControl: boolean }) {
  const client = useApiClient();
  const [draft, setDraft] = useState(() => readConfig(building));
  const [pending, setPending] = useState(false);
  const configuration = JSON.stringify(readConfig(building));
  useEffect(() => setDraft(readConfig(building)), [building.id, configuration]);
  // 方向只读展示：由 rotation 推出单一「取 → 放」，写「背面 西 → 正面 东」。
  const { arrows } = logisticsArrows(building);
  const route = arrows.length === 0
    ? '方向未定'
    : arrows.map((arrow) => `${arrow.from ? `背面 ${DIRECTION_NAMES[arrow.from]} → ` : ''}正面 ${DIRECTION_NAMES[arrow.to]}`).join('、');
  async function submit() {
    if (pending || !canControl) return;
    setPending(true);
    try {
      await submitPlanetCommand({ commandType: 'configure_sorter', planetId, focus: { entityId: building.id }, execute: () => client.cmdConfigureSorter(building.id, draft, planetId), fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }) });
    } finally { setPending(false); }
  }
  return <section className="planet-side-section" aria-label="分拣器设置">
    <div className="section-title">分拣器过滤</div>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={!canControl || pending}>
      <legend>搬运方向</legend>
      <p data-testid="sorter-direction">{route}</p>
      <p>方向由建造时的朝向决定（背面取货、正面放货），R 键旋转；这里只配过滤。</p>
      <label>过滤模式<select aria-label="过滤模式" value={draft.filter_mode} onChange={e => setDraft({ ...draft, filter_mode: e.target.value as 'allow' | 'deny' })}><option value="allow">仅搬运所选</option><option value="deny">排除所选</option></select></label>
      <label>过滤物品<select multiple aria-label="过滤物品" value={draft.filter_items} onChange={e => setDraft({ ...draft, filter_items: Array.from(e.target.selectedOptions, o => o.value) })}>{catalog?.items?.map(item => <option key={item.id} value={item.id}>{getItemDisplayName(catalog, item.id)}</option>)}</select></label>
      <p>未选择物品时允许全部。支持皮带与机器上下料，机器只接收当前配方需要的原料。</p>
      <button type="submit" className="secondary-button" disabled={pending}>{pending ? '提交中…' : '应用分拣设置'}</button>
    </fieldset></form>
  </section>;
}
