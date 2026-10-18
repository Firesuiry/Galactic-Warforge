import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refetchAfterCommandSettles } from "@/features/planet-commands/settled-refetch";
import { usePlanetCommandStore } from "@/features/planet-commands/store";

const THEATERS_KEY = ["war-theaters", "http://server", "p1"];

function commandResultEvent(requestId: string) {
  return {
    event_id: `evt-${requestId}`,
    tick: 101,
    event_type: "command_result" as const,
    visibility_scope: "p1",
    payload: { request_id: requestId, code: "OK", status: "ok", message: "done" },
  };
}

describe("refetchAfterCommandSettles", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
    queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("HTTP 已接受但服务端尚未结算：立即重取拿旧数据，结算事件到达后才刷新", () => {
    const cancel = refetchAfterCommandSettles(queryClient, {
      commandType: "theater_define_zone",
      queryKey: THEATERS_KEY,
    });

    // 提交占位（本地 requestId）→ HTTP 回执原位替换成服务端 requestId，仍是 pending。
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: "local-theater_define_zone-1",
      commandType: "theater_define_zone",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "已提交",
    });
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: "req-zone-1",
      commandType: "theater_define_zone",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "accepted",
    });
    // 命令还没在 tick 结算：此刻不能刷新（否则画面继续用旧战区）。
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    // 下一个 tick 的 command_result 到达 → 条目变 succeeded → 刷新。
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-1"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: THEATERS_KEY });
    cancel();
  });

  it("SSE 事件丢失时按兜底延迟补刷一次（画面最终也用新数据）", () => {
    refetchAfterCommandSettles(queryClient, {
      commandType: "theater_define_zone",
      queryKey: THEATERS_KEY,
      fallbackDelayMs: 1500,
    });
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: "req-zone-2",
      commandType: "theater_define_zone",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "accepted",
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1499);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("别的命令的结算不触发战区刷新；trackLatestExisting 跟踪已提交的 theater_create", () => {
    // 已经提交返回后才注册（PlanetTheaterControls.onChanged）：journal 里已有条目。
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: "req-create-1",
      commandType: "theater_create",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "accepted",
    });
    refetchAfterCommandSettles(queryClient, {
      commandType: "theater_create",
      queryKey: THEATERS_KEY,
      trackLatestExisting: true,
    });

    usePlanetCommandStore.getState().addJournalEntry({
      requestId: "req-move-1",
      commandType: "move",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "accepted",
    });
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-move-1"));
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-create-1"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("超时仍未结算也补刷一次，之后不再重复刷新", () => {
    refetchAfterCommandSettles(queryClient, {
      commandType: "theater_define_zone",
      queryKey: THEATERS_KEY,
      timeoutMs: 20_000,
    });
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: "req-zone-3",
      commandType: "theater_define_zone",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "accepted",
    });
    vi.advanceTimersByTime(20_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-3"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("取消函数生效：卸载后不再刷新", () => {
    const cancel = refetchAfterCommandSettles(queryClient, {
      commandType: "theater_define_zone",
      queryKey: THEATERS_KEY,
    });
    cancel();
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: "req-zone-4",
      commandType: "theater_define_zone",
      planetId: "planet-1-1",
      status: "succeeded",
      acceptedMessage: "accepted",
    });
    vi.advanceTimersByTime(20_000);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
