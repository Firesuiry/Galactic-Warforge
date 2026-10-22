import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { IndustryEmitters, PRIME_ROUNDS, registerBuildingType } from './emitters';
import { VFX_QUALITY } from './common';
import type { ActivitySource } from '../industrial-activity';
import type { ParticleSystem } from './particles';

const FACE = 288;

interface Emitted { id: string; count: number; at?: number }

/** 记录发射调用的粒子系统替身（不建 GPU 缓冲）。 */
function recorder() {
  const calls: Emitted[] = [];
  const system = {
    emit: (_style: unknown, burst: { count: number }, at?: number) => {
      calls.push({ id: String(calls.length), count: burst.count, at });
      return burst.count;
    },
  } as unknown as ParticleSystem;
  return { system, calls };
}

function heatSource(id: string, buildingId: string, active = true): ActivitySource {
  return { id, kind: 'heat', position: { x: 62, y: 140 }, active, buildingId, color: '#ff9856' };
}

function makeEmitters(system: ParticleSystem) {
  return new IndustryEmitters(system, VFX_QUALITY.high, () => 0.4, 100, () => new THREE.Vector3(0, 0, 1));
}

describe('工业氛围发射器（只认权威活动源）', () => {
  registerBuildingType('b-smelt', 'arc_smelter', { width: 3, height: 3 });

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
});
