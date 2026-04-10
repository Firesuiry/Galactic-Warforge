# Case1 Agent Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让案例 1 中的李斯能真实创建胡景并把建矿场任务委派给胡景，同时补齐 CLI 与 Web 入口并完成回归测试。

**Architecture:** 在 `agent-gateway` 增加显式 runtime action 与权限校验，保持协作逻辑留在 gateway；`client-cli` 新增最小 agent-gateway 管理命令；`client-web` 补权限配置与浏览器案例测试。

**Tech Stack:** TypeScript, Node.js HTTP server, React, Vitest, node:test, Playwright

---

### Task 1: 先写失败测试，锁定 gateway action 与案例 1 行为

**Files:**
- Modify: `agent-gateway/src/runtime/loop.test.ts`
- Modify: `agent-gateway/src/server.test.ts`

- [ ] **Step 1: 为 `runAgentLoop` 新 action 写失败测试**

```ts
it('executes gateway agent/conversation actions and records tool output', async () => {
  const calls: string[] = [];
  const result = await runAgentLoop({
    maxSteps: 2,
    provider: {
      async runTurn(input) {
        if (input.step === 0) {
          return {
            assistantMessage: '我先创建胡景并委派。',
            actions: [
              { type: 'agent.create', name: '胡景', role: 'worker' },
              { type: 'conversation.ensure_dm', targetAgentId: 'agent-hujing' },
              { type: 'conversation.send_message', conversationId: 'conv-dm', content: '去新建一个矿场' },
            ],
            done: false,
          };
        }
        return {
          assistantMessage: '已完成。',
          actions: [{ type: 'final_answer', message: '已完成。' }],
          done: true,
        };
      },
    },
    cliRuntime: { async run() { return 'ok'; } },
    gatewayRuntime: {
      async createAgent() { calls.push('create'); return 'agent-created'; },
      async ensureDirectConversation() { calls.push('ensure_dm'); return 'conv-dm'; },
      async sendConversationMessage() { calls.push('send_message'); return 'message-sent'; },
      async updateAgent() { return 'updated'; },
    },
    initialContext: { goal: '创建胡景并委派建矿场' },
  });
  assert.deepEqual(calls, ['create', 'ensure_dm', 'send_message']);
  assert.equal(result.finalMessage, '已完成。');
});
```

- [ ] **Step 2: 运行 loop 测试确认失败**

Run: `cd /home/firesuiry/develop/siliconWorld/agent-gateway && node --import tsx --test src/runtime/loop.test.ts`
Expected: FAIL，提示 `gatewayRuntime` 或新 action 类型未实现

- [ ] **Step 3: 为案例 1 写 gateway 集成失败测试**

```ts
it('supports case1 delegation: lisi creates hujing and dispatches mining construction', async () => {
  // 启动 createGatewayServer，注入 deterministic agentTurnRunner
  // 第一次李斯 turn 返回 agent.create
  // 第二次李斯 turn 返回 ensure_dm + send_message
  // 胡景 turn 返回 game.cli build
  // 断言最终 agent 列表里存在胡景，且胡景权限只有 build
  // 断言消息流里出现李斯委派消息
});
```

- [ ] **Step 4: 运行 gateway 集成测试确认失败**

Run: `cd /home/firesuiry/develop/siliconWorld/agent-gateway && node --import tsx --test src/server.test.ts`
Expected: FAIL，提示缺少创建权限能力或委派 action

### Task 2: 实现 gateway runtime action 与权限校验

**Files:**
- Modify: `agent-gateway/src/types.ts`
- Modify: `agent-gateway/src/runtime/action-schema.ts`
- Modify: `agent-gateway/src/runtime/loop.ts`
- Modify: `agent-gateway/src/runtime/turn.ts`
- Modify: `agent-gateway/src/server.ts`

- [ ] **Step 1: 扩展类型与 schema**

```ts
export interface AgentPolicy {
  planetIds: string[];
  commandCategories: string[];
  canCreateAgents: boolean;
  canCreateChannel: boolean;
  canManageMembers: boolean;
  canInviteByPlanet: boolean;
  canCreateSchedules: boolean;
  canDirectMessageAgentIds: string[];
  canDispatchAgentIds: string[];
}
```

```ts
enum: [
  'game.query',
  'game.command',
  'game.cli',
  'memory.note',
  'final_answer',
  'agent.create',
  'agent.update',
  'conversation.ensure_dm',
  'conversation.send_message',
]
```

- [ ] **Step 2: 让 `runAgentLoop` 支持 gatewayRuntime**

```ts
gatewayRuntime?: {
  createAgent?: (action: Record<string, unknown>) => Promise<string>;
  updateAgent?: (action: Record<string, unknown>) => Promise<string>;
  ensureDirectConversation?: (action: Record<string, unknown>) => Promise<string>;
  sendConversationMessage?: (action: Record<string, unknown>) => Promise<string>;
}
```

- [ ] **Step 3: 在 `server.ts` 实现 action 执行器**

```ts
async function createManagedAgent(actor: AgentInstance, action: Record<string, unknown>) { /* 校验 canCreateAgents + role + policy 子集 */ }
async function updateManagedAgent(actor: AgentInstance, action: Record<string, unknown>) { /* 只允许自己或下级 */ }
async function ensureAgentDm(actor: AgentInstance, targetAgentId: string) { /* 只允许下级或 policy 白名单 */ }
async function sendAgentConversationMessage(actor: AgentInstance, conversationId: string, content: string) { /* 写 messageStore 并触发 mailbox */ }
```

