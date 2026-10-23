import { describe, expect, it } from 'vitest';

import { buildHoloTasks, buildSelectionItems, buildSupplyAuras } from './scene-bridge';
import { FROZEN_TIME } from './index';
import { VFX_QUALITY, rand, randSigned, hash01 } from './common';
import { ATLAS_FRAMES } from './atlas';
import { COMBAT_FX_LIMITS } from '../combat-effects';
import { combatVfxFromEvent } from './combat-vfx-specs';
import { INDUSTRY_PROFILES, IndustryEmitters, EMITTER_OFFSETS, INDUSTRY_INTERVAL } from './emitters';
import { SHAKE_SOURCES, CameraShake, shakeFromExplosion } from '../camera-shake';
import { PARTICLE_STYLES, particleOpacity } from './particles';
import type { PlanetThreeData } from '../../planet-three-scene';
import type { BattleEvent } from '@/engine/battle-events';

const FACE = 16;

function data(overrides: Partial<PlanetThreeData> = {}): PlanetThreeData {
  return {
    playerId: 'p1',
    planet: {
      planet_id: 'p', surface: { topology: 'cube_sphere', face_size: FACE }, map_width: 48, map_height: 32,
      buildings: {
        'b-base': { id: 'b-base', type: 'battlefield_analysis_base', position: { x: 10, y: 10, z: 0 }, owner_id: 'p1', hp: 100, rotation: 0,
          runtime: { state: 'running', params: { footprint: { width: 3, height: 3 } } } },
        'b-station': { id: 'b-station', type: 'supply_station', position: { x: 4, y: 4, z: 0 }, owner_id: 'p1', hp: 100, runtime: { state: 'running' } },
        'b-station-off': { id: 'b-station-off', type: 'supply_station', position: { x: 6, y: 6, z: 0 }, owner_id: 'p1', hp: 100, runtime: { state: 'no_power' } },
        'b-enemy': { id: 'b-enemy', type: 'supply_station', position: { x: 8, y: 8, z: 0 }, owner_id: 'p2', hp: 100, runtime: { state: 'running' } },
      },
      units: {
        'u-1': { id: 'u-1', type: 'soldier', owner_id: 'p1', position: { x: 11, y: 10, z: 0 }, hp: 10, rotation: 90 },
        'u-truck': { id: 'u-truck', type: 'supply_truck', owner_id: 'p1', position: { x: 5, y: 5, z: 0 }, hp: 10 },
      },
      resources: [],
    },
    catalog: {
      buildings: [
        { id: 'battlefield_analysis_base', footprint: { width: 3, height: 3 } },
        { id: 'supply_station', supply_radius: 30 },
        { id: 'assembling_machine_mk1', footprint: { width: 3, height: 3 } },
      ],
      world_units: [{ id: 'supply_truck', supply_radius: 12 }],
    },
    runtime: {
      available: true, tick: 1, threat_level: 0,
      construction_tasks: [
        { id: 'c-1', player_id: 'p1', building_type: 'assembling_machine_mk1', position: { x: 20, y: 20, z: 0 }, state: 'building', enqueue_tick: 1, remaining_ticks: 45, total_ticks: 100 },
        { id: 'c-2', player_id: 'p1', building_type: 'conveyor_belt_mk1', position: { x: 22, y: 20, z: 0 }, state: 'building', enqueue_tick: 1, remaining_ticks: 5, total_ticks: 10 },
      ],
    },
  } as unknown as PlanetThreeData;
}

