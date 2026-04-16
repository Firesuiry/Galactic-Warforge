# agent-gateway 开发说明

`agent-gateway` 是本地智能体协作与运行时层，不属于 `server/`。游戏状态、规则和命令执行仍在 `server/`；频道、私聊、`@` 协作、权限硬限制、定时消息和前端工作台接口都落在 `agent-gateway`。

## 1. 启动

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm install
npm run dev
```

默认端口：

- `18180`

可通过环境变量覆盖：

- `SW_AGENT_GATEWAY_PORT`
- `SW_AGENT_GATEWAY_DATA_DIR`
- `SW_AGENT_GATEWAY_ENV_FILE`

启动时如果 `SW_AGENT_GATEWAY_ENV_FILE` 指向的文件，或默认仓库根目录 `../.env` 中能解析到 MiniMax key，`agent-gateway` 会自动生成一个内置模型 Provider：

- `builtin-minimax-api`
- provider: `http_api`
- model: `MiniMax-M2.1`

## 2. 当前职责

- 存模型 Provider、实例、线程、会话、消息、定时任务和密钥
- 调 HTTP API 模型，或拉起本机 `codex` / `claude` CLI provider
- 通过受控 `client-cli` 运行时执行游戏命令
- 为 `client-web` 提供 `/agent-api` HTTP / SSE 接口
- 在会话层处理自动唤醒、mailbox 串行消费和 heartbeat 式定时投递

## 3. 协作模型

### 3.1 Agent 扩展字段

`POST /agents` 现在除原有实例信息外，还支持：

- `role`: `worker | manager | director`
- `policy`: 运行时硬限制配置
- `supervisorAgentIds`: 哪些 agent 可以指挥它
- `managedAgentIds`: 它可以直接指挥哪些 agent
- `activeConversationIds`: 当前参与中的会话

`policy` 当前字段：

- `planetIds`: 允许运行命令时触达的星球范围
- `commandCategories`: 允许执行的命令类别
- `canCreateAgents`: 是否允许创建下级智能体
- `canCreateChannel`: 是否允许建频道
- `canManageMembers`: 是否允许管理成员
- `canInviteByPlanet`: 是否允许按星球拉人
- `canCreateSchedules`: 是否允许创建定时任务
- `canDirectMessageAgentIds`: 可主动私聊的 agent 列表
- `canDispatchAgentIds`: 可指挥的 agent 列表

### 3.1.1 受控 runtime action

agent provider 现在以 typed `game.command` 作为唯一游戏动作入口，同时还可以返回以下受控 action：

- `game.command`
- `agent.create`
- `agent.update`
- `conversation.ensure_dm`
- `conversation.send_message`

语义：

- `game.command`：结构化游戏命令；例如 `{"type":"game.command","command":"scan_planet","args":{"planetId":"planet-1-2"}}`
- `agent.create`：创建下级智能体；当前默认复用创建者自己的 `serverUrl / playerId / playerKey / providerId`
- `agent.update`：更新自己或受管下级的 role / goal / policy
- `conversation.ensure_dm`：确保当前 agent 与目标下级存在 DM
- `conversation.send_message`：向已有会话或目标下级 DM 投递一条消息

运行时硬限制：

- 只有 `policy.canCreateAgents=true` 的 agent 才能执行 `agent.create`
- 新建或更新下级时，授予的 `commandCategories` / `planetIds` 不能超出创建者自身范围
- 新建 agent 的角色不能高于创建者角色
- agent 向其他 agent 发私聊或委派消息时，目标必须在 `managedAgentIds`，或命中 `canDispatchAgentIds / canDirectMessageAgentIds`

### 3.2 会话与消息

会话对象分两类：

- `channel`: 多人频道
- `dm`: 双方私聊

消息对象统一进入会话流，`senderType` 支持：

- `player`
- `agent`
- `system`
- `schedule`

会话相关接口：

- `GET /conversations`
- `POST /conversations`
- `GET /conversations/:conversationId/messages`
- `GET /conversations/:conversationId/turns`
- `POST /conversations/:conversationId/messages`
- `GET /conversations/:conversationId/events`
- `POST /conversations/:conversationId/members/invite-by-planet`

当前 `POST /conversations` 可直接创建频道或私聊；`POST /conversations/:id/messages` 会解析 `@agentName` / `@agentId` 提及并写入 `mentions`，并返回：

- `accepted`
- authoritative `message`
- 当前消息触发的初始 `turns`

消息字段补充：

- `replyToMessageId`：最终回复或失败消息挂回原请求消息
- `turnId`：消息所属的 turn

`GET /conversations/:conversationId/turns` 返回 `ConversationTurn[]`，用于让前端把“玩家请求 -> turn 生命周期 -> 最终回复/失败”稳定分组，不再依赖消息到达顺序猜测。

turn 额外字段：

- `outcomeKind`: `reply_only | observed | acted | delegated | blocked`
- `executedActionCount`: 本轮真正执行的 `game.command` / 委派动作数量
- `repairCount`: 该轮因“只规划不执行”触发的 repair 次数

如果 agent turn 执行失败，当前会额外向会话写入一条 `system` 消息，避免前端表现成“私聊无回复”。

补充约束：

- `assistantPreview` 只表示当前 turn 的规划/执行摘要，不是正式回复
- provider 必须返回 `assistantMessage/actions/done` 三字段 JSON；若本轮无需动作且已经完成，可直接返回 `assistantMessage + [] + true`
- 若同时返回 `assistantMessage` 与 `final_answer`，正式回复仍以 `final_answer` 为准；若没有 `final_answer`，则 `done=true` 且非空 `assistantMessage` 会直接作为正式回复落库
- provider 返回非 JSON 但去首尾空白后仍非空的纯文本时，gateway 会自动包装成 `assistantMessage + [] + true` 的完成态；空文本、空对象或其它结构错误仍公开为 `provider_schema_invalid`
- 只有真正的空动作壳会被忽略，例如 `{}` 或只带空 `args` 的对象；带业务字段但缺 `type` 的残缺动作不会被吞掉，仍会判为 `provider_schema_invalid`
- 如果用户请求带有观察、游戏变更或委派意图，而 provider 只返回计划句、不返回对应动作，runtime 会自动做 1 次 repair；若修复后仍无真实动作，则公开为 `provider_incomplete_execution`
- 只有真正落库了正式回复消息的 turn 才会标记为 `succeeded`；这条正式回复既可能来自 `final_answer`，也可能来自 done 态的 `assistantMessage`

补充：

- `POST /agents/:agentId/messages` 这条传统单 agent thread 入口，现在也支持上面的受控 runtime action，不再只能跑 typed `game.command`
- 该 thread 入口会把 `agent.create / agent.update / conversation.ensure_dm / conversation.send_message` 的 tool 结果也持久化到 thread；后续同一 agent 的下一条消息会复用这些真实 tool 结果，而不是只看到助手自然语言
- `GET /agents/:agentId/thread` 除消息、tool call、执行日志外，还会暴露最近一次 turn 的摘要：`status`、`outcomeKind`、`executedActionCount`、`repairCount`、`errorCode/errorMessage/rawErrorMessage`、`finalMessage`
- 因此 CLI 侧可以直接通过 thread 入口完成“让李斯创建胡景并委派胡景建矿场”这类 case1 链路

### 3.3 自动唤醒

- 频道内：只有被 `@` 到的 agent 会进入 mailbox
- 私聊内：玩家 / system / schedule 消息默认会唤醒另一侧 agent；agent 自己的普通回复不会再反向自动唤醒对方，避免 agent-agent DM 形成“收到”回声环
- 只有显式 `conversation.send_message` 这类委派消息会以 `agent_dispatch` 触发下一跳 agent 唤醒
- 同一个 agent 的 mailbox 串行消费，避免并发跑多个 turn
- agent 回复后会重新写回会话；如果回复里继续 `@` 其他会话成员，会继续触发后续唤醒

### 3.4 定时任务

定时任务接口：

- `GET /schedules`
- `POST /schedules`

任务支持两类目标：

- `conversation`: 直接往已有会话发消息
- `agent_dm`: 若不存在对应私聊，会自动建一个 DM 再投递

当前实现是 scheduler 定期扫描 `nextRunAt`，命中后把 `messageTemplate` 作为 `schedule` 消息写入会话，并推进下一次执行时间。

## 4. 运行时硬限制

### 4.1 命令类别限制

这是当前已经落地的硬限制。

`client-cli/src/command-catalog.ts` 把 agent 可用命令分成：

- `observe`
- `build`
- `combat`
- `research`
- `management`

`runCommandLine()` 会在真正 dispatch 前检查命令类别，不在 `policy.commandCategories` 内就直接拒绝执行。

### 4.2 星球范围限制

这也是运行时检查，不是 prompt 建议。

当前实现方式：

- 当命令行里显式出现 `planet-*` 参数时，若不在 `policy.planetIds` 内会直接拒绝

当前已知边界：

- 这还不是完整的语义级星球隔离
- 如果某条命令不把目标星球显式写成 `planet-*` token，现实现阶段不会额外推导

文档和实现要以这个现状为准，不要把它描述成完整权限系统。

### 4.3 会话管理能力

路由层当前已对以下动作做了显式开关校验：

- 按星球拉人：agent 侧要求 `canInviteByPlanet`
- 创建定时任务：agent 侧要求 `canCreateSchedules`

玩家当前默认允许创建频道、发消息、拉人和建定时任务。更多“谁能建群 / 谁能私聊 / 谁能指挥谁”的硬限制字段已经进入 agent profile，但还需要继续把路由校验补齐到所有动作入口。

## 5. SSE 与前端联动

会话事件流：

- `GET /conversations/:conversationId/events`

事件通道 key 形式为：

- `conversation:${conversationId}`

当前主要推送：

- `message`
- `turn.updated`
- `turn.completed`
- `turn.failed`

agent 实例自身也保留：

- `GET /agents/:agentId/events`

前端 `/agents` 页面现在会分别缓存：

- `message` 事件：增量写入消息列表
- `turn.*` 事件：增量写入 `ConversationTurn` 列表

`client-web` 的 `/agents` 工作台已经从平铺消息流改成“请求卡片 + turn 状态 + 规划摘要 + 动作摘要 + 最终回复/失败原因”的结构。

## 6. Provider 与 CLI 边界

### 6.1 支持的模型 Provider 类型

- `http_api`
- `codex_cli`
- `claude_code_cli`

前端模型 Provider 管理现在可以直接配置：

- HTTP API provider 的 `apiUrl` / `apiStyle(openai|claude)` / `apiKey` / `model`
- CLI provider 的命令、工作目录和启动参数
- `commandWhitelist`：按 `observe / build / research / management / combat` 分组的可视化白名单；内置 MiniMax Provider 和 Web 新建 Provider 默认都会展开完整 agent 命令集合

当前 `http_api` 已支持 OpenAI 风格和 Claude 风格两种接口，并针对 MiniMax 实际返回的 `<think>...</think>` 前缀做了解析兼容，结构化 JSON 不再因为前置思维块而失败。

### 6.2 CLI 工具边界

agent 不直接拿 shell，只能走受控 `client-cli` 运行时。

当前白名单命令由两部分组成：

- `shared-client/src/command-catalog.ts`：公共游戏命令与 CLI alias 的单一真相
- `client-cli/src/command-catalog.ts`：在共享目录基础上补 query/save 等 CLI 专属入口

例如：

- `summary`
- `stats`
- `planet`
- `scene`
- `scan_planet`
- `build`
- `move`
- `attack`
- `upgrade`
- `start_research`
- `save`

默认不会开放：

- `rollback`
- `raw`
- `quit`
- 任意 Bash

## 7. 数据目录

默认目录：

- `agent-gateway/data`

结构：

```text
agent-gateway/data/
  providers/
  agents/
  threads/
  conversations/
  messages/
  schedules/
  secrets/
  schemas/
```

其中：

- `providers/`：模型 Provider JSON
- `agents/`：实例 JSON
- `threads/`：传统单 agent thread
- `conversations/`：频道与私聊
- `messages/`：会话消息
- `schedules/`：定时任务
- `secrets/`：加密后的 API Key / player key
- `schemas/`：provider 结构化输出所需 JSON Schema

## 8. 回归建议

至少验证以下命令：

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/**/*.test.ts
```

如果怀疑 glob 没覆盖 `server.test.ts`，单独再跑：

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/server.test.ts
```
