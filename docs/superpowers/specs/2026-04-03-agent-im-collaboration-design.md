# Agent 即时通信协作工作台设计

## 1. 背景

当前 `client-web` 的 `/agents` 页面是以模板、实例、线程表单为中心的单智能体控制台，适合调试单个 Agent，但不适合多智能体协作。用户希望将这部分改造成更接近即时通信软件的协作界面，使多个智能体能够通过频道、私聊、`@` 提及和组织关系推进任务，并为每个智能体设置可被系统强制执行的工作边界。

现有实现中，协作能力主要集中在本地 `agent-gateway`，`server/` 并不了解 Agent 的组织结构、消息流和调度关系。本轮保持这一边界不变：协作层只存在于 `agent-gateway` 与 `client-web`，`server/` 继续只负责游戏查询与命令执行。

## 2. 已确认约束

- 协作层不进入 `server/`。
- 智能体之间通过频道、私聊、`@` 提及协作。
- 频道支持动态创建。
- 玩家或总管 Agent 可以手动拉指定智能体进频道。
- 玩家或总管 Agent 可以按星球批量拉入负责该星球的智能体。
- Agent 在被 `@` 或收到私聊后自动唤醒处理，不依赖玩家手动点运行。
- 工作范围使用运行时硬限制，而不是提示词约束。
- 硬限制至少覆盖：
  - 可见/可操作星球范围
  - 可调用命令类别
  - 可私聊对象
  - 可指挥的下属智能体
  - 是否允许建频道、拉人、按星球批量拉人、创建定时任务
- 支持周期性定时任务，按固定时间间隔向某个 Agent 或某个会话发送一段消息，类似 heartbeat。

## 3. 目标与非目标

### 3.1 目标

1. 将 `/agents` 改造成 IM 风格的多智能体协作工作台。
2. 在 `agent-gateway` 中新增频道、私聊、成员关系、消息、提及、调度、定时任务的数据模型。
3. 用运行时硬限制保证 Agent 只能访问自己的星球范围、命令类别、会话和下属对象。
4. 让 `@`、私聊和定时任务都自动触发目标 Agent 的运行循环。
5. 保留现有模板、Provider、导入导出能力，但从主操作界面退到管理入口。

### 3.2 非目标

- 不把频道、私聊、组织结构、调度关系同步到 `server/`。
- 第一版不做跨机器共享工作区。
- 第一版不做复杂 cron 表达式，仅支持固定周期秒数。
- 第一版不做 `@channel`、`@all`、群组别名等高级广播语义。
- 第一版不做细粒度消息审计策略编辑器，只做必要的运行时限制。

## 4. 总体架构

```text
client-web  <----HTTP/SSE---->  agent-gateway  <----HTTP---->  SiliconWorld server
                                     |
                                     +---- provider adapters
                                     |
                                     +---- conversation store
                                     |
                                     +---- scheduler / mailbox / runner
                                     |
                                     +---- controlled client-cli runtime
```

职责边界：

- `client-web`
  - 展示工作区、频道、私聊、消息流、成员信息、任务状态
  - 提供建群、拉人、私聊、`@`、定时任务等入口
  - 展示 Agent 的运行态和权限摘要
- `agent-gateway`
  - 持久化协作数据
  - 解析消息中的提及目标
  - 维护 Agent mailbox 与 runner
  - 在运行前拼装经过权限裁剪的上下文
  - 执行命令类别和星球范围校验
  - 周期性投递定时任务消息
- `server`
  - 继续作为游戏状态与命令执行后端

## 5. 核心对象模型

### 5.1 Workspace

保留单工作区实现，但模型上允许后续扩展：

```ts
interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
```

### 5.2 AgentProfile

替代当前“只围绕线程”的实例视角，强调组织角色和运行策略：

