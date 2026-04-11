import { describe, expect, it } from "vitest";

import type { CatalogView } from "@shared/types";

import {
  buildStarterGuide,
  deriveResearchGroups,
  formatTechUnlockLabel,
  normalizeCompletedTechIds,
} from "@/features/planet-map/research-workflow";

function createCatalog(): CatalogView {
  return {
    items: [
      { id: "electromagnetic_matrix", name: "电磁矩阵" },
      { id: "energy_matrix", name: "能量矩阵" },
    ] as never,
    buildings: [
      { id: "matrix_lab", name: "矩阵研究站", buildable: true },
      { id: "tesla_tower", name: "特斯拉塔", buildable: true },
    ] as never,
    recipes: [
      { id: "magnet_recipe", name: "磁铁配方" },
    ] as never,
    techs: [
      {
        id: "dyson_sphere_program",
        name: "戴森球计划",
        level: 0,
        prerequisites: [],
        cost: [],
        unlocks: [{ type: "building", id: "matrix_lab" }],
      },
      {
        id: "electromagnetism",
        name: "电磁学",
        level: 1,
        prerequisites: ["dyson_sphere_program"],
        cost: [{ item_id: "electromagnetic_matrix", quantity: 10 }],
        unlocks: [
          { type: "building", id: "tesla_tower" },
          { type: "recipe", id: "magnet_recipe" },
        ],
      },
      {
        id: "energy_matrix",
        name: "能量矩阵",
        level: 2,
        prerequisites: ["electromagnetism"],
        cost: [{ item_id: "energy_matrix", quantity: 12 }],
        unlocks: [{ type: "special", id: "red_science" }],
      },
    ] as never,
  };
}

describe("research workflow", () => {
  it("归一化 string[] 与旧版 level map completed_techs", () => {
    expect(
      normalizeCompletedTechIds({
        completed_techs: ["dyson_sphere_program", "electromagnetism"],
      } as never),
    ).toEqual(["dyson_sphere_program", "electromagnetism"]);

    expect(
      normalizeCompletedTechIds({
        completed_techs: {
          dyson_sphere_program: 1,
          electromagnetism: 2,
          ignored: 0,
        },
      } as never),
    ).toEqual(["dyson_sphere_program", "electromagnetism"]);
  });

  it("派生 current/available/completed/locked 分组并格式化成本与解锁展示", () => {
    const groups = deriveResearchGroups(createCatalog(), {
      player_id: "p1",
      completed_techs: ["dyson_sphere_program"],
      current_research: {
        tech_id: "electromagnetism",
        state: "in_progress",
        progress: 4,
        total_cost: 10,
        blocked_reason: "waiting_matrix",
      },
    });

    expect(groups.current?.id).toBe("electromagnetism");
    expect(groups.current?.blockedReasonLabel).toContain("矩阵");
    expect(groups.current?.costLabels).toContain("电磁矩阵 x10");
    expect(groups.current?.unlockLabels).toEqual(
      expect.arrayContaining(["特斯拉塔", "磁铁配方"]),
    );
    expect(groups.available).toEqual([]);
    expect(groups.completed.map((tech) => tech.id)).toEqual([
      "dyson_sphere_program",
    ]);
    expect(groups.locked.map((tech) => tech.id)).toEqual(["energy_matrix"]);
    expect(groups.locked[0]?.missingPrerequisiteLabels).toEqual(["电磁学"]);
  });

  it("只在 electromagnetism 尚未完成时显示开局推荐路径", () => {
    expect(
      buildStarterGuide({
        player_id: "p1",
        completed_techs: ["dyson_sphere_program"],
      }),
    ).toMatchObject({
      highlightedTechId: "electromagnetism",
      steps: [
        "风机",
        "空研究站",
        "装 10 电磁矩阵",
        "研究 electromagnetism",
      ],
    });

    expect(
      buildStarterGuide({
        player_id: "p1",
        completed_techs: ["dyson_sphere_program", "electromagnetism"],
      }),
    ).toBeNull();
  });

  it("格式化 building/recipe/special 解锁文案", () => {
    const catalog = createCatalog();

    expect(
      formatTechUnlockLabel(catalog, { type: "building", id: "tesla_tower" }),
    ).toBe("特斯拉塔");
    expect(
      formatTechUnlockLabel(catalog, { type: "recipe", id: "magnet_recipe" }),
    ).toBe("磁铁配方");
    expect(
      formatTechUnlockLabel(catalog, { type: "special", id: "red_science" }),
    ).toBe("特殊解锁：red_science");
  });
});
