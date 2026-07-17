/**
 * 选中情境条：地图底部的选中对象快捷操作（群星式）。
 * 建筑：升级/拆除；单位：移动/攻击（进入地图点选模式）；地块/资源：只读信息。
 */

import type { CatalogView, CommandResponse } from '@shared/types';

import { Icon } from '@/common/Icon';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
} from '@/features/planet-commands/store';
import {
  getBuildingDisplayName,
  type PlanetRenderView,
} from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateBuildingState, translateUnitType } from '@/i18n/translate';

interface PlanetSelectionBarProps {
  catalog?: CatalogView;
  planet: PlanetRenderView;
}

export function PlanetSelectionBar({ catalog, planet }: PlanetSelectionBarProps) {
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
    return (
      <div className="planet-selection-bar" data-testid="planet-selection-bar">
        <Icon iconKey={building.type} size={20} />
        <div className="planet-selection-bar__info">
          <strong>{name}</strong>
          <span className="planet-selection-bar__meta">
            ({building.position.x}, {building.position.y}) · {translateBuildingState(building.runtime?.state)}
          </span>
        </div>
        {ownBuilding ? (
          <div className="planet-selection-bar__actions">
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
