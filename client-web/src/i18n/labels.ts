/**
 * 界面文案统一出口（i18n 标签层）。
 *
 * 目标：前端任何地方都不显示英文 id 与裸字段名（building_id / enemy_difficulty /
 * soldier / iron_ingot …）。所有「目录 id → 中文名」的推导都走这里，
 * 组件只调用这些函数，不再各自拼 id。
 *
 * 与 `@/features/planet-map/model` 的 getXxxDisplayName 的关系：
 * 那一组需要 catalog 才能取到目录里的中文名；本模块是它的兜底与补充——
 * 目录未加载 / 事件 payload 只带 id 时，仍按内置词典给出中文，最差回退中性词，
 * 绝不把 `wind_turbine`、`b-92` 这类原始串写进界面。
 */

import {
  translateAlertType,
  translateBuildingCategory,
  translateBuildingState,
  translateBuildingType,
  translateDirection,
  translateItemId,
  translateRecipeId,
  translateSeverity,
  translateTechId,
  translateUnitType,
  translateUnitTypeWithName,
} from "@/i18n/translate";

/** 未知内容的统一占位（不暴露 id）。 */
export const UNKNOWN_LABEL = "未知";

/**
 * 实体 id → 类别中文（`b-92` → 建筑、`u-7` → 单位）。
 * 前缀规则与服务端实体命名一致；识别不出时返回空串，由调用方决定回退。
 */
export function entityKindLabel(entityId: string | undefined | null): string {
  const id = (entityId ?? "").trim();
  if (!id) return "";
  if (id.startsWith("b-")) return "建筑";
  if (id.startsWith("u-")) return "单位";
  if (id.startsWith("sq-") || id.startsWith("legion-")) return "军团";
  if (id.startsWith("fleet-")) return "舰队";
  if (id.startsWith("df-")) return "黑雾";
  if (id.startsWith("planet-")) return "行星";
  if (id.startsWith("sys-") || id.startsWith("system-")) return "星系";
  return "";
}

/** 建筑 id → 中文名（目录中文名 > 内置词典 > 中性词）。 */
export function buildingLabel(
  buildingType: string | undefined | null,
  catalogName?: string,
): string {
  if (!buildingType) return UNKNOWN_LABEL;
  return translateBuildingType(buildingType, catalogName);
}

/** 物品 id → 中文名。 */
export function itemLabel(itemId: string | undefined | null, catalogName?: string): string {
  if (!itemId) return UNKNOWN_LABEL;
  return translateItemId(itemId, catalogName);
}

/** 配方 id → 中文名。 */
export function recipeLabel(recipeId: string | undefined | null, catalogName?: string): string {
  if (!recipeId) return UNKNOWN_LABEL;
  return translateRecipeId(recipeId, catalogName);
}

/** 科技 id → 中文名。 */
export function techLabel(techId: string | undefined | null, catalogName?: string): string {
  if (!techId) return UNKNOWN_LABEL;
  return translateTechId(techId, catalogName);
}

/** 单位类型 id → 中文名。 */
export function unitLabel(unitType: string | undefined | null, catalogName?: string): string {
  return translateUnitTypeWithName(unitType, catalogName);
}

/** 物品数量文案：`铁块 × 2`（列表用）。 */
export function formatItemAmounts(
  amounts: Array<{ item_id: string; quantity: number }> | undefined,
  nameOf: (itemId: string) => string = itemLabel,
  separator = "、",
): string {
  return (amounts ?? [])
    .map((amount) => `${nameOf(amount.item_id)} ×${amount.quantity}`)
    .join(separator);
}

/** 告警/难度/状态/方向等枚举文案的统一入口。 */
export const enumLabels = {
  alert: translateAlertType,
  buildingCategory: translateBuildingCategory,
  buildingState: translateBuildingState,
  difficulty: translateSeverity,
  direction: translateDirection,
} as const;
