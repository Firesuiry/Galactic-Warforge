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

  it("会用 research_completed 这类异步完成事件收口最终成功态", () => {
    act(() => {
      usePlanetCommandStore.getState().reconcileAcceptedResponse({
        commandType: "start_research",
        planetId: "planet-1-1",
        focus: { techId: "electromagnetism" },
        response: {
          request_id: "req-research-2",
          accepted: true,
          enqueue_tick: 230,
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

    act(() => {
      usePlanetCommandStore.getState().reconcileAuthoritativeEvent({
        event_id: "evt-research-completed-1",
        tick: 233,
        event_type: "research_completed",
        visibility_scope: "p1",
        payload: {
          tech_id: "electromagnetism",
        },
      } as never);
    });

    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-research-2",
      status: "succeeded",
      authoritativeCode: "OK",
      authoritativeMessage: "electromagnetism 研究完成",
      authoritativeSource: "event",
      relatedEventIds: ["evt-research-completed-1"],
    });
  });

  it("根据建筑上下文为 transfer_item 生成不同的下一步提示", () => {
    act(() => {
      usePlanetCommandStore.getState().reconcileAcceptedResponse({
        commandType: "transfer_item",
        planetId: "planet-1-1",
        focus: {
          entityId: "matrix-1",
          buildingType: "matrix_lab",
          techId: "electromagnetism",
        },
        response: {
          request_id: "req-transfer-matrix",
          accepted: true,
          enqueue_tick: 240,
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
      usePlanetCommandStore.getState().reconcileAuthoritativeEvent({
        event_id: "evt-command-result-matrix",
        tick: 241,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: "req-transfer-matrix",
          code: "OK",
          message: "items transferred",
        },
      } as never);
    });

    expect(usePlanetCommandStore.getState().journal[0]?.nextHint).toBe(
      "物料已装入研究站，下一步可启动 electromagnetism。",
    );

    act(() => {
      usePlanetCommandStore.getState().reconcileAcceptedResponse({
        commandType: "transfer_item",
        planetId: "planet-1-1",
        focus: {
          entityId: "ejector-1",
          buildingType: "em_rail_ejector",
        },
        response: {
          request_id: "req-transfer-sail",
          accepted: true,
          enqueue_tick: 242,
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
      usePlanetCommandStore.getState().reconcileAuthoritativeEvent({
        event_id: "evt-command-result-sail",
        tick: 243,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: "req-transfer-sail",
          code: "OK",
          message: "items transferred",
        },
      } as never);
    });

    expect(usePlanetCommandStore.getState().journal[0]?.nextHint).toBe(
      "太阳帆已装入电磁弹射器，下一步可发射太阳帆扩展戴森云。",
    );

    act(() => {
      usePlanetCommandStore.getState().reconcileAcceptedResponse({
        commandType: "transfer_item",
        planetId: "planet-1-1",
        focus: {
          entityId: "silo-1",
          buildingType: "vertical_launching_silo",
        },
        response: {
          request_id: "req-transfer-rocket",
          accepted: true,
          enqueue_tick: 244,
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
      usePlanetCommandStore.getState().reconcileAuthoritativeEvent({
        event_id: "evt-command-result-rocket",
        tick: 245,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: "req-transfer-rocket",
          code: "OK",
          message: "items transferred",
        },
      } as never);
    });

    expect(usePlanetCommandStore.getState().journal[0]?.nextHint).toBe(
      "火箭已装入发射井，下一步可发射火箭构建戴森球结构。",
    );
  });

  it("根据射线接收站模式生成不同的下一步提示", () => {
    for (const [requestId, receiverMode, expectedHint] of [
      [
        "req-ray-power",
        "power",
        "射线接收站已切到 power，下一步观察电网回灌是否生效。",
      ],
      [
        "req-ray-photon",
        "photon",
        "射线接收站已切到 photon，下一步观察光子产出与后续反物质链。",
      ],
      [
        "req-ray-hybrid",
        "hybrid",
        "射线接收站已切到 hybrid，下一步同时关注电网回灌与接收输出。",
      ],
    ] as const) {
      act(() => {
        usePlanetCommandStore.getState().reconcileAcceptedResponse({
          commandType: "set_ray_receiver_mode",
          planetId: "planet-1-1",
          focus: {
            entityId: "ray-1",
            buildingType: "ray_receiver",
            receiverMode,
          },
          response: {
            request_id: requestId,
            accepted: true,
            enqueue_tick: 250,
            results: [
              {
                command_index: 0,
                status: "queued",
                code: "OK",
                message: "set_ray_receiver_mode accepted",
              },
            ],
          },
        });
        usePlanetCommandStore.getState().reconcileAuthoritativeEvent({
          event_id: `evt-${requestId}`,
          tick: 251,
          event_type: "command_result",
          visibility_scope: "p1",
          payload: {
            request_id: requestId,
            code: "OK",
            message: "mode switched",
          },
        } as never);
      });

      expect(usePlanetCommandStore.getState().journal[0]?.nextHint).toBe(
        expectedHint,
      );
    }
  });
});
