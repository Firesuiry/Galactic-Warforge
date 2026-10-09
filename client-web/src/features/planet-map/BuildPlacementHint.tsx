/**
 * 建造预览旁的原因标签：缺料/占位/地形等非法时跟随鼠标显示红字，2D/3D 共用。
 */
import { useEffect, useState } from 'react';

import type { CatalogView, ItemInventory, PlanetRuntimeView } from '@shared/types';

import { assessBuildTiles, describeBuildBlock, shouldBlockBuildLocally } from '@/features/planet-map/build-workflow';
import { buildGhostDirection, DIRECTION_NAMES, isSorterBuilding } from '@/features/planet-map/logistics-direction';
import { getBuildingDisplayName, getItemDisplayName, type PlanetRenderView } from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';

interface Props {
  catalog?: CatalogView;
  inventory?: ItemInventory;
  planet: PlanetRenderView;
  playerId: string;
  /** 施工任务列表：同一格已有自己的施工任务时给出本地提示（试玩 1010 G）。 */
  runtime?: PlanetRuntimeView;
}

export function BuildPlacementHint({ catalog, inventory, planet, playerId, runtime }: Props) {
  const mode = usePlanetViewStore((state) => state.interactionMode);
  const tile = usePlanetViewStore((state) => state.hoveredTile);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const building = mode.kind === 'build';

  useEffect(() => {
    if (!building) return undefined;
    const onMove = (event: PointerEvent) => setPointer({ x: event.clientX, y: event.clientY });
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [building]);

  if (mode.kind !== 'build' || !tile || !pointer) return null;
  // 施工任务（服务端权威，含 player_id）由 assessBuildTiles 一并评估：占位文案与服务端
  // constructionReservationMessage 完全同口径（「该格已有你的施工任务：传送带 Mk.I（排队中）」），
  // 不再自造「此格已有你的施工任务（pending）」这类另一套措辞（试玩 1011 E）。
  const assessment = assessBuildTiles(catalog, mode.buildingType, planet, { x: tile.x, y: tile.y, z: 0 }, playerId, mode.rotation, inventory, runtime);
  const describe = (value: NonNullable<typeof assessment>) => describeBuildBlock(
    value,
    (itemId) => getItemDisplayName(catalog, itemId),
    (buildingType) => getBuildingDisplayName(catalog, buildingType),
  );
  if (!assessment || assessment.buildable) return null;
  // 未探索区不本地拦截（是否可建只有服务端知道）：用中性提示，不显示红色「无法建造」。
  if (!shouldBlockBuildLocally(assessment)) {
    return (
      <div className="build-placement-hint build-placement-hint--unknown" role="status" style={{ left: pointer.x + 16, top: pointer.y + 14 }}>
        {describe(assessment)}
      </div>
    );
  }
  return (
    <div className="build-placement-hint" role="status" style={{ left: pointer.x + 16, top: pointer.y + 14 }}>
      无法建造：{describe(assessment)}
    </div>
  );
}
