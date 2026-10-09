/**
 * 科技门控判定（前端唯一出处，语义对齐服务端）。
 *
 * 服务端 `gamecore.CanBuildTech` / `CanUseRecipeTech` 的规则都是「**任一**已完成科技
 * 声明了解锁即通过」（any，不是 every）。历史上前端在建造目录里用了 `every`，
 * 于是声明了两个科技的矩阵研究站（dyson_sphere_program + electromagnetic_matrix_technology）
 * 在只完成开局预置科技时被硬禁用，玩家在建造栏里点不到唯一的研究建筑。
 *
 * 本模块集中这三条判定，建筑目录 / 配方列表 / 手搓 / 进度目标全部复用：
 * - `isBuildingUnlocked`：建筑必须被某个已完成科技声明（无声明 = 不可建造，与服务端一致）；
 * - `isRecipeUnlocked`：配方没有任何科技门控时是基础配方（开局可用），有门控则任一完成即可；
 * - `missingUnlockTechIds`：仅用于展示「还需研究」的科技列表。
 */

import type { BuildingCatalogEntry, RecipeCatalogEntry } from "@shared/types";

/** 过滤空串并去重（catalog 的 unlock 列表允许有空洞）。 */
function normalizeTechIds(techIds: readonly (string | undefined | null)[] | undefined): string[] {
  const seen = new Set<string>();
  for (const techId of techIds ?? []) {
    if (techId) {
      seen.add(techId);
    }
  }
  return [...seen];
}

/** 建筑是否已解锁：可建造 + 至少一个声明它的科技已完成（对齐服务端 CanBuildTech）。 */
export function isBuildingUnlocked(
  entry: Pick<BuildingCatalogEntry, "buildable" | "unlock_tech"> | undefined,
  completedTechIds: ReadonlySet<string>,
): boolean {
  if (!entry?.buildable) {
    return false;
  }
  const required = normalizeTechIds(entry.unlock_tech);
  if (required.length === 0) {
    return false;
  }
  return required.some((techId) => completedTechIds.has(techId));
}

/** 配方是否可用：无科技门控 = 基础配方（开局可用），有门控则任一完成即可。 */
export function isRecipeUnlocked(
  recipe: Pick<RecipeCatalogEntry, "tech_unlock"> | undefined,
  completedTechIds: ReadonlySet<string>,
): boolean {
  if (!recipe) {
    return false;
  }
  const required = normalizeTechIds(recipe.tech_unlock);
  if (required.length === 0) {
    return true;
  }
  return required.some((techId) => completedTechIds.has(techId));
}

/** 展示用「还需研究」列表：所有声明了该解锁项、但玩家尚未完成的科技 id。 */
export function missingUnlockTechIds(
  techIds: readonly (string | undefined | null)[] | undefined,
  completedTechIds: ReadonlySet<string>,
): string[] {
  return normalizeTechIds(techIds).filter((techId) => !completedTechIds.has(techId));
}
