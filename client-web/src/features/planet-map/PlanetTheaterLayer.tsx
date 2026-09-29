/**
 * 战区覆盖层（C4）：把战区 zones 画到 2D 平面战术图上（圆圈 + 告警态）。
 *
 * zones[].position/radius（planet_id 匹配当前行星）→ SVG 圆；
 * zones[].alerted（U8 防区警戒）→ 红色脉动；指针穿透（不影响地图交互）。
 */

import type { WarTheaterView } from '@shared/types';

import {
  theaterZoneColor,
  theaterZoneTypeLabel,
} from '@/features/planet-map/squad-commands';

interface PlanetTheaterLayerProps {
  theaters?: WarTheaterView[];
  planetId: string;
  offsetX: number;
  offsetY: number;
  tileSize: number;
}

export function PlanetTheaterLayer({
  theaters,
  planetId,
  offsetX,
  offsetY,
  tileSize,
}: PlanetTheaterLayerProps) {
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
          const cx = offsetX + (position.x + 0.5) * tileSize;
          const cy = offsetY + (position.y + 0.5) * tileSize;
          const radius = Math.max(zone.radius ?? 1, 1) * tileSize;
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
