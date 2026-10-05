/**
 * 敌方军团标记层（C4）：把视野内的敌方 planet_runtime.combat_squads 画到战术图上。
 *
 * 与来袭波次指示同一模式：DOM overlay 绝对定位（指针事件只落在标记本身，
 * 空白处穿透回 Pixi 交互面）。点击标记 = 选中小队（shift=加选），
 * 选中态由标记层自绘选中环（小队会移动，不走 Pixi 的静态选中环）。
 */

import { useEffect, useState } from 'react';
import type { CombatSquad } from '@shared/types';

import { Icon } from '@/common/Icon';
import { sfx } from '@/engine/audio';

export interface SquadScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

interface PlanetSquadLayerProps {
  squads?: CombatSquad[];
  playerId: string;
  /** 视口换算：screen = offset + (tile + 0.5) * tileSize。3D 投影模式可传 0。 */
  offsetX: number;
  offsetY: number;
  tileSize: number;
  selectedSquads: readonly string[];
  onSelectSquad: (squad: CombatSquad, additive: boolean) => void;
  /** 3D 视图：把地表格投影到屏幕。提供后忽略 offset/tileSize，并逐帧刷新。 */
  projectTile?: (tile: { x: number; y: number }) => SquadScreenPoint | null;
}

/** 己方军团由 PlanetLegionLayer 绘制；本层只标记视野内有可见成员的敌方军团。 */
function visibleHostileSquads(squads: CombatSquad[] | undefined, playerId: string): CombatSquad[] {
  return (squads ?? []).filter(
    (squad) => squad.state !== 'destroyed' && squad.owner_id !== playerId && (squad.member_ids?.length ?? 0) > 0,
  );
}

export function PlanetSquadLayer({
  squads,
  playerId,
  offsetX,
  offsetY,
  tileSize,
  selectedSquads,
  onSelectSquad,
  projectTile,
}: PlanetSquadLayerProps) {
  const shown = visibleHostileSquads(squads, playerId);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!projectTile) {
      return undefined;
    }
    let raf = 0;
    const loop = () => {
      setFrame((value) => value + 1);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [projectTile]);
  if (shown.length === 0) {
    return null;
  }
  return (
    <div aria-label="战斗小队层" className="planet-squad-layer" role="group">
      {shown.map((squad) => {
        const hostile = squad.owner_id !== playerId;
        const selected = selectedSquads.includes(squad.id);
        const projected = projectTile
          ? projectTile({ x: squad.position.x, y: squad.position.y })
          : null;
        if (projectTile && (!projected || !projected.visible)) {
          return null;
        }
        const left = projected ? projected.x : offsetX + (squad.position.x + 0.5) * tileSize;
        const top = projected ? projected.y : offsetY + (squad.position.y + 0.5) * tileSize;
        void frame;
        return (
          <button
            aria-label={`${hostile ? '敌方小队' : '小队'} ${squad.id}`}
            aria-pressed={selected}
            className={`planet-squad-marker${hostile ? ' planet-squad-marker--hostile' : ''}${selected ? ' planet-squad-marker--selected' : ''}`}
            data-icon="soldier"
            data-squad-id={squad.id}
            key={squad.id}
            onClick={(event) => {
              event.stopPropagation();
              sfx.uiClick();
              onSelectSquad(squad, event.shiftKey && !hostile);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ left, top }}
            title={`${hostile ? '敌方 ' : ''}${squad.name || squad.id} ×${squad.member_ids?.length ?? 0}`}
            type="button"
          >
            <Icon iconKey="soldier" size={Math.max(14, Math.min(22, tileSize * 0.4))} />
            <span className="planet-squad-marker__count">{squad.member_ids?.length ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
