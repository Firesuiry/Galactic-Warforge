import { describe, expect, it } from "vitest";

import type { CatalogView } from "@shared/types";

import { initialBuildingLoadSelection } from "@/features/planet-map/model";

/**
 * 建筑抽屉「装入」表单的初始值（试玩 1016 U4）：目标建筑固定为选中建筑，
 * 候选物品/数量口径必须与工作台「研究与装料」一致（背包有 ∩ 建筑会收）。
 */
describe("initialBuildingLoadSelection：抽屉装入表单的默认物品与数量", () => {
  const catalog = {
    items: [
      { id: "electromagnetic_matrix", name: "电磁矩阵", category: "matrix" },
      { id: "energy_matrix", name: "能量矩阵", category: "matrix" },
      { id: "iron_ingot", name: "铁块" },
      { id: "gear", name: "齿轮" },
    ],
    recipes: [
      {
        id: "smelt_iron",
        name: "铁块",
        building_types: ["arc_smelter"],
        inputs: [{ item_id: "iron_ingot", quantity: 1 }],
        outputs: [{ item_id: "gear", quantity: 1 }],
        duration: 4,
      },
    ],
  } as unknown as CatalogView;

  it("研究站（研究模式）优先电磁矩阵，数量取 min(10, 背包持有量)", () => {
    const lab = {
      id: "lab-1",
      type: "matrix_lab",
      runtime: { functions: { research: { tech_id: "electromagnetism" } } },
      storage: { inventory: {} },
    } as never;
    const selection = initialBuildingLoadSelection(
      catalog,
      lab,
      { electromagnetic_matrix: 3, iron_ingot: 99 },
    );
    expect(selection).toEqual({ itemId: "electromagnetic_matrix", quantity: "3" });
  });

  it("有配方的生产建筑只列配方输入（齿轮不会被列进来）", () => {
    const smelter = {
      id: "smelter-1",
      type: "arc_smelter",
      production: { recipe_id: "smelt_iron" },
      runtime: { functions: { storage: { capacity: 40 } } },
      storage: { inventory: {} },
    } as never;
    const selection = initialBuildingLoadSelection(catalog, smelter, { iron_ingot: 50, gear: 4 });
    expect(selection).toEqual({ itemId: "iron_ingot", quantity: "10" });
  });

  it("背包里没有建筑能收的物品时留空（按钮禁用，不报假数量）", () => {
    const smelter = {
      id: "smelter-1",
      type: "arc_smelter",
      production: { recipe_id: "smelt_iron" },
      runtime: { functions: { storage: { capacity: 40 } } },
      storage: { inventory: {} },
    } as never;
    expect(initialBuildingLoadSelection(catalog, smelter, { gear: 4 })).toEqual({ itemId: "", quantity: "" });
  });
});
