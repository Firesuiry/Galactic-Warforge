# T106 Web 与智能体剩余缺口收敛设计方案

## 1. 背景与目标

`docs/process/task` 当前只有一个待处理任务：`T106_Web深度试玩后Web与智能体剩余缺口收敛.md`。  
本轮设计不再讨论“从零补齐全部 DSP 内容”，而是只处理已经定位清楚、且直接影响 Web 可玩性与智能体可用性的 5 个缺口：

1. 登录页把“Web 入口地址”和“游戏服务端地址”混成一个输入，导致玩家直接撞上 CORS。
2. 行星页命令账本无法把 `start_research` 从 `queued` 收口到异步成功终态。
3. 智能体复杂任务在 provider/runtime 归一化阶段失败时，根因被吞掉，只剩泛化报错。
4. 智能体 turn 即使 `succeeded`，也可能没有正式回复消息落到会话流。
5. Web 新建 Provider 时，命令能力配置被写死，成员权限与 Provider 能力也没有一致性校验。

本设计的目标不是“多补几个 if”，而是把这 5 个问题收束成 4 条稳定约束：

- 浏览器只配置“可访问的 Web 入口”，不要求玩家理解代理细节。
- 命令反馈必须区分“已受理”“异步处理中”“已完成/已失败”。
- 智能体 turn 的成功必须满足严格完成不变式，不能再出现伪成功。
- Provider 能力、成员权限、CLI 可执行命令必须来自同一份事实源并在运行时取交集。

## 2. 非目标

- 不重做 `server/` authoritative runtime。
- 不重新定义整套智能体协作模型。
- 不把成员权限系统扩展成语义级全权限系统。
- 不在本轮额外补充与 T106 无关的建筑、科技树或战斗玩法。

## 3. 设计原则

### 3.1 Single Source Of Truth

- 浏览器命令能力、Provider 命令能力、agent CLI 允许命令，必须共享同一份命令定义。
- turn 完成态只能由明确终态驱动，不能靠 UI 猜测。

### 3.2 Success Means Terminal State

- `accepted` 不是成功。
- `queued` 不是成功。
- `assistantPreview` 不是正式回复。

### 3.3 直接重构，不做兼容层

- `toolPolicy.commandWhitelist` 语义已经错误，本轮直接替换，不保留旧字段的长期兼容逻辑。
- turn 成功条件也直接收紧，不继续兼容“成功但没 final message”的旧行为。

### 3.4 用户可见错误必须可行动

- Web 不再显示单纯的 `Failed to fetch` 或 `执行失败，请稍后重试`。
- 对玩家可见的错误文案必须至少回答两件事：哪里失败、下一步该改什么。

## 4. 总体架构调整

本轮不拆成 5 套独立修补，而是统一收敛成 4 个模块改造：

| 模块 | 负责问题 | 核心动作 |
| --- | --- | --- |
| Web 入口语义层 | 1 | 把在线登录的配置语义固定为“Web 入口地址” |
| 命令收口引擎 | 2 | 为异步完成类命令建立统一结算规则 |
| Agent Turn 协议层 | 3, 4 | 强化 provider 归一化、错误分类、turn 完成不变式 |
| 命令能力模型 | 5，兼顾 3 | 用共享命令目录统一 Provider 与成员权限可见性 |

## 5. 详细方案

### 5.1 登录页改为“Web 入口优先”，隐藏真实 game server 细节

#### 5.1.1 现状问题

- `client-web` 当前把在线模式输入框命名为“服务地址”。
- 玩家会自然填入 `http://127.0.0.1:18081` 这类真实 game server 地址。
- 浏览器随即直连后端，触发 CORS，最终只看到 `Failed to fetch`。
- 当前正确做法实际上是填 Web 自己的地址，例如 `http://127.0.0.1:4173`，但这是前端实现细节，不该要求玩家理解。

#### 5.1.2 目标语义

在线模式下，玩家只配置一个地址：**Web 入口地址**。

- 默认值直接使用当前源站 `window.location.origin`。
- 表单文案明确说明“在线模式通过 Web 代理连接游戏服务端”。
- 不要求玩家手填 `18081/18082` 这类 game server 地址。
- 不在登录页暴露第二个“真实服务端地址”输入项，避免再次制造配置陷阱。

#### 5.1.3 交互设计

- 输入框标签从“服务地址”改为“Web 入口地址”。
- 输入框 placeholder 改为当前 Web 源站示例，而不是泛化的 server 地址。
- 在线模式补一段固定说明：
  - “请输入当前 Web 页面所在地址。在线模式会通过该入口代理访问游戏服务端，不要直接填写 18081/18082 游戏端口。”
