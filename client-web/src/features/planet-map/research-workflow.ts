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

export interface ResearchCostLine {
  itemId: string;
  itemName: string;
  /** 结算要求的总量（required_cost，已含本局研究倍率）。 */
  required: number;
  /** 已装入研究站的量（consumed_cost）。 */
  consumed: number;
  /** 还差多少（>=0）。 */
  missing: number;
}

export interface CurrentResearchCard extends ResearchTechCard {
  progress: number;
  totalCost: number;
  blockedReason?: string;
  blockedReasonLabel?: string;
  /**
   * 逐项成本对照（已装入 / 需要 / 还差）。
   * 口径是服务端结算的 required_cost / consumed_cost，不用 catalog 里的目录成本——
   * 目录成本不含 pace_research 倍率时会让玩家按错的数字装矩阵（试玩报告阻断级 #3）。
   */
  costLines: ResearchCostLine[];
  /** waiting_matrix 时的缺口文案：「研究站缺 50 个电磁矩阵（已装入 10 / 需要 60）」。 */
  matrixShortageNotice?: string;
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
    case "low_power":
      return "研究站供电不足，研究降速或停滞";
    case "waiting_matrix":
      return "研究站缺少所需矩阵";
    case "invalid_tech":
      return "科技数据无效";
    default:
      return blockedReason || "";
  }
}

/**
 * 逐项成本对照：以结算字段 required_cost / consumed_cost 为准，
 * 不用 catalog 的目录成本（目录成本不含 pace_research 倍率）。
 */
export function buildResearchCostLines(
  catalog: CatalogView | undefined,
  research: Pick<TechQueueEntry, "required_cost" | "consumed_cost">,
): ResearchCostLine[] {
  const consumed = research.consumed_cost ?? {};
  return (research.required_cost ?? []).map((cost) => {
    const already = consumed[cost.item_id] ?? 0;
    return {
      itemId: cost.item_id,
      itemName: getItemDisplayName(catalog, cost.item_id),
      required: cost.quantity,
      consumed: already,
      missing: Math.max(0, cost.quantity - already),
    };
  });
}

/** waiting_matrix 的缺口提示：「研究站缺 50 个电磁矩阵（已装入 10 / 需要 60）」。 */
function formatMatrixShortage(lines: ResearchCostLine[]): string | undefined {
  const short = lines.filter((line) => line.missing > 0);
  if (short.length === 0) {
    return undefined;
  }
  return `研究站缺 ${short.map((line) => `${line.missing} 个${line.itemName}`).join("、")}（已装入 ${short.map((line) => `${line.itemName} ${line.consumed}`).join("、")} / 需要 ${short.map((line) => `${line.itemName} ${line.required}`).join("、")}）`;
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

  // 研究中一律以结算字段（required_cost / consumed_cost）为准，
  // 不用 catalog 里按目录写死的成本（试玩报告阻断级 #3：UI 写 10、结算要 60）。
  const costLines = buildResearchCostLines(catalog, currentResearch);
  const shortage = currentResearch.blocked_reason === "waiting_matrix"
    ? formatMatrixShortage(costLines)
    : undefined;

  const tech = (catalog?.techs ?? []).find((entry) => entry.id === currentResearch.tech_id);
  if (!tech) {
    return {
      id: currentResearch.tech_id,
      name: getTechDisplayName(catalog, currentResearch.tech_id),
      level: currentResearch.current_level ?? 0,
      prerequisiteLabels: [],
      missingPrerequisiteLabels: [],
      costLabels: costLines.map((line) => `${line.itemName} ×${line.required}`),
      unlockLabels: [],
      progress: currentResearch.progress,
      totalCost: currentResearch.total_cost,
      blockedReason: currentResearch.blocked_reason,
      blockedReasonLabel: translateResearchBlockedReason(
        currentResearch.blocked_reason,
      ),
      costLines,
      matrixShortageNotice: shortage,
    };
  }

  return {
    ...deriveTechCard(catalog, tech, completedTechIds),
    // 覆盖目录成本：正在研究的科技用结算值，目录值只作参考。
    costLabels: costLines.map((line) => `${line.itemName} ×${line.required}`),
    progress: currentResearch.progress,
    totalCost: currentResearch.total_cost,
    blockedReason: currentResearch.blocked_reason,
    blockedReasonLabel: translateResearchBlockedReason(
      currentResearch.blocked_reason,
    ),
    costLines,
    matrixShortageNotice: shortage,
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
      "风力涡轮机供电",
      "矿机开采铁矿/铜矿",
      "熔炉冶炼铁块/铜块",
      "装配机加工磁线圈/电路板",
      "合成 10 电磁矩阵装入研究站",
      "研究电磁学",
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
