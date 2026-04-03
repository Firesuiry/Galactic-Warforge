# Agent 即时通信协作工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `client-web` 的 `/agents` 页面重构为 IM 风格多智能体协作工作台，并在 `agent-gateway` 中新增频道、私聊、`@` 路由、运行时权限硬限制和周期性定时消息调度。

**Architecture:** 保留 `server/` 只负责游戏状态与命令执行，将协作模型完全落在本地 `agent-gateway`。后端以会话、成员、消息、Agent policy、mailbox、schedule 为核心对象；前端以会话列表、消息流、成员/权限侧栏为核心界面；CLI 命令通过类别和星球范围在网关运行时被硬限制。

**Tech Stack:** Node.js、TypeScript、`node:test`、React、Vite、Vitest、TanStack Query、现有 `client-cli` / `shared-client`

---

## File Map

- `agent-gateway/src/types.ts`
  扩展协作域模型、Agent policy、会话、消息、定时任务类型。
- `agent-gateway/src/store/file-store.ts`
  通用目录型 JSON 存储基建。
- `agent-gateway/src/store/agent-store.ts`
  扩展 Agent profile 与 policy 读写。
- `agent-gateway/src/store/thread-store.ts`
  迁移为消息/会话相关存储适配层，或拆分成会话与消息存储。
- `agent-gateway/src/store/conversation-store.ts`
  新增会话与成员持久化。
- `agent-gateway/src/store/message-store.ts`
  新增消息持久化。
- `agent-gateway/src/store/schedule-store.ts`
  新增定时任务持久化。
- `agent-gateway/src/store/store.test.ts`
  新增会话、消息、任务和 policy 存储测试。
- `agent-gateway/src/runtime/loop.ts`
  改造成 mailbox + runner 输入模型。
- `agent-gateway/src/runtime/router.ts`
  新增消息路由与提及解析。
- `agent-gateway/src/runtime/policy.ts`
  新增私聊、建群、拉人、命令类别、星球范围硬限制。
- `agent-gateway/src/runtime/scheduler.ts`
  新增周期性消息投递器。
- `agent-gateway/src/runtime/loop.test.ts`
  覆盖自动唤醒、串行 runner、权限拒绝和调度上限。
- `agent-gateway/src/routes/agents.ts`
  从单 agent 线程接口迁移到 profile、policy、私聊辅助接口。
- `agent-gateway/src/routes/conversations.ts`
  新增频道/私聊/成员/消息接口。
- `agent-gateway/src/routes/schedules.ts`
  新增定时任务接口。
- `agent-gateway/src/server.ts`
  注册新路由，接入 scheduler 生命周期。
- `agent-gateway/src/server.test.ts`
  覆盖会话、消息、schedule 的 HTTP 行为。
- `client-cli/src/command-catalog.ts`
  为 Agent 命令增加类别元数据。
- `client-cli/src/runtime.ts`
  支持按命令类别和星球范围做运行时校验。
- `client-cli/src/runtime.test.ts`
  新增命令类别限制和越权失败测试。
- `client-web/src/features/agents/types.ts`
  替换为 workspace / conversation / message / agent profile / schedule 类型。
- `client-web/src/features/agents/api.ts`
  改成会话中心 API。
- `client-web/src/features/agents/use-agent-events.ts`
  订阅会话事件与 agent 状态事件。
- `client-web/src/features/agents/AgentWorkspace.tsx`
  重写成 IM 风格工作台。
- `client-web/src/pages/AgentsPage.tsx`
  改成会话驱动的数据装配。
- `client-web/src/pages/AgentsPage.test.tsx`
  覆盖建群、会话渲染、消息发送、右栏摘要显示。
- `client-web/src/styles/index.css`
  增加 IM 风格布局与状态样式。
- `docs/dev/client-web.md`
  更新工作台使用说明。
- `docs/dev/agent-gateway.md`
  更新会话、权限、定时任务与接口说明。

### Task 1: 扩展网关领域模型与持久化

**Files:**
- Modify: `agent-gateway/src/types.ts`
- Create: `agent-gateway/src/store/conversation-store.ts`
- Create: `agent-gateway/src/store/message-store.ts`
- Create: `agent-gateway/src/store/schedule-store.ts`
- Modify: `agent-gateway/src/store/agent-store.ts`
- Test: `agent-gateway/src/store/store.test.ts`

- [ ] **Step 1: 先写会话和 schedule 存储失败测试**

