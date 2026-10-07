import { beforeEach, describe, expect, it } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import { buildCombatAlert, findApproachingThreats, notifyApproachingThreats } from '@/features/planet-map/attack-alerts';
import { useNotificationsStore } from '@/features/notifications/store';
import { usePlanetViewStore } from '@/features/planet-map/store';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetNotificationsStore } from '@/features/notifications/store';
import { resetPlanetViewStore } from '@/features/planet-map/store';

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 8 },
    map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: [],
    buildings: {
      'b-1': {
        id: 'b-1',
        type: 'tesla_tower',
        owner_id: 'p1',
        position: { x: 2, y: 2, z: 0 },
        hp: 90,
        max_hp: 100,
      } as never,
    },
    units: {
      'u-1': {
        id: 'u-1',
        type: 'soldier',
        owner_id: 'p1',
        position: { x: 3, y: 3, z: 0 },
        hp: 50,
        max_hp: 80,
      } as never,
      'df-1': {
        id: 'df-1',
        type: 'dark_fog',
        owner_id: 'dark_fog',
        position: { x: 6, y: 6, z: 0 },
        hp: 30,
        max_hp: 30,
      } as never,
    },
    resources: [],
  } as PlanetRenderView;
}

function makeEvent(type: string, payload: Record<string, unknown>): GameEventDetail {
  return {
    event_id: `evt-${type}-1`,
    tick: 12,
    event_type: type,
    visibility_scope: 'p1',
    payload,
  };
}

describe('attack-alerts 受袭警报（C3）', () => {
  beforeEach(() => {
    resetNotificationsStore();
    resetPlanetViewStore();
  });

  it('己方建筑被黑雾攻击 → danger toast 聚合键 + 深链跳转位置', () => {
    const alert = buildCombatAlert(
      makeEvent('damage_applied', {
        attacker_id: 'df-1',
        attacker_type: 'unit',
        target_id: 'b-1',
        target_type: 'building',
        damage: 8,
        target_hp: 82,
      }),
      { planet: makePlanet(), playerId: 'p1', planetId: 'planet-1-1', now: 1000 },
    );

    expect(alert?.toast?.kind).toBe('danger');
    expect(alert?.toast?.title).toBe('建筑遭受攻击');
    expect(alert?.toast?.body).toContain('电力感应塔');
    expect(alert?.toast?.body).toContain('(2, 2)');
    // 一键跳转：深链携带受击坐标（PlanetPage 恢复 effect 消费 x/y → requestFocus）
    expect(alert?.toast?.href).toBe('/planet/planet-1-1?x=2&y=2');
    // 5s 合并窗口：同目标聚合计数（toast store 的 mergeKey 机制）
    expect(alert?.toast?.mergeKey).toBe('base_attack:b-1');
  });

  it('己方单位被打 → 单位受袭告警', () => {
    const alert = buildCombatAlert(
      makeEvent('damage_applied', { attacker_id: 'df-1', target_id: 'u-1', damage: 5, target_hp: 45 }),
      { planet: makePlanet(), playerId: 'p1', planetId: 'planet-1-1' },
    );
    expect(alert?.toast?.title).toBe('单位遭受攻击');
    expect(alert?.toast?.body).toContain('士兵');
  });

  it('己方开火（attacker 属己方）不告警', () => {
    const alert = buildCombatAlert(
      makeEvent('damage_applied', { attacker_id: 'u-1', target_id: 'b-1', damage: 5 }),
      { planet: makePlanet(), playerId: 'p1', planetId: 'planet-1-1' },
    );
    expect(alert).toBeNull();
  });

  it('敌方目标被打（我方输出）不告警', () => {
    const alert = buildCombatAlert(
      makeEvent('damage_applied', { attacker_id: 'u-1', target_id: 'df-1', damage: 5 }),
      { planet: makePlanet(), playerId: 'p1', planetId: 'planet-1-1' },
    );
    expect(alert).toBeNull();
  });

  it('enemy_wave_incoming → 来袭波次 + danger toast（方向与目标）', () => {
    const alert = buildCombatAlert(
      makeEvent('enemy_wave_incoming', {
        nest_id: 'nest-1',
        from: { x: 20, y: 3, z: 0 },
        count: 6,
        level: 2,
        target_building_id: 'b-1',
        target_pos: { x: 2, y: 2, z: 0 },
        target_owner: 'p1',
      }),
      { planet: makePlanet(), playerId: 'p1', planetId: 'planet-1-1', now: 1000 },
    );

    expect(alert?.wave).toMatchObject({
      nestId: 'nest-1',
      from: { x: 20, y: 3 },
      target: { x: 2, y: 2 },
      count: 6,
      level: 2,
    });
    expect(alert?.toast?.kind).toBe('danger');
    expect(alert?.toast?.title).toBe('侦测到黑雾袭击');
    expect(alert?.toast?.body).toContain('6 个单位来自 (20, 3)');
    expect(alert?.toast?.body).toContain('目标 (2, 2)');
    // 跳转到受袭目标位置
    expect(alert?.toast?.href).toBe('/planet/planet-1-1?x=2&y=2');
    expect(alert?.toast?.mergeKey).toBe('enemy_wave:nest-1');
  });

  it('enemy_wave_incoming 无目标时跳来源方向', () => {
    const alert = buildCombatAlert(
      makeEvent('enemy_wave_incoming', { nest_id: 'nest-2', from: { x: 9, y: 9 }, count: 3, level: 1 }),
      { planet: makePlanet(), playerId: 'p1', planetId: 'planet-1-1' },
    );
    expect(alert?.wave?.target).toBeNull();
    expect(alert?.toast?.href).toBe('/planet/planet-1-1?x=9&y=9');
  });

  it('跳转深链保留当前视图参数（view=2d 不被丢弃）', () => {
    const alert = buildCombatAlert(
      makeEvent('damage_applied', { attacker_id: 'df-1', target_id: 'b-1', damage: 8 }),
      { planet: makePlanet(), playerId: 'p1', planetId: 'planet-1-1', currentSearch: '?view=2d&quality=low' },
    );
    expect(alert?.toast?.href).toBe('/planet/planet-1-1?view=2d&quality=low&x=2&y=2');
  });
});

