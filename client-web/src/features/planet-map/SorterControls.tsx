/**
 * 分拣器设置（第 16 轮契约 §4）：只配过滤。
 *
 * 方向不再由玩家配置——分拣器有朝向，背面取货、正面放货，跟随建造时的 rotation。
 * 这里只读地展示由 rotation 推出的取/放方向；提交的载荷只有过滤字段
 * （`configure_sorter` 服务端也不再接受方向）。
 *
 * 过滤物品是**可搜索的多选列表**（试玩 1016 U2）：旧实现是原生 `<select multiple>`，
 * 100+ 项铺开、无搜索无分类，Ctrl 点选铁矿很费劲。现在输入框即时筛选（中文名 / id），
 * 每行给出物品色块 + 中文名 + 已选勾。
 */
import { useEffect, useMemo, useState } from 'react';
import type { Building, CatalogView, SorterFilterConfig } from '@shared/types';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { getItemColorValue } from './item-colors';
import { DIRECTION_NAMES, logisticsArrows } from './logistics-direction';
import { getItemDisplayName } from './model';
import { sorterFilterOptions, toggleSorterFilterItem } from './sorter-filter';

/** 面板内部的草稿：两个字段都必填，提交时原样作为 `SorterFilterConfig` 下发。 */
type SorterFilterDraft = Required<SorterFilterConfig>;

/** 只取过滤字段；方向由 rotation 决定，不进载荷。 */
function readConfig(b: Building): SorterFilterDraft {
  return {
    filter_mode: b.sorter?.filter?.mode ?? 'allow',
    filter_items: [...(b.sorter?.filter?.items ?? [])],
  };
}

export function SorterControls({ building, catalog, planetId, canControl }: { building: Building; catalog?: CatalogView; planetId: string; canControl: boolean }) {
  const client = useApiClient();
  const [draft, setDraft] = useState(() => readConfig(building));
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const configuration = JSON.stringify(readConfig(building));
  useEffect(() => setDraft(readConfig(building)), [building.id, configuration]);
  // 方向只读展示：由 rotation 推出单一「取 → 放」，写「背面 西 → 正面 东」。
  const { arrows } = logisticsArrows(building);
  const route = arrows.length === 0
    ? '方向未定'
    : arrows.map((arrow) => `${arrow.from ? `背面 ${DIRECTION_NAMES[arrow.from]} → ` : ''}正面 ${DIRECTION_NAMES[arrow.to]}`).join('、');
  const options = useMemo(() => sorterFilterOptions(catalog, draft.filter_items, query), [catalog, draft.filter_items, query]);
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
      <div className="sorter-filter">
        <label className="sorter-filter__search">
          过滤物品
          <input
            aria-label="搜索过滤物品"
            onChange={e => setQuery(e.target.value)}
            placeholder="输入物品名或 id 筛选（如 铁）"
            type="search"
            value={query}
          />
        </label>
        {draft.filter_items.length > 0 ? (
          <div className="sorter-filter__chosen" data-testid="sorter-filter-chosen">
            <span className="sorter-filter__chosen-title">已选 {draft.filter_items.length}</span>
            {draft.filter_items.map(itemId => (
              <button
                aria-label={`取消选择 ${getItemDisplayName(catalog, itemId)}`}
                className="sorter-filter__chip"
                key={itemId}
                onClick={() => setDraft(current => ({ ...current, filter_items: toggleSorterFilterItem(catalog, current.filter_items, itemId) }))}
                type="button"
              >
                <span className="sorter-filter__swatch" style={{ background: getItemColorValue(itemId, catalog?.items?.find(item => item.id === itemId)?.color) }} />
                {getItemDisplayName(catalog, itemId)}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : null}
        <ul aria-label="过滤物品候选" className="sorter-filter__list" role="listbox" aria-multiselectable="true">
          {options.length === 0 ? (
            <li className="sorter-filter__empty">没有匹配的物品（清空搜索看全部）</li>
          ) : options.map(option => (
            <li key={option.id}>
              <button
                aria-selected={option.selected}
                className={`sorter-filter__option${option.selected ? ' is-selected' : ''}`}
                onClick={() => setDraft(current => ({ ...current, filter_items: toggleSorterFilterItem(catalog, current.filter_items, option.id) }))}
                role="option"
                type="button"
              >
                <span className="sorter-filter__swatch" style={{ background: getItemColorValue(option.id, option.color) }} />
                <span className="sorter-filter__name">{option.name}</span>
                <span className="sorter-filter__id">{option.id}</span>
                {option.selected ? <span aria-hidden="true" className="sorter-filter__check">✓</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p>未选择物品时允许全部。支持皮带与机器上下料，机器只接收当前配方需要的原料。</p>
      <button type="submit" className="secondary-button" disabled={pending}>{pending ? '提交中…' : '应用分拣设置'}</button>
    </fieldset></form>
  </section>;
}
