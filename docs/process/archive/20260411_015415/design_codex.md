# 2026-04-10 `docs/process/task` 未实现功能设计方案（T106-T109）

> 本文覆盖以下 4 个未完成任务：
>
> - `docs/process/task/T106_Web行星命令面板未覆盖戴森球中后期与跨星球玩法.md`
> - `docs/process/task/T107_默认新局纯Web起步链与研究反馈闭环缺失.md`
> - `docs/process/task/T108_Web行星页信息架构与反馈设计不利于游玩.md`
> - `docs/process/task/T109_Web智能体工作台消息动作回写链路不一致.md`
>
> 目标不是再补一轮零散表单，而是把 `client-web` 和 `agent-gateway` 的异步交互链路收口成可持续扩展的稳定结构。

## 1. 目标与边界

这 4 个任务表面上分成“行星页命令缺口”“开局科研闭环缺失”“事件时间线噪声过大”“智能体工作台回复串线”，但根因其实只有两类：

1. `client-web` 没有统一的公开命令目录，也没有 authoritative 结果回写主操作流的机制。
2. `agent-gateway` 没有把“玩家请求 -> 模型动作 -> 执行状态 -> 最终回写”建模成带请求关联 ID 的生命周期对象。

本次设计的最终目标：

1. Web 行星页变成真正可玩的主工作台，而不是“地图 + 调试面板 + 一个零散命令 tab”。
2. `transfer / switch_active_planet / build_dyson_* / launch_* / set_ray_receiver_mode` 全部在 Web 内有稳定入口。
3. 所有 `/commands` 异步命令都必须有 `pending -> authoritative success/fail` 的主反馈链。
4. 默认新局的最小科研起步链必须能纯 Web 走通。
5. `/agents` 中每条玩家消息都必须对应一条可追踪的执行生命周期，不再靠“平铺消息列表 + system error”猜测发生了什么。

本次不做的事：

1. 不改 `server` 游戏规则和 Tick 语义。
2. 不为 Web 引入新的专用后门命令；仍然以现有公开 API 为 authoritative。
3. 不做“所有命令自动生成任意表单”的过度抽象；要做的是共享命令目录 + typed form 组件。

## 2. 当前代码事实

### 2.1 行星页当前把高频操作藏在右侧 tab 里

`client-web/src/pages/PlanetPage.tsx` 当前行为：

- 右侧面板只有 `详情 / 命令` 二选一 tab。
- 默认进入 `entity`，切星球后也会重置回 `entity`。
- 玩家要先找到并切到“命令”，才能开始主玩法操作。

这直接触发 T108 的“主玩法入口藏得太深”。

### 2.2 命令面板当前只覆盖少量硬编码表单

`client-web/src/features/planet-map/PlanetCommandPanel.tsx` 当前只暴露：

- 扫描
- 建造
- 移动
- 物流站配置
- 物流槽位配置
- 开始研究
- 拆除

而 `shared-client/src/api.ts` 实际已经提供：

- `cmdTransferItem`
- `cmdSwitchActivePlanet`
- `cmdSetRayReceiverMode`
- `cmdLaunchSolarSail`
- `cmdLaunchRocket`
- `cmdBuildDysonNode`
- `cmdBuildDysonFrame`
- `cmdBuildDysonShell`

这说明 T106/T107 不是服务端没实现，而是 `client-web` 没把现有公开命令纳入玩家工作流。

### 2.3 Web 当前把 `/commands` 的同步受理结果误当成最终反馈

`PlanetCommandPanel.tsx` 的 `runCommand()` 当前只读取：

- `response.accepted`
- `response.results[*].message`

然后把它写到局部状态 `resultMessage`。

问题在于：

- `shared-client` 已经为每次请求生成 `request_id`
- `server/internal/gamecore/core.go` 会在后续 Tick 发出带 `request_id` 的 `command_result` 事件
- 但前端完全没有把这两者关联起来

于是当前主反馈只能显示“accepted / queued”，而 authoritative 失败只会晚些出现在事件流里。这正是 T107 的“研究命令假成功”和 T108 的“结果与局势信息不成链”。

