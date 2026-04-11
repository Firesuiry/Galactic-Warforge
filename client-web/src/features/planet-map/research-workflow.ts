import type {
  CatalogView,
  ItemAmount,
  TechCatalogEntry,
  TechQueueEntry,
  TechState,
  TechUnlock,
} from "@shared/types";

import {
  getBuildingDisplayName,
  getItemDisplayName,
  getRecipeDisplayName,
  getTechDisplayName,
} from "@/features/planet-map/model";

export interface ResearchTechCard {
  id: string;
  name: string;
  level: number;
  prerequisiteLabels: string[];
  missingPrerequisiteLabels: string[];
  costLabels: string[];
  unlockLabels: string[];
}

export interface CurrentResearchCard extends ResearchTechCard {
  progress: number;
  totalCost: number;
  blockedReason?: string;
  blockedReasonLabel?: string;
}

export interface StarterGuideCard {
  highlightedTechId: string;
  steps: string[];
}

export interface ResearchWorkflowGroups {
  current: CurrentResearchCard | null;
  available: ResearchTechCard[];
  completed: ResearchTechCard[];
  locked: ResearchTechCard[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
      ? Number(value)
      : undefined;
}

function sortTechs(left: TechCatalogEntry, right: TechCatalogEntry) {
  if (left.level !== right.level) {
    return left.level - right.level;
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

function formatCostLabel(catalog: CatalogView | undefined, cost: ItemAmount) {
  return `${getItemDisplayName(catalog, cost.item_id)} x${cost.quantity}`;
}

function translateResearchBlockedReason(blockedReason?: string) {
  switch (blockedReason) {
    case "waiting_lab":
      return "缺少运行中的研究站";
    case "waiting_matrix":
      return "缺少所需矩阵";
    case "invalid_tech":
      return "科技数据无效";
    default:
      return blockedReason || "";
  }
}

function deriveTechCard(
  catalog: CatalogView | undefined,
  tech: TechCatalogEntry,
  completedTechIds: Set<string>,
): ResearchTechCard {
  const missingPrerequisiteLabels = (tech.prerequisites ?? [])
    .filter((techId) => !completedTechIds.has(techId))
    .map((techId) => getTechDisplayName(catalog, techId));

  return {
    id: tech.id,
    name: getTechDisplayName(catalog, tech.id),
    level: tech.level,
    prerequisiteLabels: (tech.prerequisites ?? []).map((techId) =>
      getTechDisplayName(catalog, techId),
    ),
    missingPrerequisiteLabels,
    costLabels: (tech.cost ?? []).map((cost) => formatCostLabel(catalog, cost)),
    unlockLabels: (tech.unlocks ?? []).map((unlock) =>
      formatTechUnlockLabel(catalog, unlock),
    ),
  };
}

function deriveCurrentResearchCard(
  catalog: CatalogView | undefined,
  techState: TechState,
  completedTechIds: Set<string>,
): CurrentResearchCard | null {
  const currentResearch = techState.current_research;
  if (!currentResearch?.tech_id) {
    return null;
  }

  const tech = (catalog?.techs ?? []).find((entry) => entry.id === currentResearch.tech_id);
  if (!tech) {
    return {
      id: currentResearch.tech_id,
      name: getTechDisplayName(catalog, currentResearch.tech_id),
      level: currentResearch.current_level ?? 0,
      prerequisiteLabels: [],
      missingPrerequisiteLabels: [],
      costLabels: (currentResearch.required_cost ?? []).map((cost) =>
        formatCostLabel(catalog, cost),
      ),
      unlockLabels: [],
      progress: currentResearch.progress,
      totalCost: currentResearch.total_cost,
      blockedReason: currentResearch.blocked_reason,
      blockedReasonLabel: translateResearchBlockedReason(
        currentResearch.blocked_reason,
      ),
    };
  }

  return {
    ...deriveTechCard(catalog, tech, completedTechIds),
    progress: currentResearch.progress,
    totalCost: currentResearch.total_cost,
    blockedReason: currentResearch.blocked_reason,
    blockedReasonLabel: translateResearchBlockedReason(
      currentResearch.blocked_reason,
    ),
  };
}

export function normalizeCompletedTechIds(
  techState?: Pick<TechState, "completed_techs"> | null,
) {
  const completedTechs = techState?.completed_techs;
  if (Array.isArray(completedTechs)) {
    return [...new Set(completedTechs.filter((techId): techId is string => typeof techId === "string"))];
  }

  const legacyMap = asRecord(completedTechs);
  if (!legacyMap) {
    return [];
  }

  return Object.entries(legacyMap)
    .filter(([, level]) => (asNumber(level) ?? 0) > 0)
    .map(([techId]) => techId);
}

export function formatTechUnlockLabel(
  catalog: CatalogView | undefined,
  unlock: TechUnlock,
) {
  const levelSuffix = unlock.level && unlock.level > 1
    ? ` Lv.${unlock.level}`
    : "";

  switch (unlock.type) {
    case "building":
      return `${getBuildingDisplayName(catalog, unlock.id)}${levelSuffix}`;
    case "recipe":
      return `${getRecipeDisplayName(catalog, unlock.id)}${levelSuffix}`;
    case "unit":
      return `单位解锁：${unlock.id}${levelSuffix}`;
    case "upgrade":
      return `升级：${unlock.id}${levelSuffix}`;
    case "special":
      return `特殊解锁：${unlock.id}${levelSuffix}`;
    default:
      return `${unlock.type}：${unlock.id}${levelSuffix}`;
  }
}

export function deriveResearchGroups(
  catalog: CatalogView | undefined,
  techState?: TechState,
): ResearchWorkflowGroups {
  const completedTechIds = new Set(normalizeCompletedTechIds(techState));
  const currentTechId = techState?.current_research?.tech_id ?? "";
  const techEntries = [...(catalog?.techs ?? [])]
    .filter((tech) => !tech.hidden)
    .sort(sortTechs);

  const available: ResearchTechCard[] = [];
  const completed: ResearchTechCard[] = [];
  const locked: ResearchTechCard[] = [];

  for (const tech of techEntries) {
    if (completedTechIds.has(tech.id)) {
      completed.push(deriveTechCard(catalog, tech, completedTechIds));
      continue;
    }

    if (tech.id === currentTechId) {
      continue;
    }

    const isAvailable = (tech.prerequisites ?? []).every((techId) =>
      completedTechIds.has(techId),
    );
    if (isAvailable) {
      available.push(deriveTechCard(catalog, tech, completedTechIds));
      continue;
    }

    locked.push(deriveTechCard(catalog, tech, completedTechIds));
  }

  return {
    current: techState
      ? deriveCurrentResearchCard(catalog, techState, completedTechIds)
      : null,
    available,
    completed,
    locked,
  };
}

export function buildStarterGuide(
  techState?: TechState | null,
): StarterGuideCard | null {
  const completedTechIds = new Set(normalizeCompletedTechIds(techState));
  if (completedTechIds.has("electromagnetism")) {
    return null;
  }

  return {
    highlightedTechId: "electromagnetism",
    steps: [
      "风机",
      "空研究站",
      "装 10 电磁矩阵",
      "研究 electromagnetism",
    ],
  };
}

export function getResearchProgressPercent(currentResearch?: TechQueueEntry | null) {
  if (!currentResearch?.total_cost) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(100, Math.round((currentResearch.progress / currentResearch.total_cost) * 100)),
  );
}
