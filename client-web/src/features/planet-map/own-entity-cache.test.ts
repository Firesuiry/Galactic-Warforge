import { describe, expect, it } from 'vitest';

import type { Building, Unit } from '@shared/types';

import type { PlanetRenderView } from '@/features/planet-map/model';
import { accumulateOwnEntities, createOwnEntityCache, ownEntitySnapshot } from '@/features/planet-map/own-entity-cache';
import { resolveWarGuide } from '@/features/onboarding/war-guide';

const building = (id: string, type: string, owner = 'p1', hp = 10) =>
  ({ id, type, owner_id: owner, hp, position: { x: 0, y: 0, z: 0 } }) as Building;
const unit = (id: string, type: string, owner = 'p1', hp = 10) =>
  ({ id, type, owner_id: owner, hp, position: { x: 0, y: 0, z: 0 } }) as Unit;

function planetWith(buildings: Building[], units: Unit[] = []): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 8 },
    map_width: 24,
    map_height: 16,
    tick: 1,
    buildings: Object.fromEntries(buildings.map((b) => [b.id, b])),
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    resources: [],
  } as PlanetRenderView;
}

describe('own-entity 累积缓存（跨场景窗口）', () => {
  it('窗口平移丢失建筑后仍保留历史（引导不回退）', () => {
    const cache = createOwnEntityCache();
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine'), building('b-2', 'tesla_tower')]), 'p1');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.type)).toEqual(['wind_turbine', 'tesla_tower']);

    // 镜头移到没有己方实体的窗口：这一帧 buildings 为空
    accumulateOwnEntities(cache, planetWith([]), 'p1');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.id)).toEqual(['b-1', 'b-2']);
  });

  it('只累积己方存活实体，阵亡与敌方不入缓存', () => {
    const cache = createOwnEntityCache();
    accumulateOwnEntities(cache, planetWith(
      [building('b-own', 'wind_turbine'), building('b-dead', 'tesla_tower', 'p1', 0), building('b-enemy', 'barracks', 'p2')],
      [unit('u-own', 'soldier'), unit('u-dead', 'soldier', 'p1', 0), unit('u-fog', 'dark_fog', 'dark_fog')],
    ), 'p1');
    const snapshot = ownEntitySnapshot(cache);
    expect(snapshot.buildings.map((b) => b.id)).toEqual(['b-own']);
    expect(snapshot.units.map((u) => u.id)).toEqual(['u-own']);
    // 黑雾单独累积：引导的「黑雾中立」提示不能因镜头平移而消失
    expect(snapshot.fogUnits.map((u) => u.id)).toEqual(['u-fog']);
  });

  it('同一实体被后续窗口更新时取最新一帧；换行星整份作废', () => {
    const cache = createOwnEntityCache();
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine', 'p1', 10)]), 'p1');
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine', 'p1', 7)]), 'p1');
    expect(ownEntitySnapshot(cache).buildings[0].hp).toBe(7);

    accumulateOwnEntities(cache, { ...planetWith([building('b-9', 'miner', 'p1')]), planet_id: 'planet-2-1' }, 'p1');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.id)).toEqual(['b-9']);
  });

  it('同一行星开新局（对局标识变化）时整份作废，不用上一局建筑点亮引导', () => {
    const cache = createOwnEntityCache();
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine'), building('b-2', 'tesla_tower')]), 'p1', 'game-1::seed-a');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.id)).toEqual(['b-1', 'b-2']);

    // 同一颗行星、新一局（started_at/map_seed 变了）：窗口里只有新局的一栋建筑
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine')]), 'p1', 'game-2::seed-b');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.id)).toEqual(['b-1']);
    expect(cache.gameIdentity).toBe('game-2::seed-b');

    // 同一局内窗口平移仍保留历史
    accumulateOwnEntities(cache, planetWith([]), 'p1', 'game-2::seed-b');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.id)).toEqual(['b-1']);
  });

  it('没有对局标识（离线样例）时只按行星作废，不因标识为空反复清空', () => {
    const cache = createOwnEntityCache();
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine')]), 'p1', 'game-1::seed-a');
    accumulateOwnEntities(cache, planetWith([building('b-2', 'tesla_tower')]), 'p1');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.id)).toEqual(['b-1', 'b-2']);
    expect(cache.gameIdentity).toBe('game-1::seed-a');
  });

  it('尚未登录（playerId 为空）时不累积，也不因 planet 缺失清空', () => {
    const cache = createOwnEntityCache();
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine')]), '');
    expect(ownEntitySnapshot(cache).buildings).toEqual([]);
    accumulateOwnEntities(cache, planetWith([building('b-1', 'wind_turbine')]), 'p1');
    accumulateOwnEntities(cache, undefined, 'p1');
    expect(ownEntitySnapshot(cache).buildings.map((b) => b.id)).toEqual(['b-1']);
  });

  it('回归（阻断级 4）：窗口平移清空 buildings 后，新手引导不回退', () => {
    const cache = createOwnEntityCache();
    const full = planetWith([
      building('b-wind', 'wind_turbine'),
      building('b-grid', 'tesla_tower'),
      building('b-mine', 'mining_machine'),
      building('b-smelt', 'arc_smelter'),
    ]);
    const guideOf = () => {
      const snapshot = ownEntitySnapshot(cache);
      return resolveWarGuide({
        playerId: 'p1',
        buildings: snapshot.buildings,
        units: [...snapshot.units, ...snapshot.fogUnits],
        legions: [],
      });
    };
    accumulateOwnEntities(cache, full, 'p1');
    const before = guideOf();
    expect(before.current?.id).toBe('ammo');
    expect(before.steps.filter((step) => step.done)).toHaveLength(4);

    // 镜头移到基地以外的窗口：服务端 scene 响应里 buildings 为空
    accumulateOwnEntities(cache, planetWith([]), 'p1');
    const after = guideOf();
    expect(after.current?.id).toBe(before.current?.id);
    expect(after.steps.filter((step) => step.done)).toHaveLength(4);

    // 对照组：直接用窗口数据推导会回退到 1/8（修复前的行为）
    const naive = resolveWarGuide({ playerId: 'p1', buildings: [], units: [], legions: [] });
    expect(naive.current?.id).toBe('power');
    expect(naive.steps.filter((step) => step.done)).toHaveLength(0);
  });
});