### 2.4 事件时间线当前是“全量展示 + 手工筛选”

`PlanetPage.tsx` 和 `use-planet-realtime.ts` 当前直接订阅 `ALL_EVENT_TYPES`。

`PlanetActivityPanel` 当前行为：

- 默认 `eventFilter = all`
- 直接把 `recentEvents` 平铺展示
- 不区分高价值与低价值事件

虽然 `shared-client/src/config.ts` 已经定义了：

- `DEFAULT_EVENT_TYPES`
- `DEFAULT_SSE_SILENT_EVENT_TYPES`

但行星页没有把这套优先级真正用到默认视图上，所以 `tick_completed`、`resource_changed` 会长期淹没 `command_result`、`entity_created`、`building_state_changed`。

### 2.5 active planet 当前只是被动展示，不是可操作上下文

当前 active planet 的显示散落在：

- `client-web/src/widgets/TopNav.tsx`
- `PlanetEntityPanel` 的“玩家摘要”

但这些都只是只读文本：

- 没有切换入口
- 没有明确标出“当前路由行星”和“当前 active planet”是否一致
- 命令表单也不会在提交前提示该命令是否依赖 active planet

这正是 T106 的跨星球上下文割裂。

### 2.6 `/agents` 当前只有消息列表，没有“请求生命周期”

`client-web/src/pages/AgentsPage.tsx` 和 `ChannelWorkspaceView.tsx` 当前模型非常薄：

- 拉取 `conversations`
- 拉取 `messages`
- SSE 到来时只做 `invalidateQueries`
- 页面只渲染平铺消息流

问题是：

1. 玩家消息发送后，前端只知道“接口 202 accepted”，并不知道这条消息对应哪个 agent run。
2. 智能体回复、system failure、后续迟到结果都只是普通 message。
3. 没有 `replyToMessageId`、`turnId`、`status` 这类请求关联信息。

补充一点当前事实：

- `agent-gateway` 的 `POST /conversations/:id/messages` 实际已经返回 `{ accepted, message }`
- 但 `client-web/src/features/agents/api.ts` 当前只把它声明成 `{ accepted: boolean }`
- 也就是说，前端连“刚刚自己发出的那条 message authoritative 记录”都主动丢掉了

因此只要 agent 处理稍慢，上一条任务的回复就会自然插到下一条玩家消息后面，形成 T109 的“回复和请求错位”。

### 2.7 `agent-gateway` 当前先写 assistant 文本，再执行动作

`agent-gateway/src/server.ts` 当前在会话模式下：

- `runAgentLoop()` 一拿到 provider turn，就先通过 `onAssistantMessage` 把 `assistantMessage` 追加到会话
- 然后才依次执行 `game.cli / agent.create / agent.update / conversation.send_message`
- 若后续动作失败，再追加一条 system failure

这会产生两个明显问题：

1. 会话里先出现“我会创建胡景并给他建筑权限”这种规划文本，但实际动作可能失败或只部分成功。
2. 这段 assistant 文本没有绑定到具体玩家请求，只是按到达时间插入会话。

所以当前链路天然容易出现“先报错、后部分执行”“上一条的迟到回复插到下一条后面”。

### 2.8 provider 输出校验当前只有“解析失败就整体报错”

`agent-gateway/src/providers/index.ts` 当前会直接报：

- `done must be a boolean`

`agent-gateway/src/runtime/action-schema.ts` / `runAgentLoop()` 当前会直接报：

- `action.type is required`

当前缺的是“规范化层”：

- 没有在进入执行层前把 provider 的多种可能输出形态归一化成 canonical action
- 也没有把结构化校验失败转成某个 turn 的明确失败结果
- 更没有把失败绑定到发起这条请求的玩家消息

这里的结论是推断，但推断依据明确：代码里现在只有“parse -> assert -> throw”，没有 normalize，也没有 per-request 状态对象。

## 3. 方案比选

### 方案 A：继续逐个页面打补丁

做法：

