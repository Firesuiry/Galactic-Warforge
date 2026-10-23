/**
 * 特效试验场钩子（仅测试构建）：按 `?vfxPhase=` 在**固定位置**注入合成特效并定格到指定相位。
 *
 * 计划（plan.md 步骤 9）：
 * - `Explosion`：格 (58,136)，相位 .25
 * - `TurretFire`：从 (54,144) 打向 (60,132)，相位 .4
 * - `Construction`：格 (46,132) 放一个 3×3 装配台 ghost，进度 .55
 * - `Industry`：熔炉 (62,140) 附近，看烟/火花
 * - `Selection`：选中基站 (54,144) + 2 个士兵
 *
 * 只在故事壳（FixtureStage）里调用；真机不触发。合成特效只用于夹具迭代，
 * 不能当验收图（3A 画质 §2.1 信息诚实）。
 */

import * as THREE from 'three';

import type { Building, CatalogView } from '@shared/types';
import { surfaceOffset } from '@shared/surface';
import type { BattleEvent } from '@/engine/battle-events';
import { getBuildingFootprint, toTilePoint } from '../../model';
import { footprintCenterTile } from '../tactical-overlays';
import { combatVfxFromEvent, type CombatPointLike } from './combat-vfx-specs';
import type { VfxLayer } from './index';
import type { HoloTask } from './construction-holo';
import type { SelectionItem } from './selection';

export interface FixtureContext {
  normal: (x: number, y: number) => THREE.Vector3;
  radius: number;
  scale: number;
  faceSize: number;
  buildings?: Record<string, Building>;
  catalog?: CatalogView;
}

/** 合成战斗事件（与 SSE 的 damage_applied 同形状）。 */
export function fixtureBattleEvent(seq: number, attacker: string, target: string, damage: number): BattleEvent {
  return {
    seq, at: 0, type: 'damage_applied', eventId: `fixture-${seq}`, tick: 1,
    payload: { attacker_id: attacker, target_id: target, attacker_type: 'unit', damage, target_hp: 40 },
  };
}

/** 合成击毁事件。 */
export function fixtureDestroyEvent(seq: number, target: string, entityType: 'unit' | 'building' = 'unit'): BattleEvent {
  return {
    seq, at: 0, type: 'entity_destroyed', eventId: `fixture-d-${seq}`, tick: 1,
    payload: { entity_id: target, entity_type: entityType },
  };
}

function pointAt(ctx: FixtureContext, x: number, y: number, lift = 0): CombatPointLike {
  const normal = ctx.normal(x, y);
  const position = normal.clone().multiplyScalar(ctx.radius + lift);
  return { x: position.x, y: position.y, z: position.z, owner: 'own', kind: 'unit' };
}

/** 相位 → 秒（夹具固定时间；场景冻结时用同一个值）。 */
export const FIXTURE_SECONDS: Record<string, number> = {
  explosion: 0.25 * 0.72,
  turretfire: 0.4 * 0.24,
};

/** 爆炸定格在爆发后多久（秒）：火球已铺开、烟/碎片成形。 */
const EXPLOSION_AGE = 0.2;
/** 曳光定格在开火后多久（秒）：弹道行至半程。 */
const TRACER_AGE = 0.11;

/**
 * 应用一个试验场相位。`seconds` 覆盖定格时刻（默认由相位换算）。
 * 返回注入的指令条数。
 */
