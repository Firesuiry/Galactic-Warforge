/**
 * 可生产单位（world_produce）与生产建筑的配对规则。
 *
 * 服务端 `execProduce` 的校验链（unit_production.go）：
 *   1. 建筑必须存在且属于自己；
 *   2. `unit_type` 必须在 PublicWorldProduceUnitByID 里（目录 production_mode = world_produce）；
 *   3. **建筑的类型必须等于该单位的 `producer`**（不是任意「能生产单位」的建筑）；
 *   4. 单位若带 unlock_tech 还要已研究。
 *
 * 前端两个入口（工作台「建筑量产」表单、建筑详情「单位生产」区块）必须用同一套配对，
 * 否则玩家会看到「生产」按钮却拿到服务端的「X 需由 Y 生产」回执。
 */

import type { CatalogView, WorldUnitCatalogEntry } from '@shared/types';

/** 目录里可量产的单位（production_mode = world_produce）。 */
export function listWorldProduceUnits(catalog: CatalogView | undefined): WorldUnitCatalogEntry[] {
  return (catalog?.world_units ?? []).filter((unit) => unit.production_mode === 'world_produce');
}

/** 某个建筑类型能生产的单位（`unit.producer === buildingType`）。 */
export function listUnitsForBuildingType(
  catalog: CatalogView | undefined,
  buildingType: string,
): WorldUnitCatalogEntry[] {
  return listWorldProduceUnits(catalog).filter((unit) => unit.producer === buildingType);
}

/**
 * 该建筑类型是否是某种 world_produce 单位的 `producer`。
 *
 * 与目录 `can_produce_units` 标记取并集：标记是服务端权威，但运输机器人的生产建筑是
 * HQ（战场分析基站），它的目录条目不一定带标记——只看标记会漏掉唯一的生产建筑。
 */
export function isUnitProducerBuilding(
  catalog: CatalogView | undefined,
  buildingType: string,
): boolean {
  if ((catalog?.buildings ?? []).some((entry) => entry.id === buildingType && entry.can_produce_units)) {
    return true;
  }
  return listWorldProduceUnits(catalog).some((unit) => unit.producer === buildingType);
}

/**
 * 「生产建筑」下拉的候选顺序：**全部己方建筑**，但真正的生产建筑排在前面。
 *
 * 刻意不做过滤——服务端的配对校验本身就是玩法反馈的一部分（选错建筑会拿到
 * 「步兵需由兵营生产」的中文回执），过滤掉会让玩家既选不到、也看不到原因；
 * 排前面 + 选项上标注「可量产」既给了正确的默认选择，又保留了这条反馈路径。
 */
export function orderBuildingsForProduce<T extends { type: string }>(
  catalog: CatalogView | undefined,
  ownBuildings: readonly T[],
): T[] {
  const producers = ownBuildings.filter((building) => isUnitProducerBuilding(catalog, building.type));
  const others = ownBuildings.filter((building) => !isUnitProducerBuilding(catalog, building.type));
  return [...producers, ...others];
}
