import { describe, expect, it } from "vitest";

import type { BuildingCatalogEntry, RecipeCatalogEntry } from "@shared/types";

import {
  isBuildingUnlocked,
  isRecipeUnlocked,
  missingUnlockTechIds,
} from "@/features/planet-map/tech-gate";

function building(overrides: Partial<BuildingCatalogEntry> = {}): Pick<BuildingCatalogEntry, "buildable" | "unlock_tech"> {
  return { buildable: true, unlock_tech: ["dyson_sphere_program"], ...overrides };
}

function recipe(overrides: Partial<RecipeCatalogEntry> = {}): Pick<RecipeCatalogEntry, "tech_unlock"> {
  return { tech_unlock: [], ...overrides };
}

describe("tech gate（与服务端 CanBuildTech / CanUseRecipeTech 对齐）", () => {
  it("建筑：任一已完成科技声明解锁即可（不是全部）", () => {
    // matrix_lab 声明了 dyson_sphere_program + electromagnetic_matrix_technology，
    // 开局只有前者，仍应解锁（试玩报告阻断级 #2 的根因是这里用了 every）。
    const matrixLab = building({
      unlock_tech: ["dyson_sphere_program", "electromagnetic_matrix_technology"],
    });
    expect(isBuildingUnlocked(matrixLab, new Set(["dyson_sphere_program"]))).toBe(true);
    expect(isBuildingUnlocked(matrixLab, new Set(["electromagnetic_matrix_technology"]))).toBe(true);
    expect(isBuildingUnlocked(matrixLab, new Set())).toBe(false);
    expect(isBuildingUnlocked(matrixLab, new Set(["other_tech"]))).toBe(false);
  });

  it("建筑：不可建造 / 无科技声明一律视为未解锁", () => {
    expect(isBuildingUnlocked(building({ buildable: false }), new Set(["dyson_sphere_program"]))).toBe(false);
    expect(isBuildingUnlocked(building({ unlock_tech: [] }), new Set(["dyson_sphere_program"]))).toBe(false);
    expect(isBuildingUnlocked(undefined, new Set(["dyson_sphere_program"]))).toBe(false);
  });

  it("配方：无门控是基础配方（开局可用），有门控则任一完成即可", () => {
    expect(isRecipeUnlocked(recipe(), new Set())).toBe(true);
    expect(isRecipeUnlocked(recipe({ tech_unlock: ["basic", "advanced"] }), new Set(["advanced"]))).toBe(true);
    expect(isRecipeUnlocked(recipe({ tech_unlock: ["basic", "advanced"] }), new Set(["basic"]))).toBe(true);
    expect(isRecipeUnlocked(recipe({ tech_unlock: ["basic", "advanced"] }), new Set())).toBe(false);
    expect(isRecipeUnlocked(undefined, new Set(["basic"]))).toBe(false);
  });

  it("missingUnlockTechIds 只列出未完成的科技并去重", () => {
    expect(missingUnlockTechIds(["a", "b", "a", ""], new Set(["a"]))).toEqual(["b"]);
    expect(missingUnlockTechIds(undefined, new Set(["a"]))).toEqual([]);
  });
});
