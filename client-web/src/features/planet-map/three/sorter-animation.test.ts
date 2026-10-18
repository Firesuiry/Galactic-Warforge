import { describe, expect, it } from 'vitest';
import type { Building } from '@shared/types';
import { CARRY_END, DROP_END, PICKUP_END, RELEASE_AT, SorterMotion, poseAt } from './sorter-animation';

/** 一台正在运行的分拣器；last_transfer 按需覆写。 */
function sorter(overrides: {
  state?: string; tick?: number; sequence?: number; quantity?: number; itemId?: string; cycleTicks?: number;
} = {}): Building {
  return {
    id: 'sorter', type: 'sorter_mk1', position: { x: 9, y: 4, z: 0 }, owner_id: 'p1', rotation: '90',
    runtime: { state: overrides.state ?? 'running' },
    sorter: {
      cycle_ticks: overrides.cycleTicks ?? 6, range: 3,
      last_transfer: {
        tick: overrides.tick ?? 50, sequence: overrides.sequence ?? 1,
        source_id: 'source', target_id: 'target',
        source_position: { x: 8, y: 4, z: 0 }, target_position: { x: 10, y: 4, z: 0 },
        item_id: overrides.itemId ?? 'iron_ore', quantity: overrides.quantity ?? 1,
      },
    },
  } as unknown as Building;
}

/** 以固定步长推进，返回逐帧姿态。 */
function sample(motion: SorterMotion, seconds: number, step = .005, active = true) {
  const poses = [];
  for (let time = 0; time < seconds; time += step) poses.push(motion.advance(step, active));
  return poses;
}

describe('poseAt (gate arm timeline)', () => {
  it('parks at the pickup end and lifts the claw before pickup', () => {
    const pose = poseAt(0);
    expect(pose.swing).toBe(0);
    expect(pose.lift).toBe(1);
    expect(pose.carrying).toBe(false);
  });

  it('dips at the pickup end, then carries and swings over the top to the drop end', () => {
    // 取货段末：夹爪下探到底（lift 0），物品开始挂在夹爪下。
    const pick = poseAt(PICKUP_END);
    expect(pick.swing).toBe(0);
    expect(pick.lift).toBeCloseTo(0, 6);
    expect(pick.carrying).toBe(true);
    // 携货中段：摆臂在取/放之间（swing ≈ .5），夹爪抬起、物品在爪上。
    const middle = poseAt((PICKUP_END + CARRY_END) / 2);
    expect(middle.swing).toBeGreaterThan(.4);
    expect(middle.swing).toBeLessThan(.6);
    expect(middle.lift).toBe(1);
    expect(middle.carrying).toBe(true);
    // 到达放货端：swing = 1。
    expect(poseAt(CARRY_END).swing).toBeCloseTo(1, 6);
  });

  it('releases the item mid-drop and returns empty with the claw lifted', () => {
    expect(poseAt(CARRY_END).carrying).toBe(true);
    expect(poseAt(RELEASE_AT).carrying).toBe(false);
    // 放货段：夹爪下探。
    const drop = poseAt((CARRY_END + DROP_END) / 2);
    expect(drop.swing).toBe(1);
    expect(drop.lift).toBeLessThan(.6);
    // 空载翻回：swing 从 1 回到 0，夹爪抬起。
    const back = poseAt((DROP_END + 1) / 2);
    expect(back.swing).toBeGreaterThan(0);
    expect(back.swing).toBeLessThan(1);
    expect(back.carrying).toBe(false);
    expect(poseAt(1).swing).toBeCloseTo(0, 6);
    expect(poseAt(1).lift).toBeCloseTo(1, 6);
  });

  it('is monotone in swing through the carry segment and keeps itemId', () => {
    let previous = -1;
    for (let phase = PICKUP_END; phase <= CARRY_END; phase += .01) {
      const swing = poseAt(phase, 'gear').swing;
      expect(swing).toBeGreaterThanOrEqual(previous);
      previous = swing;
    }
    expect(poseAt(.3, 'gear').itemId).toBe('gear');
  });
});

