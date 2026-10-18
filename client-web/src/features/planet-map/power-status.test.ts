import { describe, expect, it } from 'vitest';

import type { PlanetNetworksView } from '@shared/types';

import {
  isInIsolatedNetwork,
  isOwnStalledBuilding,
  isPowerAlertType,
  isolatedPowerNetworks,
} from '@/features/planet-map/power-status';

function makeBuilding(id: string, type: string, state: string | undefined, ownerId = 'p1', x = 1, y = 1) {
  return {
    id,
    type,
    owner_id: ownerId,
    position: { x, y, z: 0 },
    hp: 100,
    max_hp: 100,
    runtime: state === undefined ? {} : { state, state_reason: `reason_${state}` },
  } as never;
}

function makeNetworks(partial: Partial<PlanetNetworksView>): PlanetNetworksView {
  return { planet_id: 'planet-1-1', discovered: true, available: true, tick: 10, ...partial } as PlanetNetworksView;
}

describe('power-status 断电告警分类', () => {
  it('isPowerAlertType：断电类告警（power_shortage/power_low）判定', () => {
    expect(isPowerAlertType('power_shortage')).toBe(true);
    expect(isPowerAlertType('power_low')).toBe(true);
    expect(isPowerAlertType('input_shortage')).toBe(false);
    expect(isPowerAlertType(undefined)).toBe(false);
  });
});

describe('power-status 孤立电网', () => {
  const networks = makeNetworks({
    power_networks: [
      { id: 'net-main', owner_id: 'p1', supply: 16, demand: 21, allocated: 16, net: -5, shortage: true, node_ids: ['b-main'] },
      { id: 'net-solo-a', owner_id: 'p1', supply: 8, demand: 0, allocated: 0, net: 8, shortage: false, node_ids: ['b-91'] },
      { id: 'net-solo-b', owner_id: 'p1', supply: 8, demand: 0, allocated: 0, net: 8, shortage: false, node_ids: ['b-93'] },
      { id: 'net-enemy', owner_id: 'p2', supply: 8, demand: 0, allocated: 0, net: 8, shortage: false, node_ids: ['b-e'] },
    ],
    power_nodes: [
      { building_id: 'b-91', owner_id: 'p1', building_type: 'wind_turbine', position: { x: 13, y: 46, z: 0 }, network_id: 'net-solo-a' },
      { building_id: 'b-93', owner_id: 'p1', building_type: 'wind_turbine', position: { x: 13, y: 50, z: 0 }, network_id: 'net-solo-b' },
      { building_id: 'b-main', owner_id: 'p1', building_type: 'tesla_tower', position: { x: 15, y: 45, z: 0 }, network_id: 'net-main' },
    ],
  });

  it('isolatedPowerNetworks：只认「有发电、无用电」的己方电网', () => {
    const result = isolatedPowerNetworks(networks, 'p1');
    expect(result.networkIds.sort()).toEqual(['net-solo-a', 'net-solo-b']);
    expect(result.buildingIds.sort()).toEqual(['b-91', 'b-93']);
  });

  it('isInIsolatedNetwork：主网建筑返回 false，孤立电网建筑返回 true', () => {
    expect(isInIsolatedNetwork(networks, 'p1', 'b-91')).toBe(true);
    expect(isInIsolatedNetwork(networks, 'p1', 'b-main')).toBe(false);
    expect(isInIsolatedNetwork(networks, 'p1', 'b-unknown')).toBe(false);
  });
});

describe('power-status 停机判定', () => {
  it('isOwnStalledBuilding：no_power / error 且己方为真，其余为假', () => {
    expect(isOwnStalledBuilding(makeBuilding('b-1', 'mining_machine', 'no_power', 'p1'), 'p1')).toBe(true);
    expect(isOwnStalledBuilding(makeBuilding('b-2', 'arc_smelter', 'error', 'p1'), 'p1')).toBe(true);
    expect(isOwnStalledBuilding(makeBuilding('b-3', 'wind_turbine', 'running', 'p1'), 'p1')).toBe(false);
    expect(isOwnStalledBuilding(makeBuilding('b-4', 'mining_machine', 'no_power', 'p2'), 'p1')).toBe(false);
  });
});
