import { describe, expect, it } from 'vitest';

import type { FleetRuntimeView, PlanetRef, SystemRuntimeView } from '@shared/types';

import {
  BATTLEFIELD_HIT_RADIUS,
  BATTLEFIELD_VIEW_HEIGHT,
  BATTLEFIELD_VIEW_WIDTH,
  hitTestBattlefieldMarker,
  layoutBattlefieldMarkers,
  nearestHostileMarkerPosition,
  planetAnchor,
  resolveBattlefieldEntityPosition,
  type BattlefieldMarkerLayout,
} from '@/features/war/battlefield/battlefield-model';

const planets: PlanetRef[] = [
  { planet_id: 'planet-1-1', name: 'Gaia', discovered: true, kind: 'terrestrial' },
  { planet_id: 'planet-1-2', name: 'Ares', discovered: true, kind: 'lava' },
];

function createRuntime(): SystemRuntimeView {
  return {
    system_id: 'sys-1',
    discovered: true,
    available: true,
    planet_blockades: [
      { planet_id: 'planet-1-1', system_id: 'sys-1', owner_id: 'p1', status: 'active' },
    ],
    landing_operations: [
      {
        id: 'landing-1',
        owner_id: 'p1',
        task_force_id: 'tf-1',
        system_id: 'sys-1',
        planet_id: 'planet-1-1',
        stage: 'reconnaissance',
        result: 'pending',
      },
    ],
    contacts: [
      {
        id: 'contact-1',
        scope_type: 'system',
        scope_id: 'sys-1',
        contact_kind: 'enemy_force',
        entity_id: 'enemy-fleet-3',
        level: 'confirmed',
        position: { x: 4, y: 2 },
        threat_level: 7,
        signal_strength: 0.7,
        classification: 'destroyer_screen',
        last_updated_tick: 320,
      },
    ],
  } as unknown as SystemRuntimeView;
}

const fleets = [
  { fleet_id: 'fleet-1', owner_id: 'p1', system_id: 'sys-1', formation: 'line', state: 'ready' },
  { fleet_id: 'fleet-9', owner_id: 'p2', system_id: 'sys-2', formation: 'wedge', state: 'moving' },
] as unknown as FleetRuntimeView[];

