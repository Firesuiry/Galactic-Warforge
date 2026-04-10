import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePlanetCommandStore } from "@/features/planet-commands/store";

describe("planet command store", () => {
  beforeEach(() => {
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
  });

  it("记录 accepted 响应，并可用 authoritative snapshot 回写", () => {
    act(() => {
      usePlanetCommandStore.getState().reconcileAcceptedResponse({
        commandType: "start_research",
        planetId: "planet-1-1",
        focus: { techId: "electromagnetism" },
        response: {
          request_id: "req-research-1",
          accepted: true,
          enqueue_tick: 201,
          results: [
            {
              command_index: 0,
              status: "queued",
              code: "OK",
              message: "start_research accepted",
            },
          ],
        },
      });
    });

    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-research-1",
      commandType: "start_research",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "start_research accepted",
      enqueueTick: 201,
    });

    act(() => {
      usePlanetCommandStore.getState().hydrateAuthoritativeSnapshot({
        available_from_tick: 1,
        has_more: false,
        events: [
          {
            event_id: "evt-command-result-1",
            tick: 202,
            event_type: "command_result",
            visibility_scope: "p1",
            payload: {
              request_id: "req-research-1",
              code: "OK",
              message: "research started",
            },
          },
        ],
      } as never);
    });

    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-research-1",
      status: "succeeded",
      authoritativeCode: "OK",
      authoritativeMessage: "research started",
      authoritativeSource: "snapshot",
    });
  });

  it("标记 pending recovery，不会覆盖 authoritative 成功结果", () => {
    act(() => {
      usePlanetCommandStore.getState().reconcileAcceptedResponse({
        commandType: "transfer_item",
        planetId: "planet-1-1",
        response: {
          request_id: "req-transfer-1",
          accepted: true,
          enqueue_tick: 220,
          results: [
            {
              command_index: 0,
              status: "queued",
              code: "OK",
              message: "transfer_item accepted",
            },
          ],
        },
      });
      usePlanetCommandStore.getState().markPendingRecovery("req-transfer-1");
    });

    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-transfer-1",
      status: "pending",
      pendingRecovery: true,
    });

    act(() => {
      usePlanetCommandStore.getState().reconcileAuthoritativeEvent({
        event_id: "evt-command-result-2",
        tick: 221,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: "req-transfer-1",
          code: "OK",
          message: "items transferred",
        },
      } as never);
    });

    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-transfer-1",
      status: "succeeded",
      authoritativeSource: "event",
      pendingRecovery: false,
    });
  });
});
