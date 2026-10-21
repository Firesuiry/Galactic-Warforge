/**
 * 场景 ↔ VFX 层的桥接：把场景数据整理成 VFX 层需要的输入（纯函数，可单测）。
 *
 * - `buildSelectionItems`：选中建筑 → 占地四角括号（每格一个 bracket），选中单位 →
 *   细环 + 方向三角，悬停 → 同款更淡；
 * - `buildHoloTasks`：施工任务 → 全息模型输入（建筑类型、占地、进度）；
 * - `buildSupplyAuras`：补给站/补给车 → 补给光环条目（判定口径与旧 `updateStaticMarks` 一致）。
 */

import type { PlanetThreeData } from '../../planet-three-scene';
import { getBuildingFootprint, type SelectedEntity, type TilePoint } from '../../model';
import type { Building, CatalogView, ConstructionTaskView } from '@shared/types';
import { constructionBarProgress } from '../../three/tactical-overlays';
import { surfaceOffset } from '@shared/surface';
import { SELECTION_COLORS, type SelectionItem } from './selection';
import type { HoloTask } from './construction-holo';
import { supplyAurasFrom, type SupplyAuraItem } from './supply-aura';

interface SelectionInteraction {
  selected: SelectedEntity | null;
  selectedUnits?: string[];
  hoveredTile: TilePoint | null;
  interactionMode: { kind: string };
  layers: { selection: boolean; logistics: boolean; buildings: boolean };
}

/** 建筑朝向 → 单位方向（0° = +Z 正面）。 */
function facingOf(rotation: unknown): { x: number; y: number } {
  const degrees = Number(rotation ?? 0);
  const radians = (degrees * Math.PI) / 180;
  // 与场景 `group.rotateY(-rot)` 同口径：0° 朝 +Z（南），90° 朝 +X（东）。
  return { x: Math.sin(-radians), y: Math.cos(-radians) };
}

/** 选中/悬停 → VFX 选中项（冻结时括号直接收拢完成）。 */
export function buildSelectionItems(
  data: PlanetThreeData,
  interaction: SelectionInteraction,
  _frozen: boolean,
): SelectionItem[] {
  const items: SelectionItem[] = [];
  if (!interaction.layers.selection) return items;
  const faceSize = data.planet.surface.face_size;
  const selected = interaction.selected;
  if (selected?.kind === 'building') {
    const building = data.planet.buildings?.[selected.id];
    if (building && building.hp > 0) {
      const footprint = getBuildingFootprint(building);
      const tiles: TilePoint[] = [];
      for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
        tiles.push(surfaceOffset(building.position, dx, dy, faceSize));
      }
      // 括号只画在占地**四角格**（整块每格都画会变成一格一格的虚线，读不出「选中了这个建筑」）。
      const corners = footprint.width <= 1 && footprint.height <= 1
        ? [tiles[0]]
        : [tiles[0], tiles[footprint.width - 1], tiles[tiles.length - footprint.width], tiles[tiles.length - 1]];
      for (const [index, corner] of corners.entries()) {
        items.push({
          key: `selected:${selected.id}:${index}`, tile: { x: Math.round(corner.x), y: Math.round(corner.y) },
          color: SELECTION_COLORS.footprint, kind: 'building', opacity: 0.95,
          // 只在左下角那格挂地面光晕（`footprint` 非空即画光晕）。
          footprint: index === 0 ? tiles : undefined,
        });
      }
    }
  } else if (selected?.kind === 'unit') {
    const unit = data.planet.units?.[selected.id];
    if (unit && unit.hp > 0) {
      items.push({
        key: `selected:${selected.id}`, tile: { x: Math.round(unit.position.x), y: Math.round(unit.position.y) },
        color: SELECTION_COLORS.primary, kind: 'unit', opacity: 0.95,
        direction: facingOf((unit as unknown as { rotation?: number }).rotation),
      });
    }
  }
  // 多选单位：每个单位一个细环（主选中之外追加）。
  for (const unitId of interaction.selectedUnits ?? []) {
    if (selected?.kind === 'unit' && selected.id === unitId) continue;
    const unit = data.planet.units?.[unitId];
    if (!unit || unit.hp <= 0) continue;
    items.push({
      key: `multi:${unitId}`, tile: { x: Math.round(unit.position.x), y: Math.round(unit.position.y) },
      color: SELECTION_COLORS.multi, kind: 'unit', opacity: 0.8, direction: facingOf((unit as unknown as { rotation?: number }).rotation),
    });
  }
  // 悬停：建造/攻击模式由既有色带表达（绿/红），其它模式给更淡的同款细环。
  if (interaction.hoveredTile && interaction.interactionMode.kind !== 'build' && interaction.interactionMode.kind !== 'attack') {
    items.push({
      key: 'hover', tile: interaction.hoveredTile,
      color: SELECTION_COLORS.hover, kind: 'hover', opacity: 0.45,
    });
  }
  return items;
}

/** 施工任务 → 全息输入（进度与进度条同一口径）。 */
export function buildHoloTasks(
  tasks: readonly ConstructionTaskView[],
  catalog: CatalogView | undefined,
  faceSize: number,
  known: (task: ConstructionTaskView) => boolean,
): HoloTask[] {
  void faceSize;
  const result: HoloTask[] = [];
  for (const task of tasks) {
    if (!known(task)) continue;
    // 带子/分拣器不铺地基也没有「目标模型」，不画全息（脚手架时代也不画它们）。
    if (/conveyor|sorter|splitter/.test(task.building_type)) continue;
    const definition = catalog?.buildings?.find((entry) => entry.id === task.building_type);
    const width = definition?.footprint?.width ?? 1;
    const height = definition?.footprint?.height ?? 1;
    result.push({
      id: task.id,
      buildingType: task.building_type,
      position: { x: Math.round(task.position.x), y: Math.round(task.position.y) },
      rotation: Number(task.rotation ?? 0),
      width, height,
      progress: constructionBarProgress(task),
    });
  }
  return result;
}

/** 补给光环条目（补给站按 catalog.supply_radius；补给车同理）。 */
export function buildSupplyAuras(data: PlanetThreeData): SupplyAuraItem[] {
  const buildingRadius = new Map<string, number>(data.catalog?.buildings?.map((entry) => [entry.id, entry.supply_radius ?? 0] as [string, number]) ?? []);
  const unitRadius = new Map<string, number>(data.catalog?.world_units?.map((entry) => [entry.id, entry.supply_radius ?? 0] as [string, number]) ?? []);
  return supplyAurasFrom(
    Object.values(data.planet.buildings ?? {}) as (Building & { hp: number })[],
    Object.values(data.planet.units ?? []),
    data.playerId,
    (type, kind) => (kind === 'building' ? buildingRadius.get(type) ?? 0 : unitRadius.get(type) ?? 0),
  );
}
