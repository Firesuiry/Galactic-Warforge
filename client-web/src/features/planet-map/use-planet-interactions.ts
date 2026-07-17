/**
 * 地图直操交互：build/move/attack 模式下的地图点击 → 命令提交。
 * 与表单共用同一条 submitPlanetCommand 管道（journal 反馈、authoritative 回写一致）。
 */

import { useCallback } from 'react';

import type {
  CatalogView,
  PlanetRuntimeView,
  Position,
} from '@shared/types';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { assessBuildTiles } from '@/features/planet-map/build-workflow';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
  usePlanetCommandStore,
} from '@/features/planet-commands/store';
import type { PlanetRenderView, TilePoint } from '@/features/planet-map/model';
import { toTilePoint } from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';

function reportLocalBlock(commandType: string, planetId: string, message: string, focus?: { buildingType?: string; position?: Position }) {
  usePlanetCommandStore.getState().addJournalEntry({
    requestId: globalThis.crypto?.randomUUID?.() ?? `local-block-${Date.now()}`,
    commandType,
    planetId,
    status: 'failed',
    acceptedMessage: `${commandType} 未下达`,
    authoritativeCode: 'LOCAL_PREFLIGHT',
    authoritativeMessage: message,
    authoritativeSource: 'response',
    focus,
    pendingRecovery: false,
  });
}

/** 在指定 tile 上寻找攻击目标：优先敌军势力，其次非己方单位。 */
export function resolveAttackTargetAtTile(
  planet: PlanetRenderView,
  runtime: PlanetRuntimeView | undefined,
  playerId: string,
  tile: TilePoint,
): { id: string; label: string } | null {
  const enemy = (runtime?.enemy_forces ?? []).find((force) => {
    const pos = toTilePoint(force.position);
    return pos.x === tile.x && pos.y === tile.y;
  });
  if (enemy) {
    return { id: enemy.id, label: enemy.type };
  }
  const hostileUnit = Object.values(planet.units ?? {}).find((unit) => {
    if (unit.owner_id === playerId) {
      return false;
    }
    const pos = toTilePoint(unit.position);
    return pos.x === tile.x && pos.y === tile.y;
  });
  if (hostileUnit) {
    return { id: hostileUnit.id, label: hostileUnit.type };
  }
  return null;
}

interface UsePlanetInteractionsInput {
  catalog?: CatalogView;
  planet?: PlanetRenderView;
  runtime?: PlanetRuntimeView;
}

/**
 * 返回地图交互点击处理器（仅 build/move/attack 模式下会被 canvas 调用）。
 * planet 未加载完成时返回空操作。
 */
export function usePlanetInteractions({ catalog, planet, runtime }: UsePlanetInteractionsInput) {
  const client = useApiClient();
  const session = useSessionSnapshot();

  return useCallback(
    (tile: TilePoint) => {
      if (!planet) {
        return;
      }
      const store = usePlanetViewStore.getState();
      const mode = store.interactionMode;
      const position: Position = { x: tile.x, y: tile.y, z: 0 };

      if (mode.kind === 'build') {
        const assessment = assessBuildTiles(catalog, mode.buildingType, planet, position);
        if (assessment && !assessment.buildable) {
          const reasons = assessment.blockedTiles
            .map((blocked) => (blocked.reason === 'terrain'
              ? `(${blocked.x}, ${blocked.y}) 地形不可建`
              : blocked.reason === 'building'
                ? `(${blocked.x}, ${blocked.y}) 已被建筑占用`
                : `(${blocked.x}, ${blocked.y}) 被资源点占用`))
            .slice(0, 3)
            .join('；');
          reportLocalBlock('build', planet.planet_id, `该位置无法建造：${reasons}`, {
            buildingType: mode.buildingType,
            position,
          });
          return;
        }
        void submitPlanetCommand({
          commandType: 'build',
          planetId: planet.planet_id,
          focus: { buildingType: mode.buildingType, position },
          execute: () => client.cmdBuild(position, mode.buildingType, {
            direction: mode.direction,
            ...(mode.recipeId ? { recipeId: mode.recipeId } : {}),
          }),
          fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
            event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
            limit: 50,
          }),
        });
        // 建造模式保持，便于连续放置
        return;
      }

      if (mode.kind === 'move') {
        void submitPlanetCommand({
          commandType: 'move',
          planetId: planet.planet_id,
          focus: { entityId: mode.unitId, position },
          execute: () => client.cmdMove(mode.unitId, position),
          fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
            event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
            limit: 50,
          }),
        });
        store.exitInteractionMode();
        return;
      }

      if (mode.kind === 'attack') {
        const target = resolveAttackTargetAtTile(planet, runtime, session.playerId, tile);
        if (!target) {
          reportLocalBlock('attack', planet.planet_id, '该位置没有可攻击目标', { position });
          return;
        }
        void submitPlanetCommand({
          commandType: 'attack',
          planetId: planet.planet_id,
          focus: { entityId: mode.unitId, position },
          execute: () => client.cmdAttack(mode.unitId, target.id),
          fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
            event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
            limit: 50,
          }),
        });
        store.exitInteractionMode();
      }
    },
    [catalog, client, planet, runtime, session.playerId],
  );
}