describe('SorterMotion (authoritative playback)', () => {
  it('does not replay the first observed historical transfer', () => {
    const motion = new SorterMotion();
    // 读档/首次进场：last_transfer 是 30 tick 前的历史记录，只用来对准空闲姿态。
    motion.sync(sorter({ tick: 50, sequence: 1 }), 80);
    const poses = sample(motion, 1.2);
    expect(poses.every(pose => pose.swing === 0 && pose.lift === 1 && !pose.carrying)).toBe(true);
  });

  it('plays a transfer that arrives late but advances the sequence', () => {
    const motion = new SorterMotion();
    motion.sync(sorter({ tick: 50, sequence: 1 }), 80);
    // 先观察过历史记录，之后 sequence 前进、但 tick 已经迟到 50 tick：仍然要播。
    motion.sync(sorter({ tick: 150, sequence: 2 }), 200);
    const poses = sample(motion, 2);
    expect(poses.some(pose => pose.carrying)).toBe(true);
    expect(Math.max(...poses.map(pose => pose.swing))).toBeCloseTo(1, 3);
    // 播完回到空闲（取货端、夹爪抬起、无货）。
    const end = motion.pose();
    expect(end.swing).toBe(0);
    expect(end.carrying).toBe(false);
  });

  it('plays only once per sequence (no replay while polling repeats the same record)', () => {
    const motion = new SorterMotion();
    motion.sync(sorter({ tick: 50, sequence: 1 }), 50);
    sample(motion, 2);
    const idle = motion.pose();
    for (const tick of [60, 70, 80, 90]) motion.sync(sorter({ tick: 50, sequence: 1 }), tick);
    expect(sample(motion, 1.2).every(pose => pose.swing === 0 && !pose.carrying)).toBe(true);
    expect(motion.pose()).toEqual(idle);
  });

  it('ignores stale, future and zero-quantity records', () => {
    // 初始是一条历史记录（tick 50 / 快照 80）：只对准空闲姿态，不播。
    for (const record of [
      { tick: 90, sequence: 2, quantity: 1 },   // tick 比快照还新（未来记录）
      { tick: 60, sequence: 1, quantity: 1 },   // sequence 没有前进（过期记录）
      { tick: 60, sequence: 2, quantity: 0 },   // 数量 0
    ]) {
      const motion = new SorterMotion();
      motion.sync(sorter({ tick: 50, sequence: 1 }), 80);
      motion.sync(sorter(record), 80);
      expect(sample(motion, 1).some(pose => pose.carrying), JSON.stringify(record)).toBe(false);
    }
  });

  it('freezes on stop and hides the carried item, resuming on a later sequence', () => {
    const motion = new SorterMotion();
    motion.sync(sorter({ tick: 50, sequence: 1 }), 50);
    // 推进到携货中段（物品挂在夹爪下）。
    const carrying = sample(motion, 2).find(pose => pose.carrying)!;
    expect(carrying).toBeTruthy();
    const frozenPose = motion.pose();
    // 停机：姿态冻结、物品藏掉。
    motion.sync(sorter({ state: 'no_power', tick: 50, sequence: 1 }), 51);
    expect(motion.pose()).toMatchObject({ swing: frozenPose.swing, lift: frozenPose.lift, carrying: false });
    expect(sample(motion, .6).every(pose => pose.swing === frozenPose.swing && pose.lift === frozenPose.lift && !pose.carrying)).toBe(true);
    // 恢复供电 + 新记录：继续播。
    motion.sync(sorter({ tick: 52, sequence: 2 }), 52);
    expect(sample(motion, 2).some(pose => pose.carrying)).toBe(true);
  });

  it('stays still when the scene is frozen (active=false)', () => {
    const motion = new SorterMotion();
    motion.sync(sorter({ tick: 50, sequence: 1 }), 50);
    const before = motion.pose();
    expect(sample(motion, .5, .01, false).every(pose => pose === before)).toBe(true);
  });

  it('carries the item id of the played transfer', () => {
    const motion = new SorterMotion();
    motion.sync(sorter({ tick: 50, sequence: 1, itemId: 'iron_ingot' }), 50);
    const carrying = sample(motion, 2).find(pose => pose.carrying)!;
    expect(carrying.itemId).toBe('iron_ingot');
    motion.sync(sorter({ tick: 51, sequence: 2, itemId: 'copper_ingot' }), 51);
    // 新记录排队，播到携货段时换成新物品。
    const next = sample(motion, 3).filter(pose => pose.carrying);
    expect(next[next.length - 1].itemId).toBe('copper_ingot');
  });

  it('keeps the cycle inside a sane range for every tier cycle_ticks', () => {
    for (const cycleTicks of [6, 3, 2]) {
      const motion = new SorterMotion();
      motion.sync(sorter({ tick: 50, sequence: 1, cycleTicks }), 50);
      let carryingAt = -1;
      for (let index = 0; index < 600; index++) {
        if (motion.advance(.005).carrying) { carryingAt = index * .005; break; }
      }
      // 物品在取货段末出现（.1 × cycle），cycle 夹在 [.45, 1.8] 秒。
      expect(carryingAt).toBeGreaterThan(0);
      expect(carryingAt).toBeLessThanOrEqual(.1 * 1.8 + .01);
    }
  });
});
