/**
 * 缺电/停机标记层（试玩 1010 F）：把己方 `no_power` / `error` 的建筑在 2D 战术图上标出来。
 *
 * 与小队/军团标记层同一模式：DOM overlay 绝对定位、指针穿透（不挡地图操作）。
 * 3D 视图由 planet-three-scene 的 billboard 角标承担，本层只在 2D 视图渲染。
 * 石矿机缺电 50 分钟玩家没发现（试玩报告 F）——建筑详情里写了「缺电」但要主动点开才看得到。
 */

import { Icon } from '@/common/Icon';
import { unpoweredBuildings } from '@/features/planet-map/power-status';
import type { PlanetRenderView } from '@/features/planet-map/model';
import type { PlanetNetworksView } from '@shared/types';

interface PlanetPowerAlertLayerProps {
  planet: PlanetRenderView;
  playerId: string;
  networks?: PlanetNetworksView;
  /** 视口换算：screen = offset + (tile + 0.5) * tileSize。 */
  offsetX: number;
  offsetY: number;
  tileSize: number;
}

export function PlanetPowerAlertLayer({
  planet,
  playerId,
  networks,
  offsetX,
  offsetY,
  tileSize,
}: PlanetPowerAlertLayerProps) {
  const stalled = unpoweredBuildings(planet, playerId, networks);
  if (stalled.length === 0) {
    return null;
  }
  return (
    <div aria-label="缺电建筑层" className="planet-power-alert-layer" role="group">
      {stalled.map((building) => (
        <span
          className="planet-power-alert-marker"
          data-building-id={building.id}
          key={building.id}
          style={{
            left: offsetX + (building.x + 0.5) * tileSize,
            top: offsetY + (building.y + 0.5) * tileSize,
            fontSize: Math.max(10, Math.min(20, tileSize * 0.5)),
          }}
          title={`缺电：${building.id}（${building.x}, ${building.y}）`}
        >
          <Icon iconKey="power" size={Math.max(10, Math.min(18, tileSize * 0.45))} />
        </span>
      ))}
    </div>
  );
}
