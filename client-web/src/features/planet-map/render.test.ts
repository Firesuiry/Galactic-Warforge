import type { Building } from "@shared/types";

import {
  createAnimationFrameValueScheduler,
  describeSceneRenderSimplifications,
  getSceneRenderDetailPolicy,
  isBuildingFootprintVisible,
} from "@/features/planet-map/render";

describe("planet map render helpers", () => {
  it("低缩放时会关闭细网格和建筑标签，并返回简化提示", () => {
    const policy = getSceneRenderDetailPolicy(3);

    expect(policy.showSceneGrid).toBe(false);
    expect(policy.showBuildingLabels).toBe(false);
    expect(policy.simplifyFog).toBe(true);
    expect(policy.simplifyStructures).toBe(true);
    expect(describeSceneRenderSimplifications(policy)).toEqual(
      expect.arrayContaining(["细网格已简化", "迷雾已合并", "建筑与单位已简化"]),
    );
  });

  it("建筑 footprint 只要与视窗相交就应视为可见", () => {
    const building: Building = {
      id: "assembler-1",
      type: "assembler",
      owner_id: "p1",
      position: { x: 10, y: 10, z: 0 },
      hp: 100,
      max_hp: 100,
      level: 1,
      vision_range: 6,
      runtime: {
        params: {
          energy_consume: 1,
          energy_generate: 0,
          capacity: 0,
          maintenance_cost: { minerals: 0, energy: 0 },
          footprint: { width: 3, height: 2 },
        },
        state: "running",
      },
    };

    expect(
      isBuildingFootprintVisible(building, {
        minX: 12,
        minY: 10,
        maxX: 14,
        maxY: 12,
        centerX: 13,
        centerY: 11,
      }),
    ).toBe(true);

    expect(
      isBuildingFootprintVisible(building, {
        minX: 20,
        minY: 20,
        maxX: 24,
        maxY: 24,
        centerX: 22,
        centerY: 22,
      }),
    ).toBe(false);
  });

  it("hover 更新会合并到同一动画帧，只提交最后一个值", () => {
    const frameQueue: FrameRequestCallback[] = [];
    const committed: string[] = [];

    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameQueue.push(callback);
      return frameQueue.length;
    });
    const cancelAnimationFrameMock = vi.fn();

    const scheduler = createAnimationFrameValueScheduler<string>({
      commit: (value) => {
        committed.push(value);
      },
      isEqual: (left, right) => left === right,
      requestFrame: requestAnimationFrameMock,
      cancelFrame: cancelAnimationFrameMock,
    });

    scheduler.schedule("tile-1");
    scheduler.schedule("tile-2");
    scheduler.schedule("tile-3");

    expect(committed).toEqual([]);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    const frame = frameQueue.shift();
    expect(frame).toBeDefined();
    frame?.(16);

    expect(committed).toEqual(["tile-3"]);

    scheduler.schedule("tile-3");
    const duplicateFrame = frameQueue.shift();
    expect(duplicateFrame).toBeDefined();
    duplicateFrame?.(32);

    expect(committed).toEqual(["tile-3"]);
    expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
  });
});
