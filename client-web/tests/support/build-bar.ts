import { expect, type Page } from '@playwright/test';

/**
 * §3.2 之后建造栏是 DSP 式快捷栏：一次只渲染**一个**分类页签下的图标格
 * （见 features/planet-map/PlanetBuildBar.tsx 的 groupByCategory / currentGroup）。
 * 跨分类的建筑要先点对应页签（或按数字键 1–9）才会出现在 DOM 里，
 * 否则 `locator('.planet-build-card[data-building-id=…]')` 永远等不到元素。
 *
 * 这个 helper 把「找到该建筑所在的分类页签并切过去」收敛成一处：
 * 逐个点页签直到卡片可见，避免测试写死分类顺序（推荐位/分类归属会随数据变化）。
 */
export async function revealBuildCard(page: Page, buildingId: string) {
  const card = page.locator(`.planet-build-card[data-building-id="${buildingId}"]`);
  if (await card.isVisible().catch(() => false)) {
    return card;
  }
  const tabs = page.locator('.planet-build-bar__category');
  const count = await tabs.count();
  for (let index = 0; index < count; index += 1) {
    await tabs.nth(index).click();
    if (await card.isVisible().catch(() => false)) {
      return card;
    }
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}
