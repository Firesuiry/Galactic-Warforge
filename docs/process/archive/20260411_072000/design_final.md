# 2026-04-10 Web 运行态工作台最终实现方案

> 来源说明：
>
> - `docs/process/design_codex.md` 是当前问题域的主方案，覆盖 system 页戴森态势、命令 authoritative 回写、`/agents` 执行链路与移动端工作台四个方向。
> - 仓库当前不存在顶层 `docs/process/design_claude.md`。最新可用的 Claude 归档稿为 `docs/process/archive/20260411_015415/design_claude.md`，其内容实际是旧任务 T105，不直接对应本轮 Web 问题。
> - 因此，本最终稿不采纳 Claude 归档稿的具体改动范围，只吸收其中仍然成立的方法论：authoritative 真相应落在共享/核心层；协议必须显式稳定；测试与文档必须随实现一起收口。

## 1. 最终裁决

本轮最终方案以 `design_codex.md` 为主体，只在两个方面做综合增强：

1. 把“真相前置到共享层”的原则明确落到 `shared-client`、查询层、命令账本和公开错误模型上。
2. 把原本分散在 system、planet、agents 三处的问题统一视为“运行态视图模型缺失 + authoritative 结果收口不足”。

不采用的路径：

1. 不继续逐页补洞。
2. 不增加 Web 专用旁路 API 来掩盖状态模型问题。
3. 不把旧任务 T105 的具体修复内容强行拼入本轮方案。

## 2. 范围与目标

本次最终方案只解决以下 4 个问题：

1. `/system/:systemId` 缺少戴森球与太阳帆运行态展示。
2. 行星页命令反馈从 `accepted` 到 authoritative 结果的回写不一致。
3. `/agents` 的 builtin / `codex_cli` 执行链路不稳定，且失败态泄漏底层错误。
4. 移动端行星页在中后期工作流上可点但不可玩。

最终目标：

1. Web 中后期玩法能在现有主链上完成，不依赖 CLI 补操作。
2. 页面展示、命令提交、SSE 回写、错误模型都基于同一份共享协议。
3. 玩家界面只看到产品化结果，不暴露底层 provider / CLI / 网关细节。
4. 改动范围集中在 `client-web`、`shared-client`、`server/internal/query`、`agent-gateway`，不改世界规则主链。

## 3. 统一设计原则

### 3.1 真相放在共享层，不放在页面局部状态

1. system 页的真相来自扩展后的 `SystemRuntimeView`，而不是页面自己拼接猜测。
2. 命令执行状态的真相来自 `request_id -> authoritative result` 账本，而不是某个组件里的 `resultMessage` 字符串。
3. agent 失败态的真相来自公开错误码与 turn 状态，而不是把原始异常文本直接塞进聊天消息。

### 3.2 协议必须显式

1. `accepted` 只表示已受理，不能再冒充最终成功。
2. authoritative 成功/失败必须有显式状态与回写来源。
3. provider 输出必须经历固定流水线：`request -> parse -> repair/normalize -> validate -> execute`。
4. 对玩家可见的错误必须和内部调试日志分层。

### 3.3 继续沿用现有接口，优先扩展现有结构

1. 保留现有 API 路径。
2. 优先扩展现有响应类型，而不是新增一套平行接口。
3. 命令能力、字段标签、焦点信息等元数据收口到 `shared-client`，避免 CLI、Web、文档各写一份。

### 3.4 先收口底座，再改页面

实施顺序必须先做：

1. 共享类型与命令目录。
2. system runtime 查询模型。
3. 命令执行器与 authoritative 账本。
4. agent 公开错误模型与 turn runner。

然后再做：

1. system 页戴森态势。
2. 行星工作台与移动端工作流。
3. `/agents` 页面回归与真实 smoke。

## 4. 综合后的总体架构