- 在 `PlanetCommandPanel` 里继续加表单
- 在 `PlanetActivityPanel` 里继续加几个过滤按钮
- 在 `/agents` 里继续靠 message 文本和 system error 补提示

优点：

- 开发快
- 对现有代码改动看起来最小

缺点：

- T106/T107/T108 的共同根因不会消失，后面新增公开命令还会继续漏
- T109 的“回复串线”不会因提示优化而消失
- 页面会越来越像补丁堆，继续扩大耦合

结论：不采用。

### 方案 B：共享命令目录 + Web 命令结果账本 + agent turn 生命周期

做法：

- 把公开命令目录提升为共享结构
- Web 侧新增命令中心与 authoritative 结果账本
- agent-gateway 新增 canonical action 规范化和 `ConversationTurn`

优点：

- 一次解决 4 个任务的根因
- 后续新增公开命令和新增 agent action 都有稳定落点
- 前端反馈链从“猜测”变成“带 request/turn ID 的状态机”

缺点：

- 改动面比补丁式方案大
- 需要同时调整 `shared-client / client-web / agent-gateway`

结论：采用。这是唯一能避免反复回归的方案。

### 方案 C：给 Web 和 Agent 单独新增服务端专用聚合接口

做法：

- 再加若干 `/web/*` 或 `/agent-ui/*` 专用接口，把 UI 所需反馈预先拼好

优点：

- 前端实现会变简单

缺点：

- authoritative 逻辑被拆成两套
- UI 需求会反向污染服务端和网关职责
- 与“server 已实现，问题在玩家入口”这一前提相违背

结论：不采用。除非现有公开接口明确缺字段，否则优先在 `shared-client / client-web / agent-gateway` 内收口。

## 4. 推荐设计总览

### 4.1 对应关系

| 任务 | 根因 | 设计抓手 |
| --- | --- | --- |
| T106 | Web 无统一命令目录，跨星球上下文不显式 | 共享命令目录 + 行星工作台重构 + active planet 切换器 |
| T107 | `/commands` authoritative 结果未回写主反馈 | 命令结果账本 + request_id 关联 + 失败提示 |
| T108 | 信息架构偏调试视角，事件流无优先级 | 命令优先布局 + 高信号活动流 + 同屏结果摘要 |
| T109 | 会话无 turn 生命周期，动作协议无规范化 | canonical action 规范化 + `ConversationTurn` + reply 关联 |

### 4.2 统一原则

本次设计统一遵守四条原则：

1. 每个玩家动作都必须有稳定 ID。
2. 同步“accepted”只能算中间态，不能算最终结果。
3. UI 读取的是 authoritative 结果对象，不是“猜测哪条文本像结果”。
4. 新增能力时优先补共享目录和状态模型，不再直接往页面里塞散装逻辑。

## 5. 详细设计

### 5.1 建立共享公开命令目录

推荐新建共享目录文件，例如：

- `shared-client/src/command-catalog.ts`

目录职责：

1. 维护公开命令的 canonical 列表。
2. 声明命令所属类别、作用域、是否依赖 active planet、Web 是否必须覆盖。
3. 为 CLI、Web、文档同步提供同一份真相。

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

落地原则：

1. `client-cli/src/command-catalog.ts` 不再维护另一份同义目录，改成从共享目录派生 agent category。
   - 例如 HTTP/API 命令 `transfer_item` 对应 CLI 命令 `transfer`
   - 共享目录里显式保留这类 alias，避免以后再出现“同一能力三套名字”的漂移
2. `client-web` 的命令面板不再靠“写了哪个按钮就算支持哪个命令”，而是通过目录声明和 typed renderer 显式映射。
3. 加一条覆盖测试：凡是 `webSurface = required` 的命令，Web 若没有 renderer，测试必须失败。

这条设计直接满足 T106 第 4 条“不能再手工零散补洞”。

### 5.2 把行星页从“详情/命令二选一”改成“工作台”

推荐把右侧面板重构成 `PlanetWorkbench`，而不是继续保留“详情 vs 命令”的互斥关系。

建议桌面布局：

