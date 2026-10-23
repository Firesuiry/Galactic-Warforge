import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { IndustryEmitters, PRIME_ROUNDS, registerBuildingType } from './emitters';
import { VFX_QUALITY } from './common';
import type { ActivitySource } from '../industrial-activity';
import { ParticleSystem } from './particles';

const FACE = 288;

interface Emitted { id: string; count: number; at?: number; style: string; velocity: THREE.Vector3; position: THREE.Vector3 }

/** 记录发射调用的粒子系统替身（不建 GPU 缓冲）。 */
function recorder() {
  const calls: Emitted[] = [];
  const system = {
    emit: (style: { kind: string }, burst: { count: number; velocity: THREE.Vector3; position: THREE.Vector3 }, at?: number) => {
      calls.push({
        id: String(calls.length), count: burst.count, at, style: style.kind,
        velocity: burst.velocity.clone(), position: burst.position.clone(),
      });
      return burst.count;
    },
  } as unknown as ParticleSystem;
  return { system, calls };
}

function heatSource(id: string, buildingId: string, active = true): ActivitySource {
  return { id, kind: 'heat', position: { x: 62, y: 140 }, active, buildingId, color: '#ff9856' };
}

function makeEmitters(system: ParticleSystem, tileSize = 0.4) {
  return new IndustryEmitters(system, VFX_QUALITY.high, () => tileSize, 100, () => new THREE.Vector3(0, 0, 1));
}

function source(kind: ActivitySource['kind'], buildingId: string, active = true): ActivitySource {
  return { id: `${buildingId}:${kind}`, kind, position: { x: 62, y: 140 }, active, buildingId, color: '#fff' };
}

