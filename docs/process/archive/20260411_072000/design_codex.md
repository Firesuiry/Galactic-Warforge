# Web 未实现功能统一设计方案

## 1. 文档目的

本文针对 `docs/process/task` 下 4 个尚未完成的 Web 相关任务，给出一份统一的实现设计，而不是做 4 份彼此割裂的小修补方案。

覆盖范围：

- `/system/:systemId` 缺少戴森态势展示
- `/agents` 的 builtin / `codex_cli` 执行链路不可用，且失败态泄漏底层错误
- 行星页命令反馈从 accepted 到 authoritative 的回写不一致，且表单仍有协议字段直出
- 移动端行星页在中后期工作流上仍然是“能点但不优雅”

设计目标：

1. 直接在现有主链上补齐 Web 中后期可玩性，不引入兼容性适配层。
2. 明确前端、共享类型、服务端查询层、`agent-gateway` 各自的职责边界。
3. 让后续实现可以按阶段推进，并且每一阶段都能独立验证。

## 2. 现状结论

### 2.1 当前代码的真实瓶颈

1. `client-web/src/pages/SystemPage.tsx` 只请求 `fetchSystem(systemId)`，没有消费 `fetchSystemRuntime(systemId)`，因此页面天然看不到戴森球、太阳帆轨道和系统级能量态势。
2. `client-web/src/features/planet-map/PlanetCommandPanel.tsx` 已达到 1841 行，表单状态、命令提交、accepted/authoritative 反馈、移动端布局都耦合在一个组件里，任何一个链路不稳定都会放大成整页体验问题。
3. `client-web/src/features/planet-commands/store.ts` 已有 `request_id -> command_result` 的事件回写能力，但提交动作仍然是组件内联实现，缺少统一的“命令执行器 + authoritative 补拉”机制。
4. `agent-gateway/src/providers/openai-compatible.ts` 目前只要求“返回 JSON 对象”，并不强制 `actions` 一定为数组；`parseProviderResult` 和 `normalizeProviderTurn` 却要求严格结构，因此 builtin provider 很容易因为结构不完整直接失败。
5. `agent-gateway/src/server.ts` 在 turn 失败时，会把原始异常文本直接写进 `systemMessage.content` 和 `turn.errorMessage`，所以 CLI 命令、代理 URL、request id、上游 502 全都会显示到玩家聊天区。
6. `client-web` 现有浏览器回归主要依赖 `baseline` fixture，尚无 midgame 戴森场景；`/agents` 的 Playwright 用例也是路由 mock，不是真正的 turn 生命周期回放。

### 2.2 四个任务的根因归类

| 任务 | 根因 | 设计域 |
| --- | --- | --- |
| system 页缺少戴森态势 | 页面只读静态星系数据，没建立 system runtime 视图模型 | System 态势展示 |
| agent 链路不可用与错误泄漏 | provider 输出契约太弱，CLI 上游错误未做分类收口 | Agent 执行与错误模型 |
| 命令反馈不一致 | 命令提交与 authoritative 回写没有被抽成统一机制 | 命令反馈闭环 |
| 移动端中后期操作不优雅 | 桌面表单直接压缩到手机，缺少任务型信息架构 | 行星工作台重构 |

## 3. 方案比较

### 方案 A：逐页补洞

- 在 `SystemPage` 里直接加几个 query 和卡片
- 在 `PlanetCommandPanel` 里继续补条件分支
- 在 `agent-gateway` 里针对 `actions must be an array` 和 `502` 分别做 if/else

优点：

- 开发速度最快

缺点：

- 继续加重现有大组件和大文件的耦合
- 命令反馈和移动端问题仍然会反复出现
- agent 链路只是“针对这次报错打补丁”，没有形成稳定的 provider 契约

### 方案 B：按设计域做一次直接重构，最小化扩接口

- `SystemPage` 引入 system runtime 视图模型
- 命令提交抽成共享执行器，SSE 与 snapshot 双通道收口 authoritative 结果
- `agent-gateway` 增加结构化 turn 重试/修复和公开错误收口
- 行星页移动端改成任务型工作台，而不是继续压缩桌面表单

优点：

- 能解决 4 个任务的共同根因
- 变更范围仍集中在 `client-web`、`shared-client`、`server/internal/query`、`agent-gateway`
- 符合“直接重构，不做兼容包装”的项目准则

缺点：

- 需要拆分现有大组件
- 需要补一轮新的浏览器回归基线

