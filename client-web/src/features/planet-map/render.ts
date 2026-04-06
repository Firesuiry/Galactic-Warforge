import type { Building, Position } from "@shared/types";

import type { TilePoint, ViewportTileBounds } from "@/features/planet-map/model";
import { getBuildingFootprint, toTilePoint } from "@/features/planet-map/model";

export interface SceneRenderDetailPolicy {
  showSceneGrid: boolean;
  showBuildingLabels: boolean;
  simplifyFog: boolean;
  simplifyStructures: boolean;
}

export function getSceneRenderDetailPolicy(tileSize: number): SceneRenderDetailPolicy {
  return {
    showSceneGrid: tileSize >= 6,
    showBuildingLabels: tileSize >= 16,
    simplifyFog: tileSize < 4,
    simplifyStructures: tileSize < 6,
  };
}

export function describeSceneRenderSimplifications(policy: SceneRenderDetailPolicy) {
  const messages: string[] = [];
  if (!policy.showSceneGrid) {
    messages.push("细网格已简化");
  }
  if (policy.simplifyFog) {
    messages.push("迷雾已合并");
  }
  if (policy.simplifyStructures) {
    messages.push("建筑与单位已简化");
  }
  return messages;
}

export function isTilePointVisible(
  tile: TilePoint,
  bounds: ViewportTileBounds,
  padding = 0,
) {
  return (
    tile.x >= bounds.minX - padding &&
    tile.x <= bounds.maxX + padding &&
    tile.y >= bounds.minY - padding &&
    tile.y <= bounds.maxY + padding
  );
}

export function isPositionVisible(
  position: Position,
  bounds: ViewportTileBounds,
  padding = 0,
) {
  return isTilePointVisible(toTilePoint(position), bounds, padding);
}

export function isBuildingFootprintVisible(
  building: Building,
  bounds: ViewportTileBounds,
  padding = 0,
) {
  const origin = toTilePoint(building.position);
  const footprint = getBuildingFootprint(building);
  const maxX = origin.x + footprint.width - 1;
  const maxY = origin.y + footprint.height - 1;
  return !(
    maxX < bounds.minX - padding ||
    origin.x > bounds.maxX + padding ||
    maxY < bounds.minY - padding ||
    origin.y > bounds.maxY + padding
  );
}

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

interface AnimationFrameValueSchedulerOptions<T> {
  commit: (value: T) => void;
  getCurrentValue?: () => T;
  isEqual?: (left: T, right: T) => boolean;
  requestFrame?: RequestFrame;
  cancelFrame?: CancelFrame;
}

function fallbackRequestFrame(callback: FrameRequestCallback) {
  return window.setTimeout(() => {
    callback(performance.now());
  }, 16);
}

function fallbackCancelFrame(handle: number) {
  window.clearTimeout(handle);
}

export function createAnimationFrameValueScheduler<T>({
  commit,
  getCurrentValue,
  isEqual,
  requestFrame = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : fallbackRequestFrame,
  cancelFrame = typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function"
    ? window.cancelAnimationFrame.bind(window)
    : fallbackCancelFrame,
}: AnimationFrameValueSchedulerOptions<T>) {
  let frameHandle: number | null = null;
  let hasPendingValue = false;
  let pendingValue: T | undefined;
  let hasCommittedValue = false;
  let committedValue: T | undefined;

  return {
    schedule(value: T) {
      pendingValue = value;
      hasPendingValue = true;
      if (frameHandle !== null) {
        return;
      }

      frameHandle = requestFrame(() => {
        frameHandle = null;
        if (!hasPendingValue) {
          return;
        }

        const nextValue = pendingValue as T;
        hasPendingValue = false;
        pendingValue = undefined;

        const currentValue = getCurrentValue
          ? getCurrentValue()
          : hasCommittedValue
            ? (committedValue as T)
            : undefined;
        const hasCurrentValue = getCurrentValue !== undefined || hasCommittedValue;
        if (
          hasCurrentValue &&
          isEqual &&
          isEqual(currentValue as T, nextValue)
        ) {
          return;
        }

        committedValue = nextValue;
        hasCommittedValue = true;
        commit(nextValue);
      });
    },
    cancel() {
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      hasPendingValue = false;
      pendingValue = undefined;
      hasCommittedValue = false;
      committedValue = undefined;
    },
  };
}
