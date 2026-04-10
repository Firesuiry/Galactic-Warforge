import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { submitPlanetCommand } from "@/features/planet-commands/executor";
import { usePlanetCommandStore } from "@/features/planet-commands/store";

describe("planet command executor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
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
});
