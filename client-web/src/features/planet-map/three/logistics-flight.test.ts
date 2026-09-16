import { describe, expect, it } from 'vitest';
import { logisticsFlightNormal } from './logistics-flight';
import { tileNormal } from './projection';

const flight = { position: { x: 4, y: 4, z: 0 }, target_pos: { x: 10, y: 7, z: 0 }, status: 'in_flight' as const, remaining_ticks: 10, travel_ticks: 10 };
describe('authoritative logistics flight', () => {
  it('moves on the sphere and follows the reversed return leg without teleporting', () => {
    const start = tileNormal(flight.position, 16), end = tileNormal(flight.target_pos, 16);
    expect(logisticsFlightNormal(flight, 16).distanceTo(start)).toBeLessThan(1e-10);
    expect(logisticsFlightNormal({ ...flight, remaining_ticks: 0 }, 16).distanceTo(end)).toBeLessThan(1e-10);
    const middle = logisticsFlightNormal({ ...flight, remaining_ticks: 5 }, 16);
    expect(middle.length()).toBeCloseTo(1);
    expect(middle.angleTo(start)).toBeCloseTo(middle.angleTo(end));
    const returning = logisticsFlightNormal({ ...flight, position: flight.target_pos, target_pos: flight.position, remaining_ticks: 5 }, 16);
    expect(returning.distanceTo(middle)).toBeLessThan(1e-10);
  });
  it('keeps waiting vehicles stationary and clamps phase boundaries', () => {
    const start = tileNormal(flight.position, 16);
    for (const status of ['idle', 'waiting_unload', 'stranded', 'takeoff', 'landing'] as const) {
      expect(logisticsFlightNormal({ ...flight, status, remaining_ticks: 0 }, 16).distanceTo(start)).toBeLessThan(1e-10);
    }
    expect(logisticsFlightNormal({ ...flight, travel_ticks: 0 }, 16).distanceTo(start)).toBeLessThan(1e-10);
    expect(logisticsFlightNormal({ ...flight, remaining_ticks: 99 }, 16).distanceTo(start)).toBeLessThan(1e-10);
    expect(logisticsFlightNormal({ ...flight, remaining_ticks: -5 }, 16).distanceTo(tileNormal(flight.target_pos, 16))).toBeLessThan(1e-10);
  });
});
