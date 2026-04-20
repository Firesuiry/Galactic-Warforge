# T121 War Web Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `client-web` 中新增稳定的战争工作台页面，覆盖蓝图、军工、战区、战报四个长期面板，并提供最小可执行战争操作闭环。

**Architecture:** 在现有大战略壳子内新增独立 `/war` 页面与导航入口。页面使用 `shared-client` 现有战争查询与命令 API，配合少量派生视图与错误解释逻辑，把蓝图创建/校验/定型、部署尝试、任务群姿态调整、封锁与登陆串成可测试工作流。

**Tech Stack:** React, React Router, TanStack Query, Vitest, Testing Library, Playwright

---

### Task 1: 建立战争页面与失败测试

**Files:**
- Create: `client-web/src/pages/WarPage.test.tsx`
- Modify: `client-web/src/app/routes.tsx`
- Modify: `client-web/src/widgets/TopNav.tsx`

- [ ] **Step 1: 写失败测试，定义战争工作台入口与核心面板**

```tsx
it('展示战争工作台四个面板并暴露关键操作', async () => {
  renderApp(['/war']);
  expect(await screen.findByRole('heading', { name: '战争工作台' })).toBeInTheDocument();
  expect(screen.getByText('蓝图工作台')).toBeInTheDocument();
  expect(screen.getByText('军工总览')).toBeInTheDocument();
  expect(screen.getByText('战区面板')).toBeInTheDocument();
  expect(screen.getByText('战报与情报')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix client-web test -- WarPage.test.tsx`
Expected: FAIL，因为 `/war` 页面与导航入口尚不存在。

- [ ] **Step 3: 补路由与导航入口的最小实现**

```tsx
<Route path="/war" element={<WarPage />} />
<NavLink to="/war">战争</NavLink>
```

- [ ] **Step 4: 再次运行测试，确认仍因页面未实现而失败**

Run: `npm --prefix client-web test -- WarPage.test.tsx`
Expected: FAIL，错误收敛到 `WarPage` 内容缺失。

### Task 2: 实现战争工作台页面与命令交互

**Files:**
- Create: `client-web/src/pages/WarPage.tsx`
- Create: `client-web/src/features/war/error-hints.ts`
- Create: `client-web/src/features/war/format.ts`
- Modify: `client-web/src/styles/index.css`

- [ ] **Step 1: 扩展失败测试，覆盖蓝图校验、姿态调整、封锁/登陆等动作**

```tsx
await user.click(screen.getByRole('button', { name: '校验蓝图' }));
expect(await screen.findByText(/功率预算/)).toBeInTheDocument();

await user.selectOptions(screen.getByLabelText('任务群姿态'), 'siege');
await user.click(screen.getByRole('button', { name: '更新姿态' }));

await user.click(screen.getByRole('button', { name: '发起封锁' }));
await user.click(screen.getByRole('button', { name: '发起登陆' }));
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix client-web test -- WarPage.test.tsx`
Expected: FAIL，提示页面中缺少表单、按钮或查询结果。

- [ ] **Step 3: 编写最小实现**

```tsx
const blueprintsQuery = useQuery({ queryKey: ['war-blueprints'], queryFn: client.fetchWarfareBlueprints });
const industryQuery = useQuery({ queryKey: ['war-industry'], queryFn: client.fetchWarIndustry });
const taskForceMutation = useMutation({
  mutationFn: ({ id, stance }) => client.cmdTaskForceSetStance(id, stance),
});
```

```ts
export function resolveWarCommandHint(message?: string | null) {
  if (message?.includes('has no fleet members for blockade')) {
    return { title: '当前任务群没有舰队成员', detail: '先编入舰队，再发起封锁。' };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix client-web test -- WarPage.test.tsx`
Expected: PASS

### Task 3: 回归、文档与任务归档

**Files:**
- Modify: `docs/dev/client-web.md`
- Modify: `docs/process/running_task/T121_client_web战争蓝图军工战区与战报工作台.md`

- [ ] **Step 1: 补充 Web 文档，写清战争工作台入口与边界**

```md
- 新增 `/war` 战争工作台，集中提供蓝图、军工、战区、战报四个长期面板。
- 当前不覆盖任务群成员编成与 AI 军事自治，相关入口仍以后续任务为准。
```

- [ ] **Step 2: 跑完整相关验证**

Run: `npm --prefix client-web test`
Expected: PASS

Run: `cd client-web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 更新任务完成记录并归档**

```md
## 完成情况
- 完成时间：2026-04-20
- 结果：已完成
- 实现摘要：...
- 关键验证：...
```

- [ ] **Step 4: 提交并推送**

Run: `git add client-web docs && git commit -m "feat: add war command workbench"`
Expected: commit 成功

Run: `git push`
Expected: 远程推送成功
