import { describe, expect, it } from "vitest";

import type { TechCatalogEntry } from "@shared/types";

import { buildTechTreeLayout, techNodeStatusToken } from "./layout";

function tech(overrides: Partial<TechCatalogEntry> & { id: string }): TechCatalogEntry {
  return {
    name: overrides.id,
    category: "main",
    type: "main",
    level: 0,
    icon_key: overrides.id,
    color: "#fff",
    ...overrides,
  };
}

describe("buildTechTreeLayout", () => {
  it("根科技（无前置）位于第 0 列", () => {
    const layout = buildTechTreeLayout([tech({ id: "root" })], new Set());
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].col).toBe(0);
  });

  it("深度按最长前置链计算，而非 catalog level 字段", () => {
    const entries = [
      tech({ id: "a" }),
      tech({ id: "b", prerequisites: ["a"] }),
      tech({ id: "c", prerequisites: ["b"], level: 99 }),
    ];
    const layout = buildTechTreeLayout(entries, new Set());
    const byId = new Map(layout.nodes.map((n) => [n.entry.id, n]));
    expect(byId.get("a")!.col).toBe(0);
    expect(byId.get("b")!.col).toBe(1);
    expect(byId.get("c")!.col).toBe(2);
  });

  it("多前置取最长路径深度", () => {
    const entries = [
      tech({ id: "a" }),
      tech({ id: "b" }),
      tech({ id: "b2", prerequisites: ["b"] }),
      tech({ id: "c", prerequisites: ["a", "b2"] }),
    ];
    const layout = buildTechTreeLayout(entries, new Set());
    const byId = new Map(layout.nodes.map((n) => [n.entry.id, n]));
    expect(byId.get("c")!.col).toBe(2);
  });

  it("hidden 科技不进入布局", () => {
    const entries = [tech({ id: "a" }), tech({ id: "hidden-one", hidden: true })];
    const layout = buildTechTreeLayout(entries, new Set());
    expect(layout.nodes.map((n) => n.entry.id)).toEqual(["a"]);
  });

  it("状态：已完成 / 研究中 / 可研究(前置齐) / 锁定(前置缺)", () => {
    const entries = [
      tech({ id: "a" }),
      tech({ id: "b", prerequisites: ["a"] }),
      tech({ id: "c", prerequisites: ["b"] }),
      tech({ id: "d", prerequisites: ["c"] }),
    ];
    const completed = new Set(["a", "b"]);
    const layout = buildTechTreeLayout(entries, completed, "c");
    const byId = new Map(layout.nodes.map((n) => [n.entry.id, n]));
    expect(byId.get("a")!.status).toBe("completed");
    expect(byId.get("b")!.status).toBe("completed");
    expect(byId.get("c")!.status).toBe("researching");
    expect(byId.get("d")!.status).toBe("locked");
  });

  it("无前置且未完成/未研究的科技为 available", () => {
    const layout = buildTechTreeLayout([tech({ id: "a" })], new Set());
    expect(layout.nodes[0].status).toBe("available");
  });

  it("边：两端均完成时 active=true", () => {
    const entries = [tech({ id: "a" }), tech({ id: "b", prerequisites: ["a"] })];
    const layout = buildTechTreeLayout(entries, new Set(["a", "b"]));
    expect(layout.edges).toEqual([{ fromId: "a", toId: "b", active: true }]);
  });

  it("边：忽略指向不存在科技的前置（防御脏数据）", () => {
    const entries = [tech({ id: "a", prerequisites: ["ghost"] })];
    const layout = buildTechTreeLayout(entries, new Set());
    expect(layout.edges).toEqual([]);
  });

  it("环形前置不死循环，深度回退为 0", () => {
    const entries = [
      tech({ id: "a", prerequisites: ["b"] }),
      tech({ id: "b", prerequisites: ["a"] }),
    ];
    expect(() => buildTechTreeLayout(entries, new Set())).not.toThrow();
  });

  it("lanes 按固定优先级排序，未知 type 追加在尾部按字母序", () => {
    const entries = [
      tech({ id: "a", type: "combat" }),
      tech({ id: "b", type: "main" }),
      tech({ id: "c", type: "zeta" }),
    ];
    const layout = buildTechTreeLayout(entries, new Set());
    expect(layout.lanes).toEqual(["main", "combat", "zeta"]);
  });

  it("techNodeStatusToken 映射四态", () => {
    expect(techNodeStatusToken("completed")).toBe("completed");
    expect(techNodeStatusToken("researching")).toBe("researching");
    expect(techNodeStatusToken("available")).toBe("available");
    expect(techNodeStatusToken("locked")).toBe("locked");
  });
});