### 方案 C：整套 Web 工作台重写

- 重写 system、planet、agents 三个页面和所有命令/智能体状态管理

优点：

- 理论上最干净

缺点：

- 范围过大，不适合当前任务清单
- 会把“补齐未实现功能”拖成一次长期产品重建

### 推荐

采用方案 B。

原因：

1. 它直接针对当前代码的耦合点，而不是只修表面现象。
2. 它允许按阶段交付，每一阶段都能形成可验证结果。
3. 它不需要改世界规则主链，主要是查询层、前端编排层和 `agent-gateway` 的稳定性重构。

## 4. 总体架构

### 4.1 推荐的模块边界

```text
SystemPage
  -> useSystemSituationQuery
  -> DysonSituationPanel
  -> ActivePlanetDysonContextCard

PlanetPage / PlanetCommandCenter
  -> command executor
  -> command journal store
  -> workflow components
  -> mobile task dock / sheet

AgentWorkspace
  -> public turn state
  -> sanitized error model

agent-gateway
  -> structured provider turn runner
  -> provider retry / repair
  -> public error sanitizer
  -> internal debug log
```

### 4.2 设计原则

1. 保留已有 API 路径，优先扩展现有响应结构，不新造一批平行接口。
2. 所有 Web 命令都走同一套 authoritative 收口机制，不允许某些命令靠 SSE、某些命令靠局部状态、某些命令只显示 accepted。
3. `agent-gateway` 对外只暴露产品化错误，对内保留调试细节。
4. 移动端交互按任务流拆，而不是按协议字段堆表单。

## 5. 详细设计

### 5.1 System 页戴森态势

#### 5.1.1 目标

在 `/system/:systemId` 一页内让玩家看到：

- 戴森球总产能
- 各 layer 的 node/frame/shell 数量、`energy_output`、`rocket_launches`、`construction_bonus`
- 太阳帆轨道数量和轨道总能量
- 射线接收站可用的系统级能源
- 当前 active planet 与发射器 / 接收站之间的关系

#### 5.1.2 数据设计

前端保留现有两个请求：

- `GET /world/systems/{systemId}`
- `GET /world/systems/{systemId}/runtime`

额外读取已有：

- `GET /state/summary`

直接扩展 `SystemRuntimeView`，不新造旁路接口。新增字段：

```ts
export interface ActivePlanetDysonContextView {
  planet_id: string;
  planet_name?: string;
  system_id: string;
  em_rail_ejector_count: number;
  vertical_launching_silo_count: number;
  ray_receiver_count: number;
  ray_receiver_modes: {
    power: number;
    photon: number;
    hybrid: number;
  };
}

export interface SystemRuntimeView {
  system_id: string;
  discovered: boolean;
  available: boolean;
  solar_sail_orbit?: SolarSailOrbitState;
  dyson_sphere?: DysonSphereView;
  fleets?: FleetRuntimeView[];
  active_planet_context?: ActivePlanetDysonContextView;
}
```

服务端计算原则：

1. `dyson_sphere.total_energy` 继续表示戴森球结构总产能。
2. `solar_sail_orbit.total_energy` 表示太阳帆轨道总能量。
3. 射线接收站可用系统级能源在前端展示为：
   `solar_sail_orbit.total_energy + dyson_sphere.total_energy`
   这与 `settleRayReceivers` 当前取值逻辑一致。
4. `active_planet_context` 只在“当前 active planet 属于该 system”时返回；否则省略。这样不需要引入跨行星建筑扫描，也符合现有 world runtime 结构。

#### 5.1.3 前端视图模型

新增：

- `client-web/src/features/system/use-system-situation.ts`
- `client-web/src/features/system/system-situation-model.ts`
- `client-web/src/features/system/DysonSituationPanel.tsx`
- `client-web/src/features/system/ActivePlanetDysonContextCard.tsx`

`SystemPage` 只负责：

1. 拉取 `system`、`systemRuntime`、`summary`
2. 维护选中的 planet
3. 把原始数据交给 system 视图模型

视图模型负责生成：

- `systemEnergySummary`
- `sortedLayers`
- `selectedPlanetHint`
- `activePlanetHint`

这样可以避免把展示规则继续塞回 `SystemPage.tsx`。

#### 5.1.4 页面结构

推荐布局：