describe('工业氛围发射器（只认权威活动源）', () => {
  registerBuildingType('b-smelt', 'arc_smelter', { width: 3, height: 3 });
  registerBuildingType('b-assembler', 'assembling_machine_mk1', { width: 3, height: 3 });
  registerBuildingType('b-lab', 'matrix_lab', { width: 3, height: 3 });
  registerBuildingType('b-chem', 'chemical_plant', { width: 3, height: 3 });

  it('设备暂停 / 缺电 / 矿点枯竭（源 active=false）不发射', () => {
    const { system, calls } = recorder();
    const emitters = makeEmitters(system);
    emitters.update([heatSource('b-smelt:heat', 'b-smelt', false)], 0.5, 1, FACE, false);
    expect(calls).toHaveLength(0);
    // 源里没有 buildingId（矿点枯竭/未登记类型）同样不发射。
    emitters.update([{ id: 'x', kind: 'heat', position: { x: 1, y: 1 }, active: true, color: '#fff' }], 0.5, 2, FACE, false);
    expect(calls).toHaveLength(0);
  });

  it('运行中的熔炉按间隔发射（火/火花/烟三种样式）', () => {
    const { system, calls } = recorder();
    const emitters = makeEmitters(system);
    emitters.update([heatSource('b-smelt:heat', 'b-smelt')], 0.5, 1, FACE, false);
    expect(calls).toHaveLength(3);
    expect(emitters.activeEmitters).toBe(1);
    // 同一相位窗内不重复发射。
    emitters.update([heatSource('b-smelt:heat', 'b-smelt')], 0.01, 1.01, FACE, false);
    expect(calls).toHaveLength(3);
  });

  it('冻结：数据晚到时仍会预发射（不能把「空集合」当成已发射）', () => {
    const { system, calls } = recorder();
    const emitters = makeEmitters(system);
    // 场景构造后第一帧数据还没到：空集合。
    emitters.update([], 0, 0.9, FACE, true);
    expect(calls).toHaveLength(0);
    // 数据到达：必须按新集合预发射。
    emitters.update([heatSource('b-smelt:heat', 'b-smelt')], 0, 0.9, FACE, true);
    // 补多轮（受时间窗限制，最多 PRIME_ROUNDS 轮），至少不是只有一轮。
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.length).toBeLessThanOrEqual(3 * PRIME_ROUNDS);
    // 之后每帧保持静止（不新增粒子，画面是时间的纯函数）。
    const frozen = calls.length;
    emitters.update([heatSource('b-smelt:heat', 'b-smelt')], 0, 0.9, FACE, true);
    expect(calls).toHaveLength(frozen);
    // 预发射的发射时刻各不相同（补出稳态烟柱，而不是一轮）。
    expect(new Set(calls.map((call) => call.at)).size).toBeGreaterThan(1);
  });

  it('冻结预发射确定性：同源集合两次结果一致', () => {
    const a = recorder(), b = recorder();
    const first = makeEmitters(a.system), second = makeEmitters(b.system);
    first.update([heatSource('b-smelt:heat', 'b-smelt')], 0, 0.9, FACE, true);
    second.update([heatSource('b-smelt:heat', 'b-smelt')], 0, 0.9, FACE, true);
    expect(a.calls.map((call) => [call.count, call.at])).toEqual(b.calls.map((call) => [call.count, call.at]));
  });

  it('process 源按建筑类型分流：装配台焊花 / 研究站光粒 / 化工蒸汽都可达', () => {
    for (const [buildingId, expected] of [['b-assembler', 'spark'], ['b-lab', 'glow'], ['b-chem', 'smoke']] as const) {
      const { system, calls } = recorder();
      const emitters = makeEmitters(system);
      emitters.update([source('process', buildingId)], 0.5, 1, FACE, false);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((call) => call.style === expected)).toBe(true);
    }
  });

  it('process 源在设备暂停（active=false）时不发射', () => {
    const { system, calls } = recorder();
    const emitters = makeEmitters(system);
    for (const buildingId of ['b-assembler', 'b-lab', 'b-chem']) {
      emitters.update([source('process', buildingId, false)], 0.5, 1, FACE, false);
    }
    expect(calls).toHaveLength(0);
  });

  it('速度只乘一次格宽：不同格宽下「格/秒」一致（16 / 288 / 816 面，误差 < 5%）', () => {
    // 面越大格宽越小（16 面 ≈ 6.94、288 面 ≈ 0.386、816 面 ≈ 0.137）。
    const speeds: number[] = [];
    for (const tileSize of [6.94, 0.386, 0.137]) {
      const { system, calls } = recorder();
      const emitters = makeEmitters(system, tileSize);
      emitters.update([heatSource('b-smelt:heat', 'b-smelt')], 0.5, 1, FACE, false);
      const fire = calls.find((call) => call.style === 'fire');
      expect(fire).toBeDefined();
      // 发射器交出的速度是「格/秒」（法线 (0,0,1) → 长度即标称速度），与格宽无关。
      speeds.push(fire!.velocity.length());
    }
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeLessThan(1.05);
    // 标称 1.1 格/秒（`INDUSTRY_PROFILES.heat` 的火光）。
    for (const speed of speeds) expect(Math.abs(speed - 1.1) / 1.1).toBeLessThan(0.05);
  });

  it('端到端：粒子缓冲里的世界速度 / 格宽在 16 面与 288 面一致（不再双乘）', () => {
    const attributeSpeed = (tileSize: number) => {
      const system = new ParticleSystem(new THREE.Group(), VFX_QUALITY.high);
      system.setWorldScale(650, tileSize);
      const emitters = makeEmitters(system, tileSize);
      emitters.update([heatSource('b-smelt:heat', 'b-smelt')], 0.5, 1, FACE, false);
      const points = system.group.children[0] as THREE.Points;
      const velocity = points.geometry.getAttribute('velocity') as THREE.BufferAttribute;
      const value = Math.hypot(velocity.getX(0), velocity.getY(0), velocity.getZ(0));
      system.dispose();
      return value / tileSize;
    };
    const coarse = attributeSpeed(6.94);
    const fine = attributeSpeed(0.386);
    expect(Math.abs(coarse - fine) / coarse).toBeLessThan(0.05);
  });
});