1. 顶部：`PlanetOperationHeader`
2. 中部：`PlanetCommandCenter`
3. 下部：`PlanetSelectionSummary`
4. 底部：`PlanetActivityFeed`

其中：

- `PlanetOperationHeader` 固定显示当前路由行星、当前 active planet、最近命令结果、待处理命令数
- `PlanetCommandCenter` 放高频命令卡片
- `PlanetSelectionSummary` 放当前选中实体摘要，而不是占据整个面板
- `PlanetActivityFeed` 默认只看高信号事件

移动端可以继续使用折叠区或 tab，但规则要改成：

1. 默认优先进入“操作”
2. 记住用户上次打开的子面板
3. 最新 authoritative 结果始终固定在首屏顶部，不随面板切换消失

换句话说，真正需要去掉的是“命令入口必须先切 tab”这个前提，不一定是视觉上彻底移除所有 tab。

### 5.3 Web 命令中心采用“typed form 组件 + 共享目录”，不做裸 JSON 表单

命令中心建议按玩家心智而不是按 API 名字分组：

1. 基础操作：扫描、建造、拆除、移动
2. 研究与装料：`transfer_item`、`start_research`
3. 物流：站点配置、槽位配置
4. 跨星球：`switch_active_planet`
5. 戴森：`build_dyson_node/frame/shell`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode`

每个命令继续使用 typed form 组件，而不是通用 JSON schema 渲染器。原因：

1. 任务明确要求不能只暴露裸字段输入框。
2. Web 需要基于 `catalog / runtime / selected entity / summary` 提供候选项和预填值。
3. 戴森与研究命令都需要上下文感知 UI，通用字段渲染器做不出足够可玩性。

推荐拆分目录：

- `client-web/src/features/planet-commands/command-catalog.ts`
- `client-web/src/features/planet-commands/use-command-center.ts`
- `client-web/src/features/planet-commands/forms/TransferItemCard.tsx`
- `client-web/src/features/planet-commands/forms/SwitchActivePlanetCard.tsx`
- `client-web/src/features/planet-commands/forms/DysonLaunchCard.tsx`
- `client-web/src/features/planet-commands/forms/DysonBuildCard.tsx`
- `client-web/src/features/planet-commands/forms/RayReceiverModeCard.tsx`

`PlanetCommandPanel.tsx` 建议被拆掉，保留壳层，不再继续增长为单文件巨石。

### 5.4 为 `/commands` 增加前端“命令结果账本”

这是 T107/T108 的核心。

建议在 `client-web` 新增状态结构：

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

数据流改造：

1. Web 提交命令后，不能只写一条 `resultMessage` 字符串。
2. 必须把 `CommandResponse.request_id`、`enqueue_tick`、命令类型、聚焦对象写入 journal。
3. journal 先进入 `pending`。
4. `usePlanetRealtimeSync()` 在收到 `command_result` 事件时，按 `payload.request_id` 回填对应 entry。
5. 一旦收到 authoritative 结果，主反馈区立即从 `pending` 切到 `succeeded/failed`。

这样“accepted”就只会显示成中间态，不会再冒充最终成功。

### 5.5 在同屏内形成“命令结果 -> 原因 -> 局势变化”的闭环

主反馈区推荐固定成三段：

1. `最终结果`
2. `原因 / 阻塞`
3. `局势变化`

其中：

- 最终结果来自 `command_result`
- 原因来自 `command_result.code/message` 和本地 hint resolver
- 局势变化来自“与该命令相关的高信号事件 + 最新 runtime/summary 快照”

相关事件匹配规则建议分三层：

1. 先用 `request_id` 直连 `command_result`
2. 再按 `focus` 关联 `entity_created / building_state_changed / research_completed / rocket_launched`
3. 若仍找不到，显示“命令已完成，等待场景刷新”而不是沉默

这里不建议做整页 diff 引擎。当前任务需要的是“可理解的 authoritative 闭环”，不是构建通用状态对比系统。

### 5.6 新增 starter research 与装料专用体验

`transfer_item` 一旦补上，T107 的最小闭环基本就有了，但为了真实游玩体验，建议再补一层针对研究链的轻引导。

推荐行为：

1. 若当前选中建筑是空配方 `matrix_lab`，命令中心优先显示“研究站装料”卡片。
2. 若当前研究阻塞原因为 `waiting_matrix` 或 `command_result` 提示缺矩阵：
   - 自动列出可用研究站
   - 默认物品预选为缺失矩阵
   - 默认数量预填推荐值，例如 `10`
3. 装料成功后，主反馈区直接提供“继续开始研究”按钮或预填表单

这不是额外特例接口，而是基于通用 `transfer_item` 的上下文增强。

同样的通用交互还可以复用到 midgame：

- 给 `vertical_launching_silo` 装 `small_carrier_rocket`
- 给 `em_rail_ejector` 装 `solar_sail`

所以推荐把这类 UI 命名为“建筑装料”，而不是只写成“研究站装料”。

### 5.7 active planet 上下文必须前置成一个显式操作条

推荐在行星页首屏增加 `ActivePlanetSwitcher`：

- 当前路由行星：你正在看的星球
- 当前 active planet：命令默认落点
- 若两者不同，显示醒目提示
- 提供 `switch_active_planet` 下拉切换入口

可选项来源推荐顺序：

1. 已发现星球列表
2. 当前星系已发现行星
3. 无法稳定枚举时允许手动输入 planet id

关键不是“必须做到完美只列可切换项”，而是：

1. 玩家能在 Web 内提交切换命令
2. 提交前知道自己当前在哪、命令会落到哪
3. 切换结果会 authoritative 回写

此外，所有依赖 active planet 的命令卡片应统一显示提示：

- `本命令使用当前 active planet 作为执行上下文`
- 若路由行星与 active planet 不一致，则提醒“你当前正在观察 A，但命令会提交到 B”

### 5.8 戴森中后期命令需要专用表单，而不是继续堆 ID 输入框

针对 T106，推荐新增 4 类专用卡片：

1. `TransferItemCard`
2. `SwitchActivePlanetCard`
3. `DysonBuildCard`
4. `DysonLaunchCard`

关键交互：

- `build_dyson_node`：
  - 选择目标星系
  - 选择 `layer_index`
  - 输入或可视化选择 `latitude / longitude`
- `build_dyson_frame`：
  - 先选 layer
  - 再从该层已有 node 列表中选 `node_a / node_b`
- `build_dyson_shell`：
  - 先选 layer
  - 再输入覆盖参数
- `launch_solar_sail` / `launch_rocket`：
  - 从当前可用的发射建筑列表中选目标建筑
  - 提示当前装料情况
  - 可选数量默认预填
- `set_ray_receiver_mode`：
  - 从 `ray_receiver` 列表里选建筑
  - 模式改为中文可读选项 `power / photon / hybrid`

这组表单不要求上来就做复杂可视化编辑器，但必须满足：

1. 玩家能明确知道自己在对哪座建筑/哪层结构操作
2. 表单默认值尽量从当前 scene/runtime 推导
3. 成功失败回写到统一的命令结果账本

### 5.9 事件流改成“高信号默认可见，低信号折叠”

推荐把事件分成三档：

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
3. P2 噪声/背景事件
   - `tick_completed`
   - `resource_changed`
   - 其他高频背景更新

默认视图规则：

1. 首先展示 `最近命令结果`
2. 活动流默认只展示 P0 + P1
3. P2 聚合成“已折叠 17 条背景事件”，按需展开

前端实现上，不建议继续只靠 `eventFilter` 一个 select。推荐拆成：

- `关键反馈`
- `全部事件`
- `仅命令`
- `仅告警`

`shared-client/src/config.ts` 里已有 `DEFAULT_SSE_SILENT_EVENT_TYPES`，这次设计建议把它真正用作默认活动流的折叠依据，而不是只保留常量不落地。

### 5.10 `agent-gateway` 需要 canonical action 规范化层

针对 T109，推荐在 provider 输出与执行层之间新增明确的规范化步骤：

- `raw provider output`
- `parse`
- `normalize`
- `validate canonical action`
- `execute`

建议新增类型：

```ts
export interface CanonicalAgentTurn {
  assistantMessage: string;
  actions: CanonicalAgentAction[];
  done: boolean;
}

