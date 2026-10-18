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
 * 这里按 journal 条目的**权威回写**刷新：
 * - SSE `command_result` / 快照补拉把条目从 pending 改成 succeeded/failed 时刷新；
 * - `fallbackDelayMs` 后再兜底刷一次（SSE 断线 / 事件丢失时仍有更新，
 *   也覆盖「服务端先结算、事件后到」的窗口）；
 * - 超过 `timeoutMs` 仍未结算也刷一次并放弃，不留永久订阅。
 *
 * 注意：提交时先写入的本地占位 requestId 会被 HTTP 回执原位替换成服务端 requestId，
 * 所以这里按**命令类型 + 注册后新出现的条目**跟踪，而不是绑定某个 requestId。
 *
 * 返回值是取消函数：组件卸载或换局时调用，避免泄漏订阅与定时器。
 */
export interface SettledRefetchOptions {
  /** 命令类型，只认这条命令自己的 journal 条目。 */
  commandType: string;
  /** 要失效/重取的查询 key。 */
  queryKey: QueryKey;
  /** SSE 丢失时的兜底刷新延迟（默认 1.5s，约 4 tick @4Hz 结算窗口）。 */
  fallbackDelayMs?: number;
  /** 超过这个时间仍未结算也刷一次并放弃（默认 20s，覆盖 15s 兜底轮询一轮）。 */
  timeoutMs?: number;
  /**
   * 提交已经返回（journal 条目已写入）后再注册时用：没有更新条目就跟踪
   * journal 里最新一条同类型条目（PlanetTheaterControls 的 onChanged 就是这样）。
   */
  trackLatestExisting?: boolean;
}

/** 订阅 journal，等目标命令结算后刷新查询；返回取消函数。 */
export function refetchAfterCommandSettles(
  queryClient: QueryClient,
  options: SettledRefetchOptions,
): () => void {
  const {
    commandType,
    queryKey,
    fallbackDelayMs = 1500,
    timeoutMs = 20_000,
    trackLatestExisting = false,
  } = options;
  let cancelled = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  // 以注册时的 journal 为基线：只看之后新出现的条目（占位被回执原位替换后仍算新条目）。
  const baseline = new Set(
    usePlanetCommandStore.getState().journal
      .filter((entry) => entry.commandType === commandType)
      .map((entry) => entry.requestId),
  );
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
    const entries = usePlanetCommandStore.getState().journal;
    // 条目列表按最新在前：取最近一条同类型的新条目（连续画多个区域时跟最后一个）。
    const current = entries.find(
      (entry) => entry.commandType === commandType && !baseline.has(entry.requestId),
    ) ?? (trackLatestExisting
      ? entries.find((entry) => entry.commandType === commandType)
      : undefined);
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

  // 回执可能已经先于订阅写入（execute 同步完成的情形）：先 check 再挂订阅。
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
