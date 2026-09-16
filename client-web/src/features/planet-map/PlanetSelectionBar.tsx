/**
 * 选中情境条：地图底部的选中对象快捷操作（群星式）。
 * 建筑：升级/拆除；单位：移动/攻击（进入地图点选模式）；地块/资源：只读信息。
 */

import { useState } from 'react';
import { surfaceDistanceWithin } from '@shared/surface';
import type { Building, CatalogView, CommandResponse } from '@shared/types';

import { Icon } from '@/common/Icon';
import { sfx } from '@/engine/audio';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
} from '@/features/planet-commands/store';
import {
  formatItemInventorySummary,
  getBuildingDisplayName,
  getItemDisplayName,
  type PlanetRenderView,
} from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateBuildingState, translateUnitType } from '@/i18n/translate';

interface PlanetSelectionBarProps {
  catalog?: CatalogView;
  /** "详情"入口：切到侧栏"选中对象"页签展示完整建筑详情。 */
  onShowDetail?: () => void;
  planet: PlanetRenderView;
}

/** 建筑本地存储摘要，如 "硅矿 12 · 容量 12/20"；无存储数据时返回 null。 */
function formatBuildingStorageSummary(
  catalog: CatalogView | undefined,
  building: Building,
): string | null {
  const inventory = building.storage?.inventory;
  const hasItems = Object.values(inventory ?? {}).some((amount) => amount !== 0);
  const capacity =
    building.storage?.capacity ?? building.runtime?.functions?.storage?.capacity;
  if (!hasItems && capacity === undefined) {
    return null;
  }
  const parts: string[] = [];
  if (hasItems) {
    parts.push(`库存 ${formatItemInventorySummary(catalog, inventory)}`);
  } else {
    parts.push('库存空');
  }
  if (capacity !== undefined) {
    const total = Object.values(inventory ?? {}).reduce((sum, amount) => sum + amount, 0);
    parts.push(`容量 ${total}/${capacity}`);
  }
  return parts.join(' · ');
}

