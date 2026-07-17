import { describe, expect, it } from 'vitest';

import {
  computeSystemLanes,
  galaxyWorldRect,
  hashAngle,
  layoutSystemOrbits,
  planetColorOf,
  selectWarLanes,
  starColorOf,
  starTypeLabel,
  summarizeFleetsBySystem,
} from '@/features/starmap/model';
import type { GalaxyView, SystemRef } from '@shared/types';

function makeSystem(id: string, x: number, y: number, discovered = true): SystemRef {
  return { system_id: id, name: id, discovered, position: { x, y } };
}

describe('starmap/model', () => {
  it('恒星光谱型映射颜色，未知类型回退默认色', () => {
    expect(starColorOf('G')).toBe(0xfff4e8);
    expect(starColorOf('m')).toBe(0xffb56c);
    expect(starColorOf('???')).toBe(starColorOf(undefined));
  });

  it('行星种类映射颜色，气态带条纹色', () => {
    expect(planetColorOf('terrestrial')[0]).toBe(0x6fb7ff);
    expect(planetColorOf('gas_giant')).toHaveLength(2);
    expect(planetColorOf('unknown-kind')[0]).toBe(0x9aa7bd);
  });

  it('starTypeLabel 输出中文标签', () => {
    expect(starTypeLabel('G')).toBe('G 型恒星');
    expect(starTypeLabel(undefined)).toBe('未知恒星');
  });

  it('galaxyWorldRect 以 width/height 为主并外扩边距', () => {
    const galaxy: GalaxyView = {
      galaxy_id: 'g',
      discovered: true,
      width: 1000,
      height: 800,
      systems: [makeSystem('a', 0, 0), makeSystem('b', 1000, 800)],
    };
    const rect = galaxyWorldRect(galaxy);
    expect(rect.width).toBeGreaterThan(1000);
    expect(rect.height).toBeGreaterThan(800);
    expect(rect.x).toBeLessThan(0);
    expect(rect.y).toBeLessThan(0);
  });

  it('galaxyWorldRect 无尺寸时按恒星分布外扩，空数据回退默认世界', () => {
    const rect = galaxyWorldRect({
      galaxy_id: 'g',
      discovered: true,
      systems: [makeSystem('a', 100, 100), makeSystem('b', 500, 300)],
    });
    expect(rect.width).toBeGreaterThan(400);
    expect(rect.x).toBeLessThan(100);

    const fallback = galaxyWorldRect({ galaxy_id: 'g', discovered: true, systems: [] });
    expect(fallback).toEqual({ x: 0, y: 0, width: 1200, height: 900 });
  });

  it('layoutSystemOrbits 轨道半径递增且角度确定', () => {
    const planets = [
      { planet_id: 'p-a', discovered: true, orbit: { distance_au: 2, period_days: 700, inclination_deg: 0 } },
      { planet_id: 'p-b', discovered: true, orbit: { distance_au: 1, period_days: 365, inclination_deg: 0 } },
      { planet_id: 'p-c', discovered: true },
    ];
    const layout = layoutSystemOrbits(planets);
    // distance_au 排序：p-b(1) < p-a(2) < p-c(无，按原顺序在最后)
    expect(layout.map((l) => l.planet.planet_id)).toEqual(['p-b', 'p-a', 'p-c']);
    for (let i = 1; i < layout.length; i += 1) {
      expect(layout[i]!.orbitRadius).toBeGreaterThan(layout[i - 1]!.orbitRadius);
    }
    const again = layoutSystemOrbits(planets);
    expect(again.map((l) => l.angle)).toEqual(layout.map((l) => l.angle));
  });

  it('气态行星显示半径大于岩质行星', () => {
    const layout = layoutSystemOrbits([
      { planet_id: 'p-gas', discovered: true, kind: 'gas_giant' },
      { planet_id: 'p-rock', discovered: true, kind: 'terrestrial' },
    ]);
    const gas = layout.find((l) => l.planet.planet_id === 'p-gas')!;
    const rock = layout.find((l) => l.planet.planet_id === 'p-rock')!;
    expect(gas.radius).toBeGreaterThan(rock.radius);
  });

  it('computeSystemLanes 每系连最近 k 个邻居且去重', () => {
    const systems = [
      makeSystem('a', 0, 0),
      makeSystem('b', 10, 0),
      makeSystem('c', 20, 0),
      makeSystem('d', 100, 100),
    ];
    const lanes = computeSystemLanes(systems, 1);
    // a-b、b-c、c-d 方向各一条（最近邻），且不含重复对
    const keys = lanes.map((lane) => `${lane.from.x},${lane.from.y}->${lane.to.x},${lane.to.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(lanes.length).toBeGreaterThanOrEqual(3);
    expect(lanes.length).toBeLessThanOrEqual(systems.length);
  });

  it('computeSystemLanes 忽略无坐标的恒星系', () => {
    const lanes = computeSystemLanes([
      makeSystem('a', 0, 0),
      { system_id: 'b', discovered: false },
      makeSystem('c', 10, 0),
    ]);
    expect(lanes.length).toBe(1);
  });

  it('hashAngle 稳定且在 [0, 2π)', () => {
    const a1 = hashAngle('planet-1-1');
    const a2 = hashAngle('planet-1-1');
    expect(a1).toBe(a2);
    expect(a1).toBeGreaterThanOrEqual(0);
    expect(a1).toBeLessThan(Math.PI * 2);
    expect(hashAngle('planet-1-2')).not.toBe(a1);
  });

  it('summarizeFleetsBySystem 按 system_id 分组计数并统计 attacking，排序确定', () => {
    const summary = summarizeFleetsBySystem([
      { system_id: 'sys-b', state: 'idle' },
      { system_id: 'sys-a', state: 'attacking' },
      { system_id: 'sys-b', state: 'attacking' },
      { system_id: 'sys-b', state: 'idle' },
      { system_id: '', state: 'idle' }, // 无星系归属：跳过
    ]);
    expect(summary).toEqual([
      { systemId: 'sys-a', total: 1, attacking: 1 },
      { systemId: 'sys-b', total: 3, attacking: 1 },
    ]);
    expect(summarizeFleetsBySystem([])).toEqual([]);
  });

  it('selectWarLanes 只挑 attacking 星系的航线，方向从 attacking 端向外', () => {
    const systems = [
      makeSystem('a', 0, 0),
      makeSystem('b', 10, 0),
      makeSystem('c', 20, 0),
    ];
    const lanes = computeSystemLanes(systems, 1);
    const original = lanes.map((lane) => ({ ...lane }));

    // b attacking：a-b 与 b-c 入选，a-b 定向为 b→a，b-c 保持 b→c
    const warLanes = selectWarLanes(lanes, new Set(['b']));
    expect(warLanes).toHaveLength(2);
    const ab = warLanes.find((lane) => [lane.fromId, lane.toId].sort().join('~') === 'a~b')!;
    expect(ab.fromId).toBe('b');
    expect(ab.toId).toBe('a');
    expect(ab.from).toEqual({ x: 10, y: 0 });
    expect(ab.to).toEqual({ x: 0, y: 0 });
    const bc = warLanes.find((lane) => [lane.fromId, lane.toId].sort().join('~') === 'b~c')!;
    expect(bc.fromId).toBe('b');
    expect(bc.toId).toBe('c');

    // 无 attacking：全静态
    expect(selectWarLanes(lanes, new Set())).toEqual([]);
    // 不改传入 lanes
    expect(lanes).toEqual(original);
  });

  it('selectWarLanes 两端都 attacking 时保持原向且只出现一次', () => {
    const systems = [makeSystem('a', 0, 0), makeSystem('b', 10, 0)];
    const lanes = computeSystemLanes(systems, 1);
    expect(lanes).toHaveLength(1);
    const warLanes = selectWarLanes(lanes, new Set(['a', 'b']));
    expect(warLanes).toHaveLength(1);
    expect(warLanes[0]!.fromId).toBe(lanes[0]!.fromId);
    expect(warLanes[0]!.from).toEqual(lanes[0]!.from);
  });
});
