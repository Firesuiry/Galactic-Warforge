/**
 * 地图直操交互（C1）：
 * - 左键模式点击：build/move/attack/unit_order 模式下的地图点击 → 命令提交；
 * - 右键情境指令：inspect 模式有己方单位选中时，点敌=批量攻击、点地=批量移动；
 * - 立即指令：S=stop / H=hold（快捷键与多选面板共用）。
 *
 * C4 增量：选中小队（combat_squads）时右键点地 = 按所属任务群下达 task_force_deploy
 * 到该坐标（未编组小队给出本地预检提示）；与表单共用同一条 submitPlanetCommand 管道。
 *
 * 与表单共用同一条 submitPlanetCommand 管道（journal 反馈、authoritative 回写一致）。
 * move/attack 选择器 = 当前多选集合（含执行体：保留瞬移/手动一击语义）；
 * unit_order 选择器额外过滤执行体（服务端不受理，见 rts-commands）。
 */

import { useCallback } from 'react';

import type {
  CatalogView,
  PlanetRuntimeView,
  Position,
  Unit,
  WarTaskForceView,
} from '@shared/types';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { sfx } from '@/engine/audio';
import { assessBuildTiles } from '@/features/planet-map/build-workflow';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
  usePlanetCommandStore,
} from '@/features/planet-commands/store';
import type { PlanetRenderView, TilePoint } from '@/features/planet-map/model';
import {
  commandableUnitIds,
  orderEligibleUnitIds,
  resolveContextCommand,
} from '@/features/planet-map/rts-commands';
import { resolveSquadDeploy } from '@/features/planet-map/squad-commands';
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
  sfx.commandFail();
}

/** 在指定 tile 上寻找攻击目标：优先敌军势力，其次非己方单位。 */
export function resolveAttackTargetAtTile(
  planet: PlanetRenderView,
  runtime: PlanetRuntimeView | undefined,
  playerId: string,
  tile: TilePoint,
): { id: string; label: string } | null {
  const command = resolveContextCommand(planet, runtime, playerId, tile);
  return command.type === 'attack' ? { id: command.targetId, label: command.targetLabel } : null;
}

/** 守卫（G）模式点选目标：tile 上的单位/建筑实体 id（敌我不限，守卫对象可以是己方）。 */
export function resolveGuardTargetAtTile(
  planet: PlanetRenderView,
  tile: TilePoint,
): { id: string; label: string } | null {
  const unit = Object.values(planet.units ?? {}).find((candidate: Unit) => {
    const pos = { x: Math.round(candidate.position.x), y: Math.round(candidate.position.y) };
    return pos.x === tile.x && pos.y === tile.y;
  });
  if (unit) {
    return { id: unit.id, label: unit.type };
  }
  const building = Object.values(planet.buildings ?? {}).find((candidate) => {
    const pos = { x: Math.round(candidate.position.x), y: Math.round(candidate.position.y) };
    return pos.x === tile.x && pos.y === tile.y;
  });
  return building ? { id: building.id, label: building.type } : null;
}

interface UsePlanetInteractionsInput {
  catalog?: CatalogView;
  planet?: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  /** C4：任务群列表（小队右键部署的归属解析；缺省时小队右键给出编组提示）。 */
  taskForces?: WarTaskForceView[];
  /** C4：小队部署命令提交后的回调（调用侧据此失效/重取任务群查询）。 */
  onTaskForceDeployed?: () => void;
}

export interface PlanetInteractions {
  /** build/move/attack/unit_order 模式的左键点击（原 onInteractTile）。 */
  interactTile: (tile: TilePoint) => void;
  /** 右键情境指令：有批量命令下达时返回 true（调用侧据此抑制"取消模式"）。 */
  contextTile: (tile: TilePoint) => boolean;
  /** 立即指令（stop/hold），快捷键 S/H 与多选面板共用。 */
  orderNow: (order: 'stop' | 'hold') => void;
}

/**
 * 地图交互命令中枢：planet 未加载完成时所有入口为空操作。
 */
