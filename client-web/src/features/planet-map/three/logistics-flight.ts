import { Quaternion } from 'three';
import type { LogisticsDroneView } from '@shared/types';
import { tileNormal } from './projection';

/** Interpolate the authoritative local flight phase along the planet surface. */
export function logisticsFlightNormal(vehicle: Pick<LogisticsDroneView, 'position' | 'target_pos' | 'status' | 'remaining_ticks' | 'travel_ticks'>, faceSize: number) {
  const start = tileNormal(vehicle.position, faceSize);
  if (vehicle.status !== 'in_flight' || !vehicle.target_pos || vehicle.travel_ticks <= 0) return start;
  const end = tileNormal(vehicle.target_pos, faceSize);
  const progress = Math.max(0, Math.min(1, 1 - vehicle.remaining_ticks / vehicle.travel_ticks));
  const rotation = new Quaternion().setFromUnitVectors(start, end);
  return start.applyQuaternion(new Quaternion().slerp(rotation, progress)).normalize();
}
