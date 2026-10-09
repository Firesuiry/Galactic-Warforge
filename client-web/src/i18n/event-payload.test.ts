import { describe, expect, it } from "vitest";

import { describeEventPayload, describePayloadField, entityIdLabel } from "@/i18n/event-payload";

describe("事件 payload 中文化（防 snake_case 字段名回流）", () => {
  it("building_state_changed：字段名与状态枚举都走中文，不裸显 building_id=b-7", () => {
    const detail = describeEventPayload({
      building_id: "b-18",
      building_type: "planetary_logistics_station",
      next_state: "no_power",
      prev_reason: "",
      prev_state: "running",
      reason: "power_out_of_range",
    });
    expect(detail).toContain("建筑");
    expect(detail).toContain("b-18");
    expect(detail).toContain("缺电");
    expect(detail).toContain("超出供电范围");
    expect(detail).not.toContain("building_id");
    expect(detail).not.toContain("next_state");
    expect(detail).not.toContain("no_power");
    expect(detail).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it("entity_created：实体类型/势力/出现原因都是中文", () => {
    const detail = describeEventPayload({
      entity_id: "enemy-31",
      entity_type: "enemy_force",
      force_type: "hive",
      level: 1,
      planet_id: "planet-1-1",
      position: { x: 91, y: 19, z: 0 },
      reason: "emerged",
      strength: 100,
    });
    expect(detail).toContain("黑雾部队");
    expect(detail).toContain("蜂巢");
    expect(detail).toContain("(91, 19)");
    expect(detail).not.toContain("entity_type");
    expect(detail).not.toContain("force_type");
    expect(detail).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it("未知字段直接丢弃，不裸显字段名", () => {
    expect(describePayloadField("some_new_field", "value")).toBeNull();
    expect(describeEventPayload({ some_new_field: "x", item_id: "iron_ingot" })).toBe("物品 铁块");
  });

  it("对象/数组值不 dump 成 JSON", () => {
    const detail = describeEventPayload({ inventory: { iron_ingot: 3 }, drops: ["gear"] });
    expect(detail).not.toContain("{");
    expect(detail).not.toContain("[");
    expect(detail).not.toContain("iron_ingot");
  });

  it("实体编号带中文类别前缀", () => {
    expect(entityIdLabel("b-7")).toBe("建筑 b-7");
    expect(entityIdLabel("u-3")).toBe("单位 u-3");
    expect(entityIdLabel("mystery")).toBe("mystery");
  });
});