describe('敌袭预警（敌对单位逼近己方建筑）', () => {
  beforeEach(() => {
    resetNotificationsStore();
    resetPlanetViewStore();
  });

  it('中立黑雾不报，敌对黑雾与敌方单位按最近建筑聚合', () => {
    const planet = makePlanet();
    expect(findApproachingThreats(planet, 'p1', false)).toEqual([]);
    const hostile = findApproachingThreats(planet, 'p1', true);
    expect(hostile).toHaveLength(1);
    expect(hostile[0]).toMatchObject({ buildingId: 'b-1', count: 1, threatTile: { x: 6, y: 6 } });
    planet.units!['e-1'] = { id: 'e-1', type: 'soldier', owner_id: 'p2', position: { x: 5, y: 5, z: 0 }, hp: 10, max_hp: 10 } as never;
    expect(findApproachingThreats(planet, 'p1', false)[0]).toMatchObject({ count: 1, threatTile: { x: 5, y: 5 } });
    expect(findApproachingThreats(planet, 'p1', false, 1)).toEqual([]);
  });

  it('告警带定位并写入小地图闪点，冷却内不重复', () => {
    const planet = makePlanet();
    notifyApproachingThreats(planet, 'p1', true, 1_000_000);
    notifyApproachingThreats(planet, 'p1', true, 1_005_000);
    const toasts = useNotificationsStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ title: '敌袭预警', locate: { planetId: 'planet-1-1', x: 6, y: 6 } });
    expect(usePlanetViewStore.getState().incomingWaves).toHaveLength(1);
  });
});
