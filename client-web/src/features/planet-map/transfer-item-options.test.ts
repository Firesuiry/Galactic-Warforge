import { describe, expect, it } from "vitest";

import { listTransferItemOptions } from "@/features/planet-map/model";

/**
 * 装入建筑的物品下拉过滤（试玩 1014 层 04 P4）：旧实现把 90+ 件物品全列出来，
 * 玩家得自己猜目标建筑收不收（研究站只吃矩阵、熔炉只吃当前配方原料）。
 * 现在是「背包里有 ∩ 目标建筑真的会收」，口径与服务端 execTransferItem 一致。
 */
describe("listTransferItemOptions：装入建筑的物品下拉过滤", () => {
  const catalog = {
    items: [
      { id: "iron_ore", name: "铁矿", category: "ore" },
      { id: "copper_ore", name: "铜矿", category: "ore" },
      { id: "iron_ingot", name: "铁块", category: "material" },
      { id: "electromagnetic_matrix", name: "电磁矩阵", category: "matrix" },
      { id: "energy_matrix", name: "能量矩阵", category: "matrix" },
      { id: "proliferator_mk1", name: "增产剂 Mk.I", category: "material" },
      { id: "space_warper", name: "空间翘曲器", category: "component" },
    ],
    recipes: [
      {
        id: "smelt_iron",
        name: "铁块",
        inputs: [{ item_id: "iron_ore", quantity: 1 }],
        outputs: [{ item_id: "iron_ingot", quantity: 1 }],
      },
    ],
  } as never;
  const inventory = {
    iron_ore: 60,
    copper_ore: 10,
    iron_ingot: 4,
    electromagnetic_matrix: 2,
    proliferator_mk1: 3,
    space_warper: 1,
  };
  const smelter = {
    id: "b-64",
    type: "arc_smelter",
    production: { recipe_id: "smelt_iron" },
    runtime: { functions: { production: {} } },
  } as never;

  it("有配方的生产建筑只列「背包里有 ∩ 该配方输入」", () => {
    expect(
      listTransferItemOptions(catalog, smelter, inventory).map((item) => item.id),
    ).toEqual(["iron_ore"]);
  });

  it("研究模式的研究站只列矩阵", () => {
    const lab = {
      id: "lab-1",
      type: "matrix_lab",
      runtime: { functions: { research: {} } },
    } as never;
    expect(
      listTransferItemOptions(catalog, lab, inventory).map((item) => item.id),
    ).toEqual(["electromagnetic_matrix"]);
  });

  it("喷涂机只列增产剂，物流站只列已配置槽位物品", () => {
    const coater = {
      id: "spray-1",
      type: "spray_coater",
      runtime: { functions: {} },
    } as never;
    expect(
      listTransferItemOptions(catalog, coater, inventory).map((item) => item.id),
    ).toEqual(["proliferator_mk1"]);

    const station = {
      id: "b-35",
      type: "planetary_logistics_station",
      logistics_station: { settings: { iron_ingot: {} } },
      runtime: { functions: {} },
    } as never;
    expect(
      listTransferItemOptions(catalog, station, inventory).map((item) => item.id),
    ).toEqual(["iron_ingot"]);
  });

  it("普通仓储/无配方建筑列背包里的一切，按目录顺序（中文名排序）", () => {
    const depot = {
      id: "b-4",
      type: "depot_mk1",
      storage: { capacity: 60 },
      runtime: { functions: {} },
    } as never;
    // localeCompare("zh-CN") 在无 ICU 的运行环境下退化为码点序，这里只断言集合与
    // 稳定顺序（与实现同一比较器），不把具体的中文排序结果写死。
    const ids = listTransferItemOptions(catalog, depot, inventory).map((item) => item.id);
    expect([...ids].sort()).toEqual(
      [
        "copper_ore",
        "electromagnetic_matrix",
        "iron_ingot",
        "iron_ore",
        "proliferator_mk1",
        "space_warper",
      ].sort(),
    );
    const names = listTransferItemOptions(catalog, depot, inventory).map((item) => item.name);
    expect(names).toEqual(
      [...names].sort((left, right) => left.localeCompare(right, "zh-CN")),
    );
  });

  it("背包里没有目标建筑会收的物品时返回空（调用方据此禁用下拉并说明原因）", () => {
    expect(listTransferItemOptions(catalog, smelter, { iron_ingot: 4 })).toEqual([]);
  });
});
