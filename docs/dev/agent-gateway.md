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

## 2. 当前职责

- 存模板、实例、线程、会话、消息、定时任务和密钥
- 调 OpenAI 兼容 HTTP 模型，或拉起本机 `codex` / `claude` CLI provider
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
- `canCreateChannel`: 是否允许建频道
- `canManageMembers`: 是否允许管理成员
- `canInviteByPlanet`: 是否允许按星球拉人
- `canCreateSchedules`: 是否允许创建定时任务
- `canDirectMessageAgentIds`: 可主动私聊的 agent 列表
- `canDispatchAgentIds`: 可指挥的 agent 列表

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
- `POST /conversations/:conversationId/messages`
- `GET /conversations/:conversationId/events`
- `POST /conversations/:conversationId/members/invite-by-planet`

当前 `POST /conversations` 可直接创建频道或私聊；`POST /conversations/:id/messages` 会解析 `@agentName` / `@agentId` 提及并写入 `mentions`。

### 3.3 自动唤醒

- 频道内：只有被 `@` 到的 agent 会进入 mailbox
- 私聊内：除发送者外的另一个 agent 会被自动唤醒
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

agent 实例自身也保留：

- `GET /agents/:agentId/events`

前端 `/agents` 页面目前主要订阅会话 SSE，用于消息流实时刷新。

## 6. Provider 与 CLI 边界

### 6.1 支持的模板类型

- `openai_compatible_http`
- `codex_cli`
- `claude_code_cli`

### 6.2 CLI 工具边界

agent 不直接拿 shell，只能走受控 `client-cli` 运行时。

当前白名单命令来自 `client-cli/src/command-catalog.ts`，例如：

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
  templates/
  agents/
  threads/
  conversations/
  messages/
  schedules/
  secrets/
  schemas/
```

其中：

- `templates/`：模板 JSON
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
