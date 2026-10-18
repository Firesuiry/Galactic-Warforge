import * as THREE from 'three';
import type { Building, SorterTransfer } from '@shared/types';
import { getItemColorValue } from '../item-colors';
import { surfaceTileSize, tileNormal } from './projection';

/**
 * 分拣器动画（第 18 轮契约 §1.2，DSP 口径）。
 *
 * 形态是「低矮圆底座 + 立柱 + 一根水平横臂 + 臂端夹爪」，所以动画只有两个自由度：
 *
 * - `sorter-arm.rotation.y`：横臂绕立柱在水平面内往复摆动（取货端 ↔ 放货端，约 π）；
 * - `sorter-claw.position.y`：夹爪在取/放时下沉一点点，搬运时抬起；
 * - `sorter-payload`：物品占位，只在「已取货、未放货」的窗口可见，颜色取物品配色表。
 *
 * 一次搬运（cycle）四段，见 `PICKUP_END / CARRY_END / DROP_END`。数据源不变：
 * `building.sorter.last_transfer` 是服务端已完成搬运的权威记录，这里只做一次有限时长的
 * 视觉回放，不做物流模拟；历史记录不重放，慢帧/轮询跳过的记录也只播一次。
 */

interface Motion {
  /** 横臂缩放组：`scale.x = 臂长 / 建模臂长`。 */
  boom: THREE.Object3D;
  /** 臂端升降组：`position.y` 做夹爪下沉，`position.x` 跟随臂长。 */
  claw: THREE.Object3D;
  /** 物品占位（逐实例材质，按 item_id 上色）。 */
  payload: THREE.Object3D;
  cargo: THREE.Mesh | null;
  /** 本周期取货角 / 放货角（模型局部 yaw）。 */
  pickup: number;
  drop: number;
  /** 下一条权威记录对应的取/放角，等本周期播完再生效。 */
  nextPickup: number;
  nextDrop: number;
  /** 起始 yaw（本周期第一帧的实际角度），换取货端时平滑起摆而不是瞬移。 */
  startYaw: number;
  range: number;
  observedSequence: number;
  playedSequence: number;
  /** 本周期已播秒数；`>= cycle` 表示空闲（停在取货角、夹爪抬起）。 */
  elapsed: number;
  cycle: number;
  enabled: boolean;
  snapshotTick?: number;
  /** 快照 tick 差估算的 tick/s（拿不到时用 FALLBACK_TICK_RATE）。 */
  tickRate: number;
  /** tickRate 估算窗口的起点（tick 与墙钟），窗口 ≥ .5s 才采一次样。 */
  rateTick?: number;
  rateTime?: number;
}

/** 建模臂长（`sorter-boom` 按 .55 建，动画按 range 拉伸）。 */
const ARM_UNIT = .55;
/** 阶段边界（cycle 占比）：取货结束 / 携带摆动结束 / 放货结束。 */
const PICKUP_END = .10;
const CARRY_END = .55;
const DROP_END = .65;
/** 物品在放货段中段消失（claw 还在下沉）。 */
const RELEASE_AT = .62;
/** 夹爪下沉量（cell），取/放时才会压到 −.04。 */
const CLAW_DROP = .04;
/** tick/s 兜底：快照里拿不到差值时按 4 tick/s 估 cycle 时长。 */
const FALLBACK_TICK_RATE = 4;
/** 空闲姿态：取货端 = 背面 = 局部 +Z；放货端 = 正面 = 局部 −Z（契约 §0）。 */
const PICKUP_YAW = -Math.PI / 2;
const DROP_YAW = Math.PI / 2;
/** 迟到太多 tick 的记录是历史回放，不当成当前活动（沿用旧实现的去重口径）。 */
const RECENT_TICKS = 20;

const motions = new WeakMap<THREE.Object3D, Motion>();

