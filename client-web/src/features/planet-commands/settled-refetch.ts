import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { usePlanetCommandStore } from "@/features/planet-commands/store";

/**
 * 命令结算后的查询刷新（R20-A 试玩 1020 A2）。
 *
 * 问题：HTTP 202 只代表命令进了队列，服务端在**下一个 tick 结算**才改世界状态。
 * 旧写法在 `submitPlanetCommand(...).then(() => refetch())` 里立刻重取，
 * 拿到的是结算前的旧数据（战区 (54,144) r6 → 拖成 (48,139) r4 后画面 3.5s 还是旧圆），
 * 之后要等 15s 兜底轮询才更新。
 *
 * 这里按**服务端回执的 requestId** 跟踪那一条 journal 条目：
 * - SSE `command_result` / 快照补拉把条目从 pending 改成 succeeded/failed 时刷新；
 * - `fallbackDelayMs` 后再兜底刷一次（SSE 断线 / 事件丢失时仍有更新，
 *   也覆盖「服务端先结算、事件后到」的窗口）；
 * - 超过 `timeoutMs` 仍未结算也刷一次并放弃，不留永久订阅。
 *
 * 返回值是取消函数：调用方（PlanetPage）在卸载/换行星时统一取消，避免泄漏订阅与定时器。
 */
export interface SettledRefetchOptions {
  /** `submitPlanetCommand` 返回的 `response.request_id`。 */
  requestId: string;
  /** 要失效/重取的查询 key。 */
  queryKey: QueryKey;
  /** SSE 丢失时的兜底刷新延迟（默认 1.5s，约 4 tick @4Hz 结算窗口）。 */
  fallbackDelayMs?: number;
  /** 超过这个时间仍未结算也刷一次并放弃（默认 20s，覆盖 15s 兜底轮询一轮）。 */
  timeoutMs?: number;
}

/** 订阅 journal，等目标命令结算后刷新查询；返回取消函数。 */
export function refetchAfterCommandSettles(
  queryClient: QueryClient,
  options: SettledRefetchOptions,
): () => void {
  const {
    requestId,
    queryKey,
    fallbackDelayMs = 1500,
    timeoutMs = 20_000,
  } = options;
  let cancelled = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let sawEntry = false;
  // 先占位：check() 可能在订阅挂上之前就同步触发 invalidate。
  let unsubscribe: () => void = () => {};

  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    unsubscribe();
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
  };

  const invalidate = () => {
    if (cancelled) return;
    finish();
    void queryClient.invalidateQueries({ queryKey });
  };

  const check = () => {
    if (cancelled) return;
    const current = usePlanetCommandStore
      .getState()
      .journal.find((entry) => entry.requestId === requestId);
    if (!current) return;
    if (!sawEntry) {
      sawEntry = true;
      // 兜底：即便权威事件丢了，服务端结算后这里也补一次。
      fallbackTimer = setTimeout(invalidate, fallbackDelayMs);
    }
    if (current.status !== "pending") {
      invalidate();
    }
  };

  // 回执可能已经先于订阅写入：先 check 再挂订阅。
  check();
  unsubscribe = usePlanetCommandStore.subscribe(check);
  timeoutTimer = setTimeout(invalidate, timeoutMs);

  return () => {
    cancelled = true;
    unsubscribe();
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
  };
}
