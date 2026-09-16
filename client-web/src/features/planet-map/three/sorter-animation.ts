import * as THREE from 'three';
import type { Building, SorterTransfer } from '@shared/types';
import { surfaceTileSize, tileNormal } from './projection';

interface Motion {
  shoulder: THREE.Object3D;
  upper: THREE.Object3D;
  elbow: THREE.Object3D;
  lower: THREE.Object3D;
  wrist: THREE.Object3D;
  payload: THREE.Object3D;
  source: THREE.Vector3;
  target: THREE.Vector3;
  nextSource: THREE.Vector3;
  nextTarget: THREE.Vector3;
  observedSequence: number;
  playedSequence: number;
  elapsed: number;
  enabled: boolean;
  snapshotTick?: number;
}

const motions = new WeakMap<THREE.Object3D, Motion>();
const CYCLE_SECONDS = 0.85;
// A late snapshot must not replay an old transfer as current activity.
const RECENT_TICKS = 20;

/** A finite visual replay of a completed authoritative move; never a transport simulation. */
export function syncSorterAnimation(model: THREE.Group, building: Building, tick: number, faceSize: number, radius: number) {
  const arm = model.getObjectByName('sorter-arm');
  if (!arm) return;
  let motion = motions.get(arm);
  if (!motion) {
    motion = {
      shoulder: arm.getObjectByName('sorter-shoulder')!, upper: arm.getObjectByName('sorter-upper')!,
      elbow: arm.getObjectByName('sorter-elbow')!, lower: arm.getObjectByName('sorter-lower')!,
      wrist: arm.getObjectByName('sorter-wrist')!, payload: arm.getObjectByName('sorter-payload')!,
      source: new THREE.Vector3(-.7, .1, 0), target: new THREE.Vector3(.7, .1, 0),
      nextSource: new THREE.Vector3(), nextTarget: new THREE.Vector3(),
      observedSequence: 0, playedSequence: 0, elapsed: CYCLE_SECONDS, enabled: false,
    };
    motions.set(arm, motion);
    pose(arm, motion, new THREE.Vector3(.65, .12, 0), false);
  }
  const previousTick = motion.snapshotTick;
  motion.snapshotTick = tick;
  motion.enabled = building.runtime?.state === 'running';
  if (!motion.enabled) {
    motion.payload.visible = false;
    motion.playedSequence = motion.observedSequence;
    motion.elapsed = CYCLE_SECONDS;
    return;
  }
  const transfer = building.sorter?.last_transfer;
  if (!transfer || transfer.quantity <= 0 || transfer.sequence <= motion.observedSequence
      || tick < transfer.tick) return;
  // Initial historical records stay idle. Once observing a live line, a new
  // transfer between snapshots is valid even if a slow frame/poll took >20 ticks.
  if (tick - transfer.tick > RECENT_TICKS && (previousTick === undefined || transfer.tick <= previousTick)) return;
  model.updateMatrix();
  const inverse = model.matrix.clone().invert();
  const point = (position: SorterTransfer['source_position']) => tileNormal(position, faceSize)
    .multiplyScalar(radius + surfaceTileSize(radius, faceSize) * .25).applyMatrix4(inverse).sub(arm.position);
  motion.nextSource.copy(point(transfer.source_position));
  motion.nextTarget.copy(point(transfer.target_position));
  motion.observedSequence = transfer.sequence;
  // Metadata is diagnostic only; it does not change game inventories.
  arm.userData.transfer = { sequence: transfer.sequence, itemId: transfer.item_id, quantity: transfer.quantity };
}

/** The arm reaches actual conveyor centers with a two-link elbow, including rotated cube seams. */
function pose(arm: THREE.Object3D, motion: Motion, end: THREE.Vector3, carrying: boolean) {
  const reach = Math.hypot(end.x, end.z);
  const length = Math.max(.46, motion.source.length() * .58, motion.target.length() * .58);
  const distance = Math.min(length * 1.999, Math.hypot(reach, end.y));
  const bend = Math.acos(THREE.MathUtils.clamp(distance / (length * 2), -1, 1));
  const pitch = Math.atan2(end.y, reach) + bend;
  arm.rotation.y = -Math.atan2(end.z, end.x);
  motion.shoulder.rotation.z = pitch;
  motion.upper.scale.x = length;
  motion.elbow.position.x = length;
  motion.elbow.rotation.z = -bend * 2;
  motion.lower.scale.x = length;
  motion.wrist.position.x = length;
  motion.wrist.rotation.z = -(pitch - bend * 2);
  motion.payload.visible = carrying;
}

export function animateSorterArm(arm: THREE.Object3D, delta: number, active: boolean) {
  const motion = motions.get(arm);
  if (!motion || !motion.enabled || !active) return;
  if (motion.elapsed >= CYCLE_SECONDS) {
    if (motion.playedSequence === motion.observedSequence) return;
    motion.playedSequence = motion.observedSequence;
    // Keep the current pickup/dropoff fixed for the whole carried movement.
    // A later authoritative transfer becomes the next cycle, not a midair jump.
    motion.source.copy(motion.nextSource);
    motion.target.copy(motion.nextTarget);
    motion.elapsed = 0;
  }
  motion.elapsed = Math.min(CYCLE_SECONDS, motion.elapsed + Math.min(.1, Math.max(0, delta)));
  const phase = motion.elapsed / CYCLE_SECONDS;
  const carrying = phase > .08 && phase < .62;
  const fraction = phase < .62 ? THREE.MathUtils.smoothstep(phase, .08, .62) : 1 - THREE.MathUtils.smoothstep(phase, .68, 1);
  const end = motion.source.clone().lerp(motion.target, fraction);
  end.y += Math.sin(fraction * Math.PI) * .48;
  pose(arm, motion, end, carrying);
}
