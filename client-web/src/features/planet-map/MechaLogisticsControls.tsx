import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CatalogView, ItemInventory, MechaLogisticsRequest, Unit } from '@shared/types';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { getItemDisplayName } from './model';

type RequestRow = MechaLogisticsRequest & { item: string };
export function MechaLogisticsControls({ unit, catalog, planetId, inventory }: {
  unit: Unit; catalog?: CatalogView; planetId: string; inventory?: ItemInventory;
}) {
  const client = useApiClient();
  const authoritative = JSON.stringify(unit.mecha?.logistics_requests ?? {});
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const requests = JSON.parse(authoritative) as Record<string, MechaLogisticsRequest>;
    setRows(Object.entries(requests).map(([item, bounds]) => ({ item, ...bounds })));
  }, [unit.id, authoritative]);
  const items = catalog?.items?.filter(item => item.form === 'solid') ?? [];
  const invalid = rows.some(row => !row.item || !Number.isSafeInteger(row.min) || !Number.isSafeInteger(row.max)
    || row.min < 0 || row.max < 1 || row.min > row.max || row.max > 1000)
    || new Set(rows.map(row => row.item)).size !== rows.length;
  const update = (index: number, value: Partial<RequestRow>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...value } : row));
  return <form aria-label="机甲物流请求" onSubmit={async event => {
    event.preventDefault();
    if (pending || invalid) return;
    setPending(true);
    try {
      await submitPlanetCommand({ commandType: 'configure_mecha_logistics', planetId, focus: { entityId: unit.id },
        execute: () => client.cmdConfigureMechaLogistics(unit.id, Object.fromEntries(rows.map(({ item, min, max }) => [item, { min, max }]))),
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
      });
    } finally { setPending(false); }
  }}>
    <div className="section-title">机甲物流请求</div>
    <p className="muted">背包低于下限时补给到上限，超过上限时回收余量。需要附近配送器开启对应功能。</p>
    <fieldset disabled={pending}>
      {rows.map((row, index) => <div key={index} className="mecha-logistics-row">
        <label>物品 {index + 1}<select aria-label={`物品 ${index + 1}`} value={row.item} onChange={event => update(index, { item: event.target.value })}>
          <option value="">选择物品</option>
          {items.map(item => <option key={item.id} value={item.id}>{getItemDisplayName(catalog, item.id)}</option>)}
        </select></label>
        <label>补给下限 {index + 1}<input type="number" min={0} max={1000} step={1} value={row.min} onChange={event => update(index, { min: Number(event.target.value) })} /></label>
        <label>回收上限 {index + 1}<input type="number" min={1} max={1000} step={1} value={row.max} onChange={event => update(index, { max: Number(event.target.value) })} /></label>
        <span>背包 {inventory?.[row.item] ?? 0}</span>
        <button className="secondary-button" type="button" title={`删除请求 ${index + 1}`} aria-label={`删除请求 ${index + 1}`} onClick={() => setRows(current => current.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
      </div>)}
      <button className="secondary-button" type="button" title="添加物流请求" aria-label="添加物流请求" disabled={rows.length >= 8} onClick={() => setRows(current => [...current, { item: '', min: 10, max: 30 }])}><Plus size={16} /></button>
      <button className="secondary-button" type="submit" disabled={invalid}>应用机甲物流请求</button>
    </fieldset>
  </form>;
}