1. 顶部 hero：显示恒星名、总产能、太阳帆数量、火箭发射次数、可用接收能量。
2. 中间主区：按 layer 展示戴森态势卡片或紧凑表格。
3. 右侧目标行星卡：
   - 基础信息
   - 如果是 active planet，显示发射器 / 接收站数量和模式分布
   - 如果不是 active planet，明确提示“当前实时操作上下文来自 `active_planet_id`”
4. 底部补充说明：把“当前 active planet 上的发射器/接收站”与系统态势关联起来。

#### 5.1.5 代码落点

建议直接重构：

- `server/internal/query/fleet_runtime.go` 中的 `SystemRuntimeView` 和 `SystemRuntime` 迁到新的 `server/internal/query/system_runtime.go`
- `shared-client/src/types.ts` 同步扩字段
- `client-web/src/pages/SystemPage.tsx` 变成薄页面

#### 5.1.6 回归验证

新增：

- `client-web/src/pages/SystemPage.test.tsx`
- `client-web/tests/system-midgame.spec.ts`
- `client-web/src/fixtures/scenarios/midgame-dyson.ts`

其中：

1. fixture 用于视觉和组件回归
2. live midgame 浏览器用例用于验证真实 system runtime 渲染

当前仓库只有 `baseline` fixture，不足以覆盖戴森 system 页，这是必须补的测试基座。

### 5.2 命令 authoritative 闭环

#### 5.2.1 目标

让 `start_research`、`transfer_item`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode` 统一经历：

1. accepted
2. authoritative 成功或失败
3. 最近结果与主反馈位一致

并且页面不再出现 `quantity` 这类裸协议字段。

#### 5.2.2 核心问题

当前 `runCommand()` 在 `PlanetCommandPanel.tsx` 内部，导致：

1. 提交动作和 UI 强耦合
2. authoritative 回写依赖“页面正好还在这个组件里”
3. 缺少统一的补拉策略

#### 5.2.3 重构方案

新增共享执行器：

- `client-web/src/features/planet-commands/executor.ts`

新增统一提交接口：

```ts
interface SubmitPlanetCommandInput {
  commandType: string;
  planetId: string;
  focus?: CommandJournalFocus;
  execute: () => Promise<CommandResponse>;
}
```

执行器职责：

1. 写入 accepted journal
2. 记录 `request_id`
3. 启动 authoritative 等待流程
4. 在超时前自动做 snapshot 补拉

#### 5.2.4 authoritative 收口机制

保留 `usePlanetCommandStore`，但直接升级为“请求跟踪器”，而不是单纯日志数组。

新增能力：

1. `reconcileAcceptedResponse`
2. `reconcileAuthoritativeEvent`
3. `hydrateAuthoritativeSnapshot`
4. `markPendingRecovery`

权威结果来源分两条：

1. 主通道：`usePlanetRealtimeSync` 的 SSE `command_result`
2. 兜底通道：`fetchEventSnapshot({ event_types: ['command_result'] })` 的补拉

推荐策略：

1. 命令提交后立即记录 `request_id`
2. 如果 1 秒内未收到 authoritative，则触发一次 `command_result` snapshot 补拉
3. 页面重新进入或 SSE 重连后，对所有 pending 请求补拉一次最近 `command_result`

这样不需要新增服务器命令结果接口，也能把 accepted 和 authoritative 统一收口。

#### 5.2.5 UI 规则

1. 主反馈位始终展示“最近一条命令的最终状态”；只有在确实还未回写时才显示 accepted。
2. 最近结果列表与主反馈复用同一份 journal 数据，不允许各自拼接不同文案。
3. 失败结果必须展示 authoritative 失败原因。
4. `field.quantity` 进入翻译表，所有表单字段统一走 `fieldLabel()`。

#### 5.2.6 组件拆分

把 `PlanetCommandPanel.tsx` 拆为：

- `PlanetCommandFeedbackPanel.tsx`
- `PlanetWorkflowTabs.tsx`
- `workflows/BasicWorkflow.tsx`
- `workflows/ResearchWorkflow.tsx`
- `workflows/LogisticsWorkflow.tsx`
- `workflows/InterstellarWorkflow.tsx`
- `workflows/DysonWorkflow.tsx`

桌面和移动端都复用同一个命令执行器，避免再次出现“桌面链路能回写、移动端链路不能回写”的分叉。

#### 5.2.7 验证

新增：

- `client-web/src/features/planet-commands/store.test.ts`
- `client-web/src/features/planet-commands/executor.test.ts`
- `client-web/tests/planet-command-authoritative.spec.ts`

浏览器回归至少覆盖：

1. 研究失败
2. 研究成功
3. 射线接收站模式切换成功
4. 太阳帆发射成功

### 5.3 Agent 执行链路与错误收口

#### 5.3.1 目标

1. builtin provider 结构化输出不再因为 `actions must be an array` 直接报废
2. `codex_cli` 遇到上游 502 时，玩家界面只能看到产品化错误
3. agent 创建下级成员、分配权限、发起委派的链路可做真实回归

#### 5.3.2 provider turn 结构化策略

在 `agent-gateway` 内引入统一的“结构化 turn runner”，而不是让每个 provider 各自输出、各自炸掉。

新增：

- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/runtime/provider-error.ts`

