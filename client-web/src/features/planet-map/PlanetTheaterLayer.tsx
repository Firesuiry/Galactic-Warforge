/**
 * 战区覆盖层（C4）：把战区 zones 画到行星地图上（圆圈 + 告警态）。
 *
 * zones[].position/radius（planet_id 匹配当前行星）→ SVG 圆；
 * zones[].alerted（U8 防区警戒）→ 红色脉动；指针穿透（不影响地图交互）。
 *
 * 3D（R20-A ⑥⑦）：倾斜球面上的屏幕圆与地面圆对不上，`projectTile` 模式下改为
 * **地面圆投影**——沿圆周采样格坐标再逐点投影成多边形（与拖拽预览同一画法），
 * 服务端存的是「中心 + 半径」，画出来的也就是那个圆。
 */

import type { WarTheaterView } from '@shared/types';

import {
  theaterZoneColor,
  theaterZoneTypeLabel,
} from '@/features/planet-map/squad-commands';
import { projectTheaterZoneRing } from '@/features/planet-map/planet-three-zone-ring';
import type { SquadScreenPoint } from '@/features/planet-map/PlanetSquadLayer';
import { useProjectionFrame } from '@/features/planet-map/use-projection-frame';

interface PlanetTheaterLayerProps {
  theaters?: WarTheaterView[];
  planetId: string;
  offsetX: number;
  offsetY: number;
  tileSize: number;
  /** 3D 视图投影。提供后按地面圆投影（圆周采样点逐个 project）。 */
  projectTile?: (tile: { x: number; y: number }) => SquadScreenPoint | null;
  /** 高亮：当前选中战区（3D 下画更亮的描边）。 */
  selectedTheaterId?: string;
  /** 高亮：当前悬停格落在哪个战区圆内（战区 id）。 */
  hoveredTheaterId?: string | null;
  /** 3D 下已建成的战区层压在画布上方的 z-index（默认 4；3D 画布是普通文档流，需抬高）。 */
  zIndex?: number;
}

export function PlanetTheaterLayer({
  theaters,
  planetId,
  offsetX,
  offsetY,
  tileSize,
  projectTile,
  selectedTheaterId,
  hoveredTheaterId,
  zIndex,
}: PlanetTheaterLayerProps) {
  const zones = (theaters ?? []).flatMap((theater) =>
    (theater.zones ?? [])
      .filter((zone) => zone.planet_id === planetId && zone.position)
      .map((zone) => ({ theater, zone })),
  );
  const frame = useProjectionFrame(projectTile, zones.length > 0);
  void frame;
  if (zones.length === 0) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className="planet-theater-layer"
      data-projected={projectTile ? 'true' : undefined}
      style={zIndex !== undefined ? { zIndex } : undefined}
    >
      <svg className="planet-theater-layer__svg">
        {zones.map(({ theater, zone }, index) => {
          const position = zone.position ?? { x: 0, y: 0, z: 0 };
          const radiusTiles = Math.max(zone.radius ?? 1, 1);
          const color = zone.alerted ? '#ff1744' : theaterZoneColor(zone.zone_type);
          const highlighted = theater.id === selectedTheaterId || theater.id === hoveredTheaterId;
          const ring = projectTile
            ? projectTheaterZoneRing(projectTile, { x: position.x, y: position.y }, radiusTiles)
            : null;
          if (projectTile && !ring) {
            return null;
          }
          const label = `${theater.name || theater.id} · ${theaterZoneTypeLabel(zone.zone_type)} · 敌情 ${zone.hostile_count}${zone.alerted ? ' · 告警' : ''}`;
          if (ring) {
            // 3D：地面圆多边形 + 圆心十字 + 标签挂在圆心上方。
            // 圆心投影不可见（在球背面/视口外）时只画圆环，不把十字/标签回退到左上角。
            const center = ring.center;
            return (
              <g key={`${theater.id}-zone-${index}`} data-testid={`theater-zone-ring-${theater.id}-${index}`}>
                <path
                  className={zone.alerted ? 'planet-theater-zone planet-theater-zone--alerted' : 'planet-theater-zone'}
                  d={ring.path}
                  fill={color}
                  fillOpacity={highlighted ? 0.2 : 0.1}
                  stroke={color}
                  strokeDasharray={zone.zone_type === 'no_entry' ? '10 6' : undefined}
                  strokeWidth={highlighted ? 3 : 2}
                />
                {center ? (
                  <>
                    <g className="planet-theater-zone__cross" stroke={color} strokeWidth={1.5}>
                      <line x1={center.x - 6} x2={center.x + 6} y1={center.y} y2={center.y} />
                      <line x1={center.x} x2={center.x} y1={center.y - 6} y2={center.y + 6} />
                    </g>
                    <text
                      className="planet-theater-zone__label"
                      fill={color}
                      textAnchor="middle"
                      x={center.x}
                      y={center.y - 14}
                    >
                      {label}
                    </text>
                  </>
                ) : null}
              </g>
            );
          }
          const cx = offsetX + (position.x + 0.5) * tileSize;
          const cy = offsetY + (position.y + 0.5) * tileSize;
          const radius = radiusTiles * tileSize;
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
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