- 错误分类逻辑新增 `classifyLoginConnectionError()`：
  - 若输入地址与当前源站不同，且浏览器报 `Failed to fetch` / network error，则提示：
    - 当前在线模式需要填写 Web 入口地址
    - 不要直接填写游戏服务端端口
    - 推荐值为当前源站
  - 若输入为空或 URL 非法，则提示地址格式问题
  - 若 `/health` 成功但 `/state/summary` 鉴权失败，则继续显示鉴权/业务错误，不混为 CORS

#### 5.1.4 数据边界

- `client-web` 会话层对用户语义统一使用“入口地址”。
- 底层 `shared-client` 仍可继续接收 `serverUrl/baseUrl` 作为 API 根路径，本轮不横向改所有共享 API 类型名。
- `agent-gateway` 创建成员时，继续复用当前会话中的可访问入口地址，不新增第二套“浏览器地址/网关地址”双配置模型。

#### 5.1.5 预期落点

- `client-web/src/pages/LoginPage.tsx`
- `client-web/src/stores/session.ts`
- `client-web/src/pages/LoginPage.test.tsx`

### 5.2 为异步完成类命令建立统一“收口规则表”

#### 5.2.1 现状问题

当前 `client-web/src/features/planet-commands/store.ts` 的 authoritative 收口只认两类来源：

- `/commands` 同步响应
- `command_result`

这会导致：

- `start_research` 在 authoritative 侧已经发出 `research_completed`
- 但 journal 仍停留在 `command_result -> queued`
- “最新反馈”和命令卡片都无法进入明确成功态

根因不是研究命令特殊，而是当前账本模型默认假设：`command_result` 一定是最终态。

#### 5.2.2 新模型

保留现有 `status: pending | succeeded | failed`，新增一层更细的收口阶段：

```ts
type CommandSettlementPhase =
  | "accepted"
  | "authoritative_pending"
  | "completed"
  | "failed";
```

`PlanetCommandJournalEntry` 新增字段：

```ts
interface PlanetCommandJournalEntry {
  phase: CommandSettlementPhase;
  settlementRuleId: string;
  terminalEventType?: string;
}
```

语义：

- `accepted`: 只收到同步受理回执
- `authoritative_pending`: authoritative 已确认命令开始，但仍在等待异步完成事件
- `completed`: 已收到终态成功
- `failed`: 已收到终态失败

#### 5.2.3 结算规则表

新增 `planet-commands/settlement-rules.ts`，定义统一规则：

```ts
interface CommandSettlementRule {
  id: string;
  commandType: string;
  recoveryEventTypes: string[];
  reconcileCommandResult: (...) => SettlementDecision;
  reconcileDomainEvent: (...) => SettlementDecision | null;
}
```

默认规则：

- 大多数命令仍由 `command_result` 直接收口

异步规则首个落地项：

- `start_research`
  - `command_result` 只要是 `OK + queued/accepted/running`，都进入 `authoritative_pending`
  - 真正成功以 `research_completed` 为准
  - 匹配条件优先用 `focus.techId`

后续可扩展但本轮不强制实现的异步规则：

- `launch_rocket -> rocket_launched`
- 某些分阶段建造命令 -> `entity_created` / 其他领域事件

#### 5.2.4 UI 表现

`PlanetOperationHeader` 和命令卡片统一改为读取“阶段感知”的显示文案：

- `accepted`: “研究已提交，等待 authoritative 回写”
- `authoritative_pending`: “电磁学研究已开始，等待完成”
- `completed`: “电磁学研究完成”
- `failed`: 继续显示 authoritative 失败文案

这意味着“最新反馈”不再只是 `authoritativeMessage ?? acceptedMessage` 的二选一，而是统一走 `describeJournalEntry(entry)`。

#### 5.2.5 snapshot 补账调整

当前恢复逻辑只拉 `command_result`，这对异步命令不够。

改造后：

- pending journal 会根据自身 `settlementRule` 汇总需要恢复的事件类型
- `start_research` 在补账时必须同时拉：
  - `command_result`
  - `research_completed`

这样 SSE 丢失或短暂断流时，研究完成仍能补账成功。

#### 5.2.6 预期落点

- `client-web/src/features/planet-commands/store.ts`
- `client-web/src/features/planet-commands/settlement-rules.ts`（新增）
- `client-web/src/features/planet-commands/PlanetOperationHeader.tsx`
- `client-web/src/features/planet-commands/executor.ts`
- 对应单测与行星页回归测试

