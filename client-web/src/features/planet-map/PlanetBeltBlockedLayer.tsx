/**
 * 传送带堵塞标记（试玩 1016 B1/U7）：`belt_blocked` 告警指向带格，
 * 在 2D 战术图上画一道红色短杠（与 U7 死端短杠同一颜色与位置口径）。
 *
 * 与 PlanetPowerAlertLayer 同一模式：DOM overlay 绝对定位、指针穿透（不挡地图操作）。
 * 3D 视图由 planet-three-scene 的贴地色带承担（同一份 blockedBeltMarks 判定）。
 */

import type { AlertEntry, Building } from '@shared/types';

import { blockedBeltMarks } from '@/features/planet-map/belt-blocked-marks';
import { directionVector, isCardinalDirection } from '@/features/planet-map/logistics-direction';

interface PlanetBeltBlockedLayerProps {
  /** 服务端当前仍成立的产线告警（含 `belt_blocked`）。 */
  alerts: readonly AlertEntry[] | undefined;
  /** 视口内的建筑（判定该格上是否真有带子）。 */
  buildings: readonly Building[];
  /** 视口换算：screen = offset + (tile + 0.5) * tileSize。 */
  offsetX: number;
  offsetY: number;
  tileSize: number;
}

export function PlanetBeltBlockedLayer({
  alerts,
  buildings,
  offsetX,
  offsetY,
  tileSize,
}: PlanetBeltBlockedLayerProps) {
  const marks = blockedBeltMarks(alerts, buildings);
  if (marks.length === 0) {
    return null;
  }
  const arm = Math.max(4, tileSize * 0.3);
  return (
    <div aria-label="传送带堵塞标记层" className="planet-belt-blocked-layer" role="group">
      {marks.map((mark) => {
        const output = mark.belt.conveyor?.output;
        // 短杠垂直于流向（与 U7 死端短杠同一画法）；方向未知（auto）时画横杠。
        const vector = isCardinalDirection(output) ? directionVector(output) : { x: 1, y: 0 };
        return (
          <span
            aria-hidden="true"
            className="planet-belt-blocked-marker"
            data-alert-id={mark.alertId}
            data-building-id={mark.belt.id}
            data-tile-x={mark.tile.x}
            data-tile-y={mark.tile.y}
            key={mark.alertId}
            style={{
              left: offsetX + (mark.tile.x + 0.5) * tileSize,
              top: offsetY + (mark.tile.y + 0.5) * tileSize,
              width: arm * 2,
              transform: `translate(-50%, -50%) rotate(${Math.atan2(vector.x, vector.y)}rad)`,
            }}
            title={`传送带堵塞（${mark.tile.x}, ${mark.tile.y}）${mark.queuedItems !== undefined ? `：${mark.queuedItems} 件货` : ''}`}
          />
        );
      })}
    </div>
  );
}
