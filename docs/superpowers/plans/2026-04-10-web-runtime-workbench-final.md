# 2026-04-10 Web 运行态工作台最终方案实施计划

## 目标

基于 [docs/process/design_final.md](/home/firesuiry/develop/siliconWorld/docs/process/design_final.md) 完成四个方向的实现、实验与测试：

1. `system` 页补齐戴森运行态展示。
2. `planet` 页补齐 authoritative 命令闭环与移动端中后期工作流。
3. `agent-gateway` 补齐 provider turn runner 与公开错误模型。
4. 清理 `docs/process/task/` 中已完成任务文件，并同步受影响文档。

## 文件落点

### 共享层

- `shared-client/src/types.ts`
  - 扩展 `SystemRuntimeView` 与 agent turn 公开错误字段。
- `shared-client/src/command-catalog.ts`
  - 为 Web 工作台补足字段标签、focus 元信息、分类元数据导出。
- `shared-client/src/index.ts`
  - 导出新增共享类型与目录能力。

### 服务端查询

- `server/internal/query/fleet_runtime.go`
  - 扩展 `SystemRuntimeView.active_planet_context`。
- `server/internal/query/query_test.go`
  - 覆盖 active planet 命中/未命中两种 system runtime 行为。

### Web

- `client-web/src/pages/SystemPage.tsx`
  - 切到 runtime 驱动的戴森工作台页面。
- `client-web/src/features/system/*`
  - 新增 system 视图模型与组件。
- `client-web/src/features/planet-commands/store.ts`
  - 升级成 request journal/recovery store。
- `client-web/src/features/planet-commands/executor.ts`
  - 新增执行器，收口 accepted、SSE authoritative、snapshot recovery。
- `client-web/src/features/planet-commands/*.test.ts`
  - 覆盖 store/executor。
- `client-web/src/features/planet-workflows/*`
  - 拆出桌面/移动端工作流组件。
- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
  - 收缩为工作台容器，移除裸字段暴露。
- `client-web/src/pages/PlanetPage.test.tsx`
  - 增补移动端工作流断言。
- `client-web/src/pages/SystemPage.test.tsx`
  - 新增 system 页测试。

### Agent Gateway

- `agent-gateway/src/runtime/provider-error.ts`
  - 公开错误码映射与脱敏消息。
- `agent-gateway/src/runtime/provider-turn-runner.ts`
  - 固定 parse/repair/validate/retry 流水线。
- `agent-gateway/src/runtime/turn.ts`
  - 改为调用 provider turn runner。
- `agent-gateway/src/providers/openai-compatible.ts`
  - 支持 schema repair retry。
- `agent-gateway/src/providers/codex-cli.ts`
  - 支持瞬时错误有限重试。
- `agent-gateway/src/server.ts`
  - turn/message 只写公开错误。
- `agent-gateway/src/server.test.ts`
  - 覆盖 builtin/codex_cli 失败时的公开错误行为。

### 文档

- `docs/服务端API.md`
  - 更新 `SystemRuntimeView` 与 authoritative 命令回写说明。
- `docs/process/task/*.md`
  - 对已完成任务直接删除。

## 执行顺序

### 任务 1：shared-client 与 server runtime 基础

1. 先写 Go 查询测试，断言 `active_planet_context` 在 active planet 属于当前星系时返回统计，否则为空。
2. 实现 `fleet_runtime.go` 新视图结构与复制逻辑。
3. 更新 `shared-client/src/types.ts` 对齐新增字段。
4. 运行：

```bash
cd /home/firesuiry/develop/siliconWorld/server
/home/firesuiry/sdk/go1.25.0/bin/go test ./internal/query
```

### 任务 2：system 页戴森工作台

1. 先写 `client-web/src/pages/SystemPage.test.tsx`，覆盖 hero 指标、layer 展示、active planet context。
2. 新增 `client-web/src/features/system/` 下视图模型和展示组件。
3. 重写 `SystemPage.tsx`，改成 `fetchSystem + fetchSystemRuntime + fetchSummary` 驱动。
4. 运行：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- SystemPage
```

### 任务 3：planet authoritative 命令闭环与移动端工作台

1. 先补 `store.test.ts` 与 `executor.test.ts`，分别覆盖：
   - accepted -> command_result 回写。
   - SSE 缺失时 snapshot recovery。
   - `field.quantity` 等标签翻译。
2. 实现 `executor.ts`，并把 `PlanetCommandPanel.tsx` 中提交逻辑迁移出去。
3. 抽工作台组件与移动端 dock/sheet，保留现有 API 路径，复用同一套 store/executor。
4. 扩展 `PlanetPage.test.tsx` 断言移动端首屏上下文、最新 authoritative 反馈和重点链路入口。
5. 运行：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- planet-commands PlanetPage PlanetCommandPanel
```

### 任务 4：agent-gateway 公开错误模型

1. 先扩 `agent-gateway/src/server.test.ts`，写出底层 provider 错误不会直接暴露给消息区的失败测试。
2. 新增 `provider-error.ts` 和 `provider-turn-runner.ts`，把解析/repair/retry 逻辑从 provider 与 turn 层抽离。
3. 改 `server.ts`，turn 与系统消息仅写公开错误文案。
4. 运行：

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm test -- server runtime providers
```

### 任务 5：联调、实验、文档与清理

1. 跑一轮仓库相关测试。
2. 启动本地服务，做 browser/fixture 实验验证：
   - system 页戴森态势；
   - `transfer_item -> start_research` authoritative 闭环；
   - 戴森发射与射线接收站模式切换；
   - `/agents` 失败态脱敏。
3. 更新 `docs/服务端API.md`。
4. 删除 `docs/process/task/` 中本轮四个已完成任务文件。
5. 检查 `git status`，确认只包含本轮改动。

## 验收口径

1. 所有新增测试先失败再转绿。
2. Web 页面不再展示裸协议字段名，例如 `quantity`。
3. `accepted` 只表示受理，最终 UI 以 authoritative 结果为准。
4. `/agents` 页面和 turn 数据不泄漏 provider stderr、代理地址、request id、CLI 命令。
5. `docs/process/task/` 不再保留本轮已完成任务文件。
