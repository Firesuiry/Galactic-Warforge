/**
 * 战斗小队标记层（C4）：把 planet_runtime.combat_squads 画到 2D 平面战术图上。
 *
 * 与来袭波次指示同一模式：DOM overlay 绝对定位（指针事件只落在标记本身，
 * 空白处穿透回 Pixi 交互面）。点击标记 = 选中小队（shift=加选），
 * 选中态由标记层自绘选中环（小队会移动，不走 Pixi 的静态选中环）。
 */

import type { CombatSquad } from '@shared/types';

import { Icon } from '@/common/Icon';
import { ownCombatSquads } from '@/features/planet-map/squad-commands';
import { sfx } from '@/engine/audio';

interface PlanetSquadLayerProps {
  squads?: CombatSquad[];
  playerId: string;
  /** 视口换算：screen = offset + (tile + 0.5) * tileSize。 */
  offsetX: number;
  offsetY: number;
  tileSize: number;
  selectedSquads: readonly string[];
  onSelectSquad: (squad: CombatSquad, additive: boolean) => void;
}

/** 小队域 → 图标 key（空军/地面区分剪影；图标库无军事机设图，借相近意象）。 */
function squadIconKey(squad: CombatSquad): string {
  return 'soldier';
}

export function PlanetSquadLayer({
  squads,
  playerId,
  offsetX,
  offsetY,
  tileSize,
  selectedSquads,
  onSelectSquad,
}: PlanetSquadLayerProps) {
  const own = ownCombatSquads(squads, playerId);
  if (own.length === 0) {
    return null;
  }
  return (
    <div aria-label="战斗小队层" className="planet-squad-layer" role="group">
      {own.map((squad) => {
        const selected = selectedSquads.includes(squad.id);
        const hpRatio = squad.max_hp > 0 ? squad.hp / squad.max_hp : 0;
        return (
          <button
            aria-label={`小队 ${squad.id}`}
            aria-pressed={selected}
            className={`planet-squad-marker${selected ? ' planet-squad-marker--selected' : ''}`}
            data-squad-id={squad.id}
            key={squad.id}
            onClick={(event) => {
              event.stopPropagation();
              sfx.uiClick();
              onSelectSquad(squad, event.shiftKey);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              left: offsetX + (squad.position.x + 0.5) * tileSize,
              top: offsetY + (squad.position.y + 0.5) * tileSize,
            }}
            title={`${squad.blueprint_id} ×${squad.count} · HP ${squad.hp}/${squad.max_hp}`}
            type="button"
          >
            <Icon iconKey={squadIconKey(squad)} size={Math.max(14, Math.min(22, tileSize * 0.4))} />
            <span className="planet-squad-marker__count">{squad.count}</span>
            <span
              aria-hidden="true"
              className="planet-squad-marker__hp"
              style={{ width: `${Math.max(0, Math.min(1, hpRatio)) * 100}%` }}
            />
          </button>
        );
      })}
    </div>
  );
}