```ts
interface AgentPolicy {
  planetIds: string[];
  commandCategories: string[];
  canCreateChannel: boolean;
  canManageMembers: boolean;
  canInviteByPlanet: boolean;
  canCreateSchedules: boolean;
  canDirectMessageAgentIds: string[];
  canDispatchAgentIds: string[];
}

interface AgentProfile {
  id: string;
  name: string;
  templateId: string;
  serverUrl: string;
  playerId: string;
  playerKeySecretId: string;
  status: 'idle' | 'queued' | 'running' | 'cooldown' | 'paused' | 'error';
  role: 'worker' | 'manager' | 'director';
  policy: AgentPolicy;
  supervisorAgentIds: string[];
  managedAgentIds: string[];
  activeConversationIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

### 5.3 Conversation

统一抽象频道与私聊：

```ts
interface Conversation {
  id: string;
  workspaceId: string;
  type: 'channel' | 'dm';
  name: string;
  topic: string;
  memberIds: string[];
  createdByType: 'player' | 'agent';
  createdById: string;
  createdAt: string;
  updatedAt: string;
}
```

第一版私聊严格保持双边结构，避免把“频道”与“多人指挥窗口”混在一起。

### 5.4 ConversationMember

```ts
interface ConversationMember {
  conversationId: string;
  participantType: 'player' | 'agent';
  participantId: string;
  role: 'owner' | 'manager' | 'member';
  source: 'manual' | 'planet_batch' | 'dm_binding';
  createdAt: string;
}
```

### 5.5 Message

```ts
interface MentionTarget {
  type: 'agent';
  id: string;
}