- [ ] **Step 4: 给 provider prompt 增加 action 说明**

```ts
contextSections: [
  `当前会话：${conversation.name}`,
  `当前智能体：${agent.name}`,
  '可用 action: agent.create / agent.update / conversation.ensure_dm / conversation.send_message / game.cli',
]
```

- [ ] **Step 5: 跑 Task 1 的测试直到通过**

Run: `cd /home/firesuiry/develop/siliconWorld/agent-gateway && node --import tsx --test src/runtime/loop.test.ts src/server.test.ts`
Expected: PASS

### Task 3: 补齐 client-cli 的 agent-gateway 最小命令

**Files:**
- Modify: `client-cli/src/config.ts`
- Add: `client-cli/src/agent-api.ts`
- Modify: `client-cli/src/commands/index.ts`
- Modify: `client-cli/src/commands/action.ts`
- Modify: `client-cli/src/commands/index.test.ts`
- Add: `client-cli/src/agent-api.test.ts`

- [ ] **Step 1: 先写 CLI API 与命令失败测试**

```ts
await createAgentProfile({ name: '李斯', providerId: 'provider-case1', ... });
await updateAgentProfile('agent-lisi', { policy: { canCreateAgents: true, commandCategories: ['observe', 'build', 'management', 'research', 'combat'] } });
await sendAgentMessage('agent-lisi', '创建胡景并赋予建筑权限');
```

- [ ] **Step 2: 运行 client-cli 测试确认失败**

Run: `cd /home/firesuiry/develop/siliconWorld/client-cli && npm test -- --runInBand`
Expected: FAIL，提示缺少 agent-api 客户端或命令注册

- [ ] **Step 3: 实现 agent-gateway API 与命令**

```ts
export const AGENT_GATEWAY_URL = process.env.SW_AGENT_GATEWAY ?? 'http://127.0.0.1:18180';
```

```ts
agent_list
agent_create <name> --provider <provider_id> [--role <worker|manager|director>]
agent_update <agent_id> [--can-create-agents <true|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>]
agent_message <agent_id> <content...>
agent_thread <agent_id>
```

- [ ] **Step 4: 跑 client-cli 测试直到通过**

Run: `cd /home/firesuiry/develop/siliconWorld/client-cli && npm test -- --runInBand`
Expected: PASS

### Task 4: 补齐 client-web 权限配置与浏览器案例测试

**Files:**
- Modify: `client-web/src/features/agents/types.ts`
- Modify: `client-web/src/features/agents/MemberWorkspaceView.tsx`
- Modify: `client-web/src/pages/AgentsPage.tsx`
- Modify: `client-web/tests/agent-platform.spec.ts`
- Modify: `client-web/src/features/agents/api.test.ts`

- [ ] **Step 1: 为 Web 权限新增字段写失败测试**

```ts
expect(JSON.parse(String(init?.body))).toEqual({
  policy: expect.objectContaining({
    canCreateAgents: true,
  }),
});
```

- [ ] **Step 2: 为 Playwright 案例 1 写失败测试**

```ts
test('案例1：浏览器中李斯创建胡景并委派建矿场', async ({ page }) => {
  // 打开 /agents
  // 配置李斯 canCreateAgents
  // 给李斯发两条消息
  // 断言消息流出现胡景与建矿场结果
});
```

- [ ] **Step 3: 运行 web 测试确认失败**

Run: `cd /home/firesuiry/develop/siliconWorld/client-web && npm test`
Expected: FAIL，提示缺少 canCreateAgents 或案例流程未实现

- [ ] **Step 4: 实现 Web 配置字段并修正测试**

```tsx
<label className="agent-form__checkbox">
  <input
    aria-label="允许创建智能体"
    checked={canCreateAgents}
    onChange={(event) => setCanCreateAgents(event.target.checked)}
    type="checkbox"
  />
  <span>允许创建智能体</span>
</label>
```

- [ ] **Step 5: 跑 web 单测与 Playwright 直到通过**

Run: `cd /home/firesuiry/develop/siliconWorld/client-web && npm test && npx playwright test tests/agent-platform.spec.ts`
Expected: PASS

### Task 5: 同步文档并完成 CLI / Web 验证

**Files:**
- Modify: `docs/dev/agent-gateway.md`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/case/case1.md`

- [ ] **Step 1: 更新文档**

```md
- Agent policy 新增 `canCreateAgents`
- runtime action 新增 `agent.create / agent.update / conversation.ensure_dm / conversation.send_message`
- CLI 新增 `agent_list / agent_create / agent_update / agent_message / agent_thread`
```

- [ ] **Step 2: 运行 agent-gateway、client-cli、client-web 全部测试**

Run: `cd /home/firesuiry/develop/siliconWorld/agent-gateway && node --import tsx --test src/**/*.test.ts`
Expected: PASS

Run: `cd /home/firesuiry/develop/siliconWorld/client-cli && npm test -- --runInBand`
Expected: PASS

Run: `cd /home/firesuiry/develop/siliconWorld/client-web && npm test && npx playwright test tests/agent-platform.spec.ts`
Expected: PASS

- [ ] **Step 3: 做真实案例验证**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./...`
Expected: PASS

Run: 用 CLI 执行案例 1，确认能看到李斯创建胡景并委派建造。
Expected: CLI 输出中可看到胡景出现，以及建造命令执行结果。

Run: 启动 `agent-gateway` 与 `client-web`，通过 Playwright 浏览器脚本打开 `/agents` 实际执行案例 1。
Expected: 浏览器消息流中能看到李斯创建胡景、再委派胡景建矿场。
