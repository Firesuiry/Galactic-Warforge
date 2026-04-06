# 星球页加载性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 降低 `client-web` 星球页在大地图和低缩放时的加载与交互卡顿，同时保留主要信息可读性。

**Architecture:** 在 `PlanetMapCanvas` 内把高成本静态绘制与轻量 overlay 解耦；通过视窗裁剪、低缩放降细节和 hover 帧节流来减少每帧绘制量和 React 状态写入。实现保持现有 API 和页面结构不变。

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, HTML Canvas, Zustand

---

### Task 1: 为性能降级规则补失败测试

**Files:**
- Modify: `client-web/src/pages/PlanetPage.test.tsx`
- Test: `client-web/src/pages/PlanetPage.test.tsx`

- [ ] **Step 1: 写出低缩放降细节与 hover 节流的失败测试**

```tsx
it("大地图低缩放时会隐藏高成本细网格", async () => {
  renderApp(["/planet/planet-1-1"]);
  expect(await screen.findByRole("heading", { name: "Gaia" })).toBeInTheDocument();
  expect(await screen.findByText(/细网格已简化/)).toBeInTheDocument();
});
```

```tsx
it("hover 状态更新会合并到动画帧内", async () => {
  vi.useFakeTimers();
  renderApp(["/planet/planet-1-1"]);
  const canvas = await screen.findByRole("img", { name: "行星地图" });
  canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 14, clientY: 14, bubbles: true }));
  expect(screen.getByText("Hover -")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试，确认新测试按预期失败**

Run: `npm test -- src/pages/PlanetPage.test.tsx`
Expected: FAIL，提示缺少低缩放提示或 hover 合帧行为未满足断言

- [ ] **Step 3: 只保留能支撑修复的最小测试结构**

```tsx
// 为 scene 大地图构造更密集可见区域，并断言状态栏出现降细节提示
// 为 pointermove 引入 fake timers / requestAnimationFrame 观察点
```

- [ ] **Step 4: 再次运行目标测试，确保仍然是红灯**

Run: `npm test -- src/pages/PlanetPage.test.tsx`
Expected: FAIL

- [ ] **Step 5: 提交阶段性变更**

```bash
git add client-web/src/pages/PlanetPage.test.tsx
git commit -m "test: cover planet page render degradation rules"
```

### Task 2: 重构地图绘制路径并实现降细节

**Files:**
- Modify: `client-web/src/features/planet-map/PlanetMapCanvas.tsx`
- Modify: `client-web/src/features/planet-map/model.ts`
- Test: `client-web/src/pages/PlanetPage.test.tsx`

- [ ] **Step 1: 在模型层补充视窗判断与降细节阈值工具**

```ts
export interface RenderDetailPolicy {
  showSceneGrid: boolean;
  showBuildingLabels: boolean;
  simplifyFog: boolean;
  simplifyStructures: boolean;
}
```

```ts
export function getPlanetRenderDetailPolicy(tileSize: number): RenderDetailPolicy {
  return {
    showSceneGrid: tileSize >= 6,
    showBuildingLabels: tileSize >= 24,
    simplifyFog: tileSize < 3,
    simplifyStructures: tileSize < 6,
  };
}
```

- [ ] **Step 2: 运行相关测试，确认工具尚未接入时页面测试仍失败**

Run: `npm test -- src/pages/PlanetPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 在 `PlanetMapCanvas` 中实现视窗过滤、hover 合帧与状态提示**

```ts
const detailPolicy = getPlanetRenderDetailPolicy(tileSize);
const visibleBuildings = useMemo(() => filterBuildingsByViewport(buildingList, viewportBounds), [buildingList, viewportBounds]);
const pendingHoverRef = useRef<TilePoint | null>(null);
const hoverFrameRef = useRef<number | null>(null);
```

```ts
function scheduleHoveredTile(nextTile: TilePoint | null) {
  pendingHoverRef.current = nextTile;
  if (hoverFrameRef.current !== null) {
    return;
  }
  hoverFrameRef.current = window.requestAnimationFrame(() => {
    hoverFrameRef.current = null;
    const current = usePlanetViewStore.getState().hoveredTile;
    const next = pendingHoverRef.current;
    if ((current?.x ?? null) !== (next?.x ?? null) || (current?.y ?? null) !== (next?.y ?? null)) {
      setHoveredTile(next);
    }
  });
}
```

- [ ] **Step 4: 把高成本绘制逻辑按策略降级**

```ts
if (layers.grid && detailPolicy.showSceneGrid) {
  // draw grid
}

if (layers.fog && fog) {
  if (detailPolicy.simplifyFog) {
    // draw coarser fog blocks
  } else {
    // draw tile fog
  }
}
```

```ts
if (layers.buildings) {
  visibleBuildings.forEach((building) => {
    // simplified rectangles for low zoom
  });
}
```

- [ ] **Step 5: 运行目标测试，确认变绿**

Run: `npm test -- src/pages/PlanetPage.test.tsx`
Expected: PASS

- [ ] **Step 6: 清理重复逻辑，保持测试绿色**

```ts
function drawSceneFog(...)
function drawVisibleBuildings(...)
function drawVisibleUnits(...)
```

- [ ] **Step 7: 提交阶段性变更**

```bash
git add client-web/src/features/planet-map/model.ts client-web/src/features/planet-map/PlanetMapCanvas.tsx client-web/src/pages/PlanetPage.test.tsx
git commit -m "feat: optimize planet canvas rendering path"
```

### Task 3: 完整验证与浏览器检查

**Files:**
- Modify: `client-web/src/features/planet-map/PlanetMapCanvas.tsx`
- Test: `client-web/src/pages/PlanetPage.test.tsx`

- [ ] **Step 1: 运行完整自动化测试**

Run: `npm test`
Expected: PASS，0 failures

- [ ] **Step 2: 运行构建，确认类型和打包通过**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 启动本地页面并用浏览器检查星球页**

Run: `npm run dev -- --host 127.0.0.1 --port 4173`
Expected: Vite 启动成功，可在浏览器打开页面

- [ ] **Step 4: 手工确认关键行为**

```text
1. 打开 /planet/:id，确认地图能显示
2. 低缩放下仍能看见主要建筑/兵力分布
3. 拖拽、缩放、悬停时无明显卡死
4. 建筑建造、兵力调配入口和当前局势信息仍可见
```

- [ ] **Step 5: 若浏览器检查发现问题，做最小修正并重跑验证**

```bash
npm test
npm run build
```
