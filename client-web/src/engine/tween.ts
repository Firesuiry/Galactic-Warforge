/**
 * 补间动画基础：纯函数，不依赖 Pixi，可单测。
 * 由调用方（通常是 Pixi ticker 或 rAF）按 dt 驱动。
 */

export type EaseFn = (t: number) => number;

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function easeOutCubic(t: number): number {
  const p = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - p) ** 3;
}

export function easeInOutCubic(t: number): number {
  const p = Math.min(Math.max(t, 0), 1);
  return p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2;
}

export interface Tween {
  /** 已进行时长（ms）。 */
  elapsed: number;
  /** 总时长（ms）。 */
  duration: number;
  /** 推进 dt（ms），返回 [0,1] 经缓动后的进度；完成时返回 1。 */
  step: (dtMs: number) => number;
  readonly done: boolean;
}

export function createTween(durationMs: number, ease: EaseFn = easeOutCubic): Tween {
  const duration = Math.max(durationMs, 0);
  const state = { elapsed: 0, done: duration === 0 };
  return {
    get elapsed() {
      return state.elapsed;
    },
    get duration() {
      return duration;
    },
    get done() {
      return state.done;
    },
    step(dtMs: number) {
      if (state.done) {
        return 1;
      }
      state.elapsed += Math.max(dtMs, 0);
      if (state.elapsed >= duration) {
        state.done = true;
        state.elapsed = duration;
        return 1;
      }
      return ease(duration === 0 ? 1 : state.elapsed / duration);
    },
  };
}