export function applyFixturePhase(layer: VfxLayer, phase: string, seconds: number | undefined, ctx: FixtureContext): number {
  const time = seconds ?? 0.9;
  switch (phase.toLowerCase()) {
    case 'explosion': {
      // (58,136)：击毁一台敌方机甲 → 火球 + 烟 + 碎片 + 冲击波 + 闪光。
      const points: Record<string, CombatPointLike> = {
        'fx-target': { ...pointAt(ctx, 58, 136, 0.35), owner: 'enemy', kind: 'unit' },
      };
      const resolve = (id: string | undefined | null) => (id ? points[id] ?? null : null);
      const specs = combatVfxFromEvent(fixtureDestroyEvent(9001, 'fx-target'), resolve);
      // 发射时刻 = 目标相位往前推 AGE 秒，再把时钟拨到目标相位：
      // 粒子/曳光/冲击波因此停在「爆发后 AGE 秒」的样子（t=0 时淡入为 0，直接定格会看不见）。
      layer.setFrozenPhase(time);
      layer.combat.spawn(specs);
      layer.shake.add(0.6, 380);
      // 粒子在冻结模式下自动把发射时刻前移（见 ParticleSystem.emit）；
      // 短命对象（冲击波/点光源/焦痕）由 `advanceTimed` 推到爆发中段，之后冻结不动。
      layer.update(0, ctx.radius * 0.16, ctx.faceSize);
      layer.advanceTimed(EXPLOSION_AGE);
      return specs.bursts.length + specs.shockwaves.length;
    }
    case 'turretfire': {
      // (54,144) → (60,132)：枪口焰 + 曳光 + 命中火花。
      const points: Record<string, CombatPointLike> = {
        'fx-gun': { ...pointAt(ctx, 54, 144, 0.55), owner: 'own', kind: 'building' },
        'fx-victim': { ...pointAt(ctx, 60, 132, 0.25), owner: 'enemy', kind: 'unit' },
      };
      const resolve = (id: string | undefined | null) => (id ? points[id] ?? null : null);
      const specs = combatVfxFromEvent(fixtureBattleEvent(9002, 'fx-gun', 'fx-victim', 18), resolve);
      layer.setFrozenPhase(time);
      layer.combat.spawn(specs);
      layer.update(0, ctx.radius * 0.16, ctx.faceSize);
      layer.advanceTimed(TRACER_AGE);
      return specs.bursts.length + specs.tracers.length;
    }
    case 'construction': {
      // (46,132) 3×3 装配台 ghost，进度 .55。
      const task: HoloTask = {
        id: 'fx-construction', buildingType: 'assembling_machine_mk1',
        position: { x: 46, y: 132 }, rotation: 0, width: 3, height: 3, progress: 0.55,
      };
      layer.setFrozenPhase(time);
      layer.syncConstruction([task], ctx.faceSize);
      layer.update(0, ctx.radius * 0.16, ctx.faceSize);
      return 1;
    }
    case 'industry': {
      // 熔炉 (62,140)：不注入合成粒子——场景的工业发射器只认权威活动源
      // （夹具数据里 b-55/b-67 的 `production.remaining_ticks > 0` → heat 源），
      // 冻结下按固定相位预发射一轮。这里只把时钟拨到固定相位并推一帧。
      layer.setFrozenPhase(time);
      layer.update(0, ctx.radius * 0.16, ctx.faceSize);
      return 0;
    }
    case 'selection': {
      // 选中基站 (54,144) + 士兵 2 个（细环 + 方向三角）。与真机同一套输入：
      // 基站按真实占地（占地中心 + 占地格数）画**一个**四角括号；士兵是 (55,135)/(54,138)。
      const base = ctx.buildings?.['b-39'];
      const items: SelectionItem[] = [];
      if (base) {
        const footprint = getBuildingFootprint(base as unknown as Building);
        const origin = toTilePoint(base.position);
        const tiles = Array.from({ length: footprint.width * footprint.height }, (_, index) => {
          const cell = surfaceOffset(origin, index % footprint.width, Math.floor(index / footprint.width), ctx.faceSize);
          return { x: Math.round(cell.x), y: Math.round(cell.y) };
        });
        items.push({
          key: 'fx-base', tile: footprintCenterTile(origin, footprint, ctx.faceSize),
          color: '#ffd166', kind: 'building', opacity: 0.95,
          footprint: tiles, footprintSize: footprint,
        });
      }
      for (const index of [0, 1]) {
        items.push({
          key: `fx-unit-${index}`, tile: index === 0 ? { x: 55, y: 135 } : { x: 54, y: 138 },
          color: index === 0 ? '#fff1a8' : '#9ef7c9', kind: 'unit', opacity: 0.9,
          direction: { x: 0, y: 1 },
        });
      }
      layer.setFrozenPhase(time);
      layer.syncSelection(items, ctx.faceSize, 0);
      layer.update(0, ctx.radius * 0.16, ctx.faceSize);
      return items.length;
    }
    default:
      return 0;
  }
}

void THREE;
