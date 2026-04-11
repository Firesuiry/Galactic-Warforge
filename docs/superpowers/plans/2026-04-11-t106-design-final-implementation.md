# T106 Design Final Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 完成 T106 的 agent-gateway、Web 行星建造工作流、研究窄栏交互的实现、实验与测试，并清理 `docs/process/task/` 中已完成任务文件。

**Architecture:** 以 `design_final.md` 为唯一实现规格，优先补齐已有工作区中的半成品实现和测试，而不是重写整套链路。`agent-gateway` 负责 turn 完成态与错误暴露，`client-web` 负责建造/研究派生与交互收口，`docs` 负责同步最终行为与清理已完成任务文件。

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright, Node test runner

---

### Task 1: 锁定剩余缺口并先跑现有关键测试

**Files:**
- Inspect: `docs/process/design_final.md`
- Inspect: `docs/process/task/T106_2026-04-11_Web试玩与智能体回归问题.md`
- Inspect: `agent-gateway/src/runtime/*.ts`
- Inspect: `client-web/src/features/planet-map/*.ts*`
- Inspect: `client-web/src/features/planet-commands/*.ts*`
- Inspect: `client-web/src/features/agents/*.tsx`

- [ ] Step 1: 运行 `agent-gateway` 关键测试，确认 closeout repair、字段别名、错误暴露是否已转绿。
- [ ] Step 2: 运行 `client-web` 关键单测，确认建造工作流、研究工作流与 `/agents` 页面是否仍有失败项。
- [ ] Step 3: 记录失败点，只对失败或设计未覆盖的地方补测试和实现。

### Task 2: 补齐 `agent-gateway` 完成态、repair 与错误可见性

**Files:**
- Modify: `agent-gateway/src/runtime/loop.ts`
- Modify: `agent-gateway/src/runtime/turn-completion.ts`
- Modify: `agent-gateway/src/runtime/game-command-schema.ts`
- Modify: `agent-gateway/src/runtime/provider-turn-runner.ts`
- Modify: `agent-gateway/src/providers/openai-compatible.ts`
- Modify: `agent-gateway/src/server.ts`
- Test: `agent-gateway/src/runtime/loop.test.ts`
- Test: `agent-gateway/src/runtime/action-schema.test.ts`
- Test: `agent-gateway/src/providers/providers.test.ts`
- Test: `agent-gateway/src/server.test.ts`

- [ ] Step 1: 先补或修正失败测试，覆盖 observe closeout、`agent.create` closeout、snake_case 归一化、字段级 repair 与 turn 错误字段落盘。
- [ ] Step 2: 以最小实现修正 runtime，使 `done=true` 只能在最终结果已交付时成功。
- [ ] Step 3: 确认 gateway 返回结构化工具结果，便于最终回复复述。
- [ ] Step 4: 运行 `cd /home/firesuiry/develop/siliconWorld/agent-gateway && npm test`。

### Task 3: 补齐 `client-web` 建造工作流闭环与研究窄栏交互

**Files:**
- Modify: `client-web/src/features/planet-map/build-workflow.ts`
- Modify: `client-web/src/features/planet-commands/error-hints.ts`
- Modify: `client-web/src/features/planet-commands/store.ts`
- Modify: `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- Modify: `client-web/src/features/planet-map/PlanetPanels.tsx`
- Modify: `client-web/src/features/planet-map/research-workflow.ts`
- Modify: `client-web/src/styles/index.css`
- Test: `client-web/src/features/planet-map/build-workflow.test.ts`
- Test: `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
- Test: `client-web/src/features/planet-commands/store.test.ts`
- Test: `client-web/src/pages/PlanetPage.test.tsx`

- [ ] Step 1: 先让建造目录收口、距离预检、缺电提示和研究单列布局相关测试表达最终行为。
- [ ] Step 2: 修正派生层与组件，只保留玩家模式默认入口，高级模式显式展开调试内容。
- [ ] Step 3: 修正 journal 与 state reason 提示，使 `entity_created -> building_state_changed` 能汇总为下一步建议。
- [ ] Step 4: 运行 `cd /home/firesuiry/develop/siliconWorld/client-web && npm test -- build-workflow PlanetCommandPanel store PlanetPage AgentsPage`。

### Task 4: 做浏览器实验与真实回归

**Files:**
- Test: `client-web/tests/planet-build-workflow.spec.ts`
- Test: `client-web/tests/research-workflow.spec.ts`
- Test: `client-web/tests/agent-platform.spec.ts`
- Runtime: `scripts/start-local-playtest.sh`

- [ ] Step 1: 先确认浏览器用例是否存在且符合 `design_final` 的真实点击要求。
- [ ] Step 2: 启动本地服务，执行至少研究点击、建造提示、`/agents` 观察/创建/科研错误展示三条实验路径。
- [ ] Step 3: 保存测试结果与必要证据，只在用例或运行环境阻塞时说明未完成项。

### Task 5: 文档同步与任务清理

**Files:**
- Modify: `docs/process/design_final.md` 仅在实现偏差需要回填时更新
- Modify: `docs/服务端API.md` 若 server/gateway 对外行为发生变化
- Delete: `docs/process/task/T106_2026-04-11_Web试玩与智能体回归问题.md`

- [ ] Step 1: 仅在 API 或用户可见行为变化时更新文档，避免无关改写。
- [ ] Step 2: 在验证完成后删除已完成的 `T106` 任务文件。
- [ ] Step 3: 复查 `git status`，确认没有误删或覆盖用户原有改动。

### 验收

- [ ] `agent-gateway` 测试覆盖 observe closeout、`agent.create` closeout、research 参数 repair、turn 错误字段。
- [ ] `client-web` 测试覆盖默认建造目录收口、距离/供电提示、研究窄栏点击与 `/agents` 错误展示。
- [ ] 浏览器实验至少验证一次真实科技卡片点击，不使用 `force: true`。
- [ ] `docs/process/task/` 不再保留已完成的 T106 任务文件。