执行顺序：

1. 正常请求 provider
2. 尝试 `parseProviderResult`
3. 如果失败原因是结构不完整：
   - 用更严格的修复提示重试一次
   - 修复提示只允许返回合法 JSON，且 `actions` 必须是数组
4. 若第二次仍失败，则输出公开错误 `provider_schema_invalid`

对于 `http_api` provider：

1. 保留当前 openai-compatible 接法
2. 但 prompt 内必须加入一段固定 schema 示例
3. 解析失败后允许一次“schema repair retry”

对于 `codex_cli` provider：

1. 保留 `--output-schema`
2. 在 `runCodexTurn` 外层增加瞬时上游错误重试
3. 只对可识别的瞬时错误重试，例如 `502 Bad Gateway`、连接重置、上游超时

#### 5.3.3 错误分层

新增公开错误模型：

```ts
type PublicTurnErrorCode =
  | 'provider_schema_invalid'
  | 'provider_unavailable'
  | 'provider_start_failed'
  | 'permission_denied'
  | 'unsupported_action'
  | 'unknown';
```

服务端内部保留：

- `rawError`
- provider stderr/stdout
- CLI command line
- upstream request id

这些只进入：

- `AgentThread.executionLogs`
- 服务器日志

绝不进入：

- `ConversationMessage.content`
- `ConversationTurn.errorMessage`

公开错误文案示例：

- `provider_schema_invalid`：成员返回了不可执行的结构化结果，本次任务已终止。
- `provider_unavailable`：上游模型服务暂时不可用，请稍后重试。
- `permission_denied`：该成员当前没有执行这项操作的权限。

#### 5.3.4 turn 持久化字段

建议直接扩 `ConversationTurn`：

```ts
interface ConversationTurn {
  ...
  errorCode?: PublicTurnErrorCode;
  errorMessage?: string; // 仅保存公开错误
}
```

`ChannelWorkspaceView` 只渲染公开错误，不渲染 raw log。

#### 5.3.5 真实链路回归

自动化测试分两层：

1. 稳定回归层
   - `agent-gateway/src/server.test.ts`
   - 本地 fake `http_api` provider
   - 本地 fake `codex_cli` stub
2. 手工 smoke 层
   - 用实际配置的 builtin provider
   - 用实际 `codex_cli` provider
   - 验证创建下级智能体、权限限制、建造/科研委派

原因很简单：

- 外部模型服务的 502 无法靠代码完全消灭
- 代码层能保证的是“重试 + 错误收口 + 健康配置下的 happy path”
- CI 里必须靠本地可控 stub 做确定性回归

#### 5.3.6 代码落点

需要改动：