/** 同步一条权威快照：范围/停机/payload 颜色，新的 `last_transfer` 排队播放一次。 */
export function syncSorterAnimation(model: THREE.Group, building: Building, tick: number, faceSize: number, radius: number) {
  const arm = model.getObjectByName('sorter-arm');
  if (!arm) return;
  let motion = motions.get(arm);
  if (!motion) {
    const boom = arm.getObjectByName('sorter-boom');
    const claw = arm.getObjectByName('sorter-claw');
    const payload = arm.getObjectByName('sorter-payload');
    if (!boom || !claw || !payload) return;
    motion = {
      boom, claw, payload,
      cargo: payload.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh) ?? null,
      pickup: PICKUP_YAW, drop: DROP_YAW, nextPickup: PICKUP_YAW, nextDrop: DROP_YAW, startYaw: PICKUP_YAW,
      range: 1, observedSequence: 0, playedSequence: 0,
      elapsed: Number.POSITIVE_INFINITY, cycle: 1, enabled: false,
      tickRate: FALLBACK_TICK_RATE,
    };
    motions.set(arm, motion);
    pose(arm, motion, PICKUP_YAW, 1, false);
  }
  motion.tickRate = estimateTickRate(motion, tick);
  motion.range = building.sorter?.range ?? motion.range;
  applyRange(motion);
  const previousTick = motion.snapshotTick;
  motion.snapshotTick = tick;
  motion.enabled = building.runtime?.state === 'running';
  if (!motion.enabled) {
    // 停机/无电/停工：整机冻结在原姿态，只把物品藏掉（契约 §1.2）。
    motion.payload.visible = false;
    motion.playedSequence = motion.observedSequence;
    motion.elapsed = Number.POSITIVE_INFINITY;
    return;
  }
  const transfer = building.sorter?.last_transfer;
  if (!transfer || transfer.quantity <= 0 || transfer.sequence <= motion.observedSequence || tick < transfer.tick) return;
  model.updateMatrix();
  const inverse = model.matrix.clone().invert();
  const lift = surfaceTileSize(radius, faceSize) * .25;
  const angle = (position: SorterTransfer['source_position']) => {
    const point = tileNormal(position, faceSize).multiplyScalar(radius + lift).applyMatrix4(inverse);
    // 与旧 `arm.rotation.y = -atan2(end.z, end.x)` 同口径：+X 是臂的 0 角方向。
    return Math.atan2(-point.z, point.x);
  };
  motion.nextPickup = angle(transfer.source_position);
  motion.nextDrop = angle(transfer.target_position);
  // 历史记录/慢帧漏掉的记录不重放：只把空闲姿态对准真实取货端（不播整段搬运）。
  // 观察过一次活动记录后，两条快照之间发生的新记录仍然有效（慢帧也能播）。
  if (tick - transfer.tick > RECENT_TICKS && (previousTick === undefined || transfer.tick <= previousTick)) {
    motion.pickup = motion.nextPickup; motion.drop = motion.nextDrop;
    if (motion.elapsed >= motion.cycle) pose(arm, motion, motion.pickup, 1, false);
    return;
  }
  motion.observedSequence = transfer.sequence;
  motion.cycle = THREE.MathUtils.clamp((building.sorter?.cycle_ticks ?? 6) / motion.tickRate, .35, 1.6);
  if (motion.cargo) {
    const material = motion.cargo.material as THREE.MeshStandardMaterial;
    material.color.set(getItemColorValue(transfer.item_id));
  }
  // 诊断元数据；不影响库存或服务端状态。
  arm.userData.transfer = { sequence: transfer.sequence, itemId: transfer.item_id, quantity: transfer.quantity };
}

/**
 * 每帧推进摆动/升降（由 `IndustrialModels.animate` 在 `sorter-arm` 上调用）。
 * `active` = 整机通电且在运行；false 时冻结。
 */
