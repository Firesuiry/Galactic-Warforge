import type {
  BuildingCatalogEntry,
  CatalogView,
  PlanetNetworksView,
  Position,
  StateSummary,
} from "@shared/types";

import type { PlanetRenderView } from "@/features/planet-map/model";
import { tileContainsBuilding, toTilePoint } from "@/features/planet-map/model";
import { type PlanetCommandJournalEntry } from "@/features/planet-commands/store";
import {
  resolvePlanetCommandHint,
  type PlanetCommandHint,
} from "@/features/planet-commands/error-hints";
import { normalizeCompletedTechIds } from "@/features/planet-map/research-workflow";

const BUILD_RECOMMENDATION_ORDER = [
  "wind_turbine",
  "matrix_lab",
  "tesla_tower",
  "em_rail_ejector",
  "vertical_launching_silo",
  "ray_receiver",
] as string[];

const BUILD_RECOMMENDATION_PRIORITY = new Map(
  BUILD_RECOMMENDATION_ORDER.map((buildingId, index) => [buildingId, index]),
);

export interface BuildCatalogEntryView extends BuildingCatalogEntry {
  visibility: "recommended" | "unlocked" | "locked" | "debugOnly";
}

export interface BuildCatalogGroup {
  recommended: BuildCatalogEntryView[];
  unlocked: BuildCatalogEntryView[];
  locked: BuildCatalogEntryView[];
  debugOnly: BuildCatalogEntryView[];
}

export interface BuildReachability {
  executorUnitId?: string;
  executorPosition?: Position;
  operateRange?: number;
  distance?: number;
  inRange: boolean;
}

export interface BuildWorkflowView {
  catalog: BuildCatalogGroup;
  reachability: BuildReachability;
  preflightHints: PlanetCommandHint[];
  postBuildHints: PlanetCommandHint[];
}

function sortCatalogEntries(
  left: BuildCatalogEntryView,
  right: BuildCatalogEntryView,
) {
  const leftPriority = BUILD_RECOMMENDATION_PRIORITY.get(left.id) ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = BUILD_RECOMMENDATION_PRIORITY.get(right.id) ?? Number.MAX_SAFE_INTEGER;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

function manhattanDistance(left: Position, right: Position) {
  const leftPoint = toTilePoint(left);
  const rightPoint = toTilePoint(right);
  return Math.abs(leftPoint.x - rightPoint.x) + Math.abs(leftPoint.y - rightPoint.y);
}

function buildCatalogGroups(
  catalog: CatalogView | undefined,
  summary: StateSummary | undefined,
  playerId: string,
): BuildCatalogGroup {
  const completedTechIds = new Set(
    normalizeCompletedTechIds(summary?.players?.[playerId]?.tech),
  );
  const groups: BuildCatalogGroup = {
    recommended: [],
    unlocked: [],
    locked: [],
    debugOnly: [],
  };

  for (const entry of catalog?.buildings ?? []) {
    if (!entry.buildable) {
      continue;
    }

    const unlockTechs = entry.unlock_tech?.filter(Boolean) ?? [];
    const viewEntry: BuildCatalogEntryView = {
      ...entry,
      visibility: "unlocked",
    };

    if (unlockTechs.length === 0) {
      viewEntry.visibility = "debugOnly";
      groups.debugOnly.push(viewEntry);
      continue;
    }

    const unlocked = unlockTechs.every((techId) => completedTechIds.has(techId));
    if (!unlocked) {
      viewEntry.visibility = "locked";
      groups.locked.push(viewEntry);
      continue;
    }

    if (BUILD_RECOMMENDATION_PRIORITY.has(entry.id)) {
      viewEntry.visibility = "recommended";
      groups.recommended.push(viewEntry);
      continue;
    }

    groups.unlocked.push(viewEntry);
  }

  return {
    recommended: groups.recommended.sort(sortCatalogEntries),
    unlocked: groups.unlocked.sort(sortCatalogEntries),
    locked: groups.locked.sort(sortCatalogEntries),
    debugOnly: groups.debugOnly.sort(sortCatalogEntries),
  };
}

function buildReachability(
  planet: PlanetRenderView,
  summary: StateSummary | undefined,
  playerId: string,
  selectedPosition?: Position,
) {
  const executorState = summary?.players?.[playerId]?.executor;
  const executorUnitId = executorState?.unit_id;
  const executor = executorUnitId ? planet.units?.[executorUnitId] : undefined;
  const operateRange = executorState?.operate_range;
  const distance = executor?.position && selectedPosition
    ? manhattanDistance(executor.position, selectedPosition)
    : undefined;

  return {
    executorUnitId,
    executorPosition: executor?.position,
    operateRange,
    distance,
    inRange: distance === undefined || operateRange === undefined
      ? true
      : distance <= operateRange,
  } satisfies BuildReachability;
}

function buildPreflightHints(reachability: BuildReachability) {
  if (
    !reachability.executorUnitId
    || !reachability.executorPosition
    || reachability.distance === undefined
    || reachability.operateRange === undefined
    || reachability.inRange
  ) {
    return [];
  }

  const hint = resolvePlanetCommandHint({
    message: `executor out of range: ${reachability.distance} > ${reachability.operateRange}`,
  });
  return hint ? [hint] : [];
}

function resolveSelectedBuilding(
  planet: PlanetRenderView,
  selectedPosition?: Position,
) {
  if (!selectedPosition) {
    return undefined;
  }
  return Object.values(planet.buildings ?? {}).find((building) =>
    tileContainsBuilding(building, selectedPosition.x, selectedPosition.y),
  );
}

function buildPostBuildHints(input: {
  journal?: PlanetCommandJournalEntry[];
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  selectedPosition?: Position;
}) {
  const selectedBuilding = resolveSelectedBuilding(
    input.planet,
    input.selectedPosition,
  );

  const journalHint = input.journal?.find(
    (entry) =>
      entry.commandType === "build"
      && entry.focus?.position
      && input.selectedPosition
      && toTilePoint(entry.focus.position).x === toTilePoint(input.selectedPosition).x
      && toTilePoint(entry.focus.position).y === toTilePoint(input.selectedPosition).y
      && entry.nextHint,
  )?.nextHint;

  if (journalHint) {
    return [
      {
        tone: "info",
        title: journalHint,
        detail: "authoritative: journal",
      } satisfies PlanetCommandHint,
    ];
  }

  const networkReason = selectedBuilding
    ? input.networks?.power_coverage?.find(
      (coverage) => coverage.building_id === selectedBuilding.id,
    )?.reason
    : undefined;
  const hint = resolvePlanetCommandHint({
    reason: selectedBuilding?.runtime?.state_reason || networkReason,
  });
  return hint ? [hint] : [];
}

export function deriveBuildWorkflowView(input: {
  catalog?: CatalogView;
  journal?: PlanetCommandJournalEntry[];
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  playerId: string;
  selectedPosition?: Position;
  summary?: StateSummary;
}): BuildWorkflowView {
  const catalog = buildCatalogGroups(input.catalog, input.summary, input.playerId);
  const reachability = buildReachability(
    input.planet,
    input.summary,
    input.playerId,
    input.selectedPosition,
  );

  return {
    catalog,
    reachability,
    preflightHints: buildPreflightHints(reachability),
    postBuildHints: buildPostBuildHints(input),
  };
}
