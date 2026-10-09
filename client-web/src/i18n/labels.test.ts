import { describe, expect, it } from "vitest";

import {
  buildingLabel,
  entityKindLabel,
  formatItemAmounts,
  itemLabel,
  recipeLabel,
  techLabel,
  unitLabel,
} from "@/i18n/labels";

describe("界面标签（中英混杂清理）", () => {
  it("词典优先，目录中文名兜底，绝不回退英文 id", () => {
    expect(itemLabel("iron_ingot")).toBe("铁块");
    expect(unitLabel("soldier")).toBe("士兵");
    expect(buildingLabel("wind_turbine")).toBe("风力涡轮机");
    expect(techLabel("electromagnetism")).toBe("电磁学");
  });

  it("目录给了中文名时优先目录（词典未覆盖的新内容）", () => {
    expect(itemLabel("custom_plate", "定制板材")).toBe("定制板材");
    expect(unitLabel("new_unit", "新单位")).toBe("新单位");
  });

  it("配方没有词典：有目录中文名用目录，缺则中性词而不是裸 id", () => {
    expect(recipeLabel("smelt_iron", "铁块冶炼")).toBe("铁块冶炼");
    expect(recipeLabel("unknown_recipe")).toBe("未知");
    expect(recipeLabel("unknown_recipe")).not.toContain("unknown_recipe");
  });

  it("单位类型未知时回退中性词（不显示英文 id）", () => {
    expect(unitLabel("some_new_unit_type")).toBe("未知");
    expect(unitLabel("some_new_unit_type")).not.toContain("some_new_unit_type");
    expect(unitLabel("")).toBe("未知");
  });

  it("实体 id → 类别中文；识别不出返回空串", () => {
    expect(entityKindLabel("b-92")).toBe("建筑");
    expect(entityKindLabel("u-7")).toBe("单位");
    expect(entityKindLabel("sq-3")).toBe("军团");
    expect(entityKindLabel("fleet-enemy-1")).toBe("舰队");
    expect(entityKindLabel("mystery")).toBe("");
  });

  it("物品数量列表用中文名与 × 连接", () => {
    expect(formatItemAmounts([
      { item_id: "iron_ingot", quantity: 2 },
      { item_id: "circuit_board", quantity: 1 },
    ])).toBe("铁块 ×2、电路板 ×1");
    expect(formatItemAmounts(undefined)).toBe("");
  });
});
