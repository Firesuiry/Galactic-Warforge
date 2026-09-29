/**
 * 战区覆盖层（C4）：把战区 zones 画到 2D 平面战术图上（圆圈 + 告警态）。
 *
 * zones[].position/radius（planet_id 匹配当前行星）→ SVG 圆；
 * zones[].alerted（U8 防区警戒）→ 红色脉动；指针穿透（不影响地图交互）。
 */

import { useEffect, useState } from 'react';
import type { WarTheaterView } from '@shared/types';

import {
  theaterZoneColor,
  theaterZoneTypeLabel,
} from '@/features/planet-map/squad-commands';
import type { SquadScreenPoint } from '@/features/planet-map/PlanetSquadLayer';

interface PlanetTheaterLayerProps {
  theaters?: WarTheaterView[];
  planetId: string;
  offsetX: number;
  offsetY: number;
  tileSize: number;
  /** 3D 视图投影。提供后圆半径取圆心与沿 X 偏移 radius 格的屏幕距离。 */
  projectTile?: (tile: { x: number; y: number }) => SquadScreenPoint | null;
}

export function PlanetTheaterLayer({
  theaters,
  planetId,
  offsetX,
  offsetY,
  tileSize,
  projectTile,
}: PlanetTheaterLayerProps) {
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
  void frame;
  const zones = (theaters ?? []).flatMap((theater) =>
    (theater.zones ?? [])
      .filter((zone) => zone.planet_id === planetId && zone.position)
      .map((zone) => ({ theater, zone })),
  );
  if (zones.length === 0) {
    return null;
  }
  return (
    <div aria-hidden="true" className="planet-theater-layer">
      <svg className="planet-theater-layer__svg">
        {zones.map(({ theater, zone }, index) => {
          const position = zone.position ?? { x: 0, y: 0, z: 0 };
          const radiusTiles = Math.max(zone.radius ?? 1, 1);
          let cx = offsetX + (position.x + 0.5) * tileSize;
          let cy = offsetY + (position.y + 0.5) * tileSize;
          let radius = radiusTiles * tileSize;
          if (projectTile) {
            const center = projectTile({ x: position.x, y: position.y });
            const edge = projectTile({ x: position.x + radiusTiles, y: position.y });
            if (!center?.visible) {
              return null;
            }
            cx = center.x;
            cy = center.y;
            radius = edge
              ? Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y))
              : 24;
          }
          const color = zone.alerted ? '#ff1744' : theaterZoneColor(zone.zone_type);
          return (
            <g key={`${theater.id}-zone-${index}`}>
              <circle
                className={zone.alerted ? 'planet-theater-zone planet-theater-zone--alerted' : 'planet-theater-zone'}
                cx={cx}
                cy={cy}
                fill={color}
                fillOpacity={0.08}
                r={radius}
                stroke={color}
                strokeDasharray={zone.zone_type === 'no_entry' ? '10 6' : undefined}
                strokeWidth={2}
              />
              <text
                className="planet-theater-zone__label"
                fill={color}
                textAnchor="middle"
                x={cx}
                y={cy - radius - 6}
              >
                {`${theater.name || theater.id} · ${theaterZoneTypeLabel(zone.zone_type)} · 敌情 ${zone.hostile_count}${zone.alerted ? ' · 告警' : ''}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
