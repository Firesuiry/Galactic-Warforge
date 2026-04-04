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
  return translateByDictionary(dictionary, value);
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

export function translateItemId(itemId: string, displayName?: string) {
  return translateCatalogBackedValue(TRANSLATIONS.itemId, itemId, displayName);
}

export function translateTechId(techId: string, displayName?: string) {
  return translateCatalogBackedValue(TRANSLATIONS.techId, techId, displayName);
}

export function translateUnitType(unitType: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.unitType, unitType, TRANSLATIONS.ui.unknown);
}

export function translateEventType(eventType: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.eventType, eventType, "事件已记录");
}

export function translateAlertType(alertType: string | undefined | null) {
  return translateByDictionary(TRANSLATIONS.alertType, alertType, TRANSLATIONS.ui.unknown);
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
