import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { submitPlanetCommand } from "@/features/planet-commands/executor";
import { usePlanetCommandStore } from "@/features/planet-commands/store";
import { useNotificationsStore } from "@/features/notifications/store";

const { sfxMock } = vi.hoisted(() => ({
  sfxMock: {
    commandOk: vi.fn(),
    commandFail: vi.fn(),
  },
}));

vi.mock("@/engine/audio", () => ({
  sfx: sfxMock,
}));

describe("planet command executor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
    useNotificationsStore.getState().resetNotifications();
    sfxMock.commandOk.mockClear();
    sfxMock.commandFail.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepted 后在超时补拉 snapshot，并用 authoritative 结果回写", async () => {
    const execute = vi.fn().mockResolvedValue({
      request_id: "req-build-1",
      accepted: true,
      enqueue_tick: 320,
      results: [
        {
          command_index: 0,
          status: "queued",
          code: "OK",
          message: "build accepted",
        },
      ],
    });
    const fetchAuthoritativeSnapshot = vi.fn().mockResolvedValue({
      available_from_tick: 1,
      has_more: false,
      events: [
        {
          event_id: "evt-command-result-build",
          tick: 321,
          event_type: "command_result",
          visibility_scope: "p1",
          payload: {
            request_id: "req-build-1",
            code: "OK",
            message: "wind_turbine 已开始施工",
          },
        },
      ],
    });

    await submitPlanetCommand({
      commandType: "build",
      planetId: "planet-1-1",
      execute,
      fetchAuthoritativeSnapshot,
      recoveryTimeoutMs: 800,
    });

    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-build-1",
      status: "pending",
    });
    expect(sfxMock.commandOk).toHaveBeenCalledTimes(1);
    expect(sfxMock.commandFail).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchAuthoritativeSnapshot).toHaveBeenCalledWith({
      planetId: "planet-1-1",
      requestId: "req-build-1",
    });
    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-build-1",
      status: "succeeded",
      authoritativeMessage: "wind_turbine 已开始施工",
      authoritativeSource: "snapshot",
    });
  });

  it("SSE 已先回写时，不再触发 snapshot 补拉", async () => {
    const execute = vi.fn().mockResolvedValue({
      request_id: "req-scan-2",
      accepted: true,
      enqueue_tick: 410,
      results: [
        {
          command_index: 0,
          status: "queued",
          code: "OK",
          message: "scan_planet accepted",
        },
      ],
    });
    const fetchAuthoritativeSnapshot = vi.fn();

    await submitPlanetCommand({
      commandType: "scan_planet",
      planetId: "planet-1-1",
      execute,
      fetchAuthoritativeSnapshot,
      recoveryTimeoutMs: 500,
    });

    act(() => {
      usePlanetCommandStore.getState().reconcileAuthoritativeEvent({
        event_id: "evt-command-result-scan",
        tick: 411,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: "req-scan-2",
          code: "OK",
          message: "planet scan complete",
        },
      } as never);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetchAuthoritativeSnapshot).not.toHaveBeenCalled();
    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-scan-2",
      status: "succeeded",
      authoritativeSource: "event",
    });
  });

  it("本地提交失败时只向玩家展示翻译后的文案，原文留在 debugMessage", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("502 Bad Gateway"));

    await submitPlanetCommand({
      commandType: "produce",
      planetId: "planet-1-1",
      execute,
    });

    const entry = usePlanetCommandStore.getState().journal[0];
    expect(entry).toMatchObject({
      status: "failed",
      authoritativeCode: "LOCAL_ERROR",
      authoritativeMessage: "服务器连接异常，请稍后重试。",
      debugMessage: "502 Bad Gateway",
    });
    expect(sfxMock.commandFail).toHaveBeenCalledTimes(1);
    expect(sfxMock.commandOk).not.toHaveBeenCalled();
  });

  it("服务端拒绝时播 commandFail", async () => {
    const execute = vi.fn().mockResolvedValue({
      request_id: "req-reject-1",
      accepted: false,
      results: [
        {
          command_index: 0,
          status: "rejected",
          code: "INSUFFICIENT_RESOURCES",
          message: "矿石不足",
        },
      ],
    });

    await submitPlanetCommand({
      commandType: "build",
      planetId: "planet-1-1",
      execute,
    });

    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      status: "failed",
      authoritativeCode: "INSUFFICIENT_RESOURCES",
    });
    expect(sfxMock.commandFail).toHaveBeenCalledTimes(1);
    expect(sfxMock.commandOk).not.toHaveBeenCalled();
  });

  it("服务端拒绝时弹出显眼的失败 toast（中文原文直出）", async () => {
    const execute = vi.fn().mockResolvedValue({
      request_id: "req-reject-2",
      accepted: false,
      results: [
        {
          command_index: 0,
          status: "rejected",
          code: "INSUFFICIENT_RESOURCES",
          message: "建造还需要 1 个齿轮",
        },
      ],
    });

    await submitPlanetCommand({
      commandType: "build",
      planetId: "planet-1-1",
      execute,
    });

    const toasts = useNotificationsStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      kind: "danger",
      title: "建造失败",
      body: "建造还需要 1 个齿轮",
    });
    // 服务端中文文案直接进入日志
    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      status: "failed",
      authoritativeMessage: "建造还需要 1 个齿轮",
      debugMessage: "建造还需要 1 个齿轮",
    });
  });

  it("GAME_FINISHED 拒绝时提示对局已结束并链到结算页", async () => {
    const execute = vi.fn().mockResolvedValue({
      request_id: "req-finished",
      accepted: false,
      results: [
        {
          command_index: 0,
          status: "rejected",
          code: "GAME_FINISHED",
          message: "game finished: victory already declared, commands are no longer accepted",
        },
      ],
    });

    await submitPlanetCommand({
      commandType: "build",
      planetId: "planet-1-1",
      execute,
    });

    expect(useNotificationsStore.getState().toasts[0]).toMatchObject({
      kind: "danger",
      title: "对局已结束",
      body: "对局已结束，请前往结算页查看战报。",
      href: "/settlement",
    });
    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      status: "failed",
      authoritativeCode: "GAME_FINISHED",
      authoritativeMessage: "对局已结束，请前往结算页查看战报。",
    });
  });

  it("本地提交失败时同样弹出失败 toast", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("fetch failed"));

    await submitPlanetCommand({
      commandType: "build",
      planetId: "planet-1-1",
      execute,
    });

    expect(useNotificationsStore.getState().toasts[0]).toMatchObject({
      kind: "danger",
      title: "建造失败",
      body: "服务器连接异常，请稍后重试。",
    });
  });
});
