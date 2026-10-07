/**
 * 建造预览旁的原因标签：缺料/占位/地形等非法时跟随鼠标显示红字，2D/3D 共用。
 */
import { useEffect, useState } from 'react';

import type { CatalogView, ItemInventory } from '@shared/types';

import { assessBuildTiles, describeBuildBlock } from '@/features/planet-map/build-workflow';
import { getItemDisplayName, type PlanetRenderView } from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';

interface Props {
  catalog?: CatalogView;
  inventory?: ItemInventory;
  planet: PlanetRenderView;
  playerId: string;
}

export function BuildPlacementHint({ catalog, inventory, planet, playerId }: Props) {
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
  const assessment = assessBuildTiles(catalog, mode.buildingType, planet, { x: tile.x, y: tile.y, z: 0 }, playerId, mode.rotation, inventory);
  if (!assessment || assessment.buildable) return null;
  return (
    <div className="build-placement-hint" role="status" style={{ left: pointer.x + 16, top: pointer.y + 14 }}>
      无法建造：{describeBuildBlock(assessment, (itemId) => getItemDisplayName(catalog, itemId))}
    </div>
  );
}