export type CanonicalAgentAction =
  | { type: "game.cli"; commandLine: string }
  | { type: "agent.create"; name: string; role?: string; policy?: Partial<AgentPolicy>; providerId?: string }
  | { type: "agent.update"; agentId: string; policy?: Partial<AgentPolicy>; role?: string; goal?: string }
  | { type: "conversation.ensure_dm"; targetAgentId: string }
  | { type: "conversation.send_message"; conversationId?: string; targetAgentId?: string; content: string }
  | { type: "final_answer"; message: string }
  | { type: "memory.note"; note: string };
```

规范化层职责：

1. 兼容有限范围内的 provider 方言，例如：
   - `structured_output`
   - `action.args`
   - `done: "true"` 这类可无歧义转布尔的形态
2. 只要映射存在歧义，就拒绝执行并生成结构化失败结果
3. 执行层以后只接受 canonical action

这里要强调一个边界：

- 不从 assistant 自然语言里“猜”缺失的 policy、planetIds、commandCategories
- 能结构化映射就映射
- 不能映射就明确失败

这样可以直接杜绝“前端报错但后端偷偷部分执行”。

### 5.11 `agent.create` 必须以“结构化语义完整”作为执行前置

当前 `createManagedAgent()` 能创建 agent，但如果 provider 只给了 `name`、没给完整 policy，就会落成默认空权限。

对 T109 来说，这是不可接受的。

推荐规则：

1. 当请求意图是“创建带权限的下级 agent”时，`agent.create` 必须显式给出：
   - `policy.planetIds`
   - `policy.commandCategories`
2. 若缺任一关键字段：
   - 不执行创建
   - turn 标记为 `failed`
   - failure reason 明确写“missing policy.planetIds”或“missing policy.commandCategories”

这比“先创建一个空权限 agent 再说”更符合项目的激进式演进原则。

### 5.12 引入 `ConversationTurn`，把会话消息和执行生命周期解耦

这是 T109 的主设计。

建议新增存储对象：

```ts
export interface ConversationTurn {
  id: string;
  conversationId: string;
  requestMessageId: string;
  actorType: "player" | "schedule";
  actorId: string;
  targetAgentId: string;
  status: "accepted" | "queued" | "planning" | "executing" | "succeeded" | "failed";
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

关键点：

1. 玩家每发一条消息，不再只是“追加 message”。
2. 若该消息会唤醒某个 agent，就要同时创建一个 `ConversationTurn`。
3. mailbox 不再只消费“message”，而是消费“turn”。
4. turn 拥有自己的状态推进和失败原因。

这样就能稳定表达：

- 这条玩家消息有没有被接收
- 当前在排队、规划还是执行
- 失败是 schema 问题、权限问题还是游戏命令失败
- 回复究竟属于哪条请求

### 5.13 会话消息需要增加 `replyToMessageId` / `turnId`

当前 `ConversationMessage` 是无引用的平铺消息。

推荐扩展为：

```ts
export interface ConversationMessage {
  ...
  replyToMessageId?: string;
  turnId?: string;
}
```

使用规则：

1. agent 回复消息必须带 `replyToMessageId = 发起请求的玩家消息 ID`
2. system failure 也必须带同一个 `replyToMessageId`
3. 若消息属于某次 turn 的阶段性结果，同时带 `turnId`

这样即便物理排序仍按时间递增，前端也可以按“玩家消息卡片 -> 回复/状态”分组渲染，不再被迟到回复打乱语义。

### 5.14 会话 SSE 不能只推 message，还要推 turn status

当前 `/conversations/:id/events` 主要只发 `message`。

推荐新增：

- `turn.updated`
- `turn.completed`
- `turn.failed`

前端策略从“收到任意事件就整段 refetch”调整为：

1. `message` 事件增量写入 query cache
2. `turn.*` 事件增量写入 turn cache
3. 只有在重连或怀疑漏事件时再做全量 refetch

这会比当前 `invalidateQueries` 的粗暴刷新更稳，也能让 UI 真正显示“已接收 / 规划中 / 执行中 / 成功 / 失败”。

### 5.15 `/agents` UI 改成“请求卡片 + 回复分组”而不是纯聊天记录

`ChannelWorkspaceView.tsx` 推荐改成两层：

1. 时间顺序的“请求卡片”
2. 每张卡片内的“turn 状态 + 回复 + system failure + 动作摘要”

展示规则：

1. 玩家消息是主卡片标题
2. 每个被唤醒的 agent 都有自己的子状态条
3. agent 回复、system failure、动作结果都挂到对应子状态下

对于 DM：

- 一条玩家消息通常只对应一个 target agent turn

对于频道：

- 一条带多个 `@` 的消息可以展开成多个 agent turn

这样就算某个 turn 很晚才完成，也只会回到它自己的请求卡片内，不会污染下一条玩家消息。

### 5.16 assistant 文本不能再在动作执行前直接当最终回复落会话

当前 `assistantMessage` 更像“规划文本”，不一定等价于最终回复。

推荐调整规则：

1. `assistantMessage` 先写入 `ConversationTurn` 的 planning/executing 状态说明，不直接作为最终聊天消息。
2. 只有满足以下条件之一时，才落正式 agent message：
   - provider 明确给出 `final_answer`
   - 或 turn 成功结束且 `assistantMessage` 被明确标记可见
3. 若 turn 失败，则前端显示：
   - 规划说明（可选）
   - 失败原因
   - 未执行完成的动作摘要

这样可以消除“会话里先出现一句承诺，随后又失败”的错觉。

### 5.17 provider prompt 和 schema 文件也要同步升级

`agent-gateway/src/runtime/turn.ts` 与 `runtime/action-schema.ts` 需要同步更新：

1. schema 直接描述 canonical action 字段
2. prompt 给出至少 3 组高频例子：
   - 建造
   - 研究
   - 创建下级 agent 并附权限
3. 明确禁止：
   - 只在 assistant 文本里说权限，action 里不写
   - 把 `done` 写成字符串
   - 把真正参数塞进无法识别的嵌套对象

这一步不是为了“教模型更聪明”，而是为了让 canonical 输出形式变成单一路径。

## 6. 文件级改动建议

### 6.1 `shared-client`

建议新增或重构：

- `shared-client/src/command-catalog.ts`
- `shared-client/src/api.ts`
- `shared-client/src/types.ts`

职责：

- 共享公开命令目录
- 补齐命令定义的元信息
- 必要时扩展 `CommandResponse`、会话 turn 相关类型

### 6.2 `client-web` 行星页

建议重点修改：

- `client-web/src/pages/PlanetPage.tsx`
- `client-web/src/features/planet-map/use-planet-realtime.ts`
- `client-web/src/features/planet-map/store.ts`
- `client-web/src/features/planet-map/model.ts`
- `client-web/src/features/planet-map/PlanetPanels.tsx`
- `client-web/src/features/planet-map/PlanetCommandPanel.tsx` 或拆分后新目录
- `client-web/src/i18n/translation-config.ts`

建议新增：

- `client-web/src/features/planet-commands/*`
- `client-web/src/features/planet-commands/forms/*`

### 6.3 `agent-gateway`

建议重点修改：

- `agent-gateway/src/types.ts`
- `agent-gateway/src/providers/index.ts`
- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/runtime/turn.ts`
- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/runtime/router.ts`
- `agent-gateway/src/routes/conversations.ts`
- `agent-gateway/src/server.ts`

建议新增：

- `agent-gateway/src/store/turn-store.ts`

### 6.4 `client-web` 智能体工作台

建议重点修改：

- `client-web/src/features/agents/types.ts`
- `client-web/src/features/agents/api.ts`
- `client-web/src/features/agents/use-agent-events.ts`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`
- `client-web/src/pages/AgentsPage.tsx`

## 7. 测试设计

### 7.1 `client-web` 行星页测试

必须新增或扩展以下覆盖：

1. 提交 `start_research` 后：
   - 先显示 `pending`
   - 收到匹配 `request_id` 的 `command_result` 后切成 `failed`
   - 主反馈展示 `missing electromagnetic_matrix in research labs`
2. `transfer_item` 表单可对研究站装料
3. `switch_active_planet` 能显示当前 active planet 变更
4. `launch_solar_sail / launch_rocket / build_dyson_node` 至少有一条 happy path 提交测试
5. 默认活动流不展示 `tick_completed / resource_changed`，但可展开查看

### 7.2 浏览器实机回归

按照 AGENTS 要求，`client-web` 不能只跑单测，必须进浏览器看：

1. 默认新局纯 Web 跑通：
   - `wind_turbine`
   - `matrix_lab`
   - `transfer electromagnetic_matrix`
   - `start_research electromagnetism`
2. midgame 纯 Web 跑通至少一条戴森链：
   - `switch_active_planet`
   - `transfer`
   - `build_dyson_node`
   - `launch_solar_sail`
   - `launch_rocket`
   - `set_ray_receiver_mode`
3. 行星页首屏就能看到可操作入口和最近 authoritative 结果

### 7.3 `agent-gateway` 单测 / 集成测试

建议补以下回归：

1. provider 输出 `done: "true"` 时，规范化层若允许转换则正确转换；若不允许则 turn 明确失败
2. provider 输出缺 `action.type` 时，不执行任何动作，并把失败绑定到对应 turn
3. `agent.create` 若缺权限字段，不能创建空权限 agent
4. 一条玩家消息后立即再发第二条消息时：
   - 第一条 turn 的回复仍能挂回第一条请求
   - 不会插到第二条请求卡片下
5. 建造、创建下级 agent、研究 3 类 case 都能稳定回写 turn 结果

### 7.4 `/agents` 前端测试

建议补以下覆盖：

1. 发送消息后先出现 `queued/planning` 状态
2. 收到 `turn.failed` 时，请求卡片展示失败原因而不是仅出现一条孤立 system message
3. 迟到回复会显示在原请求下，不会污染最新请求

## 8. 文档同步要求

实施时需要同步更新：

- `docs/dev/client-web.md`
- `docs/dev/agent-gateway.md`
- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/player/已知问题与回归.md`

同步重点：

1. 行星页已经具备哪些 Web 直达命令
2. 默认新局纯 Web 起步链是否已闭环
3. `/agents` 会话现在如何显示 turn 生命周期
4. provider action canonical schema 的要求

## 9. 建议实施顺序

为了降低耦合，建议拆成 3 段：

### 阶段 1：先打通 Web 命令反馈底座

目标：

- 共享命令目录
- 命令结果账本
- active planet 显式上下文
- `transfer_item` + `switch_active_planet`

完成后可直接解决 T107 的闭环问题，并为 T106/T108 铺底。

### 阶段 2：补齐戴森与信息架构

目标：

- 戴森相关 typed form
- 行星页工作台重构
- 高信号活动流

完成后解决 T106/T108。

### 阶段 3：重构 agent turn 生命周期

目标：

- canonical action normalize
- `ConversationTurn`
- `/agents` 请求卡片式 UI

完成后解决 T109。

## 10. 最终结论

这 4 个任务不适合继续按页面零散补洞。推荐方案是：

1. 用共享公开命令目录统一 `client-cli / shared-client / client-web` 的公开能力定义。
2. 用前端命令结果账本把 `/commands` 的同步受理与 authoritative `command_result` 事件重新接起来。
3. 用 `ConversationTurn + replyToMessageId + canonical action normalize` 重建 `/agents` 的异步执行语义。

这样改完后，Web 才能真正从“能看一点、能点一点的调试面板”升级成主玩法入口；`agent-gateway` 也才能从“能收消息但不保证链路一致”升级成可靠的智能体协作运行时。