describe('battlefield-model 布局', () => {
  it('planetAnchor：单行星固定在正右方，多行星沿圆周排布且半径递增', () => {
    const single = planetAnchor(0, 1);
    expect(single.x).toBeCloseTo(BATTLEFIELD_VIEW_WIDTH / 2 + 120, 6);
    expect(single.y).toBeCloseTo(BATTLEFIELD_VIEW_HEIGHT / 2, 6);

    const first = planetAnchor(0, 2);
    const second = planetAnchor(1, 2);
    expect(Math.hypot(first.x - BATTLEFIELD_VIEW_WIDTH / 2, first.y - BATTLEFIELD_VIEW_HEIGHT / 2)).toBeCloseTo(120, 6);
    expect(Math.hypot(second.x - BATTLEFIELD_VIEW_WIDTH / 2, second.y - BATTLEFIELD_VIEW_HEIGHT / 2)).toBeCloseTo(156, 6);
    // 两颗行星相对（角度差 π）
    expect(second.x).toBeCloseTo(BATTLEFIELD_VIEW_WIDTH / 2 - 156, 6);
  });

  it('layoutBattlefieldMarkers：行星/舰队/接触全量排布并保留示意图语义', () => {
    const markers = layoutBattlefieldMarkers({
      planets,
      runtime: createRuntime(),
      fleets,
      playerId: 'p1',
    });

    const planet = markers.find((marker) => marker.id === 'planet-1-1');
    expect(planet?.kind).toBe('planet');
    expect(planet?.tone).toBe('enemy'); // 被封锁
    expect(planet?.blockaded).toBe(true);
    expect(planet?.detail).toBe('封锁 active · 登陆 reconnaissance');

    const free = markers.find((marker) => marker.id === 'planet-1-2');
    expect(free?.tone).toBe('neutral');
    expect(free?.blockaded).toBe(false);
    expect(free?.detail).toBeUndefined();

    // 本星系舰队锚定第一个行星旁（+28, -22），tone 按 owner 划分
    const ownFleet = markers.find((marker) => marker.id === 'fleet-1');
    expect(ownFleet?.tone).toBe('own');
    expect(ownFleet?.x).toBeCloseTo((planet?.x ?? 0) + 28, 6);
    expect(ownFleet?.y).toBeCloseTo((planet?.y ?? 0) - 22, 6);

    // 外星系舰队锚定视口中心旁，且属敌方
    const otherFleet = markers.find((marker) => marker.id === 'fleet-9');
    expect(otherFleet?.tone).toBe('enemy');
    expect(otherFleet?.x).toBeCloseTo(BATTLEFIELD_VIEW_WIDTH / 2 + 28, 6);
    expect(otherFleet?.y).toBeCloseTo(BATTLEFIELD_VIEW_HEIGHT / 2 - 22, 6);

    // contact：position×6 钳位 + entityId 记录
    const contact = markers.find((marker) => marker.id === 'contact-1');
    expect(contact?.kind).toBe('contact');
    expect(contact?.entityId).toBe('enemy-fleet-3');
    expect(contact?.x).toBeCloseTo(BATTLEFIELD_VIEW_WIDTH / 2 + 24, 6);
    expect(contact?.y).toBeCloseTo(BATTLEFIELD_VIEW_HEIGHT / 2 + 12, 6);
  });

  it('layoutBattlefieldMarkers：contact position 超出视口时按边距钳位', () => {
    const runtime = createRuntime();
    runtime.contacts = [
      {
        ...(runtime.contacts ?? [])[0],
        id: 'contact-far',
        position: { x: 500, y: -500, z: 0 },
      },
    ];
    const markers = layoutBattlefieldMarkers({ planets, runtime, fleets: [], playerId: 'p1' });
    const far = markers.find((marker) => marker.id === 'contact-far');
    expect(far?.x).toBeCloseTo(BATTLEFIELD_VIEW_WIDTH - 24, 6);
    expect(far?.y).toBeCloseTo(24, 6);
  });

  it('hitTestBattlefieldMarker：半径内取最近者，落空返回 null', () => {
    const markers: BattlefieldMarkerLayout[] = [
      { id: 'a', kind: 'fleet', label: 'a', x: 100, y: 100, tone: 'own' },
      { id: 'b', kind: 'contact', label: 'b', x: 108, y: 100, tone: 'enemy' },
      { id: 'c', kind: 'planet', label: 'c', x: 300, y: 300, tone: 'neutral' },
    ];
    expect(hitTestBattlefieldMarker(markers, 106, 100)?.id).toBe('b');
    expect(hitTestBattlefieldMarker(markers, 100, 100)?.id).toBe('a');
    // 边界：恰好等于半径也算命中
    expect(hitTestBattlefieldMarker(markers, 300 - BATTLEFIELD_HIT_RADIUS, 300)?.id).toBe('c');
    expect(hitTestBattlefieldMarker(markers, 200, 200)).toBeNull();
  });

  it('resolveBattlefieldEntityPosition：按标记 id 或 contact.entity_id 解析', () => {
    const markers = layoutBattlefieldMarkers({
      planets,
      runtime: createRuntime(),
      fleets,
      playerId: 'p1',
    });
    expect(resolveBattlefieldEntityPosition(markers, 'fleet-1')).not.toBeNull();
    const byEntity = resolveBattlefieldEntityPosition(markers, 'enemy-fleet-3');
    const byContactId = resolveBattlefieldEntityPosition(markers, 'contact-1');
    expect(byEntity).toEqual(byContactId);
    expect(resolveBattlefieldEntityPosition(markers, 'ghost')).toBeNull();
    expect(resolveBattlefieldEntityPosition(markers, undefined)).toBeNull();
  });

  it('nearestHostileMarkerPosition：只在敌方标记中找最近者', () => {
    const markers = layoutBattlefieldMarkers({
      planets,
      runtime: createRuntime(),
      fleets,
      playerId: 'p1',
    });
    const ownFleet = markers.find((marker) => marker.id === 'fleet-1');
    const hostile = nearestHostileMarkerPosition(markers, ownFleet?.x ?? 0, ownFleet?.y ?? 0);
    expect(hostile).not.toBeNull();
    // 最近敌点不得是己方舰队自身位置
    expect(hostile).not.toEqual({ x: ownFleet?.x, y: ownFleet?.y });

    const peaceful = markers.filter((marker) => marker.tone !== 'enemy');
    expect(nearestHostileMarkerPosition(peaceful, 0, 0)).toBeNull();
  });
});