```ts
it('persists conversations, messages, schedules, and agent policies', async () => {
  const stores = await createTestStores();

  await stores.agentStore.save({
    id: 'agent-director',
    name: '总管',
    templateId: 'tpl-1',
    serverUrl: 'http://127.0.0.1:18081',
    playerId: 'p1',
    playerKeySecretId: 'secret-1',
    status: 'idle',
    role: 'director',
    policy: {
      planetIds: ['planet-a'],
      commandCategories: ['observe', 'management'],
      canCreateChannel: true,
      canManageMembers: true,
      canInviteByPlanet: true,
      canCreateSchedules: true,
      canDirectMessageAgentIds: ['agent-a'],
      canDispatchAgentIds: ['agent-a'],
    },
    supervisorAgentIds: [],
    managedAgentIds: ['agent-a'],
    activeConversationIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  });

  await stores.conversationStore.save({
    id: 'conv-1',
    workspaceId: 'workspace-default',
    type: 'channel',
    name: '星球A指挥部',
    topic: '协调建设',
    memberIds: ['player:p1', 'agent:agent-director'],
    createdByType: 'player',
    createdById: 'p1',
    createdAt: NOW,
    updatedAt: NOW,
  });

  await stores.messageStore.append({
    id: 'msg-1',
    conversationId: 'conv-1',
    senderType: 'player',
    senderId: 'p1',
    kind: 'chat',
    content: '@总管 检查星球A电力',
    mentions: [{ type: 'agent', id: 'agent-director' }],
    trigger: 'player_message',
    createdAt: NOW,
  });

  await stores.scheduleStore.save({
    id: 'schedule-1',
    workspaceId: 'workspace-default',
    name: 'A星巡检',
    creatorType: 'player',
    creatorId: 'p1',
    targetType: 'conversation',
    targetId: 'conv-1',
    intervalSeconds: 300,
    messageTemplate: '@总管 每5分钟检查一次星球A',
    enabled: true,
    nextRunAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });

  assert.equal((await stores.conversationStore.list()).length, 1);
  assert.equal((await stores.messageStore.listByConversation('conv-1')).length, 1);
  assert.equal((await stores.scheduleStore.list()).length, 1);
  assert.equal((await stores.agentStore.get('agent-director'))?.policy.commandCategories[0], 'observe');
});
```

- [ ] **Step 2: 运行存储测试，确认按缺少 store/type 失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/store/store.test.ts
```

Expected: FAIL，报错缺少会话、消息、schedule store 或类型字段不匹配。

- [ ] **Step 3: 最小实现类型与 store**

```ts
export interface ConversationStore {
  list(): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
}

export interface MessageStore {
  listByConversation(conversationId: string): Promise<ConversationMessage[]>;
  append(message: ConversationMessage): Promise<void>;
}

export interface ScheduleStore {
  list(): Promise<ScheduleJob[]>;
  get(id: string): Promise<ScheduleJob | null>;
  save(job: ScheduleJob): Promise<void>;
}
```

- [ ] **Step 4: 重跑存储测试，确认转绿**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/store/store.test.ts
```

Expected: PASS。

### Task 2: 新增会话、成员、消息与任务 HTTP 接口

**Files:**
- Create: `agent-gateway/src/routes/conversations.ts`
- Create: `agent-gateway/src/routes/schedules.ts`
- Modify: `agent-gateway/src/routes/agents.ts`
- Modify: `agent-gateway/src/server.ts`
- Test: `agent-gateway/src/server.test.ts`

- [ ] **Step 1: 先写 HTTP 失败测试**

```ts
it('creates a channel, invites by planet, posts a message, and manages schedules', async () => {
  const server = await createTestGatewayServer();

  const createChannel = await fetch(`${server.url}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'channel',
      name: '星球A协作',
      topic: '协调建设',
      createdByType: 'player',
      createdById: 'p1',
      memberIds: ['player:p1'],
    }),
  });
  assert.equal(createChannel.status, 201);

  const inviteByPlanet = await fetch(`${server.url}/conversations/conv-1/members:invite-by-planet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actorType: 'player',
      actorId: 'p1',
      planetId: 'planet-a',
    }),
  });
  assert.equal(inviteByPlanet.status, 200);

  const postMessage = await fetch(`${server.url}/conversations/conv-1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      senderType: 'player',
      senderId: 'p1',
      content: '@agent-a 检查产线',
    }),
  });
  assert.equal(postMessage.status, 202);

  const createSchedule = await fetch(`${server.url}/schedules`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      creatorType: 'player',
      creatorId: 'p1',
      targetType: 'conversation',
      targetId: 'conv-1',
      intervalSeconds: 300,
      messageTemplate: '@agent-a 每5分钟汇报一次',
    }),
  });
  assert.equal(createSchedule.status, 201);
});
```

- [ ] **Step 2: 运行 HTTP 测试，确认缺少路由而失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/server.test.ts
```

Expected: FAIL，出现 `404` 或路由未注册错误。

- [ ] **Step 3: 最小实现接口与权限入口**

