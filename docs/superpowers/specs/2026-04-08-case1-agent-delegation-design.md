# Case1 Agent Delegation Design

**日期**: 2026-04-08

## 背景

`docs/case/case1.md` 要求系统支持如下闭环：

1. 玩家创建总管智能体李斯。
2. 赋予李斯全部权限，包含创建新智能体的权限。
3. 李斯创建下级智能体胡景，并只给胡景建筑权限。
4. 玩家命令李斯新建矿场。
5. 李斯委派胡景执行建造，最终由胡景完成矿场建造。

`docs/case/case实现要求.md` 进一步要求：

- 先确认真实实现是否支持该玩法。
- 若 CLI / Web 缺口存在，则补齐。
- 通过 CLI 与浏览器分别完成该玩法验证。

当前仓库现状：

- `server/` 只负责游戏状态与命令执行，不负责多智能体协作。
- `agent-gateway/` 已有 agent、会话、消息、自动唤醒、受控 `game.cli` 执行。
- `client-web` 已有 `/agents` 页面，可创建成员、编辑命令分类等权限。
- `client-cli` 当前没有 agent-gateway 管理命令。
- `agent-gateway` 虽保存了 `managedAgentIds / supervisorAgentIds / canDispatchAgentIds` 等字段，但运行时还没有“创建下级智能体”“受控委派发消息”的显式 action。

## 目标

补齐一条可验证、可受控、可测试的多智能体委派链，使案例 1 可以通过 CLI 与 Web 真实完成。

## 非目标

- 不把协作逻辑下沉回 `server/`。
- 不引入为了兼容旧行为的适配层。
- 不实现完整组织架构系统，只补齐案例 1 所需且可扩展的最小能力。

## 设计

### 1. agent-gateway 新增显式受控 action

Provider 返回的结构化 action 新增：

- `agent.create`
- `agent.update`
- `conversation.ensure_dm`
- `conversation.send_message`

这些 action 由 `agent-gateway` 运行时显式执行，不再依赖模型只输出自然语言文本“假装已经创建或委派”。

### 2. 新增创建智能体权限

`AgentPolicy` 新增：

- `canCreateAgents: boolean`

语义：

- 只有 `canCreateAgents=true` 的 agent 才能执行 `agent.create`。
- 创建出的下级默认继承同一 `serverUrl / playerId / playerKey`，避免暴露额外凭据配置。
- 创建者与被创建者自动建立 `managedAgentIds / supervisorAgentIds` 关系。

### 3. 创建与更新的权限边界

运行时校验遵循最小可控原则：

- 只有创建者自己或其可管理下级可以被 `agent.update` 修改。
- 被授予的 `policy.commandCategories` 必须是创建者可执行范围的子集。
  - 若创建者自己的 `commandCategories` 为空，则视为“当前未限制分类”，允许授予任意分类。
- 被授予的 `policy.planetIds` 必须是创建者星球范围的子集。
  - 若创建者自己的 `planetIds` 为空，则视为“不限星球”。
- 新建 agent 的角色不能高于创建者角色。

这保证李斯可以创建只会建造的胡景，但不能凭空创建比自己更高权限的智能体。

### 4. 受控委派消息

`conversation.ensure_dm` 与 `conversation.send_message` 提供明确的委派链：

- 李斯先确保与胡景有 DM。
- 李斯再向该 DM 发送“去新建一个矿场”的消息。
- DM 中的胡景被自动唤醒，按既有 mailbox 串行执行。

运行时约束：

- 若目标 agent 不在 `managedAgentIds`，且不在 `policy.canDispatchAgentIds / canDirectMessageAgentIds` 允许范围内，则拒绝。

### 5. client-cli 补齐 agent-gateway 命令

新增最小命令集：

- `agent_list`
- `agent_create`
- `agent_update`
- `agent_message`
- `agent_thread`

这些命令直连 `agent-gateway`，用于在终端里完成案例 1：

1. 创建李斯。
2. 给李斯开启 `canCreateAgents` 与全部命令分类。
3. 对李斯发送“创建胡景并赋建筑权限”。
4. 再发送“新建矿场”。
5. 读取李斯线程确认其已创建胡景并委派建造。

### 6. client-web 权限配置补齐

`/agents` 成员详情页新增 `允许创建智能体` 开关，并保持现有命令分类、星球范围、可调度成员配置。

这样浏览器里可直接把李斯配置成：

- 可创建下级
- 可调度胡景
- 全命令分类

### 7. 测试策略

#### agent-gateway

- `runAgentLoop` 增加新 action 的单元测试。
- `server.test.ts` 增加案例 1 集成测试，使用可控 `agentTurnRunner`：
  - 李斯收到第一条指令时创建胡景。
  - 李斯收到第二条指令时给胡景发 DM。
  - 胡景收到 DM 时执行 `build ... mining_machine`。

#### client-cli

- 为新增 agent-gateway API 与命令补单元测试。
- 增加案例 1 的 CLI 集成测试，验证终端侧能完成“创建李斯 -> 指令创建胡景 -> 指令建矿场”。

#### client-web

- Playwright 用浏览器跑 `/agents`：
  - 创建李斯并配置权限。
  - 通过与李斯的会话发送案例消息。
  - 观察消息流与成员列表状态，验证案例路径对玩家可见。

## 风险与取舍

- 受控 action 会让 runtime 稍复杂，但它是可测试、可审计、可扩展的正交边界，优于把委派逻辑塞进 prompt。
- CLI 这次只补案例 1 所需最小命令，不一次性把完整 `agent-gateway` 全接口都做成 REPL 命令，避免范围失控。

## 交付结果

完成后应满足：

- 李斯拥有 `canCreateAgents` 时可真实创建胡景。
- 胡景只拥有建造权限。
- 李斯可真实把建矿场任务派发给胡景。
- CLI 与 Web 都有对应操作路径。
- 文档、测试、浏览器验证同步更新。
