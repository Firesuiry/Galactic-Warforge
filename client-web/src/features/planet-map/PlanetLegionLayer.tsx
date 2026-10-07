/**
 * 军团标记层（3.4）：地图上画军团标记（成员质心）与指令箭头（attack/defend/retreat -> target）。
 * 2D 用 offset+tileSize 换算，3D 传 projectTile 并逐帧刷新。标记点击 = 选中全部成员。
 */

import type { CombatSquad } from '@shared/types';

import { Icon } from '@/common/Icon';
import { sfx } from '@/engine/audio';
import { useProjectionFrame } from '@/features/planet-map/use-projection-frame';
import type { SquadScreenPoint } from '@/features/planet-map/PlanetSquadLayer';
import {
  LEGION_ARROW_COLOR,
  LEGION_ORDER_LABEL,
  legionArrow,
  legionCenter,
  ownLegions,
  type LegionUnits,
} from '@/features/planet-map/legion-model';

interface PlanetLegionLayerProps {
  squads?: CombatSquad[];
  units: LegionUnits;
  playerId: string;
  offsetX: number;
  offsetY: number;
  tileSize: number;
  onSelectLegion: (legion: CombatSquad) => void;
  projectTile?: (tile: { x: number; y: number }) => SquadScreenPoint | null;
}

export function PlanetLegionLayer({
  squads, units, playerId, offsetX, offsetY, tileSize, onSelectLegion, projectTile,
}: PlanetLegionLayerProps) {
  const legions = ownLegions(squads, playerId);
  useProjectionFrame(projectTile, legions.length > 0);
  if (legions.length === 0) return null;

  const toScreen = (p: { x: number; y: number }) => {
    if (projectTile) {
      const projected = projectTile({ x: p.x, y: p.y });
      return projected?.visible ? { x: projected.x, y: projected.y } : null;
    }
    return { x: offsetX + (p.x + 0.5) * tileSize, y: offsetY + (p.y + 0.5) * tileSize };
  };

  return (
    <div aria-label="军团层" className="planet-legion-layer" role="group">
      <svg className="planet-legion-layer__arrows" aria-hidden="true">
        <defs>
          {(['attack', 'defend', 'retreat'] as const).map((order) => (
            <marker id={`legion-arrow-${order}`} key={order} markerHeight="8" markerWidth="8" orient="auto" refX="6" refY="4">
              <path d="M0,0 L8,4 L0,8 z" fill={LEGION_ARROW_COLOR[order]} />
            </marker>
          ))}
        </defs>
        {legions.map((legion) => {
          const arrow = legionArrow(legion, units);
          const a = arrow && toScreen(arrow.from);
          const b = arrow && toScreen(arrow.to);
          if (!arrow || !a || !b) return null;
          return (
            <line
              data-legion-arrow={legion.id}
              data-order={arrow.order}
              key={legion.id}
              markerEnd={`url(#legion-arrow-${arrow.order})`}
              stroke={LEGION_ARROW_COLOR[arrow.order]}
              strokeDasharray="6 4"
              strokeWidth={2}
              x1={a.x} x2={b.x} y1={a.y} y2={b.y}
            />
          );
        })}
      </svg>
      {legions.map((legion) => {
        const p = toScreen(legionCenter(legion, units));
        if (!p) return null;
        const order = LEGION_ORDER_LABEL[legion.order ?? 'idle'];
        return (
          <button
            aria-label={`军团 ${legion.name || legion.id}`}
            className="planet-legion-marker"
            data-legion-id={legion.id}
            key={legion.id}
            onClick={(event) => {
              event.stopPropagation();
              sfx.uiClick();
              onSelectLegion(legion);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ left: p.x, top: p.y }}
            title={`${legion.name || legion.id} · ${order} · ${legion.member_ids?.length ?? 0} 名成员`}
            type="button"
          >
            <Icon iconKey="fleet" size={14} />
            <span className="planet-legion-marker__label">{legion.name || legion.id} · {order}</span>
          </button>
        );
      })}
    </div>
  );
}
