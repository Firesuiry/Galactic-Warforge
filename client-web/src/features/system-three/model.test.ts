import type { DysonLayerView, FleetRuntimeView, SystemView } from '@shared/types';
import { displayOrbitRadius, dysonPoint, layoutPlanets, publicFleets, resolvedDysonFrames, visibleDysonLayers } from './model';

const system: SystemView = {
  system_id: 'sol', discovered: true, planets: [
    { planet_id: 'earth', discovered: true, kind: 'terrestrial', orbit: { distance_au: 1, period_days: 365, inclination_deg: 12 } },
    { planet_id: 'hidden', discovered: false, kind: 'lava', orbit: { distance_au: 2, period_days: 700, inclination_deg: 0 } },
  ],
};

describe('public 3D system diagram', () => {
  it('never creates objects for undiscovered planets or an undiscovered system', () => {
    expect(layoutPlanets(system).map(item => item.planet.planet_id)).toEqual(['earth']);
    expect(layoutPlanets({ ...system, discovered: false })).toEqual([]);
  });
  it('retains public orbit radius and inclination with deterministic schematic phase', () => {
    const first = layoutPlanets(system)[0], next = layoutPlanets(structuredClone(system))[0];
    expect(first.position.toArray()).toEqual(next.position.toArray());
    expect(first.position.length()).toBeCloseTo(displayOrbitRadius(1));
    expect(first.position.y).toBeCloseTo(first.position.z * Math.tan(12 * Math.PI / 180));
    expect(displayOrbitRadius(3)).toBeGreaterThan(displayOrbitRadius(1));
  });
  it('uses degree-based server node positions and rejects frames with absent endpoints', () => {
    expect(dysonPoint(10, 90, 0).y).toBeCloseTo(10);
    expect(dysonPoint(10, 0, 90).z).toBeCloseTo(10);
    const layer = { orbit_radius: 1, nodes: [{ id: 'a' }, { id: 'b' }], frames: [
      { id: 'valid', node_a_id: 'a', node_b_id: 'b' }, { id: 'missing', node_a_id: 'a', node_b_id: 'x' },
    ] } as DysonLayerView;
    expect(resolvedDysonFrames(layer).map(item => item.frame.id)).toEqual(['valid']);
  });
  it('requires available player runtime before drawing megastructures or fleets', () => {
    const fleet = { fleet_id: 'f', system_id: 'sol' } as FleetRuntimeView;
    expect(publicFleets({ system, fleets: [fleet] })).toEqual([fleet]);
    expect(publicFleets({ system: { ...system, discovered: false }, fleets: [fleet] })).toEqual([]);
    const runtime = { system_id: 'sol', discovered: true, available: true, fleets: [fleet], dyson_sphere: { system_id: 'sol', player_id: 'p', total_energy: 0, layers: [{ layer_index: 0, orbit_radius: 1, energy_output: 0 }] } };
    expect(publicFleets({ system, runtime })).toEqual([fleet]);
    expect(publicFleets({ system, runtime: { ...runtime, available: false } })).toEqual([]);
    expect(publicFleets({ system, runtime, fleets: [{ ...fleet, system_id: 'elsewhere' }, { ...fleet, transit: { from_system_id: 'sol', target_system_id: 'other', remaining_ticks: 2, total_ticks: 5 } }] })).toEqual([]);
    expect(visibleDysonLayers({ system, runtime })).toHaveLength(1);
    expect(visibleDysonLayers({ system: { ...system, discovered: false }, runtime })).toEqual([]);
  });
});