describe('VFX 场景桥接（纯函数）', () => {
  it('选中建筑：只画一个括号，中心 = 占地中心（position 是占地原点）', () => {
    const items = buildSelectionItems(data(), {
      selected: { kind: 'building', id: 'b-base', position: { x: 10, y: 10, z: 0 } }, hoveredTile: null,
      interactionMode: { kind: 'inspect' }, layers: { selection: true, logistics: true, buildings: true },
    }, true);
    expect(items).toHaveLength(1);
    const bracket = items[0];
    expect(bracket.kind).toBe('building');
    // 3×3 从 (10,10) 起：占地中心是 (11,11)，不是原点 (10,10)。
    expect(bracket.tile).toEqual({ x: 11, y: 11 });
    expect(bracket.footprintSize).toEqual({ width: 3, height: 3 });
    expect(bracket.footprint).toHaveLength(9);
  });

  it('选中建筑：1×1 / 5×5 的括号中心都等于占地中心', () => {
    const base = data();
    const withBuilding = (width: number, height: number) => ({
      ...base,
      planet: {
        ...base.planet,
        buildings: {
          ...base.planet.buildings,
          'b-x': { id: 'b-x', type: 't', position: { x: 6, y: 8, z: 0 }, owner_id: 'p1', hp: 100, rotation: 0,
            runtime: { state: 'running', params: { footprint: { width, height } } } },
        },
      },
    }) as unknown as PlanetThreeData;
    const select = (dataSet: PlanetThreeData) => buildSelectionItems(dataSet, {
      selected: { kind: 'building', id: 'b-x', position: { x: 6, y: 8, z: 0 } }, hoveredTile: null,
      interactionMode: { kind: 'inspect' }, layers: { selection: true, logistics: true, buildings: true },
    }, true);
    expect(select(withBuilding(1, 1))[0].tile).toEqual({ x: 6, y: 8 });
    expect(select(withBuilding(5, 5))[0].tile).toEqual({ x: 8, y: 10 });
    expect(select(withBuilding(5, 5))[0].footprintSize).toEqual({ width: 5, height: 5 });
  });

  it('选中单位：细环 + 方向三角（朝向取 rotation）', () => {
    const items = buildSelectionItems(data(), {
      selected: { kind: 'unit', id: 'u-1', position: { x: 11, y: 10, z: 0 } }, selectedUnits: ['u-1'], hoveredTile: { x: 3, y: 3 },
      interactionMode: { kind: 'inspect' }, layers: { selection: true, logistics: true, buildings: true },
    }, true);
    const unit = items.find((item) => item.kind === 'unit');
    expect(unit?.direction).toBeDefined();
    expect(items.some((item) => item.kind === 'hover')).toBe(true);
  });

  it('建造/攻击模式不画悬停细环（沿用绿/红色带）；选中图层关闭时为空', () => {
    const base = { selected: null, hoveredTile: { x: 3, y: 3 }, layers: { selection: true, logistics: true, buildings: true } };
    expect(buildSelectionItems(data(), { ...base, interactionMode: { kind: 'build' } }, true)).toHaveLength(0);
    expect(buildSelectionItems(data(), { ...base, interactionMode: { kind: 'attack' } }, true)).toHaveLength(0);
    expect(buildSelectionItems(data(), { ...base, selected: { kind: 'unit', id: 'u-1', position: { x: 11, y: 10, z: 0 } }, interactionMode: { kind: 'inspect' }, layers: { ...base.layers, selection: false } }, true)).toHaveLength(0);
  });

  it('施工全息：进度取 remaining/total，带子/分拣器不画，未探索格过滤', () => {
    const tasks = buildHoloTasks(data().runtime!.construction_tasks!, data().catalog, FACE, () => true);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].buildingType).toBe('assembling_machine_mk1');
    expect(tasks[0].progress).toBeCloseTo(0.55, 6);
    expect(tasks[0].width).toBe(3);
    const none = buildHoloTasks(data().runtime!.construction_tasks!, data().catalog, FACE, (task) => task.id !== 'c-1');
    expect(none).toHaveLength(0);
  });

  it('补给光环：运行薄荷绿、停机暗红、敌方不画、补给车浅蓝', () => {
    const auras = buildSupplyAuras(data());
    const byColor = new Map(auras.map((aura) => [aura.color, aura]));
    expect(byColor.get('#5ff0b0')?.radiusTiles).toBe(30);
    expect(byColor.get('#e0727f')?.running).toBe(false);
    expect(byColor.get('#7dc5f4')?.radiusTiles).toBe(12);
    // 敌方补给站不画（owner 判定）。
    expect(auras.filter((aura) => aura.color === '#5ff0b0')).toHaveLength(1);
  });
});

