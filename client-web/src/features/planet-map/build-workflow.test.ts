import { describe, expect, it } from "vitest";

import { deriveBuildWorkflowView } from "@/features/planet-map/build-workflow";

function createCatalog() {
  return {
    buildings: [
      {
        id: "wind_turbine",
        name: "风力涡轮机",
        buildable: true,
        unlock_tech: ["dyson_sphere_program"],
      },
      {
        id: "matrix_lab",
        name: "矩阵研究站",
        buildable: true,
        unlock_tech: ["dyson_sphere_program"],
      },
      {
        id: "ray_receiver",
        name: "射线接收站",
        buildable: true,
        unlock_tech: ["ray_receiver_tech"],
      },
      {
        id: "planetary_logistics_station",
        name: "行星物流站",
        buildable: true,
      },
    ],
  };
}

function createPlanet() {
  return {
    planet_id: "planet-1-1",
    buildings: {
      "lab-1": {
        id: "lab-1",
        type: "matrix_lab",
        owner_id: "p1",
        position: { x: 5, y: 4, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 4,
        runtime: {
          params: {
            energy_consume: 2,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "no_power",
          state_reason: "under_power",
        },
      },
    },
    units: {
      "exec-1": {
        id: "exec-1",
        type: "executor",
        owner_id: "p1",
        position: { x: 1, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        attack: 0,
        defense: 0,
        attack_range: 0,
        move_range: 2,
        vision_range: 4,
        is_moving: false,
      },
    },
  };
}

function createSummary() {
  return {
    players: {
      p1: {
        player_id: "p1",
        is_alive: true,
        executor: {
          unit_id: "exec-1",
          build_efficiency: 1,
          operate_range: 6,
          concurrent_tasks: 1,
          research_boost: 0,
        },
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program"],
        },
      },
    },
  };
}

describe("build workflow", () => {
  it("按已解锁/未解锁/目录异常拆分建造目录，并突出主流程建筑", () => {
    const view = deriveBuildWorkflowView({
      catalog: createCatalog() as never,
      playerId: "p1",
      planet: createPlanet() as never,
      summary: createSummary() as never,
      selectedPosition: { x: 1, y: 1, z: 0 },
    });

    expect(view.catalog.recommended.map((entry) => entry.id)).toEqual([
      "wind_turbine",
      "matrix_lab",
    ]);
    expect(view.catalog.unlocked).toEqual([]);
    expect(view.catalog.locked.map((entry) => entry.id)).toEqual([
      "ray_receiver",
    ]);
    expect(view.catalog.debugOnly.map((entry) => entry.id)).toEqual([
      "planetary_logistics_station",
    ]);
  });

  it("按执行体坐标与 Manhattan 距离派生建造前检查", () => {
    const view = deriveBuildWorkflowView({
      catalog: createCatalog() as never,
      playerId: "p1",
      planet: createPlanet() as never,
      summary: createSummary() as never,
      selectedPosition: { x: 5, y: 4, z: 0 },
    });

    expect(view.reachability).toMatchObject({
      executorUnitId: "exec-1",
      executorPosition: { x: 1, y: 1, z: 0 },
      operateRange: 6,
      distance: 7,
      inRange: false,
    });
    expect(view.preflightHints[0]).toMatchObject({
      title: "当前执行体无法直接建造到目标坐标",
      suggestedAction: "move_executor",
    });
    expect(view.preflightHints[0]?.detail).toContain("distance / operateRange = 7 / 6");
  });

  it("根据建筑停机原因派生建造后的下一步供电提示", () => {
    const view = deriveBuildWorkflowView({
      catalog: createCatalog() as never,
      playerId: "p1",
      planet: createPlanet() as never,
      summary: createSummary() as never,
      selectedPosition: { x: 5, y: 4, z: 0 },
    });

    expect(view.postBuildHints[0]).toMatchObject({
      title: "电网已接入，但当前发电不足",
      suggestedAction: "build_power",
    });
    expect(view.postBuildHints[0]?.detail).toContain("authoritative: under_power");
  });
});