### 5.3 强化 provider 输出归一化，优先修正常见 schema 漏洞

#### 5.3.1 现状问题

当前 agent-gateway 的处理链路大致是：

1. provider 返回结构化 JSON
2. `parseProviderResult()` 处理文本包裹和 envelope
3. `normalizeProviderTurn()` 做严格规范化
4. 失败后 `classifyPublicTurnError()` 决定前端文案

现状缺陷：

- `action.type is required` 这类错误没有被修复，也没有被正确分类
- Web 最终只拿到“执行失败，请稍后重试”
- 玩家无法判断是模型输出坏了、schema 不匹配，还是权限不足

#### 5.3.2 归一化策略

在 `normalizeProviderTurn()` 内引入“常见变体修复层”，优先修复高概率、低歧义的 provider 输出问题。

计划支持的自动补全规则：

1. 缺 `type` 但含 `commandLine` 或 `command`
   - 推断为 `game.cli`
2. 缺 `type` 但含 `content + targetAgentId/conversationId`
   - 推断为 `conversation.send_message`
3. 缺 `type` 但含 `name + policy`
   - 推断为 `agent.create`
4. 缺 `type` 但含 `agentId`
   - 推断为 `agent.update`
5. 缺 `type` 但含 `message`，且本轮 `done=true`
   - 推断为 `final_answer`
6. 继续支持已存在的 `args` 展开逻辑

推断失败时才真正抛出 schema 错误。

#### 5.3.3 一次性修复重试

为减少 provider 偶发格式抖动，可在 provider-turn runner 层统一加一次“修复重试”：

- 条件：canonical normalize 失败且错误属于 `provider_schema_invalid`
- 做法：向同一 provider 追加一段简短 repair prompt
  - 明确指出哪一个字段缺失或类型不对
  - 要求只返回修复后的完整 JSON
- 限制：每轮最多重试 1 次，避免 turn 死循环

这样 HTTP API provider、Codex CLI provider、Claude CLI provider 都能共享同一条修复机制，而不是只让某一个 provider 家族独自兜底。

#### 5.3.4 错误分类升级

`classifyPublicTurnError()` 改造成更细粒度分类，而不是把大多数问题都压到 `unknown`：

建议新增或细化以下公开错误码：

- `provider_schema_invalid`
- `provider_action_missing_type`
- `provider_final_answer_missing`
- `provider_unavailable`
- `provider_start_failed`
- `permission_denied`
- `unsupported_action`
- `unknown`

其中：

- `action.type is required` 应落到 `provider_action_missing_type`
- “模型没有提交 final_answer” 应落到 `provider_final_answer_missing`
- 同时给出用户可见 `message + hint`

示例：

- `message`: `模型返回的动作缺少 type 字段，未通过结构校验。`
- `hint`: `请检查 Provider 的结构化输出提示词，或重试当前任务。`

#### 5.3.5 turn 持久化字段

`ConversationTurn` 需要补充更适合前端展示的失败信息：

```ts
interface ConversationTurn {
  errorCode?: string;
  errorMessage?: string;
  errorHint?: string;
}
```

后端日志继续保留原始 `rawError`，但前端只展示经过公开分类后的文案与建议。

#### 5.3.6 预期落点

- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/runtime/provider-error.ts`
- `agent-gateway/src/types.ts`
- `agent-gateway/src/server.ts`
- 相关 provider/runtime/server 测试

### 5.4 turn 成功条件收紧为“必须有正式 final message”

#### 5.4.1 设计选择

本轮选择 **严格失败**，不采用“把 `assistantPreview` 自动回填成正式回复”的兼容策略。

原因：

- `assistantPreview` 语义已经被明确为规划/执行预览
- 自动回填会继续模糊 preview 与正式答复的边界
- 这本质上是在吞掉 provider 协议错误，不符合项目“直接重构”的原则

#### 5.4.2 新不变式

只要 turn 最终状态是 `succeeded`，就必须同时满足：

1. `runAgentLoop()` 收到了正式 `final_answer`
2. `server.ts` 成功写入正式 `agent_message`
3. `ConversationTurn.finalMessageId` 非空

只要缺任意一项：

- turn 直接进入 `failed`
- `errorCode = provider_final_answer_missing`
- `errorMessage` 明确告知“智能体结束执行但没有提交正式回复”

#### 5.4.3 UI 表现

`/agents` 页面保持“规划摘要”和“最终回复”两个区块的强语义分离：

- `assistantPreview` 只渲染在“规划摘要”
- `finalMessageId` 指向的消息只渲染在“最终回复”
- 若 turn 因缺正式回复而失败：
  - 仍可显示“规划摘要”
  - 但不显示“最终回复”
  - 改为显示失败原因与修复提示

这样用户能一眼判断：

- 智能体只是规划了
- 还是已经真的形成正式工作记录

#### 5.4.4 预期落点

- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/server.ts`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`
- 对应 server / agents page 测试

### 5.5 重构 Provider 命令能力模型，改为共享命令目录 + 交集执行

#### 5.5.1 现状问题

当前 `toolPolicy.commandWhitelist` 有三个问题：

1. Web 创建 Provider 时写死为 `['build', 'overview', 'galaxy', 'planet']`
2. 这些值本身混杂“命令名”和“页面/视图概念”，语义不清
3. 运行时并没有把 Provider 命令能力与成员权限做严格交集，导致配置可见性混乱

#### 5.5.2 直接替换字段

直接废弃：

```ts
toolPolicy.commandWhitelist: string[]
```

替换为：

```ts
toolPolicy.allowedCommandIds: string[]
```

定义规则：

- `allowedCommandIds` 存的是真实 CLI 命令 ID
- 这些 ID 必须来自共享命令目录
- 不再允许写 `overview` 这类不是 CLI 命令的值
- 不保留旧字段长期兼容逻辑；内置 Provider、测试数据、前端表单、持久化 JSON 一次性同步修改

#### 5.5.3 共享命令目录

新增一份跨 `shared-client / client-web / client-cli / agent-gateway` 共用的命令事实源，例如：

```ts
interface AgentCommandDefinition {
  id: string;                     // 真实 CLI 命令名
  label: string;                  // 展示名
  permissionCategory: "observe" | "build" | "combat" | "research" | "management";
  surfaceCategory: "observe" | "build" | "research" | "management" | "dyson";
  layer: "galaxy" | "system" | "planet";
  source: "public" | "extra";
}
```

来源：

- `PUBLIC_COMMAND_DEFINITIONS`
- CLI 专属可观察/管理命令：`summary`、`stats`、`galaxy`、`system`、`planet`、`scene`、`inspect`、`fleet_status`、`fog`、`save`

这样 Web 表单、agent-gateway prompt、CLI runtime 执行器都引用同一份目录。

#### 5.5.4 运行时交集规则

agent 真正可执行命令集合改为：

```text
Provider.allowedCommandIds
∩ 命令目录
∩ Agent.policy.commandCategories 映射出的允许类别
∩ 其他 runtime 限制（planetIds / cliEnabled）
```

这个交集需要同时用于：

- provider prompt 中的 `allowedCommands`
- `runCommandLine()` 的实际放行校验
- Web 成员详情页的能力可视化

#### 5.5.5 Web 配置与一致性校验

Provider 管理页改造：

- 不再写死默认白名单
- 默认选中“全部公共命令”
- 支持按权限类别/命令类别分组展开编辑
- 每个命令展示中文名、真实命令 ID、作用层级

成员详情页增加“能力覆盖检查”：

- 展示当前成员权限类别
- 展示绑定 Provider 在这些类别下实际可达的命令
- 校验策略：
  - 若某个已开启的成员权限类别在 Provider 侧 **0 可达命令**，阻止保存并给出明确提示
  - 若只是“部分命令被 Provider 过滤”，允许保存，但展示黄色警告，避免误以为该类别全开

这样可以解决：

- “成员权限开了 research，但 Provider 根本不允许 `start_research`”
- “成员权限开了 management，但 Provider 不允许戴森相关管理命令”

#### 5.5.6 预期落点

- `shared-client/src/...` 共享命令目录（新增）
- `client-cli/src/command-catalog.ts`
- `client-cli/src/runtime.ts`
- `agent-gateway/src/types.ts`
- `agent-gateway/src/bootstrap/minimax.ts`
- `agent-gateway/src/server.ts`
- `agent-gateway/src/routes/providers.ts`
- `client-web/src/features/agents/ProviderManagerView.tsx`
- `client-web/src/features/agents/MemberWorkspaceView.tsx`
- `client-web/src/features/agents/types.ts`

## 6. 验收标准映射

### 6.1 登录页不再暴露错误地址心智

对应设计：

- 5.1 的“Web 入口地址”语义
- 5.1 的登录错误分类

验收结果应表现为：

- 用户填当前 Web 地址可直接进入
- 若填 `18081/18082`，页面会明确提示“这是游戏服务端端口，不是 Web 入口地址”

### 6.2 研究命令能从 queued 收口到成功

对应设计：

- 5.2 的规则表与 `research_completed` 收口

验收结果应表现为：

- 研究完成后，Header 和命令卡片都进入明确成功态

### 6.3 智能体复杂任务失败时，前端拿到真实原因与建议

对应设计：

- 5.3 的归一化修复
- 5.3 的细粒度错误分类

验收结果应表现为：

- 观察型任务、建造型任务、创建下级智能体任务至少都能区分：
  - provider schema 问题
  - 权限问题
  - provider 不可用

### 6.4 turn succeeded 必须伴随正式回复

对应设计：

- 5.4 的严格完成不变式

验收结果应表现为：

- 没有 `final_answer` 的 turn 直接失败
- 有 `final_answer` 的 turn 一定能在消息流中看到正式 agent 回复

### 6.5 Provider 能力与成员权限一致可见

对应设计：

- 5.5 的共享命令目录
- 5.5 的运行时交集
- 5.5 的成员页覆盖检查

验收结果应表现为：

- Web 新建 Provider 时可显式编辑命令能力
- 研究/管理能力不会再出现“看起来开了，实际永远不可达”的假配置

## 7. 建议实现顺序

### 阶段 A：先打通命令能力与 turn 协议

1. 共享命令目录与 `allowedCommandIds`
2. provider/runtime 归一化与错误分类
3. turn 成功不变式

原因：

- 这三项共同决定智能体是否能稳定工作
- 也是问题 3、4、5 的共同基础

### 阶段 B：再收口行星命令反馈

1. 命令结算规则表
2. `start_research -> research_completed`
3. snapshot 补账扩展

### 阶段 C：最后做登录 UX

登录页变更对代码影响最小，但最适合在前两块稳定后统一补文案、测试和浏览器回归。

## 8. 测试与回归方案

### 8.1 单元测试

- `LoginPage`：
  - 在线模式默认填当前源站
  - 填真实 game server 地址时，失败文案明确指出 Web 入口地址
- `planet-commands/store`：
  - `start_research` 在 `command_result queued` 后仍保持 pending
  - `research_completed` 到达后进入 succeeded
  - snapshot 同时恢复 `command_result + research_completed`
- `action-schema`：
  - 缺 `type` 但含 `commandLine` 时可自动推断
  - 缺 `type` 且无法推断时，返回细粒度 schema 错误
- `runAgentLoop`：
  - `done=true` 但无 `final_answer` 时失败
- Provider/成员能力模型：
  - `allowedCommandIds` 与成员权限求交集正确

### 8.2 集成测试

- `agent-gateway/src/server.test.ts`
  - 观察型任务成功
  - 坐标建造成功
  - 创建下级智能体并分配权限成功
  - 缺 `final_answer` 时 turn 失败且带明确错误码

### 8.3 Playwright / 浏览器回归

- 登录页：
  - 输入 Web 入口地址正常进入
  - 输入 `18081/18082` 时出现明确提示，不再只是 `Failed to fetch`
- 默认新局研究链：
  - 风机 -> 研究站 -> 装矩阵 -> 启动研究 -> Header 收口成功
- `/agents`：
  - 发“你好”时 turn 必须生成正式回复或明确失败
  - 新建 Provider 可编辑命令能力
  - 成员权限与 Provider 能力不一致时出现阻断/警告

## 9. 文档同步要求

实现完成后，至少同步更新：

- `docs/dev/client-web.md`
- `docs/dev/agent-gateway.md`

需要同步的内容包括：

- 登录页在线模式语义改为 Web 入口地址
- 行星命令账本的异步收口规则
- Provider 命令能力字段从 `commandWhitelist` 改为 `allowedCommandIds`
- turn 成功必须含正式回复的协议约束

## 10. 结论

T106 的 5 个问题表面上分散在登录页、行星页、智能体工作台和 Provider 管理，但本质上都指向同一类设计缺陷：**语义边界不够硬，导致“受理像成功、预览像回复、权限像能力、入口像服务端”**。

本方案通过四个直接重构动作收敛这些边界：

- 浏览器只认 Web 入口
- 异步命令按规则表收口
- turn 成功必须落正式消息
- Provider 与成员权限共享命令事实源并做运行时交集

这样改完后，Web 与智能体两条链路的状态语义会显著稳定，且不会影响已经验证通过的默认新局科研链、midgame 建筑链和戴森运行态展示。