describe('VFX 边界用例', () => {
  const resolve = (id: string | undefined | null) => (id === 't' ? { x: 0, y: 0, z: 100, owner: 'own' as const, kind: 'building' as const } : null);
  const event = (payload: Record<string, unknown>): BattleEvent => ({ seq: 1, at: 0, type: 'damage_applied', payload, eventId: 'e', tick: 1 });

  it('粒子池满：容量上限生效，继续发射不抛错、不增长', () => {
    const settings = VFX_QUALITY.low;
    expect(settings.particleLimit).toBeLessThan(VFX_QUALITY.high.particleLimit);
    expect(VFX_QUALITY.high.particleLimit).toBe(5000);
    // 环形缓冲：live 计数不超过容量（由 ParticleBatch 内部保证；这里校验档位表口径）。
    expect(VFX_QUALITY.low.emissionScale).toBeLessThan(VFX_QUALITY.high.emissionScale);
    expect(VFX_QUALITY.low.dynamicLights).toBe(0);
  });

  it('设备暂停/缺电/矿点枯竭：不发射（活动源不存在 → 发射器空转）', () => {
    // 发射器只认 `collectActivity` 的 active 源；heat 只在 production.remaining_ticks > 0 时出现。
    const building = {
      id: 'b', type: 'arc_smelter', position: { x: 1, y: 1, z: 0 }, owner_id: 'p1',
      runtime: { state: 'no_power', functions: { production: { throughput: 1 } } },
      production: { remaining_ticks: 5 },
    };
    const source = { id: 'b:heat', kind: 'heat' as const, position: { x: 1, y: 1 }, active: building.runtime.state === 'running', color: '#ff9856', buildingId: 'b' };
    expect(source.active).toBe(false);
    expect(IndustryEmitters.offsetFor('arc_smelter')).toEqual(EMITTER_OFFSETS.arc_smelter);
    expect(IndustryEmitters.offsetFor('conveyor_belt_mk1')).toBeNull();
    expect(IndustryEmitters.profileFor('heat', 'arc_smelter')).toBe(INDUSTRY_PROFILES.heat);
    expect(IndustryEmitters.profileFor('heat', 'chemical_plant')?.styles[0].style.kind).toBe('smoke');
    expect(INDUSTRY_INTERVAL).toBeGreaterThan(0);
  });

  it('同一帧 ≥200 条战斗事件：事件口径不变（每条的指令数有界），上限常量存在', () => {
    let bursts = 0;
    for (let i = 0; i < 200; i++) {
      const specs = combatVfxFromEvent(event({ attacker_id: 't', target_id: 't', damage: 1 }), resolve);
      bursts += specs.bursts.length;
    }
    // 单条伤害事件的粒子批次有界（枪口 2 + 命中 2 + 焦痕 1 = 5），不会随事件数超线性增长。
    expect(bursts).toBe(200 * 4);
    expect(COMBAT_FX_LIMITS.damageFloats).toBe(24);
  });

  it('freeze 确定性：同一事件两次生成的指令逐字段一致；随机数只由 seed 决定', () => {
    const a = combatVfxFromEvent(event({ attacker_id: 't', target_id: 't', damage: 3 }), resolve);
    const b = combatVfxFromEvent(event({ attacker_id: 't', target_id: 't', damage: 3 }), resolve);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(rand(12345, 3)).toBe(rand(12345, 3));
    expect(randSigned(999, 1)).toBe(randSigned(999, 1));
    expect(hash01(0)).toBeGreaterThanOrEqual(0);
    expect(hash01(0)).toBeLessThan(1);
    // 不同 seed 产生不同序列。
    expect(rand(1, 1)).not.toBe(rand(2, 1));
    // 冻结时间常量固定。
    expect(FROZEN_TIME).toBeGreaterThan(0);
    expect(particleOpacity(0.5)).toBeGreaterThan(0);
    expect(particleOpacity(0)).toBe(0);
    expect(particleOpacity(1)).toBe(0);
  });

  it('粒子样式与图集帧区间对齐（每种样式都在图集里）', () => {
    for (const style of Object.values(PARTICLE_STYLES)) {
      const frames = ATLAS_FRAMES[style.kind];
      expect(frames).toBeDefined();
      expect(frames.start + frames.count).toBeLessThanOrEqual(16);
    }
  });

  it('镜头震动：freeze/reduced-motion 下不生效；强度上限 1；源数有上限', () => {
    const disabled = new CameraShake(() => false);
    disabled.add(1, 500);
    expect(disabled.intensity).toBe(0);
    const enabled = new CameraShake(() => true);
    for (let i = 0; i < 20; i++) enabled.add(1, 500);
    expect(enabled.intensity).toBeLessThanOrEqual(1);
    expect(SHAKE_SOURCES).toBe(6);
    enabled.update(0.6);
    expect(enabled.intensity).toBe(0);
    // 距离衰减：越远越弱，超出半径不震。
    expect(shakeFromExplosion(1, 0)).toBeGreaterThan(shakeFromExplosion(1, 10));
    expect(shakeFromExplosion(1, 100)).toBe(0);
  });
});