- `agent-gateway/src/providers/openai-compatible.ts`
- `agent-gateway/src/providers/codex-cli.ts`
- `agent-gateway/src/providers/cli-runner.ts`
- `agent-gateway/src/runtime/turn.ts`
- `agent-gateway/src/server.ts`
- `client-web/src/features/agents/types.ts`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`

### 5.4 移动端行星工作台重构

#### 5.4.1 目标

保留“地图首屏 + 工作台 / 选中对象 / 活动流”三段式大框架，但把移动端工作台改成任务型交互：

- 不再让玩家穿过长表单
- 当前 active planet、选中对象、最近结果始终可感知
- 戴森链中后期操作可以在手机上顺畅完成

#### 5.4.2 交互结构

移动端工作台改为三层：

1. 顶部稳定上下文条
   - active planet
   - 当前选中对象
   - 最新 authoritative 结果
   - 待处理命令数
2. 中部任务入口
   - 建造
   - 研究与装料
   - 戴森发射
   - 射线接收站
3. 底部任务面板
   - 分步骤填写最少必要字段
   - 次要参数折叠到“高级选项”

#### 5.4.3 四条重点链路

1. 建造
   - 先选建筑类型
   - 再选地图位置
   - 方向等低频参数放到折叠区
2. 研究与装料
   - 先选目标研究站
   - 再选研究项目或装料物品
   - 默认带出最近使用数量
3. 戴森发射
   - 先选发射器类型（太阳帆 / 火箭）
   - 再选 building、layer、数量
   - 使用 system runtime 预填当前 layer
4. 射线接收站
   - 先列出当前 planet 的接收站卡片
   - 模式切换用 segmented control，而不是长 select 表单

#### 5.4.4 组件拆分

新增：

- `client-web/src/features/planet-workflows/mobile/MobileTaskDock.tsx`
- `client-web/src/features/planet-workflows/mobile/MobileTaskSheet.tsx`
- `client-web/src/features/planet-workflows/mobile/MobileWorkflowLauncher.tsx`

桌面端继续显示完整工作流卡片，但数据和提交都复用同一套 workflow state 与 command executor。

#### 5.4.5 测试

新增：

- `client-web/src/pages/PlanetPage.mobile.test.tsx`
- `client-web/tests/planet-midgame-mobile.spec.ts`

当前 Playwright 只验证“移动端仍有三标签”，这远远不够，必须补“完成一次 midgame 戴森操作”的真实路径回归。

## 6. 实施顺序

建议按 5 个阶段推进：

### 阶段 1：基础抽象

- 拆出 `system runtime` 查询模型
- 抽出 `planet command executor`
- 抽出 `agent` 公开错误模型

这是后续所有改动的公共底座。

### 阶段 2：System 页戴森态势

- 补 `SystemRuntimeView.active_planet_context`
- 完成 system 页 UI 与 midgame fixture

### 阶段 3：命令 authoritative 闭环

- 命令执行器接管 5 条重点命令
- `field.quantity` 翻译补齐
- 浏览器回归补上

### 阶段 4：Agent 链路

- provider retry / repair
- 错误收口
- e2e 回归和手工 smoke checklist

### 阶段 5：移动端工作台

- 移动端任务型布局
- 四条重点链路优化
- mobile midgame 浏览器回归

## 7. 风险与前置条件

### 7.1 外部模型服务不可用

`codex_cli` 的上游 502 属于外部依赖故障，代码层只能做到：

1. 有限重试
2. 错误分类
3. 对玩家隐藏底层细节

不能把所有外部 502“修没”。这是实施时必须明确的边界。

### 7.2 midgame 浏览器回归基座缺失

当前没有可直接复用的 midgame fixture。若不先补测试场景，system 页和移动端戴森链都无法稳定回归。

### 7.3 PlanetCommandPanel 拆分风险

这是本次重构里最容易引入回归的部分。必须先抽执行器，再拆 UI；不能反过来。

## 8. 验收矩阵

| 目标 | 验收方式 |
| --- | --- |
| `/system/sys-1` 可见 layer、太阳帆、火箭次数、总产能 | 浏览器 midgame 用例 + 组件测试 |
| active planet 与发射器 / 接收站关系可读 | system 页组件测试 |
| `start_research` / `transfer_item` / `launch_solar_sail` / `launch_rocket` / `set_ray_receiver_mode` 全部 authoritative 回写一致 | 命令执行器单测 + 浏览器回归 |
| 页面不再显示 `quantity` | i18n 单测 + 表单渲染测试 |
| builtin provider 不再因 `actions` 结构问题直接裸失败 | gateway 单测 |
| `codex_cli` 失败时聊天区不再泄漏代理 URL / request id / CLI 命令 | gateway 单测 + `/agents` 页面回归 |
| Web 中能完成“创建下级智能体并限制其只可在 `planet-1-1` 执行 `build`” | gateway e2e + 浏览器 live smoke |
| 移动端完成一次中后期戴森操作无需穿过大段无关表单 | mobile Playwright 用例 |

## 9. 结论

这 4 个任务表面上分散在 `system`、`planet`、`agents` 三个页面，实际上只有一个共同问题：当前 Web 端仍然缺少“运行态视图模型”和“统一的执行结果收口层”。

因此推荐的不是继续逐页补洞，而是：

1. 直接补 system runtime 展示模型
2. 统一命令 authoritative 闭环
3. 重做 agent 的 provider turn 契约和错误收口
4. 把移动端行星工作台改成任务型结构

按这个方案推进，四个任务会在同一轮重构里一起闭环，而不是留下下一批新的 UI/状态同步碎片。
