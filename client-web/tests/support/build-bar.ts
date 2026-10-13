import { expect, type Page } from '@playwright/test';

/**
 * §3.2 之后建造栏是 DSP 式快捷栏：一次只渲染**一个**分类页签下的图标格
 * （见 features/planet-map/PlanetBuildBar.tsx 的 groupByCategory / currentGroup）。
 * 跨分类的建筑要先点对应页签（或按数字键 1–9）才会出现在 DOM 里，
 * 否则 `locator('.planet-build-card[data-building-id=…]')` 永远等不到元素。
 *
 * 这个 helper 把「找到该建筑所在的分类页签并切过去」收敛成一处：
 * 逐个点页签直到卡片可见，避免测试写死分类顺序（推荐位/分类归属会随数据变化）。
 *
 * 并行跑时点页签偶尔会被慢渲染吞掉（点完卡片还是上一页的），因此按页签轮询两遍。
 */
export async function revealBuildCard(page: Page, buildingId: string) {
  const card = page.locator(`.planet-build-card[data-building-id="${buildingId}"]`);
  if (await card.isVisible().catch(() => false)) {
    return card;
  }
  const tabs = page.locator('.planet-build-bar__category');
  const count = await tabs.count();
  for (let round = 0; round < 2; round += 1) {
    for (let index = 0; index < count; index += 1) {
      await tabs.nth(index).click();
      if (await card.isVisible().catch(() => false)) {
        return card;
      }
    }
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}

/**
 * 点建造卡片并等「建造模式真的激活」。
 *
 * 3D 软渲染 + 多 worker 并行时，点卡片到 React 提交建造模式有明显的传播延迟，
 * 过早去点地图会把落点当成普通选中（用例报「命令没发出」）。判据用两条互补信号：
 * 建造栏提示行（`.planet-build-bar__hint`，2D/3D 通用）或顶栏「取消建造 · Esc」按钮。
 *
 * 卡片只点一次：重复点同一张卡片会来回切换建造模式（第二次点变成取消）。
 */
export async function enterBuildMode(
  page: Page,
  buildingId: string,
  hintText: string | RegExp,
  timeoutMs = 20_000,
) {
  const card = await revealBuildCard(page, buildingId);
  const hint = page.locator('.planet-build-bar__hint');
  const cancel = page.getByRole('button', { name: '取消建造 · Esc' });
  const matched = async () => {
    if (await cancel.count() > 0) {
      return true;
    }
    // 提示行**只在建造模式激活时存在**：不先判存在就 innerText() 会等满 Playwright
    // 默认 30s 超时（.catch 只能吞掉异常、吞不掉这 30s），比用例自身的超时还长。
    if (await hint.count() === 0) {
      return false;
    }
    const text = await hint.first().innerText({ timeout: 1_000 }).catch(() => '');
    return typeof hintText === 'string' ? text.includes(hintText) : hintText.test(text);
  };
  if (await matched()) {
    return;
  }
  await card.click();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await matched()) {
      return;
    }
    await page.waitForTimeout(400);
  }
  await expect(hint.first()).toContainText(hintText, { timeout: 5_000 });
}
