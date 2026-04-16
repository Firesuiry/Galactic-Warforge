import type {
  BuildingCatalogEntry,
  CatalogView,
  PlanetResource,
  PlanetNetworksView,
  Position,
  StateSummary,
} from "@shared/types";

import type { PlanetRenderView } from "@/features/planet-map/model";
import {
  getResourceList,
  getTerrainTile,
  tileContainsBuilding,
  toTilePoint,
} from "@/features/planet-map/model";
import { type PlanetCommandJournalEntry } from "@/features/planet-commands/store";
import {
  resolvePlanetCommandHint,
  type PlanetCommandHint,
} from "@/features/planet-commands/error-hints";
import {
  buildWaypointRoute,
  manhattanDistance,
  stepTowardsTarget,
} from "@/features/planet-map/range-planning";
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
  moveRange?: number;
  operateRange?: number;
  distance?: number;
  inRange: boolean;
}

export interface BuildBlockedTile {
  x: number;
  y: number;
  terrain: string;
  reason: "terrain" | "building" | "resource";
  buildingId?: string;
  resourceId?: string;
}

export interface BuildTileAssessment {
  footprint: {
    width: number;
    height: number;
  };
  terrain: string;
  terrainBuildable: boolean;
  blockingBuildingId?: string;
  blockingResourceId?: string;
  buildable: boolean;
  blockedTiles: BuildBlockedTile[];
}

export interface BuildApproachPlan {
  distanceGap?: number;
  landingPosition?: Position;
  firstWaypoint?: Position;
  waypoints: Position[];
}

export interface BuildWorkflowView {
  catalog: BuildCatalogGroup;
  reachability: BuildReachability;
  tileAssessment?: BuildTileAssessment;
  approachPlan?: BuildApproachPlan;
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
  const moveRange = executor?.move_range;
  const operateRange = executorState?.operate_range;
  const distance = executor?.position && selectedPosition
    ? manhattanDistance(executor.position, selectedPosition)
    : undefined;

  return {
    executorUnitId,
    executorPosition: executor?.position,
    moveRange,
    operateRange,
    distance,
    inRange: distance === undefined || operateRange === undefined
      ? true
      : distance <= operateRange,
  } satisfies BuildReachability;
}

function findBlockingResource(
  resources: PlanetResource[],
  x: number,
  y: number,
) {
  return resources.find((resource) => {
    const position = toTilePoint(resource.position);
    return position.x === x && position.y === y;
  });
}

function getCatalogFootprint(
  catalog: CatalogView | undefined,
  buildingType?: string,
) {
  const entry = catalog?.buildings?.find((candidate) => candidate.id === buildingType);
  return {
    width: Math.max(1, entry?.footprint?.width ?? 1),
    height: Math.max(1, entry?.footprint?.height ?? 1),
  };
}

function buildTileAssessment(input: {
  catalog?: CatalogView;
  buildingType?: string;
  planet: PlanetRenderView;
  selectedPosition?: Position;
}) {
  if (!input.selectedPosition) {
    return undefined;
  }

  const footprint = getCatalogFootprint(input.catalog, input.buildingType);
  const blockedTiles: BuildBlockedTile[] = [];
  const resources = getResourceList(input.planet);

  for (let dy = 0; dy < footprint.height; dy += 1) {
    for (let dx = 0; dx < footprint.width; dx += 1) {
      const x = input.selectedPosition.x + dx;
      const y = input.selectedPosition.y + dy;
      const terrain = getTerrainTile(input.planet, x, y);
      const blockingBuilding = Object.values(input.planet.buildings ?? {}).find(
        (building) => tileContainsBuilding(building, x, y),
      );
      const blockingResource = findBlockingResource(resources, x, y);

      if (terrain !== "buildable") {
        blockedTiles.push({ x, y, terrain, reason: "terrain" });
      }
      if (blockingBuilding) {
        blockedTiles.push({
          x,
          y,
          terrain,
          reason: "building",
          buildingId: blockingBuilding.id,
        });
      }
      if (blockingResource) {
        blockedTiles.push({
          x,
          y,
          terrain,
          reason: "resource",
          resourceId: blockingResource.id,
        });
      }
    }
  }

  const primaryTerrain = getTerrainTile(
    input.planet,
    input.selectedPosition.x,
    input.selectedPosition.y,
  );
  const blockingBuildingId = blockedTiles.find(
    (tile) => tile.reason === "building",
  )?.buildingId;
  const blockingResourceId = blockedTiles.find(
    (tile) => tile.reason === "resource",
  )?.resourceId;

  return {
    footprint,
    terrain: primaryTerrain,
    terrainBuildable: primaryTerrain === "buildable",
    blockingBuildingId,
    blockingResourceId,
    buildable: blockedTiles.length === 0,
    blockedTiles,
  } satisfies BuildTileAssessment;
}

function buildApproachPlan(
  reachability: BuildReachability,
  selectedPosition?: Position,
) {
  if (
    !selectedPosition
    || !reachability.executorPosition
    || reachability.distance === undefined
    || reachability.operateRange === undefined
    || reachability.inRange
  ) {
    return undefined;
  }

  const distanceGap = Math.max(
    reachability.distance - reachability.operateRange,
    0,
  );
  const landingPosition = stepTowardsTarget(
    reachability.executorPosition,
    selectedPosition,
    distanceGap,
  );
  const waypoints = reachability.moveRange && reachability.moveRange > 0
    ? buildWaypointRoute(
      reachability.executorPosition,
      landingPosition,
      reachability.moveRange,
    )
    : [landingPosition];

  return {
    distanceGap,
    landingPosition,
    firstWaypoint: waypoints[0] ?? landingPosition,
    waypoints,
  } satisfies BuildApproachPlan;
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
  buildingType?: string;
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
  const tileAssessment = buildTileAssessment(input);
  const approachPlan = buildApproachPlan(reachability, input.selectedPosition);

  return {
    catalog,
    reachability,
    tileAssessment,
    approachPlan,
    preflightHints: buildPreflightHints(reachability),
    postBuildHints: buildPostBuildHints(input),
  };
}