```ts
if (request.method === 'POST' && url.pathname === '/conversations') {
  return createConversation(request, response, context);
}

if (request.method === 'POST' && url.pathname.match(/^\/conversations\/[^/]+\/messages$/)) {
  return postConversationMessage(request, response, context);
}

if (request.method === 'POST' && url.pathname.match(/^\/conversations\/[^/]+\/members:invite-by-planet$/)) {
  return inviteConversationMembersByPlanet(request, response, context);
}

if (request.method === 'POST' && url.pathname === '/schedules') {
  return createSchedule(request, response, context);
}
```

- [ ] **Step 4: 重跑 HTTP 测试，确认接口可用**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/server.test.ts
```

Expected: PASS。

### Task 3: 实现 `@` 路由、mailbox、runner 与定时调度

**Files:**
- Create: `agent-gateway/src/runtime/router.ts`
- Create: `agent-gateway/src/runtime/policy.ts`
- Create: `agent-gateway/src/runtime/scheduler.ts`
- Modify: `agent-gateway/src/runtime/loop.ts`
- Modify: `agent-gateway/src/runtime/events.ts`
- Test: `agent-gateway/src/runtime/loop.test.ts`

- [ ] **Step 1: 先写自动唤醒与权限失败测试**

```ts
it('queues mentioned agents, rejects unauthorized dm targets, and serializes runner execution', async () => {
  const runtime = createTestRuntime({
    agents: [
      makeAgent('director', {
        canDispatchAgentIds: ['worker-a'],
        canDirectMessageAgentIds: ['worker-a'],
      }),
      makeAgent('worker-a'),
    ],
  });

  await runtime.postMessage({
    conversationId: 'conv-1',
    senderType: 'player',
    senderId: 'p1',
    content: '@worker-a 检查星球A电力',
  });

  assert.deepEqual(runtime.mailboxFor('worker-a'), ['msg-1']);

  await assert.rejects(() => runtime.postDm({
    senderType: 'agent',
    senderId: 'worker-a',
    targetAgentId: 'director',
    content: '我来指挥你',
  }), /dm_not_allowed/);

  await runtime.startRunner('worker-a');
  assert.equal(runtime.statusOf('worker-a'), 'running');
});

it('dispatches enabled schedules as conversation messages', async () => {
  const scheduler = createSchedulerForTest();
  await scheduler.tick('2026-04-03T12:00:00.000Z');
  assert.equal(scheduler.dispatchedMessages()[0]?.trigger, 'schedule_message');
});
```

- [ ] **Step 2: 运行 loop 测试，确认因缺少 router/policy/scheduler 失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/runtime/loop.test.ts
```

Expected: FAIL，报 `router`、`scheduler` 或权限校验缺失。

- [ ] **Step 3: 最小实现路由与 runner 串行执行**

```ts
export function resolveMentionTargets(message: ConversationMessage, members: ConversationMember[]) {
  const memberAgentIds = new Set(
    members.filter((member) => member.participantType === 'agent').map((member) => member.participantId),
  );
  return message.mentions.filter((mention) => memberAgentIds.has(mention.id)).map((mention) => mention.id);
}

export async function enqueueAndRun(agentId: string) {
  if (runnerState.get(agentId) === 'running') {
    return;
  }
  runnerState.set(agentId, 'running');
  try {
    await runAgentLoop(/* mailbox-driven context */);
  } finally {
    runnerState.set(agentId, 'idle');
  }
}
```

- [ ] **Step 4: 重跑 loop 测试，确认自动唤醒和 schedule 生效**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/runtime/loop.test.ts
```

Expected: PASS。

### Task 4: 为 CLI 增加命令类别和硬限制校验

**Files:**
- Modify: `client-cli/src/command-catalog.ts`
- Modify: `client-cli/src/runtime.ts`
- Test: `client-cli/src/runtime.test.ts`

- [ ] **Step 1: 先写命令类别失败测试**

```ts
it('rejects commands outside allowed categories for agent runtime', async () => {
  await assert.rejects(() => runCommandLine('attack unit-1 enemy-1', {
    currentPlayer: 'p1',
    serverUrl: 'http://127.0.0.1:18081',
    playerKey: 'key_player_1',
  }, {
    allowedCategories: ['observe'],
  }), /command category not allowed/);
});
```

- [ ] **Step 2: 运行 CLI 测试，确认因缺少类别映射失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-cli
npm test -- --runInBand src/runtime.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 最小实现命令类别目录**

```ts
export const AGENT_COMMAND_CATALOG = {
  summary: { category: 'observe' },
  stats: { category: 'observe' },
  build: { category: 'build' },
  move: { category: 'combat' },
  attack: { category: 'combat' },
  start_research: { category: 'research' },
  save: { category: 'management' },
} as const;
```

- [ ] **Step 4: 重跑 CLI 测试，确认限制生效**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-cli
npm test -- --runInBand src/runtime.test.ts
```