interface ConversationMessage {
  id: string;
  conversationId: string;
  senderType: 'player' | 'agent' | 'system' | 'schedule';
  senderId: string;
  kind: 'chat' | 'system' | 'tool' | 'schedule';
  content: string;
  mentions: MentionTarget[];
  trigger: 'player_message' | 'agent_message' | 'schedule_message' | 'system_message';
  createdAt: string;
}
```

### 5.6 ScheduleJob

```ts
interface ScheduleJob {
  id: string;
  workspaceId: string;
  name: string;
  creatorType: 'player' | 'agent';
  creatorId: string;
  targetType: 'agent_dm' | 'conversation';
  targetId: string;
  intervalSeconds: number;
  messageTemplate: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

## 6. 运行时硬限制

### 6.1 消息可见性

- Agent 只能读取自己所在会话的消息。
- Agent 看不到未加入频道的历史、成员与未读。
- 私聊只对双方和玩家管理视图可见。

### 6.2 `@` 与私聊

- 频道内只能 `@` 当前可见成员。
- Agent 发起私聊时，目标必须在 `canDirectMessageAgentIds` 内，除非发送者是玩家。
- Agent 指派其他 Agent 时，目标必须在 `canDispatchAgentIds` 内。

### 6.3 星球范围

- 给 Agent 组装上下文时，只提供 `policy.planetIds` 允许的星球摘要。
- 候选拉人列表和按星球拉人结果也基于该策略裁剪。
- 命令执行前再次验证目标星球是否在白名单内。

### 6.4 命令类别

- CLI 命令目录需要新增类别标注，例如 `observe`、`build`、`combat`、`logistics`、`research`、`management`。
- Agent 运行时只能拿到自己允许的类别。
- 即使模型产出了未授权命令，也在工具层直接拒绝。

### 6.5 管理操作

只有玩家或具备相应策略位的总管 Agent 才能：

- 创建频道
- 邀请成员
- 按星球批量拉人
- 修改 Agent policy
- 创建、启停、修改定时任务

### 6.6 定时任务

- 定时任务不绕过任何权限限制。
- 它只负责向目标会话或目标 Agent 私聊投递消息。
- 如果创建者失去权限、目标不可达或目标会话不存在，任务自动暂停并发送系统消息。

## 7. 消息流与调度

### 7.1 统一触发源

所有新消息都归一到以下触发类型：

- `player_message`
- `agent_message`
- `schedule_message`
- `system_message`

### 7.2 自动唤醒规则

- 私聊消息会直接唤醒目标 Agent。
- 频道消息只唤醒被明确 `@` 的 Agent。
- 没有 `@` 的频道消息不会广播唤醒全部成员。
- 定时消息投递后复用普通消息路由。

### 7.3 Mailbox + Runner

每个 Agent 拥有：

- `mailbox`
  - 待处理消息引用队列
- `runner`
  - 单并发执行循环

调度规则：

1. 新消息写入会话。
2. 路由器解析提及与目标对象。
3. 消息引用加入目标 Agent 的 mailbox。
4. Agent 若空闲则从 `idle` 转为 `queued` 并启动 runner。
5. runner 读取 mailbox，拼装权限裁剪后的上下文，执行多轮 loop。
6. 产生的回复、工具结果、后续 `@` 再写回消息流。

### 7.4 防风暴策略

第一版必须提供基础保护：

- 同一 Agent 同时只允许一个 runner。
- `running` 状态下的新消息只入队不并发重跑。
- 单次唤醒有最大步数。
- 单次回复允许的提及数量设上限。
- 同一会话的短时自动触发次数设上限。
- 互相提及链路超阈值时，插入系统消息并暂停链路。

## 8. 上下文拼装

Agent 被唤醒时只获得以下信息：

- 触发它的消息
- 当前会话最近 N 条可见消息
- 与其相关的私聊最近 N 条
- 允许访问的星球摘要
- 可用命令类别及命令目录
- 可指挥下属列表
- 当前 Agent 的 policy 摘要

明确不提供：

- 未加入会话的消息
- 未授权星球信息
- 未授权命令类别
- 不可指挥 Agent 的详细目录

## 9. 前端交互设计

### 9.1 总体布局

`/agents` 改为：

- 左栏：频道、私聊、智能体目录
- 中栏：消息流与输入框
- 右栏：成员、权限、任务、Agent 摘要

### 9.2 左栏

- `频道` 分组：显示未读、最近消息、星球标签
- `私聊` 分组：显示玩家与 Agent 或 Agent 与 Agent 的双边会话
- `智能体目录`：显示状态、模板、星球范围、命令类别、是否总管

### 9.3 中栏

消息样式区分：

- 玩家消息
- Agent 消息
- 系统消息
- 定时任务消息

输入框支持：

- `@agent` 自动补全
- 建频道
- 拉成员
- 按星球拉人
- 创建定时任务

### 9.4 右栏

根据当前上下文展示：

- 频道信息与成员管理
- 私聊对象的策略摘要
- Agent 的工作范围、命令类别、上下级关系
- 当前会话相关的定时任务

### 9.5 配置入口重组

Provider、模板、prompt、CLI workdir 仍保留，但从主工作台移出，进入：

- `组织管理`
- `运行时设置`

主界面聚焦协作，设置界面聚焦配置。

## 10. 持久化与 API 调整

`agent-gateway/data` 需要扩展目录：

```text
agent-gateway/data/
  templates/
  agents/
  conversations/
  memberships/
  messages/
  schedules/
  secrets/
  schemas/
```

需要新增或重构的 API 大致分为：

- 会话列表与详情
- 建频道 / 建私聊
- 邀请成员 / 按星球批量拉人
- 发消息
- 订阅会话事件与 Agent 状态
- 查询与更新 Agent policy
- 查询与维护定时任务

导入导出需要扩展到 `conversations`、`memberships`、`messages`、`schedules`。

## 11. 错误处理

- 越权私聊：返回 `403` 并写入系统消息
- 越权 `@`：返回 `403`
- 越权命令类别：工具层拒绝，写入工具结果消息
- 越权星球命令：工具层拒绝，写入工具结果消息
- 频道成员不存在：返回 `404`
- 目标 Agent 已暂停：消息可投递但不自动运行，状态明确展示
- 定时任务失效：自动禁用并发出系统消息

## 12. 测试策略

### 12.1 agent-gateway

- 会话创建与成员管理测试
- `@` 路由与私聊路由测试
- mailbox 与 runner 串行执行测试
- 命令类别和星球范围硬限制测试
- 定时任务投递与自动暂停测试
- 导入导出回归测试

### 12.2 client-web

- `/agents` 页面交互测试
- 会话切换与消息渲染测试
- `@` 自动补全与发送测试
- 右栏权限摘要与任务面板测试

### 12.3 浏览器验证

必须真实打开浏览器检查：

- `/agents` 是否呈现为 IM 风格工作台
- 建群、拉人、按星球拉人是否可见且可操作
- `@` 后目标 Agent 是否自动出现运行态并回消息
- 私聊和频道切换是否正常
- 定时任务创建后是否会按周期投递消息

## 13. 方案取舍结论

本轮采用“频道中心型”的 IM 协作方案，而不是继续沿用单 Agent 线程控制台。原因如下：

- 它最符合“像即时通信软件”的交互目标。
- 动态建群、按星球批量拉人、私聊指挥、`@` 协作都天然落在这一模型里。
- 运行时硬限制能直接映射到“谁能看见谁、谁能对谁说话、谁能调用什么命令”。
- 定时任务可以统一复用消息投递与自动唤醒链路，不需要额外再造一套任务系统。
