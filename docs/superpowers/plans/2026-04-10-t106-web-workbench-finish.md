# T106 Web Workbench Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 收掉 Web 行星工作台剩余缺口，完成桌面工作流分组、移动端可玩布局、浏览器回归，并清理已完成的 `docs/process/task` 任务文件。

**Architecture:** 保持现有共享命令目录、命令 journal 与 agent turn 协议不变，只在 `client-web` 做工作台层重构，把“大表单”改成按玩家心智分组的工作流，并在 `PlanetPage` 引入移动端面板切换与更稳定的地图首屏。验证分三层：Vitest 锁组件/页面结构，Playwright 锁浏览器体验，`agent-gateway` 测试确认 T109 现有闭环未回退。

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, Playwright, Node test

---

### Task 1: 先锁住工作台结构与交互验收

**Files:**
- Modify: `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
- Modify: `client-web/src/pages/PlanetPage.test.tsx`
- Modify: `client-web/tests/visual.spec.ts`

- [ ] **Step 1: 写失败的命令分组与最近结果历史测试**

```tsx
it("按工作流分组命令，并展示最近结果历史", async () => {
  render(
    <PlanetCommandPanel
      catalog={catalog as never}
      client={client as never}
      planet={planet as never}
      runtime={runtime as never}
      summary={summary as never}
    />,
  );

  await user.click(screen.getByRole("button", { name: "研究与装料" }));
  expect(screen.getByRole("button", { name: "启动研究" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "建筑装料" })).toBeInTheDocument();
  expect(screen.getByText("最近结果")).toBeInTheDocument();
});
```

- [ ] **Step 2: 写失败的行星页移动端面板测试**

```tsx
it("移动端默认地图首屏可见，并提供工作台/选中对象/活动流切换", async () => {
  renderApp(["/planet/planet-1-1"]);

  expect(await screen.findByRole("img", { name: "行星地图" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "工作台" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "选中对象" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "活动流" })).toBeInTheDocument();
});
```

- [ ] **Step 3: 写失败的浏览器回归断言**

```ts
test("移动端行星页保留地图首屏并可切换工作台面板", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixtureMode(page);
  await page.goto("/planet/planet-1-1");

  await expect(page.getByRole("img", { name: "行星地图" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "工作台" })).toBeVisible();
});
```

- [ ] **Step 4: 运行失败测试确认当前布局不满足要求**

Run: `cd client-web && npm test -- --run PlanetCommandPanel.test.tsx PlanetPage.test.tsx`

Expected: FAIL，缺少工作流切换/最近结果历史/移动端 tab 结构。

### Task 2: 实现 Web 行星工作台重构

**Files:**
- Modify: `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- Modify: `client-web/src/features/planet-commands/PlanetCommandCenter.tsx`
- Modify: `client-web/src/pages/PlanetPage.tsx`
- Modify: `client-web/src/styles/index.css`

- [ ] **Step 1: 为命令面板加入工作流分组与最近结果历史**

```tsx
const WORKBENCH_SECTIONS = [
  { id: "basic", label: "基础操作" },
  { id: "research", label: "研究与装料" },
  { id: "logistics", label: "物流" },
  { id: "cross-planet", label: "跨星球" },
  { id: "dyson", label: "戴森" },
] as const;
```

- [ ] **Step 2: 将原有大表单拆成按分组切换的卡片区，保留现有命令调用与 journal 写入**

```tsx
<div className="planet-command-workflows" role="tablist" aria-label="工作流">
  {WORKBENCH_SECTIONS.map((section) => (
    <button
      key={section.id}
      role="tab"
      aria-selected={activeSection === section.id}
      onClick={() => setActiveSection(section.id)}
      type="button"
    >
      {section.label}
    </button>
  ))}
</div>
```

- [ ] **Step 3: 在行星页增加移动端面板切换，默认保留地图与局势摘要首屏**

```tsx
const [mobilePanel, setMobilePanel] = useState<"workbench" | "selection" | "activity">("workbench");
```

- [ ] **Step 4: 用响应式样式把桌面保持地图优先、移动端切成地图 + 面板 tab，而不是三栏纵向坍塌**

```css
.planet-mobile-tabs {
  display: none;
}

@media (max-width: 900px) {
  .planet-mobile-tabs {
    display: grid;
  }
}
```

- [ ] **Step 5: 运行前端单测直到通过**

Run: `cd client-web && npm test -- --run PlanetCommandPanel.test.tsx PlanetPage.test.tsx`

Expected: PASS

### Task 3: 浏览器实验、回归与文档清理

**Files:**
- Modify: `client-web/tests/visual.spec.ts`
- Delete: `docs/process/task/T106_Web试玩确认智能体动作链仍不可用且行星页交互不达可玩标准.md`

- [ ] **Step 1: 运行浏览器回归与截图测试**

Run: `cd client-web && npm run test:visual -- --project=chromium`

Expected: PASS，桌面截图更新为新工作台布局，移动端切换测试通过。

- [ ] **Step 2: 运行 agent-gateway 回归，确认 T109 链路未退化**

Run: `cd agent-gateway && npm test -- --test-name-pattern="returns initial turns|fails the turn when agent.create policy is incomplete"`

Expected: PASS

- [ ] **Step 3: 删除已完成任务文件并复查工作区**

Run: `git status --short`

Expected: 只剩本轮相关前端、测试与文档改动；`docs/process/task` 不再保留已完成任务文件。
