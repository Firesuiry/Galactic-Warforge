import { TRANSLATIONS } from "@/i18n/translation-config";

function hasDisplayName(value: string | undefined | null) {
  return Boolean(value && value.trim() !== "");
}

function isProbablyChinese(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

export function translateByDictionary(
  dictionary: Record<string, string>,
  value: string | undefined | null,
  fallback = "-",
) {
  if (!value) {
    return fallback;
  }
  return dictionary[value] ?? value;
}

function translateCatalogBackedValue(
  dictionary: Record<string, string>,
  value: string,
  displayName?: string,
) {
  if (hasDisplayName(displayName) && displayName && isProbablyChinese(displayName)) {
    return displayName;
  }
  const translated = dictionary[value];
  if (translated) {
    return translated;
  }
  // 字典未命中时回退到 catalog 的英文名（如 "Wind Turbine"），
  // 避免界面直接暴露下划线原始 ID（如 wind_turbine）。
  if (hasDisplayName(displayName) && displayName) {
    return displayName;
  }
  return value;
}

export function translatePlanetKind(kind: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.planetKind, kind, TRANSLATIONS.ui.unknown);
}

export function translateBuildingType(
  buildingType: string,
  displayName?: string,
) {
  return translateCatalogBackedValue(
    TRANSLATIONS.buildingType,
    buildingType,
    displayName,
  );
}

/** 建筑目录分组名（建造栏分组标题）：词典未命中时回退原始 category 字符串。 */
export function translateBuildingCategory(category: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.buildingCategory, category, TRANSLATIONS.ui.unknown);
}

export function translateItemId(itemId: string, displayName?: string) {
  return translateCatalogBackedValue(TRANSLATIONS.itemId, itemId, displayName);
}

/**
 * 物品 id → 中文名（界面用，绝不回退裸 id）。
 * 优先级与 translateCatalogBackedValue 一致：目录中文名 > 词典；
 * 两者都没有时回退中性词「物品」，避免把 ammo_bullet 这类内部 id 写进文案。
 */
export function translateItemIdSafe(itemId: string | undefined | null, displayName?: string) {
  if (!itemId) {
    return TRANSLATIONS.ui.unknown;
  }
  if (hasDisplayName(displayName) && displayName && isProbablyChinese(displayName)) {
    return displayName;
  }
  const translated = TRANSLATIONS.itemId[itemId as keyof typeof TRANSLATIONS.itemId];
  if (translated) {
    return translated;
  }
  if (hasDisplayName(displayName) && displayName) {
    return displayName;
  }
  return TRANSLATIONS.ui.item;
}

export function translateTechId(techId: string, displayName?: string) {
  return translateCatalogBackedValue(TRANSLATIONS.techId, techId, displayName);
}

export function translateUnitType(unitType: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.unitType, unitType, TRANSLATIONS.ui.unknown);
}

/**
 * 单位类型词典命中（未命中返回 null）。
 * 事件摘要用它区分「目录/词典里有中文名」与「只是个内部枚举 id」，
 * 后者一律回退中性词，不把 enemy_force 这类 snake_case 写进界面。
 */
export function translateUnitTypeOrNull(unitType: string | undefined | null): string | null {
  if (!unitType) return null;
  return TRANSLATIONS.unitType[unitType as keyof typeof TRANSLATIONS.unitType] ?? null;
}

/** 建筑类型词典命中（未命中返回 null，语义同 translateUnitTypeOrNull）。 */
export function translateBuildingTypeOrNull(buildingType: string | undefined | null): string | null {
  if (!buildingType) return null;
  return TRANSLATIONS.buildingType[buildingType as keyof typeof TRANSLATIONS.buildingType] ?? null;
}

/** 单位类型 id → 中文名：词典优先，其次目录中文名，最后回退中性词（不暴露 soldier 这类 id）。 */
export function translateUnitTypeWithName(
  unitType: string | undefined | null,
  displayName?: string,
) {
  if (!unitType) {
    return TRANSLATIONS.ui.unknown;
  }
  const translated = TRANSLATIONS.unitType[unitType as keyof typeof TRANSLATIONS.unitType];
  if (translated) {
    return translated;
  }
  if (hasDisplayName(displayName) && displayName && isProbablyChinese(displayName)) {
    return displayName;
  }
  return TRANSLATIONS.ui.unknown;
}

/**
 * 配方 id → 中文名：没有配方词典，只有目录中文名可用；
 * 目录缺名时回退中性词（配方 id 一律是 snake_case 英文，不上界面）。
 */
export function translateRecipeId(recipeId: string, displayName?: string) {
  if (!recipeId) {
    return TRANSLATIONS.ui.unknown;
  }
  if (hasDisplayName(displayName) && displayName && isProbablyChinese(displayName)) {
    return displayName;
  }
  return hasDisplayName(displayName) && displayName ? displayName : TRANSLATIONS.ui.unknown;
}

export function translateEventType(eventType: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.eventType, eventType, "事件已记录");
}

export function translateAlertType(
  alertType: string | undefined | null,
  fallback: string = TRANSLATIONS.ui.unknown,
) {
  return translateByDictionary(TRANSLATIONS.alertType, alertType, fallback);
}

export function translateSeverity(severity: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.severity, severity, TRANSLATIONS.ui.unknown);
}

export function translateBuildingState(state: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.buildingState, state, TRANSLATIONS.ui.unknown);
}

export function translatePowerCoverageReason(reason: string | undefined | null) {
  return translateByDictionary(
    TRANSLATIONS.powerCoverageReason,
    reason,
    TRANSLATIONS.ui.unknown,
  );
}

export function translateDirection(direction: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.direction, direction, TRANSLATIONS.ui.unknown);
}

export function translateLogisticsScope(scope: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.logisticsScope, scope, TRANSLATIONS.ui.unknown);
}

export function translateLogisticsMode(mode: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.logisticsMode, mode, TRANSLATIONS.ui.unknown);
}

export function translateCommandType(commandType: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.commandType, commandType, TRANSLATIONS.ui.unknown);
}

export function translateAgentStatus(status: string | undefined | null) {
  return translateByDictionary(
    TRANSLATIONS.agentStatus,
    status,
    TRANSLATIONS.ui.unknown,
  );
}

export function translateAgentMessageKind(kind: string | undefined | null) {
  return translateByDictionary(
    TRANSLATIONS.agentMessageKind,
    kind,
    TRANSLATIONS.ui.unknown,
  );
}

export function translateAgentCommandCategory(
  category: string | undefined | null,
) {
  return translateByDictionary(
    TRANSLATIONS.agentCommandCategory,
    category,
    TRANSLATIONS.ui.unknown,
  );
}

export function translateUi(key: string) {
  return TRANSLATIONS.ui[key as keyof typeof TRANSLATIONS.ui] ?? key;
}
