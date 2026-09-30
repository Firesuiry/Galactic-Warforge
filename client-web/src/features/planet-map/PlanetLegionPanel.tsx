/**
 * 军团面板（3.4）：地图左侧军团列表。
 * - 选中单位后「编成军团」（form_squad）；
 * - 每个军团：一键选中成员、进攻/防守/撤退（进入点地选目标模式）、补给优先、解散。
 */

import { useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import type { CombatSquad } from '@shared/types';

import { sfx } from '@/engine/audio';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import {
  LEGION_ORDER_LABEL,
  LEGION_TARGET_ORDERS,
  formableUnitIds,
  legionAliveMemberIds,
  legionOutOfAmmoCount,
  ownLegions,
  type LegionUnits,
} from '@/features/planet-map/legion-model';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

interface PlanetLegionPanelProps {
  planetId: string;
  squads?: CombatSquad[];
  units: LegionUnits;
}

export function PlanetLegionPanel({ planetId, squads, units }: PlanetLegionPanelProps) {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const { selectedUnits, interactionMode } = usePlanetViewStore(useShallow((s) => ({
    selectedUnits: s.selectedUnits,
    interactionMode: s.interactionMode,
  })));
  const [name, setName] = useState('');
  const legions = ownLegions(squads, session.playerId);
  const formable = formableUnitIds(units, selectedUnits, session.playerId);

  function submit(commandType: string, execute: () => ReturnType<typeof client.cmdFormSquad>, entityId?: string) {
    sfx.uiClick();
    void submitPlanetCommand({
      commandType,
      planetId,
      focus: entityId ? { entityId } : undefined,
      execute,
      fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
        event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
        limit: 50,
      }),
    });
  }

  function selectLegion(legion: CombatSquad) {
    sfx.uiClick();
    usePlanetViewStore.getState().setSelectedUnits(legionAliveMemberIds(legion, units));
  }

  if (legions.length === 0 && formable.length === 0) return null;

  return (
    <aside aria-label="军团列表" className="planet-legion-panel" data-testid="planet-legion-panel">
      <header><strong>军团 {legions.length}</strong></header>
      {formable.length > 0 ? (
        <form
          className="planet-legion-panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            submit('form_squad', () => client.cmdFormSquad(formable, trimmed || undefined, planetId), formable[0]);
            setName('');
          }}
        >
          <input
            aria-label="军团名称"
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="军团名称（可选）"
            value={name}
          />
          <button className="secondary-button" type="submit">编成军团（{formable.length}）</button>
        </form>
      ) : null}
      <ul>
        {legions.map((legion) => {
          const alive = legionAliveMemberIds(legion, units).length;
          const dry = legionOutOfAmmoCount(legion, units);
          const active = interactionMode.kind === 'squad_order' && interactionMode.squadId === legion.id
            ? interactionMode.order : null;
          return (
            <li data-legion-id={legion.id} key={legion.id}>
              <button className="planet-legion-panel__pick" onClick={() => selectLegion(legion)} type="button">
                <strong>{legion.name || legion.id}</strong>
                <span>{LEGION_ORDER_LABEL[legion.order ?? 'idle']} · {alive}/{legion.member_ids?.length ?? 0} 存活</span>
              </button>
              {dry > 0 ? <span role="alert">{dry} 个单位弹药耗尽</span> : null}
              <div className="planet-legion-panel__orders">
                {LEGION_TARGET_ORDERS.map((order) => (
                  <button
                    aria-pressed={active === order}
                    className="secondary-button"
                    key={order}
                    onClick={() => usePlanetViewStore.getState().setInteractionMode({ kind: 'squad_order', squadId: legion.id, order })}
                    title="点击后在地图上选目标点"
                    type="button"
                  >
                    {LEGION_ORDER_LABEL[order]}
                  </button>
                ))}
                <button
                  className="secondary-button"
                  onClick={() => submit('squad_order', () => client.cmdSquadOrder(legion.id, 'resupply', undefined, planetId), legion.id)}
                  type="button"
                >
                  {LEGION_ORDER_LABEL.resupply}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => submit('dissolve_squad', () => client.cmdDissolveSquad(legion.id, planetId), legion.id)}
                  type="button"
                >
                  解散
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
