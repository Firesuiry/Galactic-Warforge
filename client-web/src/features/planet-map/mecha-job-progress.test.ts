import { describe, expect, it } from 'vitest';

import type { CatalogView, MechaJob, Unit } from '@shared/types';

import {
  completionToast,
  deriveMechaJobProgress,
  formatRemaining,
  jobRemainingTicks,
  jobTotalBatches,
} from '@/features/planet-map/mecha-job-progress';

const catalog = {
  items: [{ id: 'copper_ingot', name: '铜块' }],
  recipes: [{ id: 'smelt_copper', name: '铜块冶炼' }],
} as unknown as CatalogView;

function executor(job: MechaJob | undefined): Unit {
  return {
    id: 'u-7',
    type: 'executor',
    owner_id: 'p1',
    position: { x: 1, y: 2, z: 0 },
    hp: 120,
    max_hp: 120,
    attack: 20,
    defense: 8,
    attack_range: 4,
    move_range: 14,
    vision_range: 6,
    mecha: {
      energy: 40, max_energy: 110, fuel_energy: 0, shield: 0, max_shield: 0,
      attack_energy_cost: 8, move_energy_cost: 1, shield_recharge_delay: 10, last_hit_tick: 0,
      job,
    },
  };
}

describe('机甲批量进度', () => {
  it('剩余 tick 与总批数按服务端字段复原', () => {
    // 已完成 15、剩余 5、每批 60 tick、当前批还剩 45 → (5-1)*60 + 45 = 285
    const job = { remaining_batches: 5, remaining_ticks: 45, ticks_per_batch: 60, completed_batches: 15 };
    expect(jobTotalBatches(job)).toBe(20);
    expect(jobRemainingTicks(job)).toBe(285);
    expect(formatRemaining(285)).toBe('29 秒'); // 285/10 = 28.5 → 向上取整
    expect(formatRemaining(1200)).toBe('2 分 0 秒');
    expect(formatRemaining(0)).toBe('即将完成');
  });

  it('派生进度模型：标题、已完成/总数、百分比、暂停原因', () => {
    const progress = deriveMechaJobProgress(catalog, executor({
      kind: 'craft', recipe_id: 'smelt_copper', remaining_ticks: 45, ticks_per_batch: 60,
      remaining_batches: 5, completed_batches: 15, energy_per_batch: 3, state: 'running',
    }));
    expect(progress).toMatchObject({
      unitId: 'u-7',
      title: '手搓 铜块冶炼',
      completed: 15,
      total: 20,
      percent: 75,
      stateLabel: undefined,
    });
    expect(progress?.remainingLabel).toBe('29 秒');

    const paused = deriveMechaJobProgress(catalog, executor({
      kind: 'craft', recipe_id: 'smelt_copper', remaining_ticks: 45, ticks_per_batch: 60,
      remaining_batches: 5, completed_batches: 15, energy_per_batch: 3, state: 'no_energy',
    }));
    expect(paused?.stateLabel).toBe('核心能量不足，补能后自动继续');
  });

  it('无任务 / 无机甲返回 null', () => {
    expect(deriveMechaJobProgress(catalog, executor(undefined))).toBeNull();
    expect(deriveMechaJobProgress(catalog, undefined)).toBeNull();
  });

  it('完成通知文案走中文名（不出现裸 id）', () => {
    const toast = completionToast(catalog, executor(undefined), {
      kind: 'craft', recipe_id: 'smelt_copper', remaining_ticks: 0, ticks_per_batch: 60,
      remaining_batches: 0, completed_batches: 20, energy_per_batch: 3, state: 'running',
    });
    expect(toast?.title).toBe('手搓完成：铜块冶炼');
    expect(toast?.body).toBe('×20');
    expect(toast?.title).not.toContain('smelt_copper');
    expect(toast?.mergeKey).toBe('mecha_job_done:craft:smelt_copper');
  });
});
