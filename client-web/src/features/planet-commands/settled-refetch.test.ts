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

function pendingEntry(requestId: string, commandType = "theater_define_zone") {
  usePlanetCommandStore.getState().addJournalEntry({
    requestId,
    commandType,
    planetId: "planet-1-1",
    status: "pending",
    acceptedMessage: "accepted",
  });
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

  it("按 requestId 跟踪：结算事件到达后才刷新", () => {
    pendingEntry("req-zone-1");
    const cancel = refetchAfterCommandSettles(queryClient, {
      requestId: "req-zone-1",
      queryKey: THEATERS_KEY,
    });

    // 命令还没在 tick 结算：此刻不能刷新（否则画面继续用旧战区）。
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-1"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: THEATERS_KEY });
    cancel();
  });

  it("别的 requestId（同类型命令）结算不触发这条的刷新", () => {
    pendingEntry("req-zone-1");
    pendingEntry("req-zone-2");
    const cancel = refetchAfterCommandSettles(queryClient, {
      requestId: "req-zone-1",
      queryKey: THEATERS_KEY,
    });
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-2"));
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-1"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("连续两次划定各自刷新一次（订阅按各自 requestId 独立）", () => {
    pendingEntry("req-zone-1");
    pendingEntry("req-zone-2");
    const cancelFirst = refetchAfterCommandSettles(queryClient, {
      requestId: "req-zone-1",
      queryKey: THEATERS_KEY,
    });
    const cancelSecond = refetchAfterCommandSettles(queryClient, {
      requestId: "req-zone-2",
      queryKey: THEATERS_KEY,
    });

    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-1"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-2"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    cancelFirst();
    cancelSecond();
  });

  it("SSE 事件丢失时按兜底延迟补刷一次（画面最终也用新数据）", () => {
    pendingEntry("req-zone-2");
    refetchAfterCommandSettles(queryClient, {
      requestId: "req-zone-2",
      queryKey: THEATERS_KEY,
      fallbackDelayMs: 1500,
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1499);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("超时仍未结算也补刷一次，之后不再重复刷新", () => {
    pendingEntry("req-zone-3");
    refetchAfterCommandSettles(queryClient, {
      requestId: "req-zone-3",
      queryKey: THEATERS_KEY,
      timeoutMs: 20_000,
    });
    vi.advanceTimersByTime(20_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-3"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("取消函数生效：卸载后不再刷新", () => {
    pendingEntry("req-zone-4");
    const cancel = refetchAfterCommandSettles(queryClient, {
      requestId: "req-zone-4",
      queryKey: THEATERS_KEY,
    });
    cancel();
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(commandResultEvent("req-zone-4"));
    vi.advanceTimersByTime(20_000);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
