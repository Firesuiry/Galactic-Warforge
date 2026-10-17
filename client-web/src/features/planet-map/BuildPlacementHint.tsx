/**
 * 建造预览旁的原因标签：缺料/占位/地形等非法时跟随鼠标显示红字，2D/3D 共用。
 */
import { useEffect, useState } from 'react';

import type { CatalogView, ItemInventory, PlanetRuntimeView } from '@shared/types';

import { assessBuildTiles, describeBuildBlock, shouldBlockBuildLocally } from '@/features/planet-map/build-workflow';
import { buildGhostDirection, DIRECTION_NAMES, isSorterBuilding } from '@/features/planet-map/logistics-direction';
import { describeMiningCoverage } from '@/features/planet-map/mining-coverage';
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
  if (!assessment || assessment.buildable) {
    // 采集建筑（矿机/水泵/抽油机）合法落点：不再只说「有矿」，直接说清这一台会采哪种矿
    // （与服务端 model.MiningItemAt 同一套覆盖框 + 平票规则，见 §5.1）。覆盖框里混了别的
    // 矿种时给警示色 + 列出不会开采的矿——那些矿脉一格都不采（第 16 轮契约）。
    const mining = describeMiningCoverage(catalog, mode.buildingType, planet, { x: tile.x, y: tile.y, z: 0 }, mode.rotation);
    if (!mining) return null;
    return (
      <div
        className={`build-placement-hint build-placement-hint--mining${mining.mixed ? ' build-placement-hint--mining-mixed' : ''}`}
        data-testid="build-mining-hint"
        role="status"
        style={{ left: pointer.x + 16, top: pointer.y + 14 }}
      >
        {mining.text}
      </div>
    );
  }
  // 未探索区不本地拦截（是否可建只有服务端知道）：用中性提示，不显示红色「无法建造」。
  if (!shouldBlockBuildLocally(assessment)) {
    return (
      <div className="build-placement-hint build-placement-hint--unknown" role="status" style={{ left: pointer.x + 16, top: pointer.y + 14 }}>
        {describe(assessment)}
      </div>
    );
  }
  // 缺料时也要把「将开采」一起给出来（试玩 1016 摩擦 2）：玩家恰恰要先看落点会采什么矿，
  // 再决定去补料还是换位置。缺料提示不再把开采预览顶掉。
  const shortageOnly = assessment.missingItems.length > 0;
  const mining = shortageOnly
    ? describeMiningCoverage(catalog, mode.buildingType, planet, { x: tile.x, y: tile.y, z: 0 }, mode.rotation)
    : null;
  return (
    <div className="build-placement-hint" role="status" style={{ left: pointer.x + 16, top: pointer.y + 14 }}>
      <span>无法建造：{describe(assessment)}</span>
      {mining ? (
        <span
          className={`build-placement-hint__mining${mining.mixed ? ' is-mixed build-placement-hint--mining-mixed' : ''}`}
          data-testid="build-mining-hint"
        >
          {mining.text}
        </span>      ) : null}
    </div>
  );
}
