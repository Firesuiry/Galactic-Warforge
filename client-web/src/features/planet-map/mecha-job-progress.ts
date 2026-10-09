/**
 * 机甲手搓/采集的批量进度（主界面常驻横幅 + 完成通知）。
 *
 * 服务端 MechaJob 只给「当前批剩余 tick / 剩余批数 / 已完成批数」，不下发总批数，
 * 这里按 `已完成 + 剩余` 复原总数，并按 10 tick/s 估算剩余时间。
 * 进度条与「已完成 x / 总数」常驻在地图主界面，玩家不必展开机甲面板
 * （试玩报告：30 个铜块 = 1800 tick 只在展开详情时可见，容易以为卡死）。
 *
 * 完成通知：任务在场景里从「有 job」变成「无 job」即视为结束；
 * 取消（本机刚提交过 cancel_mecha_job）与阵亡（单位 HP<=0）不报完成，
 * 避免假通知。
 */

import { useEffect, useRef } from 'react';

import type { CatalogView, Unit } from '@shared/types';

import { isNotificationsFrozen } from '@/features/notifications/notify';
import { useNotificationsStore } from '@/features/notifications/store';
import { usePlanetCommandStore } from '@/features/planet-commands/store';
import { getRecipeDisplayName, getItemDisplayName } from '@/features/planet-map/model';
import type { PlanetRenderView } from '@/features/planet-map/model';

/** 服务端默认 10 tick/s（遭遇战预设）。 */
const TICKS_PER_SECOND = 10;
/** 取消命令提交后这段时间内不报「完成」（避免把取消当完成）。 */
const CANCEL_GRACE_MS = 8000;

export interface MechaJobProgress {
  unitId: string;
  kind: 'mine' | 'craft' | string;
  title: string;
  completed: number;
  total: number;
  remainingTicks: number;
  remainingLabel: string;
  state: 'running' | 'no_energy' | 'out_of_range' | string;
  stateLabel?: string;
  percent: number;
}

/** 剩余 tick → 「1 分 12 秒」；<=0 或非法 → 「即将完成」。 */
export function formatRemaining(ticks: number): string {
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return '即将完成';
  }
  const totalSeconds = Math.ceil(ticks / TICKS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

/** 批量任务总批数 = 已完成 + 剩余（服务端不下发总数）。 */
export function jobTotalBatches(job: { completed_batches: number; remaining_batches: number }): number {
  return Math.max(1, job.completed_batches + job.remaining_batches);
}

/** 剩余 tick = 未完成批次（含当前批剩余）累计。 */
export function jobRemainingTicks(job: {
  remaining_batches: number;
  remaining_ticks: number;
  ticks_per_batch: number;
}): number {
  return Math.max(0, (job.remaining_batches - 1) * job.ticks_per_batch) + Math.max(0, job.remaining_ticks);
}

function jobStateLabel(state: string): string | undefined {
  switch (state) {
    case 'no_energy':
      return '核心能量不足，补能后自动继续';
    case 'out_of_range':
      return '距离矿点过远，回到 2 格内继续采集';
    default:
      return undefined;
  }
}

/** 玩家自己的执行体（机甲）。 */
export function findOwnExecutor(planet: PlanetRenderView | undefined, playerId: string): Unit | undefined {
  return Object.values(planet?.units ?? {}).find(
    (unit) => unit.owner_id === playerId && unit.mecha != null,
  );
}

/** 当前机甲任务的展示模型（无任务返回 null）。 */
export function deriveMechaJobProgress(
  catalog: CatalogView | undefined,
  unit: Unit | undefined,
): MechaJobProgress | null {
  const job = unit?.mecha?.job;
  if (!unit || !job) {
    return null;
  }
  const total = jobTotalBatches(job);
  const title = job.kind === 'mine'
    ? '手动采集中'
    : `手搓 ${getRecipeDisplayName(catalog, job.recipe_id ?? '')}`;
  const remainingTicks = jobRemainingTicks(job);
  return {
    unitId: unit.id,
    kind: job.kind,
    title,
    completed: job.completed_batches,
    total,
    remainingTicks,
    remainingLabel: formatRemaining(remainingTicks),
    state: job.state,
    stateLabel: jobStateLabel(job.state),
    percent: Math.max(0, Math.min(100, Math.round((job.completed_batches / total) * 100))),
  };
}

/** 完成文案：「手搓完成：铁块 ×20」/「采集完成：铁矿 ×10」。 */
export function completionToast(
  catalog: CatalogView | undefined,
  unit: Unit | undefined,
  lastJob: NonNullable<Unit['mecha']>['job'] | undefined,
) {
  if (!lastJob) {
    return null;
  }
  const count = Math.max(1, lastJob.completed_batches);
  const subject = lastJob.kind === 'mine'
    ? `采集完成：${getItemDisplayName(catalog, lastJob.resource_id ?? '')}`
    : `手搓完成：${getRecipeDisplayName(catalog, lastJob.recipe_id ?? '')}`;
  return {
    kind: 'success' as const,
    title: subject,
    body: `×${count}`,
    mergeKey: `mecha_job_done:${lastJob.kind}:${lastJob.recipe_id ?? lastJob.resource_id ?? ''}`,
  };
}

/**
 * 主界面机甲进度：返回当前任务进度，并在任务结束时补一条完成通知。
 * 只在任务从「有」变「无」且不是取消/阵亡时报完成。
 */
export function useMechaJobProgress(
  catalog: CatalogView | undefined,
  planet: PlanetRenderView | undefined,
  playerId: string,
): MechaJobProgress | null {
  const unit = findOwnExecutor(planet, playerId);
  const progress = deriveMechaJobProgress(catalog, unit);
  const lastJobRef = useRef<{ unitId: string; job: NonNullable<Unit['mecha']>['job'] } | null>(null);

  useEffect(() => {
    if (!unit) {
      return;
    }
    const job = unit.mecha?.job;
    if (job) {
      lastJobRef.current = { unitId: unit.id, job };
      return;
    }
    const last = lastJobRef.current;
    if (!last || last.unitId !== unit.id) {
      return;
    }
    lastJobRef.current = null;
    // 阵亡或本机刚提交取消：不是「完成」，不报。
    if (unit.hp <= 0 || isNotificationsFrozen()) {
      return;
    }
    const cancelled = usePlanetCommandStore.getState().journal.some(
      (entry) => entry.commandType === 'cancel_mecha_job'
        && entry.focus?.entityId === unit.id
        && Date.now() - entry.submittedAt < CANCEL_GRACE_MS,
    );
    if (cancelled) {
      return;
    }
    const toast = completionToast(catalog, unit, last.job);
    if (toast) {
      useNotificationsStore.getState().push(toast);
    }
  }, [catalog, unit, unit?.hp, unit?.mecha?.job]);

  return progress;
}