```text
shared-client
  -> command catalog
  -> shared runtime / command / agent error types

server query
  -> SystemRuntimeView
  -> active_planet_context

client-web /system
  -> useSystemSituation
  -> DysonSituationPanel
  -> ActivePlanetDysonContextCard

client-web /planet
  -> command executor
  -> command journal store
  -> PlanetWorkbench
  -> desktop workflows + mobile task dock/sheet

agent-gateway
  -> provider-turn-runner
  -> parse / repair / validate pipeline
  -> public turn error model
  -> internal debug logs
```

职责边界：

1. `shared-client` 负责共享命令目录、类型和公开错误码，不负责 UI 逻辑。
2. `server/internal/query` 只负责 authoritative 运行态查询，不负责前端展示拼装。
3. `client-web` 负责把 authoritative 数据组织成玩家可用的工作台和反馈闭环。
4. `agent-gateway` 负责 provider 契约、错误收口和执行生命周期，不向玩家暴露底层细节。

## 5. 详细设计

### 5.1 System 页戴森态势

保留现有请求：

1. `GET /world/systems/{systemId}`
2. `GET /world/systems/{systemId}/runtime`
3. `GET /state/summary`

直接扩展 `SystemRuntimeView`，新增 `active_planet_context`，用来表达当前 `active_planet` 在该 system 下的戴森相关建筑上下文：

1. `em_rail_ejector_count`
2. `vertical_launching_silo_count`
3. `ray_receiver_count`
4. `ray_receiver_modes`

展示规则：

1. `dyson_sphere.total_energy` 表示结构总产能。
2. `solar_sail_orbit.total_energy` 表示太阳帆轨道总能量。
3. 射线接收站可用系统级能源统一展示为两者之和。
4. `active_planet_context` 只在当前 active planet 属于该 system 时返回，避免引入跨星球扫描副作用。

前端拆分：

1. `SystemPage.tsx` 只负责拉数与选中状态。
2. `use-system-situation.ts` / `system-situation-model.ts` 负责视图模型。
3. `DysonSituationPanel.tsx` 负责系统级态势。
4. `ActivePlanetDysonContextCard.tsx` 负责当前 active planet 与发射器/接收站关系。

页面结构：

1. 顶部 hero 展示恒星名、总产能、太阳帆数、火箭发射次数、可用接收能量。
2. 主区按 layer 展示戴森结构。
3. 侧栏展示选中行星与 active planet 上下文。
4. 底部补充“系统态势如何映射到当前 active planet 的操作能力”。

### 5.2 共享命令目录与 authoritative 命令闭环

新增：

1. `shared-client/src/command-catalog.ts`
2. `client-web/src/features/planet-commands/executor.ts`

共享命令目录至少要覆盖：

1. 命令 canonical ID
2. 命令分类
3. layer / active planet 依赖
4. Web 是否必须覆盖
5. 字段标签与常用 focus 元信息

命令执行器输入：

```ts
interface SubmitPlanetCommandInput {
  commandType: string;
  planetId: string;
  focus?: CommandJournalFocus;
  execute: () => Promise<CommandResponse>;
}
```

执行器职责：

1. 写入 accepted journal。
2. 记录 `request_id`。
3. 启动 authoritative 等待流程。
4. 超时后触发 snapshot 补拉。

`usePlanetCommandStore` 升级为请求跟踪器，新增：

1. `reconcileAcceptedResponse`
2. `reconcileAuthoritativeEvent`
3. `hydrateAuthoritativeSnapshot`
4. `markPendingRecovery`

authoritative 收口来源：

1. 主通道：`usePlanetRealtimeSync` 的 SSE `command_result`
2. 兜底通道：`fetchEventSnapshot({ event_types: ['command_result'] })`

统一 UI 规则：

1. 主反馈位展示最近一条命令的最终状态；只有确实未回写时才展示 accepted。
2. 最近结果列表与主反馈位复用同一份 journal。
3. 失败结果必须展示 authoritative 原因。
4. `quantity` 之类裸协议字段进入统一标签翻译，不允许直接出现在表单中。

### 5.3 行星工作台与移动端任务流

桌面端不再让 `PlanetCommandPanel.tsx` 独占一切，而是拆成工作台：