export function usePlanetInteractions({ catalog, planet, runtime, taskForces, onTaskForceDeployed }: UsePlanetInteractionsInput): PlanetInteractions {
  const client = useApiClient();
  const session = useSessionSnapshot();

  const submitMove = useCallback(
    (selector: string[], position: Position) => {
      if (!planet) {
        return;
      }
      void submitPlanetCommand({
        commandType: 'move',
        planetId: planet.planet_id,
        focus: { entityId: selector[0], position },
        execute: () => client.cmdMove(selector, position),
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
          event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
          limit: 50,
        }),
      });
    },
    [client, planet],
  );

  const submitAttack = useCallback(
    (selector: string[], targetId: string, position: Position) => {
      if (!planet) {
        return;
      }
      void submitPlanetCommand({
        commandType: 'attack',
        planetId: planet.planet_id,
        focus: { entityId: selector[0], position },
        execute: () => client.cmdAttack(selector, targetId),
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
          event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
          limit: 50,
        }),
      });
    },
    [client, planet],
  );

  const submitUnitOrder = useCallback(
    (selector: string[], order: 'attack_move' | 'patrol' | 'guard' | 'hold' | 'stop', options: { position?: Position; targetEntityId?: string }) => {
      if (!planet) {
        return;
      }
      void submitPlanetCommand({
        commandType: 'unit_order',
        planetId: planet.planet_id,
        focus: { entityId: selector[0], position: options.position },
        execute: () => client.cmdUnitOrder(selector, order, options),
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
          event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
          limit: 50,
        }),
      });
    },
    [client, planet],
  );

  const interactTile = useCallback(
    (tile: TilePoint) => {
      if (!planet) {
        return;
      }
      const store = usePlanetViewStore.getState();
      const mode = store.interactionMode;
      const position: Position = { x: tile.x, y: tile.y, z: 0 };

      if (mode.kind === 'build') {
        const assessment = assessBuildTiles(catalog, mode.buildingType, planet, position, session.playerId, mode.rotation);
        if (assessment && !assessment.buildable) {
          const reasons = assessment.blockedTiles
            .map((blocked) => (blocked.reason === 'terrain'
              ? `(${blocked.x}, ${blocked.y}) 地形不可建`
              : blocked.reason === 'building'
                ? `(${blocked.x}, ${blocked.y}) 已被建筑占用`
                : blocked.reason === 'resource'
                  ? `(${blocked.x}, ${blocked.y}) 被资源点占用`
                  : blocked.reason === 'missing_host'
                    ? `(${blocked.x}, ${blocked.y}) 需要己方仓库原点`
                    : `(${blocked.x}, ${blocked.y}) 需要建在资源点上`))
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
            rotation: mode.rotation ?? 0,
            autoApproach: true,
            planetId: planet.planet_id,
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
        const selector = commandableUnitIds(planet, store.selectedUnits, session.playerId);
        if (selector.length === 0) {
          reportLocalBlock('move', planet.planet_id, '没有选中的己方单位', { position });
          store.exitInteractionMode();
          return;
        }
        submitMove(selector, position);
        store.exitInteractionMode();
        return;
      }

      if (mode.kind === 'attack') {
        const selector = commandableUnitIds(planet, store.selectedUnits, session.playerId);
        if (selector.length === 0) {
          reportLocalBlock('attack', planet.planet_id, '没有选中的己方单位', { position });
          store.exitInteractionMode();
          return;
        }
        const target = resolveAttackTargetAtTile(planet, runtime, session.playerId, tile);
        if (!target) {
          reportLocalBlock('attack', planet.planet_id, '该位置没有可攻击目标', { position });
          return;
        }
        submitAttack(selector, target.id, position);
        store.exitInteractionMode();
        return;
      }

      if (mode.kind === 'unit_order') {
        const selector = orderEligibleUnitIds(planet, store.selectedUnits, session.playerId);
        if (selector.length === 0) {
          reportLocalBlock('unit_order', planet.planet_id, '没有可接受指令的单位（执行体不受理编队指令）', { position });
          store.exitInteractionMode();
          return;
        }
        if (mode.order === 'guard') {
          const target = resolveGuardTargetAtTile(planet, tile);
          if (!target) {
            reportLocalBlock('unit_order', planet.planet_id, '该位置没有可守卫的目标', { position });
            return;
          }
          submitUnitOrder(selector, 'guard', { targetEntityId: target.id });
        } else {
          submitUnitOrder(selector, mode.order, { position });
        }
        store.exitInteractionMode();
      }
    },
    [catalog, client, planet, runtime, session.playerId, submitAttack, submitMove, submitUnitOrder],
  );

  const contextTile = useCallback(
    (tile: TilePoint): boolean => {
      if (!planet) {
        return false;
      }
      const store = usePlanetViewStore.getState();
      const selector = commandableUnitIds(planet, store.selectedUnits, session.playerId);
      const position: Position = { x: tile.x, y: tile.y, z: 0 };

      // C4：小队右键部署——按所属任务群分组下达 task_force_deploy 到目标坐标。
      if (selector.length === 0 && store.selectedSquads.length > 0) {
        const resolution = resolveSquadDeploy(taskForces ?? [], store.selectedSquads);
        if (resolution.unassignedSquadIds.length > 0) {
          reportLocalBlock(
            'task_force_deploy',
            planet.planet_id,
            `小队 ${resolution.unassignedSquadIds.join('、')} 未编入任务群：到战争页「战区」面板编组后再部署`,
            { position },
          );
        }
        resolution.plans.forEach((plan) => {
          void submitPlanetCommand({
            commandType: 'task_force_deploy',
            planetId: planet.planet_id,
            focus: { position },
            execute: () => client.cmdTaskForceDeploy(plan.taskForceId, {
              planetId: planet.planet_id,
              position,
            }),
            fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
              event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
              limit: 50,
            }),
          }).then(() => onTaskForceDeployed?.());
        });
        return resolution.plans.length > 0 || resolution.unassignedSquadIds.length > 0;
      }

      if (selector.length === 0) {
        return false;
      }
      const command = resolveContextCommand(planet, runtime, session.playerId, tile);
      if (command.type === 'attack') {
        submitAttack(selector, command.targetId, { x: tile.x, y: tile.y, z: 0 });
      } else {
        submitMove(selector, command.position);
      }
      return true;
    },
    [client, onTaskForceDeployed, planet, runtime, session.playerId, submitAttack, submitMove, taskForces],
  );

  const orderNow = useCallback(
    (order: 'stop' | 'hold') => {
      if (!planet) {
        return;
      }
      const store = usePlanetViewStore.getState();
      const selector = orderEligibleUnitIds(planet, store.selectedUnits, session.playerId);
      if (selector.length === 0) {
        return;
      }
      submitUnitOrder(selector, order, {});
    },
    [planet, session.playerId, submitUnitOrder],
  );

  return { interactTile, contextTile, orderNow };
}
