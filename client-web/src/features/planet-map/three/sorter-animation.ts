import * as THREE from 'three';
import type { Building } from '@shared/types';

/**
 * 分拣器搬运节拍（第 19 轮，门控式摆臂的「时间轴」部分，几何由 `sorter-rig` 负责）。
 *
 * 一次搬运（cycle）四段，`swing` 是摆臂在竖直面里的进度（0 = 停在取货端，1 = 落到放货端）：
 *
 * | 阶段 | 占比 | 动作 |
 * | --- | --- | --- |
 * | 取货 | 0–.10 | 夹爪下探到取货点（`lift` 1→0），物品从 .10 起挂在夹爪下 |
 * | 携货翻转 | .10–.55 | `swing` 0→1：摆臂从取货端翻过头顶落到放货端 |
 * | 放货 | .55–.65 | 夹爪下探，物品在 .62 消失 |
 * | 空载翻回 | .65–1.0 | `swing` 1→0，夹爪抬起 |
 *
 * 数据源：`building.sorter.last_transfer` 是服务端已完成搬运的权威记录，这里只做一次有限时长的
 * 视觉回放，不做物流模拟；历史记录不重放，慢帧/轮询跳过的记录也只播一次。
 */

/** 阶段边界（cycle 占比）：取货结束 / 携带翻转结束 / 放货结束。 */
export const PICKUP_END = .10;
export const CARRY_END = .55;
export const DROP_END = .65;
/** 物品在放货段中段消失（夹爪还在下探）。 */
export const RELEASE_AT = .62;
/** tick/s 兜底：快照里拿不到差值时按 4 tick/s 估 cycle 时长。 */
const FALLBACK_TICK_RATE = 4;
/** 迟到太多 tick 的记录是历史回放，不当成当前活动（只对首次观察生效）。 */
const RECENT_TICKS = 20;

export interface SorterPose {
  /** 0 = 取货端，1 = 放货端（门控摆臂的翻转进度）。 */
  swing: number;
  /** 1 = 夹爪抬起（悬停），0 = 下探到取/放点。 */
  lift: number;
  /** 夹爪下是否挂着物品。 */
  carrying: boolean;
  /** 本周期搬的物品（配色用）。 */
  itemId?: string;
}

export class SorterMotion {
  private observedSequence = 0;
  private playedSequence = 0;
  /** 本周期已播秒数；`>= cycle` 表示空闲（停在取货端、夹爪抬起）。 */
  private elapsed = Number.POSITIVE_INFINITY;
  private cycle = 1;
  private enabled = false;
  private itemId?: string;
  private pendingItemId?: string;
  /** 快照 tick 差估算的 tick/s。 */
  private tickRate = FALLBACK_TICK_RATE;
  private rateTick?: number;
  private rateTime?: number;
  private current: SorterPose = { swing: 0, lift: 1, carrying: false };

  /** 同步一条权威快照：停机冻结；新的 `last_transfer` 排队播放一次。 */
  sync(building: Building, tick: number, now = clock()) {
    this.tickRate = this.estimateTickRate(tick, now);
    this.enabled = building.runtime?.state === 'running';
    if (!this.enabled) {
      // 停机/无电/停工：整机冻结在原姿态，只把物品藏掉。
      this.current = { ...this.current, carrying: false };
      this.playedSequence = this.observedSequence;
      this.elapsed = Number.POSITIVE_INFINITY;
      return;
    }
    const transfer = building.sorter?.last_transfer;
    if (!transfer || transfer.quantity <= 0 || transfer.sequence <= this.observedSequence || tick < transfer.tick) return;
    // 只有**首次**观察到的历史记录不重放（读档/首次进场时 last_transfer 可能是几十秒前的）。
    // 之后只看 sequence 是否前进：挂机产线里 last_transfer 可能迟到十几~几十 tick（1018 联调实测）。
    if (this.observedSequence === 0 && tick - transfer.tick > RECENT_TICKS) {
      this.observedSequence = this.playedSequence = transfer.sequence;
      return;
    }
    this.observedSequence = transfer.sequence;
    this.pendingItemId = transfer.item_id;
    this.cycle = THREE.MathUtils.clamp((building.sorter?.cycle_ticks ?? 6) / this.tickRate, .45, 1.8);
  }

  /** 每帧推进（`active` = 整机运行且场景不冻结）。 */
  advance(delta: number, active = true): SorterPose {
    if (!this.enabled || !active) return this.current;
    if (this.elapsed >= this.cycle) {
      if (this.playedSequence === this.observedSequence) return this.current = { swing: 0, lift: 1, carrying: false, itemId: this.itemId };
      this.playedSequence = this.observedSequence;
      this.itemId = this.pendingItemId;
      this.elapsed = 0;
    }
    this.elapsed = Math.min(this.cycle, this.elapsed + Math.min(.1, Math.max(0, delta)));
    return this.current = poseAt(this.elapsed / this.cycle, this.itemId);
  }

  pose(): SorterPose { return this.current; }

  /**
   * 用「≥ .5 秒窗口内的 tick 差 / 墙钟差」估算 tick/s，再平滑。
   * 快照回调很密（~20 次/秒），相邻两次的 Δt 会因 tick 量化严重虚高，所以窗口跨过 .5s 才采样。
   */
  private estimateTickRate(tick: number, now: number) {
    if (this.rateTick === undefined || this.rateTime === undefined) {
      this.rateTick = tick; this.rateTime = now;
      return this.tickRate;
    }
    const seconds = (now - this.rateTime) / 1000;
    if (seconds < .5) return this.tickRate;
    const ticks = tick - this.rateTick;
    this.rateTick = tick; this.rateTime = now;
    if (ticks <= 0) return this.tickRate;
    return this.tickRate * .5 + THREE.MathUtils.clamp(ticks / seconds, .5, 30) * .5;
  }
}

/** 周期内某一时刻的姿态（纯函数，测试与 ghost 预览共用）。 */
export function poseAt(phase: number, itemId?: string): SorterPose {
  const smooth = THREE.MathUtils.smoothstep;
  const swing = phase < PICKUP_END ? 0
    : phase < CARRY_END ? smooth(phase, PICKUP_END, CARRY_END)
    : phase < DROP_END ? 1
    : 1 - smooth(phase, DROP_END, 1);
  // 取货段压爪 → 抬起搬运 → 放货段再压爪 → 空载回摆抬起。
  const lift = phase < PICKUP_END ? 1 - smooth(phase, 0, PICKUP_END)
    : phase < .18 ? smooth(phase, PICKUP_END, .18)
    : phase < CARRY_END ? 1
    : phase < DROP_END ? 1 - smooth(phase, CARRY_END, DROP_END)
    : smooth(phase, DROP_END, .8);
  return { swing, lift, carrying: phase >= PICKUP_END && phase < RELEASE_AT, itemId };
}

function clock() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