Expected: PASS。

### Task 5: 重写 `/agents` 为 IM 风格工作台

**Files:**
- Modify: `client-web/src/features/agents/types.ts`
- Modify: `client-web/src/features/agents/api.ts`
- Modify: `client-web/src/features/agents/use-agent-events.ts`
- Modify: `client-web/src/features/agents/AgentWorkspace.tsx`
- Modify: `client-web/src/pages/AgentsPage.tsx`
- Modify: `client-web/src/styles/index.css`
- Test: `client-web/src/pages/AgentsPage.test.tsx`

- [ ] **Step 1: 先写页面失败测试**

```tsx
it('renders conversations, messages, and policy sidebar in IM layout', async () => {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/agent-api/health')) return Promise.resolve(jsonResponse({ status: 'ok' }));
    if (url.endsWith('/agent-api/workspace')) return Promise.resolve(jsonResponse({ id: 'workspace-default', name: '本地工作区' }));
    if (url.endsWith('/agent-api/conversations')) return Promise.resolve(jsonResponse([
      { id: 'conv-1', type: 'channel', name: '星球A协作', unreadCount: 2 },
    ]));
    if (url.endsWith('/agent-api/agents')) return Promise.resolve(jsonResponse([
      { id: 'agent-a', name: '建造官', status: 'running', policy: { planetIds: ['planet-a'], commandCategories: ['build'] } },
    ]));
    if (url.endsWith('/agent-api/conversations/conv-1/messages')) return Promise.resolve(jsonResponse([
      { id: 'msg-1', senderType: 'player', senderId: 'p1', kind: 'chat', content: '@建造官 检查产线', createdAt: NOW },
    ]));
    return Promise.reject(new Error(`unexpected url ${url}`));
  }));

  renderApp(['/agents']);

  expect(await screen.findByRole('heading', { name: '智能体协作台' })).toBeInTheDocument();
  expect(screen.getByText('星球A协作')).toBeInTheDocument();
  expect(screen.getByText('@建造官 检查产线')).toBeInTheDocument();
  expect(screen.getByText('build')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行页面测试，确认按旧 UI 失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- AgentsPage
```

Expected: FAIL，标题、接口或布局不匹配。

- [ ] **Step 3: 最小实现 IM 工作台骨架**

```tsx
return (
  <div className="agent-im-workspace">
    <aside className="agent-im-sidebar">{/* conversations / dms / agents */}</aside>
    <main className="agent-im-thread">{/* message stream + composer */}</main>
    <section className="agent-im-details">{/* members / policy / schedules */}</section>
  </div>
);
```

- [ ] **Step 4: 重跑页面测试，确认工作台与右栏摘要可见**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- AgentsPage
```

Expected: PASS。

### Task 6: 更新文档并做端到端验证

**Files:**
- Modify: `docs/dev/client-web.md`
- Modify: `docs/dev/agent-gateway.md`

- [ ] **Step 1: 更新开发文档**

```md
- `/agents` 现为 IM 风格协作台，支持频道、私聊、`@`、按星球拉人和定时任务。
- `agent-gateway` 新增 conversations / schedules / policy 相关接口与本地持久化目录。
```

- [ ] **Step 2: 运行自动化验证**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/**/*.test.ts

cd /home/firesuiry/develop/siliconWorld/client-cli
npm test -- --runInBand src/runtime.test.ts

cd /home/firesuiry/develop/siliconWorld/client-web
npm test
```

Expected: 全部 PASS。

- [ ] **Step 3: 做浏览器验证**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go run ./cmd/server -config config-dev.yaml -map-config map.yaml

cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm run dev

cd /home/firesuiry/develop/siliconWorld/client-web
npm run dev
```

Expected:

- `/agents` 为 IM 风格布局
- 可创建频道
- 可按星球拉人
- `@` 后目标 Agent 自动进入运行态并回复
- 定时任务能周期性投递消息

## Self-Review

- Spec coverage:
  - IM 工作台布局：Task 5
  - 频道/私聊/成员模型：Task 1, Task 2
  - `@` 自动唤醒与 mailbox：Task 3
  - 运行时命令类别硬限制：Task 4
  - 定时任务：Task 1, Task 2, Task 3
  - 文档与浏览器验证：Task 6
- Placeholder scan: 无 `TODO`、`TBD`、`类似 Task N` 之类占位描述。
- Type consistency:
  - 后端统一使用 `Conversation`、`ConversationMessage`、`ScheduleJob`、`AgentPolicy`
  - 前端同样围绕 `conversation / message / policy / schedule` 组织，避免继续混用旧 `thread` 概念

Plan complete and saved to `docs/superpowers/plans/2026-04-03-agent-im-collaboration.md`.
