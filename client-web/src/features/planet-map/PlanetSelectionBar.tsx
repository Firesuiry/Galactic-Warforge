/**
 * 选中情境条：地图底部的选中对象快捷操作（群星式）。
 * 建筑：升级/拆除；单位：移动/攻击（进入地图点选模式）；地块/资源：只读信息。
 */

import type { Building, CatalogView, CommandResponse } from '@shared/types';

import { Icon } from '@/common/Icon';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
} from '@/features/planet-commands/store';
import {
  formatItemInventorySummary,
  getBuildingDisplayName,
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

  if (!selected || selected.kind === 'tile' || selected.kind === 'resource') {
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
        </div>
        {ownUnit ? (
          <div className="planet-selection-bar__actions">
            <button
              className={`secondary-button${modeForUnit?.kind === 'move' ? ' planet-selection-bar__active' : ''}`}
              type="button"
              onClick={() => {
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