1. `PlanetOperationHeader`
2. `PlanetCommandFeedbackPanel`
3. `PlanetWorkflowTabs`
4. `PlanetSelectionSummary`
5. `PlanetActivityFeed`

并把原大组件拆分为：

1. `workflows/BasicWorkflow.tsx`
2. `workflows/ResearchWorkflow.tsx`
3. `workflows/LogisticsWorkflow.tsx`
4. `workflows/InterstellarWorkflow.tsx`
5. `workflows/DysonWorkflow.tsx`

关键体验要求：

1. active planet 必须首屏可见，并支持直接 `switch_active_planet`。
2. starter research 必须能纯 Web 跑通，`transfer_item -> start_research -> authoritative feedback` 形成闭环。
3. 戴森命令不再暴露一堆裸 ID 输入框，而是基于 runtime、选中对象和共享目录给出候选项与默认值。
4. 活动流默认只展示高信号事件，低信号背景事件折叠。

移动端工作台改为三层：

1. 顶部稳定上下文条：active planet、选中对象、最新 authoritative 结果、待处理命令数。
2. 中部任务入口：建造、研究与装料、戴森发射、射线接收站。
3. 底部任务面板：分步骤填写最少必要字段，高级选项折叠。

新增：

1. `MobileTaskDock.tsx`
2. `MobileTaskSheet.tsx`
3. `MobileWorkflowLauncher.tsx`

重点链路：

1. 建造
2. 研究与装料
3. 戴森发射
4. 射线接收站模式切换

桌面和移动端必须复用同一套 workflow state 与 command executor，禁止出现两套回写逻辑。

### 5.4 Agent 执行链路与公开错误模型

在 `agent-gateway` 内引入统一的 provider turn runner，而不是让每个 provider 各自解析、各自报错。

新增：

1. `agent-gateway/src/runtime/provider-turn-runner.ts`
2. `agent-gateway/src/runtime/provider-error.ts`

固定流水线：

1. 请求 provider
2. `parseProviderResult`
3. 对结构不完整结果执行一次 repair retry
4. 校验 canonical 结构
5. 执行动作
6. 生成公开 turn 状态与内部调试日志

对于 `http_api` / builtin provider：

1. prompt 中加入固定 schema 示例。
2. 解析失败允许一次 schema repair retry。

对于 `codex_cli` provider：

1. 保留 `--output-schema`。
2. 对可识别的瞬时错误做有限重试，例如 `502 Bad Gateway`、连接重置、上游超时。
3. 超出重试边界后只向玩家暴露公开错误，不回显底层 stderr、代理 URL、request id、命令行。

公开错误码统一为：

```ts
type PublicTurnErrorCode =
  | 'provider_schema_invalid'
  | 'provider_unavailable'
  | 'provider_start_failed'
  | 'permission_denied'
  | 'unsupported_action'
  | 'unknown';
```

持久化原则：

1. `ConversationTurn.errorCode` / `errorMessage` 只保存公开错误。
2. `rawError`、provider stdout/stderr、CLI 参数、upstream request id 只进入执行日志和服务器日志。
3. `ChannelWorkspaceView` 只渲染公开结果与公开失败态。

这部分如果后续仍出现 turn 串线，再继续扩展 message 与 turn 的显式关联字段；但本轮主目标先完成 provider 契约稳定与错误收口。

## 6. 文件级落点

建议重点改动如下：

### 6.1 `shared-client`

1. `shared-client/src/command-catalog.ts`
2. `shared-client/src/types.ts`
3. `shared-client/src/index.ts`

### 6.2 `server`

1. `server/internal/query/system_runtime.go`
2. `server/internal/query/fleet_runtime.go`

### 6.3 `client-web`

1. `client-web/src/pages/SystemPage.tsx`
2. `client-web/src/features/system/use-system-situation.ts`
3. `client-web/src/features/system/system-situation-model.ts`
4. `client-web/src/features/system/DysonSituationPanel.tsx`
5. `client-web/src/features/system/ActivePlanetDysonContextCard.tsx`
6. `client-web/src/features/planet-commands/executor.ts`
7. `client-web/src/features/planet-commands/store.ts`
8. `client-web/src/features/planet-workflows/mobile/*`
9. `client-web/src/features/planet-map/PlanetCommandPanel.tsx` 及其拆分组件
10. `client-web/src/features/agents/types.ts`
11. `client-web/src/features/agents/ChannelWorkspaceView.tsx`