export function animateSorterArm(arm: THREE.Object3D, delta: number, active: boolean) {
  const motion = motions.get(arm);
  if (!motion || !motion.enabled || !active) return;
  if (motion.elapsed >= motion.cycle) {
    if (motion.playedSequence === motion.observedSequence) {
      pose(arm, motion, motion.pickup, 1, false);
      return;
    }
    motion.playedSequence = motion.observedSequence;
    motion.pickup = motion.nextPickup;
    motion.drop = motion.nextDrop;
    // 从当前实际姿态起摆：换取货端时第一段是「转过去」，不是瞬移。
    motion.startYaw = arm.rotation.y;
    motion.elapsed = 0;
  }
  motion.elapsed = Math.min(motion.cycle, motion.elapsed + Math.min(.1, Math.max(0, delta)));
  const phase = motion.elapsed / motion.cycle;
  let yaw: number;
  if (phase < PICKUP_END) yaw = THREE.MathUtils.lerp(motion.startYaw, motion.pickup, THREE.MathUtils.smoothstep(phase, 0, PICKUP_END));
  else if (phase < CARRY_END) yaw = THREE.MathUtils.lerp(motion.pickup, motion.drop, THREE.MathUtils.smoothstep(phase, PICKUP_END, CARRY_END));
  else if (phase < DROP_END) yaw = motion.drop;
  else yaw = THREE.MathUtils.lerp(motion.drop, motion.pickup, THREE.MathUtils.smoothstep(phase, DROP_END, 1));
  // 取货段压爪 → 抬起搬运 → 放货段再压爪 → 空载回摆抬起。
  const lift = phase < PICKUP_END ? 1 - THREE.MathUtils.smoothstep(phase, 0, PICKUP_END)
    : phase < .18 ? THREE.MathUtils.smoothstep(phase, PICKUP_END, .18)
    : phase < CARRY_END ? 1
    : phase < DROP_END ? 1 - THREE.MathUtils.smoothstep(phase, CARRY_END, DROP_END)
    : THREE.MathUtils.smoothstep(phase, DROP_END, .8);
  pose(arm, motion, yaw, lift, phase >= PICKUP_END && phase < RELEASE_AT);
}

/** 写一次姿态（yaw + 夹爪升降 + 物品显隐）。 */
function pose(arm: THREE.Object3D, motion: Motion, yaw: number, lift: number, carrying: boolean) {
  arm.rotation.y = yaw;
  motion.claw.position.y = -CLAW_DROP * (1 - lift);
  motion.payload.visible = carrying;
}

/** 臂长：`L = .55 + (range - 1) * .42`（契约 §1.1），boom 拉伸、夹爪同步到臂端。 */
function applyRange(motion: Motion) {
  const length = ARM_UNIT + (Math.max(1, motion.range) - 1) * .42;
  motion.boom.scale.x = length / ARM_UNIT;
  motion.claw.position.x = length;
}

/**
 * 用「≥ .5 秒窗口内的 tick 差 / 墙钟差」估算 tick/s，再平滑进 `motion.tickRate`。
 *
 * 快照回调可能非常密集（数据层每次更新都会调 sync，实测 ~20 次/秒）：拿相邻两次
 * 调用的 Δt 算会因 tick 量化（Δtick=1 / .05s = 20 tick/s）严重虚高，cycle 被压到
 * 下限 .35s、横臂甩得看不清。所以只在窗口跨过 .5s 才采一次样。
 */
function estimateTickRate(motion: Motion, tick: number) {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  if (motion.rateTick === undefined || motion.rateTime === undefined) {
    motion.rateTick = tick; motion.rateTime = now;
    return motion.tickRate;
  }
  const seconds = (now - motion.rateTime) / 1000;
  if (seconds < .5) return motion.tickRate;
  const ticks = tick - motion.rateTick;
  motion.rateTick = tick; motion.rateTime = now;
  if (ticks <= 0) return motion.tickRate;
  const estimate = THREE.MathUtils.clamp(ticks / seconds, .5, 30);
  return motion.tickRate * .5 + estimate * .5;
}
