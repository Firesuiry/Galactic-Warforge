# 2026-04-10 T106-T109 最终实现方案：Web 主玩法工作台与 Agent Turn 生命周期收口

> 来源说明：
>
> - `docs/process/design_codex.md` 提供了 T106-T109 的当前问题拆解、代码现状与主要改造方向。
> - `docs/process/design_claude.md` 当前文件实际仍是旧任务 T105 的方案稿，不直接覆盖 T106-T109；本最终稿只吸收其中仍然成立的方法论：authoritative 真相应落在共享/核心层，避免在 transport 或 UI 层做补丁式兜底；协议必须显式稳定，测试与文档要随协议一起收口。

## 1. 范围与最终目标

本次最终方案只解决以下 4 个任务：

1. `T106_Web行星命令面板未覆盖戴森球中后期与跨星球玩法`
2. `T107_默认新局纯Web起步链与研究反馈闭环缺失`
3. `T108_Web行星页信息架构与反馈设计不利于游玩`
4. `T109_Web智能体工作台消息动作回写链路不一致`

最终目标是把 `client-web` 与 `agent-gateway` 的异步交互链路从“局部可用但靠猜”收口成“主玩法可玩、结果可追踪、结构可扩展”的稳定系统：

1. 行星页首屏就是主玩法工作台，而不是默认落在调试/详情语境。
2. Web 必须覆盖真实可玩的公开命令，至少补齐 `transfer_item`、`switch_active_planet`、`build_dyson_node/frame/shell`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode`。
3. `/commands` 的同步 `accepted` 只能表示“已受理”，不能再冒充最终成功；最终成功/失败必须由带 `request_id` 的 authoritative 结果回写主反馈位。
4. 默认新局最小科研起步链必须能纯 Web 跑通；midgame 至少一条戴森主链必须能纯 Web 跑通。
5. `/agents` 中每条玩家请求都必须对应一条可追踪的执行生命周期，回复、失败、动作落地必须挂回正确请求，不再出现串线和“先报错后执行”的不一致。

## 2. 从两份设计稿收敛出的统一原则

### 2.1 authoritative 真相前置到共享状态层

沿用 `design_claude.md` 的核心方法论，但应用到当前任务：

1. 命令覆盖面的真相放在共享命令目录，不放在某个页面是否手写了按钮。
2. 命令执行状态的真相放在 `request_id -> authoritative result` 的账本，不放在局部 `resultMessage` 字符串。
3. 智能体请求生命周期的真相放在 `ConversationTurn`，不放在平铺消息流的时间顺序猜测上。

### 2.2 局部收口，不做全局 hack

不采用以下做法：

1. 不在 `apiFetch()` 之类的通用抽象里塞 UI 专用逻辑。
2. 不给 Web 再补一批专用后门 API 来拼装前端状态。
3. 不靠“多加几句提示文案”掩盖异步链路和协议问题。

采用的策略是：

1. 在 `shared-client` 固定命令目录与必要类型。
2. 在 `client-web` 增加命令账本与显式工作台。
3. 在 `agent-gateway` 增加 canonical action normalize 与 `ConversationTurn`。

### 2.3 协议必须显式，不允许隐式猜测

1. 命令链路必须显式区分 `pending` 与 `succeeded/failed`。
2. 智能体消息必须显式带 `turnId` 与 `replyToMessageId`。
3. provider 输出必须先 `parse -> normalize -> validate -> execute`，不能再直接“解析后断言，不合法就炸”。

### 2.4 实施顺序必须先收口底座，再扩表面功能

当前 4 个任务彼此相关，但不是同一层问题。最终实施顺序必须是：

1. 先打通 Web 命令结果闭环与 starter research 起步链。
2. 再重构行星工作台与戴森中后期命令体验。
3. 最后重建 agent turn 生命周期与 `/agents` 工作台。

## 3. 最终取舍

### 3.1 不采用“继续逐页补表单”的方案

原因：

1. T106/T107/T108 的共同根因是“没有统一命令目录”和“没有 authoritative 结果账本”。
2. 继续在 `PlanetCommandPanel.tsx` 里堆按钮，只会让页面越来越像补丁堆。
3. 这种做法无法防止后续再次出现“服务端已实现但 Web 无入口”的回归。

### 3.2 不采用“再加 Web 专用服务端聚合接口”的方案

原因：

1. 当前公开游戏命令已经存在，问题主要在 `shared-client / client-web / agent-gateway` 的编排和反馈链路。
2. 若为了 UI 简化再新增一套 `/web/*` 专用 authoritative 逻辑，会把职责边界继续打乱。

### 3.3 最终采用的统一方案

本次最终采用以下三块共同组成的方案：

1. `shared-client` 建立共享公开命令目录，作为 CLI/Web/文档的一份真相。
2. `client-web` 把行星页重构为工作台，并引入 `request_id` 驱动的命令结果账本。
3. `agent-gateway` 引入 canonical action normalize、`ConversationTurn`、消息引用与 turn 事件流，重建工作台中的请求生命周期。

## 4. 详细设计

### 4.1 共享公开命令目录

新增：

- `shared-client/src/command-catalog.ts`

职责：

1. 定义公开命令 canonical ID。
2. 描述命令分类、作用域、是否依赖 active planet、Web 是否必须覆盖。
3. 显式记录 API 命令名与 CLI 命令别名的映射，避免同一能力在多处漂移。

建议结构：

```ts
export type PublicCommandId =
  | "scan_galaxy"
  | "scan_system"
  | "scan_planet"
  | "build"
  | "move"
  | "demolish"
  | "start_research"
  | "transfer_item"
  | "switch_active_planet"
  | "set_ray_receiver_mode"
  | "launch_solar_sail"
  | "launch_rocket"
  | "build_dyson_node"
  | "build_dyson_frame"
  | "build_dyson_shell";

export interface PublicCommandDefinition {
  id: PublicCommandId;
  cliCommandName?: string;
  category: "observe" | "build" | "research" | "management" | "dyson";
  layer: "galaxy" | "system" | "planet";
  requiresActivePlanet: boolean;
  webSurface: "required" | "optional" | "hidden";
}
```

最终要求：

1. `client-cli` 不再维护另一份同义目录，而是从共享目录派生命令分类和文档描述。
2. `client-web` 不能再靠“页面里写了哪个按钮就算支持哪个命令”，而要根据共享目录显式声明覆盖范围。
3. 必须补一条覆盖测试：凡是 `webSurface = required` 的命令，若 Web 没有 renderer，测试直接失败。

### 4.2 行星页从“详情/命令二选一”改成“主玩法工作台”

当前 `PlanetPage.tsx` 仍然默认 `detailTab = "entity"`，这与 T108 的问题完全一致。最终方案不再把命令区当成次级页签，而是把右侧改造为 `PlanetWorkbench`。

建议桌面结构：

1. `PlanetOperationHeader`
2. `PlanetCommandCenter`
3. `PlanetSelectionSummary`
4. `PlanetActivityFeed`

含义：

1. `PlanetOperationHeader` 固定显示当前路由行星、当前 active planet、最新 authoritative 命令结果、待处理命令数。
2. `PlanetCommandCenter` 承载高频命令卡片，是首屏主入口。
3. `PlanetSelectionSummary` 只负责当前选中实体摘要，不再独占整个右侧主面板。
4. `PlanetActivityFeed` 默认展示高信号反馈，并与最新命令结果同屏。

移动端可以保留折叠区或分段 tab，但必须满足：

1. 默认优先进入操作区。
2. 记住最近一次打开的子面板。
3. 最新 authoritative 结果固定在首屏，不随面板切换消失。

### 4.3 命令中心采用 typed form 组件，不做裸 JSON 表单

新增目录建议：

- `client-web/src/features/planet-commands/`
- `client-web/src/features/planet-commands/forms/`

核心原则：

1. 继续使用 typed form 组件，而不是通用 JSON schema 表单。
2. 表单要从 `catalog`、`runtime`、当前选中实体、当前 active planet 推导候选项和默认值。
3. 命令卡片按玩家心智分组，而不是按接口名平铺。

建议分组：

1. 基础操作：扫描、建造、拆除、移动。
2. 研究与装料：`transfer_item`、`start_research`。
3. 物流：物流站配置、物流槽位配置。
4. 跨星球：`switch_active_planet`。
5. 戴森：`build_dyson_*`、`launch_*`、`set_ray_receiver_mode`。

至少新增以下卡片：

1. `TransferItemCard`
2. `SwitchActivePlanetCard`
3. `DysonBuildCard`
4. `DysonLaunchCard`
5. `RayReceiverModeCard`

### 4.4 Web 侧引入命令结果账本，主反馈不再停留在 accepted

当前 `PlanetCommandPanel.tsx` 只在局部维护 `resultMessage`，收到同步返回后直接显示 `accepted, will execute at next tick` 一类文案。最终方案要求用 `request_id` 建立显式账本。

建议状态结构：

```ts
export interface PlanetCommandJournalEntry {
  requestId: string;
  commandType: string;
  planetId: string;
  submittedAt: number;
  enqueueTick?: number;
  status: "pending" | "succeeded" | "failed";
  acceptedMessage: string;
  authoritativeCode?: string;
  authoritativeMessage?: string;
  relatedEventIds: string[];
  focus?: {
    entityId?: string;
    position?: { x: number; y: number; z?: number };
    techId?: string;
  };
  nextHint?: string;
}
```

数据流必须改成：

1. 提交命令后，把 `CommandResponse.request_id`、`enqueue_tick`、命令类型、聚焦对象写入 journal。
2. 首次写入状态只能是 `pending`。
3. `usePlanetRealtimeSync()` 在收到 `command_result` 事件后，按 `payload.request_id` 回填对应 entry。
4. authoritative 结果到达后，主反馈位从 `pending` 切成 `succeeded` 或 `failed`。
5. `accepted` 只作为中间态说明，不再占据最终反馈位。

实现上：

1. `PlanetCommandPanel.tsx` 负责发起命令，不再自己维护最终态文案。
2. `planet-map/store.ts` 或新的 `planet-commands/store.ts` 负责 journal 的统一状态。
3. `PlanetOperationHeader` 负责展示最新最终结果、失败原因和下一步提示。

### 4.5 默认新局科研链必须有纯 Web 闭环

T107 的根因不在服务端，而在 Web 缺少 `transfer_item` 入口和 authoritative 失败回写。最终方案要求把 starter research 做成真实可玩的默认流。

必须达成：

1. 当选中 `matrix_lab` 或当前研究失败原因为缺矩阵时，命令中心优先展示“建筑装料”卡片。
2. 装料卡片默认预选缺失物料，例如 `electromagnetic_matrix`。
3. `start_research` 失败时，主反馈区明确显示失败原因，并给出下一步操作提示，而不是只显示 `accepted`。
4. 装料成功后，界面直接提供继续研究的预填入口。

注意：

1. 这里不引入“研究专用后门 API”。
2. 统一复用 `transfer_item` 的通用能力，只在 Web 体验层做上下文增强。
3. 同一套“建筑装料”体验后续要能复用到 `vertical_launching_silo`、`em_rail_ejector` 等中后期建筑。

### 4.6 active planet 必须前置成显式上下文

当前 active planet 只在只读摘要中出现，不能满足 T106。最终方案要求在行星页首屏增加显式上下文条。

建议新增：

- `ActivePlanetSwitcher`

必须显示：

1. 当前路由行星：玩家正在看的星球。
2. 当前 active planet：命令默认执行上下文。
3. 若两者不一致，显示醒目提示。

必须支持：

1. 在 Web 内直接提交 `switch_active_planet`。
2. 所有依赖 active planet 的命令卡片都显示统一提示。
3. 命令提交前明确告诉玩家“你正在观察 A，但命令会提交到 B”。

可选项来源优先级：

1. 已发现星球列表。
2. 当前星系已发现行星。
3. 枚举不稳定时允许手动输入 planet ID。

### 4.7 戴森中后期命令使用专用表单，不再堆 ID 输入框

对于 T106，最终不接受“只把几个缺失字段暴露出来”的做法。每个戴森主链命令都必须具备最小可玩性。

最低交互要求：

1. `build_dyson_node`
   - 选择目标星系
   - 选择 `layer_index`
   - 输入或辅助选择 `latitude / longitude`
2. `build_dyson_frame`
   - 先选 layer
   - 再从该层已有 node 列表中选 `node_a / node_b`
3. `build_dyson_shell`
   - 先选 layer
   - 再设置覆盖参数
4. `launch_solar_sail / launch_rocket`
   - 从当前可用发射建筑列表中选目标建筑
   - 明确展示装料情况
   - 数量有默认预填
5. `set_ray_receiver_mode`
   - 从当前 `ray_receiver` 列表中选建筑
   - 模式使用可读选项，而不是裸字符串

这批表单暂时不要求上来就做复杂图形化编辑器，但必须满足：

1. 玩家知道自己在对哪座建筑、哪层结构、哪个星系操作。
2. 默认值尽量来源于当前 runtime 和 scene，而不是让玩家手打全部 ID。
3. 成败结果都统一回写到命令结果账本。

### 4.8 活动流默认高信号可见，低信号折叠

当前 `PlanetActivityPanel` 仍然是 `eventFilter = all` 的平铺模式，不适合真实游玩。最终方案要求显式引入事件优先级。

事件分层：

1. P0 结果事件
   - `command_result`
   - `research_completed`
   - `rocket_launched`
   - `production_alert`
2. P1 状态变化
   - `entity_created`
   - `entity_destroyed`
   - `building_state_changed`
   - `construction_paused`
   - `construction_resumed`
   - `damage_applied`
   - `loot_dropped`
3. P2 背景噪声
   - `tick_completed`
   - `resource_changed`
   - `threat_level_changed`

默认视图规则：

1. 首先展示最近命令结果。
2. 活动流默认只展示 P0 + P1。
3. P2 聚合为“已折叠的背景事件”，按需展开。
4. `shared-client/src/config.ts` 中已有的 `DEFAULT_SSE_SILENT_EVENT_TYPES` 要真正用于 UI 默认折叠逻辑，而不是只保留常量。

推荐把 `PlanetActivityPanel` 的筛选改成明确模式，而不是只有一个 select：

1. `关键反馈`
2. `全部事件`
3. `仅命令`
4. `仅告警`

### 4.9 同屏形成“结果 -> 原因 -> 局势变化”的闭环

最终主反馈区固定回答三个问题：

1. 命令是否成功。
2. 若失败，原因是什么。
3. 若成功或失败，当前局势发生了什么变化。

展示来源：

1. 最终结果来自 `command_result`。
2. 原因来自 `command_result.code/message` 与本地 hint resolver。
3. 局势变化来自相关高信号事件与最新 runtime/summary 快照。

关联规则按三层处理：

1. 优先用 `request_id` 直连 `command_result`。
2. 再按 `focus` 关联 `entity_created / building_state_changed / research_completed / rocket_launched`。
3. 若暂时没有更多结果，只显示“命令已完成，等待场景刷新”，不允许沉默。

### 4.10 agent-gateway 增加 canonical action normalize 层

当前 `runAgentLoop()` 是“provider turn -> assertSupportedAction -> 直接执行”，这正是 T109 中 `action.type is required`、`done must be a boolean` 的根因。最终方案要求把 provider 输出处理拆成固定流水线：

1. `raw provider output`
2. `parse`
3. `normalize`
4. `validate canonical action`
5. `execute`

建议新增 canonical 类型：

```ts
export interface CanonicalAgentTurn {
  assistantMessage: string;
  actions: CanonicalAgentAction[];
  done: boolean;
}

export interface CanonicalAgentPolicy {
  planetIds: string[];
  commandCategories: string[];
  canCreateAgents: boolean;
  canManageMembers: boolean;
  canInviteByPlanet: boolean;
  canCreateSchedules: boolean;
  canDirectMessageAgentIds: string[];
  canDispatchAgentIds: string[];
}

export type CanonicalAgentAction =
  | { type: "game.cli"; commandLine: string }
  | { type: "agent.create"; name: string; role?: string; goal?: string; providerId?: string; policy: CanonicalAgentPolicy }
  | { type: "agent.update"; agentId: string; policy?: CanonicalAgentPolicy; role?: string; goal?: string }
  | { type: "conversation.ensure_dm"; targetAgentId: string }
  | { type: "conversation.send_message"; conversationId?: string; targetAgentId?: string; content: string }
  | { type: "final_answer"; message: string }
  | { type: "memory.note"; note: string };
```

normalize 层职责：

1. 兼容有限范围内、无歧义的 provider 方言，例如 `done: "true"` 或 `action.args` 包裹。
2. 只要映射有歧义，就拒绝执行，并生成结构化失败结果。
3. 执行层以后只接受 canonical action。

边界要求：

1. 不从 assistant 自然语言里猜缺失参数。
2. 不允许“先部分执行，再在 UI 上报 schema 错误”。
3. schema 或 normalize 失败也必须绑定到对应 turn，而不是只打印一条孤立 system message。

### 4.11 `agent.create` 必须要求结构化权限完整

针对 T109，本次最终明确：

1. provider 触发的 `agent.create` action 必须带完整 `policy`。
2. `policy.planetIds`、`policy.commandCategories`、相关布尔权限字段不能再依赖默认空值。
3. 若关键字段缺失，直接拒绝执行，turn 标记为 `failed`，失败原因明确写出缺失字段。

这条规则只针对 gateway 内部的 canonical action 契约，目的是防止“创建成功但权限语义没落地”的假成功。

### 4.12 引入 `ConversationTurn`，把请求生命周期从消息流中解耦

新增：

- `agent-gateway/src/store/turn-store.ts`

新增类型建议：

```ts
export interface ConversationTurn {
  id: string;
  conversationId: string;
  requestMessageId: string;
  actorType: "player" | "schedule";
  actorId: string;
  targetAgentId: string;
  status: "accepted" | "queued" | "planning" | "executing" | "succeeded" | "failed";
  assistantPreview?: string;
  assistantMessageId?: string;
  finalMessageId?: string;
  errorMessage?: string;
  actionSummaries: Array<{
    type: string;
    status: "pending" | "succeeded" | "failed";
    detail: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

规则：

1. 每条玩家消息一旦触发 agent 自动唤醒，就同时创建对应 turn。
2. DM 中通常是一条请求对应一个 turn。
3. 频道中一条带多个 `@` 的请求可以对应多个 turn。
4. mailbox 处理的最小单位从“消息”升级为“消息触发的 turn 生命周期”。

### 4.13 会话消息增加 `replyToMessageId` 与 `turnId`

扩展：

- `agent-gateway/src/types.ts`
- `client-web/src/features/agents/types.ts`

新增字段：

```ts
export interface ConversationMessage {
  ...
  replyToMessageId?: string;
  turnId?: string;
}
```

使用规则：

1. agent 回复消息必须带 `replyToMessageId = 发起请求的玩家消息 ID`。
2. system failure 若需要落消息，也必须带相同的 `replyToMessageId` 与 `turnId`。
3. 任何阶段性消息若属于某次 turn，都必须带 `turnId`。

这样前端就能按“请求卡片 -> turn 状态 -> 回复/失败/动作摘要”分组，而不是继续按到达时间平铺。

### 4.14 会话 API 与 SSE 同步升级

当前 `POST /conversations/:id/messages` 实际已返回 `{ accepted, message }`，但前端把它简化成 `{ accepted: boolean }`。最终方案要求两侧一起收口。

API 调整：

1. `POST /conversations/:id/messages` 的前端类型必须接住 authoritative `message`。
2. 建议进一步返回 `turns` 的初始快照，至少让前端能立即建立请求卡片。
3. 新增 `GET /conversations/:id/turns`，供页面首屏拉取当前 turn 列表。

SSE 调整：

1. 保留 `message` 事件。
2. 新增 `turn.updated`
3. 新增 `turn.completed`
4. 新增 `turn.failed`

前端策略：

1. `message` 事件增量写入消息缓存。
2. `turn.*` 事件增量写入 turn 缓存。
3. 只有在重连或怀疑漏事件时才做全量 refetch。

### 4.15 `/agents` UI 改成“请求卡片 + turn 状态 + 回复分组”

`ChannelWorkspaceView.tsx` 不能再只渲染 `messages[]`。最终界面模型应改成：

1. 以玩家请求消息为主卡片。
2. 每个请求卡片下显示一个或多个 agent turn。
3. 每个 turn 内展示：
   - 当前状态
   - 规划摘要
   - 动作执行摘要
   - 最终回复
   - 失败原因

这样可以稳定表达：

1. 这条请求是否已接收。
2. 当前在排队、规划、执行还是已经完成。
3. 失败是 schema 问题、权限问题还是游戏命令失败。
4. 迟到回复属于哪条旧请求，而不是污染最新请求。

### 4.16 assistant 规划文本不再直接落成最终会话回复

当前 `server.ts` 在 `onAssistantMessage` 中立即把 `assistantMessage` 写入会话，这会造成“先承诺，后失败”的错觉。最终方案要求：

1. `assistantMessage` 先作为 turn 的 `assistantPreview` 或 planning/executing 状态说明。
2. 只有满足以下条件之一时，才写成正式 agent message：
   - provider 明确给出 `final_answer`
   - turn 成功结束且该文本被标记为可见最终回复
3. 若 turn 失败，前端展示规划摘要、失败原因和未完成动作，而不是把规划文本当成已完成答复。

## 5. 文件级落地建议

### 5.1 `shared-client`

建议新增或修改：

- `shared-client/src/command-catalog.ts`
- `shared-client/src/api.ts`
- `shared-client/src/types.ts`
- `shared-client/src/index.ts`

职责：

1. 建立共享命令目录。
2. 扩展命令与 turn 相关类型。
3. 为 Web 和 CLI 暴露统一命令元信息。

### 5.2 `client-web` 行星工作台

建议重点修改：

- `client-web/src/pages/PlanetPage.tsx`
- `client-web/src/features/planet-map/PlanetPanels.tsx`
- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- `client-web/src/features/planet-map/use-planet-realtime.ts`
- `client-web/src/features/planet-map/store.ts`
- `client-web/src/features/planet-map/model.ts`
- `client-web/src/i18n/translation-config.ts`

建议新增：

- `client-web/src/features/planet-commands/PlanetOperationHeader.tsx`
- `client-web/src/features/planet-commands/ActivePlanetSwitcher.tsx`
- `client-web/src/features/planet-commands/PlanetCommandCenter.tsx`
- `client-web/src/features/planet-commands/use-command-journal.ts`
- `client-web/src/features/planet-commands/forms/TransferItemCard.tsx`
- `client-web/src/features/planet-commands/forms/SwitchActivePlanetCard.tsx`
- `client-web/src/features/planet-commands/forms/DysonBuildCard.tsx`
- `client-web/src/features/planet-commands/forms/DysonLaunchCard.tsx`
- `client-web/src/features/planet-commands/forms/RayReceiverModeCard.tsx`

### 5.3 `agent-gateway`

建议重点修改：

- `agent-gateway/src/types.ts`
- `agent-gateway/src/routes/conversations.ts`
- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/runtime/turn.ts`
- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/runtime/router.ts`
- `agent-gateway/src/server.ts`

建议新增：

- `agent-gateway/src/store/turn-store.ts`

### 5.4 `client-web` 智能体工作台

建议重点修改：

- `client-web/src/features/agents/types.ts`
- `client-web/src/features/agents/api.ts`
- `client-web/src/features/agents/use-agent-events.ts`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`
- `client-web/src/pages/AgentsPage.tsx`

## 6. 建议实施顺序

### 阶段 1：先打通 Web 命令反馈底座与 starter research

目标：

1. 共享命令目录。
2. 命令结果账本。
3. active planet 显式上下文。
4. `transfer_item` 与 `switch_active_planet` 的 Web 卡片。
5. `start_research` 的 authoritative 结果回写与下一步提示。

阶段完成后应先收掉 T107，并为 T106/T108 提供底座。

### 阶段 2：重构行星工作台与戴森中后期操作

目标：

1. 行星页改成主玩法工作台。
2. 戴森命令 typed form 补齐。
3. 活动流高信号默认可见。
4. 同屏结果闭环完成。

阶段完成后应收掉 T106 与 T108。

### 阶段 3：重建 agent turn 生命周期与 `/agents` 工作台

目标：

1. canonical action normalize。
2. `ConversationTurn` 存储与事件流。
3. `replyToMessageId + turnId`。
4. `/agents` 请求卡片式界面。
5. assistant 规划文本与最终回复分离。

阶段完成后应收掉 T109。

## 7. 测试与验证设计

### 7.1 `client-web` 单测

建议至少扩展：

- `client-web/src/shared-api.test.ts`
- `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
- `client-web/src/pages/PlanetPage.test.tsx`
- `client-web/src/pages/AgentsPage.test.tsx`
- `client-web/src/features/agents/api.test.ts`

必须覆盖：

1. `transfer_item`、`switch_active_planet`、至少一条戴森命令有表单提交流程。
2. 提交研究命令后先显示 `pending`，收到匹配 `request_id` 的 `command_result` 后切为最终失败或成功。
3. 默认活动流不展示 `tick_completed / resource_changed / threat_level_changed`，但可展开。
4. 发送会话消息后，前端会接住 authoritative `message` 与 `turn`，并按请求卡片分组显示。
5. 迟到回复只能挂回原请求，不得污染最新请求。

### 7.2 `agent-gateway` 单测 / 集成测试

建议至少扩展：

- `agent-gateway/src/runtime/loop.test.ts`
- `agent-gateway/src/runtime/router.test.ts`
- `agent-gateway/src/server.test.ts`
- `agent-gateway/src/providers/providers.test.ts`

必须覆盖：

1. provider 输出 `done: "true"` 时，normalize 行为符合约束；允许转换则稳定转换，不允许则 turn 明确失败。
2. 输出缺 `action.type` 时，不执行任何动作，并把失败绑定到正确 turn。
3. `agent.create` 缺权限字段时拒绝创建，不能落空权限 agent。
4. 一条消息后立即再发第二条消息时，第一条 turn 的回复仍能挂回第一条请求。
5. 建造、创建下级 agent、研究三类核心 case 都能稳定回写 turn 结果。

### 7.3 浏览器实机验证

按 AGENTS 要求，`client-web` 不能只跑单测，必须进浏览器验证。

默认新局必须纯 Web 跑通：

1. 建 `wind_turbine`
2. 建 `matrix_lab`
3. 向研究站转入 `electromagnetic_matrix`
4. 启动并完成 `electromagnetism`

midgame 必须纯 Web 跑通至少一条戴森链：

1. `switch_active_planet`
2. `transfer_item`
3. `build_dyson_node`
4. `launch_solar_sail`
5. `launch_rocket`
6. `set_ray_receiver_mode`

`/agents` 必须实机验证：

1. 创建带限制权限的下级 agent
2. 执行一次建造请求
3. 执行一次研究请求
4. 快速连续发送两条请求，确认不会串线

## 8. 文档同步要求

实施完成后必须同步更新：

- `docs/dev/client-web.md`
- `docs/dev/agent-gateway.md`
- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/player/已知问题与回归.md`

同步重点：

1. Web 已具备哪些直达命令与 active planet 上下文说明。
2. 默认新局纯 Web 起步链是否已闭环。
3. midgame 戴森主链在 Web 中如何操作。
4. `/agents` 工作台现在如何展示 turn 生命周期。
5. provider action canonical schema 的约束。

## 9. 验收标准

1. 在默认新局中，玩家只使用 `client-web` 就能完成最小科研起步链，不需要切 CLI。
2. 在 midgame 中，玩家只使用 `client-web` 就能完成至少一条真实戴森主链。
3. 命令提交后，主反馈位会先显示 `pending`，随后被 authoritative 结果覆盖为最终成功或失败；不能长期停留在 `accepted`。
4. 行星页首屏附近就能进行主玩法操作，且默认活动流不会被背景噪声淹没。
5. `/agents` 中每条玩家消息都能看到对应 turn 生命周期；回复、失败、动作摘要都严格挂回原请求。
6. 创建下级 agent 时，若权限要求不完整则明确失败；若声称创建成功，实际落库 policy 必须与请求一致。
7. 不再出现 `action.type is required`、`done must be a boolean` 这类未绑定 turn 的裸 schema 错误。

## 10. 不在本次范围内

1. 不修改 `server` 游戏规则、Tick 语义和现有公开游戏命令含义。
2. 不引入面向 Web 的游戏后门命令或第二套 authoritative 业务接口。
3. 不做“所有命令自动生成任意表单”的过度抽象。
4. 不继续保留“assistant 规划文本天然等于最终回复”的旧语义。

## 11. 最终结论

T106-T109 不能继续按孤立页面问题处理。最终方案必须一次性完成三件事：

1. 用共享公开命令目录统一 Web/CLI/文档的能力真相。
2. 用 `request_id` 驱动的命令结果账本重建 Web 主玩法反馈链。
3. 用 `ConversationTurn + canonical action normalize + replyToMessageId/turnId` 重建 `/agents` 的异步执行语义。

只有这样，`client-web` 才能从“能看一点、能点一点的调试页”升级成真正的主玩法入口，`agent-gateway` 也才能从“能收消息但链路不稳定”升级成可追踪、可验证、可维护的协作运行时。