### 6.4 `agent-gateway`

1. `agent-gateway/src/runtime/provider-turn-runner.ts`
2. `agent-gateway/src/runtime/provider-error.ts`
3. `agent-gateway/src/providers/openai-compatible.ts`
4. `agent-gateway/src/providers/codex-cli.ts`
5. `agent-gateway/src/providers/cli-runner.ts`
6. `agent-gateway/src/runtime/turn.ts`
7. `agent-gateway/src/server.ts`

## 7. 实施顺序

### 阶段 1：基础抽象

1. 共享命令目录
2. `SystemRuntimeView` 扩展
3. 命令执行器与账本
4. agent 公开错误模型

### 阶段 2：System 页戴森态势

1. 查询层补 `active_planet_context`
2. 完成 system 页视图模型与 UI
3. 补 midgame fixture

### 阶段 3：命令 authoritative 闭环

1. 执行器接管重点命令
2. 统一 journal 与主反馈位
3. 补 `field.quantity` 等标签翻译

### 阶段 4：Agent 链路

1. provider retry / repair
2. 公开错误收口
3. builtin / `codex_cli` 稳定回归

### 阶段 5：移动端工作台

1. 任务型布局
2. 四条重点中后期链路优化
3. mobile midgame 回归

## 8. 测试与验收

必须新增或扩展以下测试：

1. `client-web/src/pages/SystemPage.test.tsx`
2. `client-web/tests/system-midgame.spec.ts`
3. `client-web/src/features/planet-commands/store.test.ts`
4. `client-web/src/features/planet-commands/executor.test.ts`
5. `client-web/tests/planet-command-authoritative.spec.ts`
6. `client-web/src/pages/PlanetPage.mobile.test.tsx`
7. `client-web/tests/planet-midgame-mobile.spec.ts`
8. `agent-gateway/src/server.test.ts`

浏览器实机回归至少覆盖：

1. system 页可见 layer、太阳帆、火箭次数、总产能与 active planet 上下文。
2. `start_research`、`transfer_item`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode` 全部 authoritative 回写一致。
3. 页面不再显示 `quantity` 一类裸协议字段。
4. builtin provider 不再因 `actions` 结构问题直接裸失败。
5. `codex_cli` 失败时聊天区不再泄漏代理 URL、request id、CLI 命令。
6. 移动端能完成一次中后期戴森操作，不需要穿过长表单。

## 9. 风险与边界

1. 外部模型服务的 `502` 只能通过有限重试与错误分层降低影响，不能保证彻底消失。
2. 当前缺少稳定的 midgame 浏览器回归基座，这会直接影响 system 页与移动端改造的验证效率。
3. `PlanetCommandPanel.tsx` 拆分风险最高，必须先抽执行器，再拆 UI，不能反过来。

不在本次范围内：

1. 不修改世界规则、Tick 语义和现有公开游戏命令含义。
2. 不引入 Web 专用后门命令或第二套 authoritative 业务接口。
3. 不做整套 Web 工作台重写。

## 10. 结论

本轮问题表面分散在 `system`、`planet`、`agents` 三个页面，实质上只有一个共同根因：当前 Web 缺少统一的运行态视图模型与 authoritative 结果收口层。

因此最终方案确定为：

1. 用扩展后的 `SystemRuntimeView` 补齐 system 页戴森态势。
2. 用共享命令目录 + 命令执行器 + request journal 重建行星页反馈闭环。
3. 用 provider turn runner + 公开错误模型收口 `/agents` 链路。
4. 用任务型移动端工作台补齐中后期可玩性。

按这条路线推进，可以在不引入兼容包装层的前提下，一次性解决四个任务的共同根因，而不是继续制造下一批页面级补丁。
