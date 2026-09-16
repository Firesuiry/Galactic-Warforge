import { useState } from 'react';
import type { CatalogView, Unit } from '@shared/types';
import { getItemDisplayName } from './model';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';

/** All values and fuel choices come from the authoritative scene and catalog. */
export function MechaControls({ unit, catalog, planetId, canControl }: {
  unit: Unit; catalog?: CatalogView; planetId: string; canControl: boolean;
}) {
  const client = useApiClient();
  const [fuelId, setFuelId] = useState('coal');
  const [pending, setPending] = useState(false);
  const mecha = unit.mecha;
  if (!mecha) return null;
  const fuels = catalog?.items?.filter(item => (item.mecha_fuel_energy ?? 0) > 0) ?? [];
  const fuel = fuels.find(item => item.id === fuelId) ?? fuels[0];
  const full = mecha.energy >= mecha.max_energy || mecha.fuel_energy > 0;
  return (
    <section className="planet-side-section mecha-controls" aria-label="机甲核心">
      <div className="section-title">机甲核心</div>
      <label>核心能量 <strong>{mecha.energy} / {mecha.max_energy}</strong>
        <meter aria-label="核心能量" min={0} max={mecha.max_energy} value={mecha.energy} />
      </label>
      <label>能量护盾 <strong>{mecha.shield} / {mecha.max_shield}</strong>
        <meter aria-label="能量护盾" min={0} max={Math.max(1, mecha.max_shield)} value={mecha.shield} />
      </label>
      <p className="muted">燃料余能 {mecha.fuel_energy} · 每次攻击耗能 {mecha.attack_energy_cost} · 每格移动耗能 {mecha.move_energy_cost}</p>
      <p className="muted">{mecha.max_shield > 0 ? `脱战 ${mecha.shield_recharge_delay} tick 后消耗核心能量恢复护盾。` : '研究能量护盾科技后解锁护盾。'}</p>
      {canControl ? <form onSubmit={async event => {
        event.preventDefault();
        if (!fuel || full || pending) return;
        setPending(true);
        try {
          await submitPlanetCommand({
            commandType: 'refuel_mecha', planetId, focus: { entityId: unit.id },
            execute: () => client.cmdRefuelMecha(unit.id, fuel.id, 1),
            fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
          });
        } finally { setPending(false); }
      }}>
        <label>背包燃料
          <select aria-label="机甲燃料" value={fuel?.id ?? ''} onChange={event => setFuelId(event.target.value)}>
            {fuels.map(item => <option key={item.id} value={item.id}>{getItemDisplayName(catalog, item.id)} · {item.mecha_fuel_energy} 能量</option>)}
          </select>
        </label>
        <button className="secondary-button" type="submit" disabled={!fuel || full || pending}>
          {pending ? '提交中…' : '消耗 1 个燃料补能'}
        </button>
        <p className="muted">从背包扣除燃料。核心已满或尚有燃料余能时无需添加。</p>
      </form> : null}
    </section>
  );
}
