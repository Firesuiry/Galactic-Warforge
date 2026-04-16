import type { Position } from "@shared/types";

import { toTilePoint } from "@/features/planet-map/model";

export function manhattanDistance(left: Position, right: Position) {
  const leftPoint = toTilePoint(left);
  const rightPoint = toTilePoint(right);
  return (
    Math.abs(leftPoint.x - rightPoint.x) + Math.abs(leftPoint.y - rightPoint.y)
  );
}

export function stepTowardsTarget(
  start: Position,
  target: Position,
  steps: number,
) {
  const next = { ...toTilePoint(start), z: start.z ?? 0 };
  const targetPoint = toTilePoint(target);
  let remaining = Math.max(steps, 0);

  while (remaining > 0 && next.x !== targetPoint.x) {
    next.x += Math.sign(targetPoint.x - next.x);
    remaining -= 1;
  }
  while (remaining > 0 && next.y !== targetPoint.y) {
    next.y += Math.sign(targetPoint.y - next.y);
    remaining -= 1;
  }

  return {
    x: next.x,
    y: next.y,
    z: target.z ?? start.z ?? 0,
  } satisfies Position;
}

export function buildWaypointRoute(
  start: Position,
  target: Position,
  maxStep: number,
) {
  const stepSize = Math.max(Math.floor(maxStep), 1);
  const waypoints: Position[] = [];
  let current = {
    x: start.x,
    y: start.y,
    z: start.z ?? target.z ?? 0,
  } satisfies Position;

  while (manhattanDistance(current, target) > stepSize) {
    current = stepTowardsTarget(current, target, stepSize);
    waypoints.push(current);
  }

  if (manhattanDistance(current, target) > 0) {
    waypoints.push({
      x: target.x,
      y: target.y,
      z: target.z ?? current.z ?? 0,
    });
  }

  return waypoints;
}
