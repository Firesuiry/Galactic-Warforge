import type { Position } from "@shared/types";

import type { PlanetRenderView } from "@/features/planet-map/model";
import {
  buildWaypointRoute,
  manhattanDistance,
} from "@/features/planet-map/range-planning";

export interface MoveWorkflowView {
  unitId: string;
  unitPosition?: Position;
  moveRange?: number;
  distance?: number;
  distanceGap?: number;
  inRange: boolean;
  waypoints: Position[];
  firstWaypoint?: Position;
}

export function deriveMoveWorkflowView(input: {
  planet: PlanetRenderView;
  targetPosition?: Position;
  unitId: string;
}) {
  const unit = input.unitId ? input.planet.units?.[input.unitId] : undefined;
  const distance = unit?.position && input.targetPosition
    ? manhattanDistance(unit.position, input.targetPosition)
    : undefined;
  const moveRange = unit?.move_range;
  const inRange = distance === undefined || moveRange === undefined
    ? true
    : distance <= moveRange;
  const waypoints = unit?.position && input.targetPosition && moveRange && !inRange
    ? buildWaypointRoute(unit.position, input.targetPosition, moveRange)
    : [];

  return {
    unitId: input.unitId,
    unitPosition: unit?.position,
    moveRange,
    distance,
    distanceGap:
      distance !== undefined && moveRange !== undefined && distance > moveRange
        ? distance - moveRange
        : undefined,
    inRange,
    waypoints,
    firstWaypoint: waypoints[0],
  } satisfies MoveWorkflowView;
}