export function PlanetSelectionBar({ catalog, onShowDetail, planet }: PlanetSelectionBarProps) {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const selected = usePlanetViewStore((state) => state.selected);
  const interactionMode = usePlanetViewStore((state) => state.interactionMode);
  const setInteractionMode = usePlanetViewStore((state) => state.setInteractionMode);
  const exitInteractionMode = usePlanetViewStore((state) => state.exitInteractionMode);
  const setSelected = usePlanetViewStore((state) => state.setSelected);
  const [quantity, setQuantity] = useState(1);
  const [miningPending, setMiningPending] = useState(false);

  if (!selected || selected.kind === 'tile') {
    return null;
  }

  function submit(commandType: string, execute: () => Promise<CommandResponse>, focus?: { entityId?: string }) {
    void submitPlanetCommand({
      commandType,
      planetId: planet.planet_id,
      focus,
      execute,
      fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
        event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
        limit: 50,
      }),
    });
  }

  if (selected.kind === 'resource') {
    const resource = planet.resources?.find(entry => entry.id === selected.id);
    if (!resource) return null;
    const ownMechas = Object.values(planet.units ?? {}).filter(unit => unit.owner_id === session.playerId && unit.type === 'executor' && unit.mecha);
    const mecha = ownMechas.find(unit => surfaceDistanceWithin(unit.position, resource.position, planet.surface.face_size, 2) !== undefined) ?? ownMechas[0];
    const inRange = mecha && surfaceDistanceWithin(mecha.position, resource.position, planet.surface.face_size, 2) !== undefined;
    const solid = catalog?.items?.some(item => item.id === resource.kind && item.form === 'solid') && resource.behavior === 'finite';
    const count = Number.isFinite(quantity) ? Math.max(1, Math.min(999, Math.floor(quantity))) : 1;
    const enough = (resource.remaining ?? 0) >= count;
    return <div className="planet-selection-bar" data-testid="planet-selection-bar">
      <Icon iconKey={resource.kind} size={20} />
      <div className="planet-selection-bar__info">
        <strong>{getItemDisplayName(catalog, resource.kind)}</strong>
        <span className="planet-selection-bar__meta">剩余 {resource.remaining ?? '—'} · ({resource.position.x}, {resource.position.y})</span>
        <span className="planet-selection-bar__meta">{!solid ? '需要采集设施' : !mecha ? '本地暂无己方机甲' : !inRange ? '请将机甲移动到矿点 2 格内' : mecha.mecha?.job ? '机甲正在执行任务，请先完成或取消' : !enough ? '矿点剩余数量不足' : `每件 10 tick · 消耗 ${count * 10} 核心能量`}</span>
      </div>
      {solid && mecha ? <form className="planet-selection-bar__actions" onSubmit={async event => {
        event.preventDefault();
        if (!inRange || !enough || mecha.mecha?.job || miningPending) return;
        setMiningPending(true);
        try {
          await submitPlanetCommand({ commandType: 'mine_resource', planetId: planet.planet_id, focus: { entityId: mecha.id },
            execute: () => client.cmdMineResource(mecha.id, resource.id, count),
            fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
          });
        } finally { setMiningPending(false); }
      }}>
        <label>采集数量<input aria-label="采集数量" type="number" min={1} max={Math.min(999, resource.remaining ?? 1)} step={1} value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></label>
        <button className="secondary-button" disabled={!inRange || !enough || Boolean(mecha.mecha?.job) || miningPending} type="submit">手动采集</button>
        <button className="secondary-button" type="button" onClick={() => { setSelected({ kind: 'unit', id: mecha.id, position: mecha.position }); onShowDetail?.(); }}>机甲详情</button>
      </form> : null}
    </div>;
  }

  if (selected.kind === 'building') {
    const building = planet.buildings?.[selected.id];
    if (!building) {
      return null;
    }
    const name = getBuildingDisplayName(catalog, building.type);
    const ownBuilding = building.owner_id === session.playerId;
    const storageSummary = formatBuildingStorageSummary(catalog, building);
    return (
      <div className="planet-selection-bar" data-testid="planet-selection-bar">
        <Icon iconKey={building.type} size={20} />
        <div className="planet-selection-bar__info">
          <strong>{name}</strong>
          <span className="planet-selection-bar__meta">
            ({building.position.x}, {building.position.y}) · {translateBuildingState(building.runtime?.state)}
          </span>
          {storageSummary ? (
            <span className="planet-selection-bar__meta">{storageSummary}</span>
          ) : null}
        </div>
        {ownBuilding ? (
          <div className="planet-selection-bar__actions">
            {onShowDetail ? (
              <button
                className="secondary-button"
                type="button"
                onClick={onShowDetail}
              >
                详情
              </button>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => submit('upgrade', () => client.cmdUpgrade(building.id), { entityId: building.id })}
            >
              升级
            </button>
            <button
              className="secondary-button planet-selection-bar__danger"
              type="button"
              onClick={() => {
                submit('demolish', () => client.cmdDemolish(building.id), { entityId: building.id });
                setSelected(null);
              }}
            >
              拆除
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (selected.kind === 'unit') {
    const unit = planet.units?.[selected.id];
    if (!unit) {
      return null;
    }
    const ownUnit = unit.owner_id === session.playerId;
    const modeForUnit = interactionMode.kind === 'move' || interactionMode.kind === 'attack'
      ? interactionMode
      : null;
    return (
      <div className="planet-selection-bar" data-testid="planet-selection-bar">
        <Icon iconKey={unit.type} size={20} />
        <div className="planet-selection-bar__info">
          <strong>{translateUnitType(unit.type)}</strong>
          <span className="planet-selection-bar__meta">
            ({unit.position.x}, {unit.position.y}) · HP {unit.hp}/{unit.max_hp}
          </span>
          {unit.mecha ? <span className="planet-selection-bar__meta">
            能量 {unit.mecha.energy}/{unit.mecha.max_energy} · 护盾 {unit.mecha.shield}/{unit.mecha.max_shield}
          </span> : null}
        </div>
        {ownUnit ? (
          <div className="planet-selection-bar__actions">
            {onShowDetail ? <button className="secondary-button" type="button" onClick={onShowDetail}>
              {unit.mecha ? '机甲详情' : '详情'}
            </button> : null}
            <button
              className={`secondary-button${modeForUnit?.kind === 'move' ? ' planet-selection-bar__active' : ''}`}
              type="button"
              onClick={() => {
                sfx.uiClick();
                if (modeForUnit?.kind === 'move') {
                  exitInteractionMode();
                } else {
                  setInteractionMode({ kind: 'move', unitId: unit.id });
                }
              }}
            >
              {modeForUnit?.kind === 'move' ? '取消移动' : '移动'}
            </button>
            <button
              className={`secondary-button${modeForUnit?.kind === 'attack' ? ' planet-selection-bar__active' : ''}`}
              type="button"
              onClick={() => {
                sfx.uiClick();
                if (modeForUnit?.kind === 'attack') {
                  exitInteractionMode();
                } else {
                  setInteractionMode({ kind: 'attack', unitId: unit.id });
                }
              }}
            >
              {modeForUnit?.kind === 'attack' ? '取消攻击' : '攻击'}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}
