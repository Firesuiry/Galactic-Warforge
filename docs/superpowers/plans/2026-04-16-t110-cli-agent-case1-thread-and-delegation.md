# T110 CLI Agent Case1 Thread And Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `agent_message` 直连线程入口，让李斯能真实创建胡景并委派建矿，同时让 `agent_thread` 暴露真实执行证据与失败原因。

**Architecture:** 保持现有 `agent-gateway` 直连线程入口，不新增兼容层。在线程模型中补齐最近一次 turn 元数据，并把 `agent.create / conversation.ensure_dm / conversation.send_message` 的 tool 结果像 `game.command` 一样持久化到 thread，使后续 turn 能复用真实上下文。

**Tech Stack:** TypeScript, Node.js test runner, `agent-gateway`, `client-cli`

---

### Task 1: 覆盖直连线程上下文与观测缺口

**Files:**
- Modify: `agent-gateway/src/server.test.ts`
- Modify: `client-cli/src/agent-api.test.ts`

- [ ] **Step 1: 写失败测试，证明 gateway 动作结果不会持久化到 thread**

```ts
it('persists agent.create and delegation tool results into agent thread history', async () => {
  // 第一次消息创建胡景，第二次消息只有在 history 含 tool 结果时才会继续 ensure_dm + send_message
  // 断言 thread.messages / toolCalls 中出现 agent.create 与 conversation.send_message 证据
});
```

- [ ] **Step 2: 运行失败测试，确认当前行为缺失**

Run: `npm test -- --test-name-pattern="persists agent.create and delegation tool results into agent thread history" agent-gateway/src/server.test.ts`
Expected: FAIL，thread 中缺少 gateway 动作工具结果或第二条委派消息未落地。

- [ ] **Step 3: 写失败测试，证明 agent_thread 不暴露最后一次 turn 失败元数据**

```ts
assert.equal(thread.lastTurn?.errorCode, 'provider_incomplete_execution');
assert.equal(thread.lastTurn?.executedActionCount, 0);
```

- [ ] **Step 4: 运行失败测试，确认 thread 输出缺字段**

Run: `npm test -- --test-name-pattern="exposes last turn failure details in agent thread" agent-gateway/src/server.test.ts client-cli/src/agent-api.test.ts`
Expected: FAIL，API 类型或返回结构不包含 `lastTurn`。

### Task 2: 在线程模型中持久化 gateway 动作与最后一次 turn

**Files:**
- Modify: `agent-gateway/src/types.ts`
- Modify: `agent-gateway/src/routes/agents.ts`

- [ ] **Step 1: 为 AgentThread 增加最近一次 turn 摘要字段**

```ts
lastTurn?: {
  status: 'running' | 'completed' | 'failed';
  outcomeKind?: 'reply_only' | 'observed' | 'acted' | 'delegated' | 'blocked';
  executedActionCount: number;
  repairCount: number;
  errorCode?: string;
  errorMessage?: string;
  rawErrorMessage?: string;
  finalMessage?: string;
};
```

- [ ] **Step 2: 把 gateway 动作执行结果与日志写入 thread**

```ts
thread.toolCalls.push({ type: action.type, payload: { action, output } });
thread.executionLogs.push({ level: 'info', message: `${action.type} ${output}`, createdAt: now });
thread.messages.push({ role: 'tool', content: output, createdAt: now });
```

- [ ] **Step 3: 在直连线程路由中更新 lastTurn 状态**

```ts
thread.lastTurn = {
  status: 'completed',
  outcomeKind: result.outcomeKind,
  executedActionCount: result.executedActionCount,
  repairCount: result.repairCount,
  finalMessage: result.finalMessage,
};
```

- [ ] **Step 4: 在失败路径写入 errorCode / rawErrorMessage**

```ts
thread.lastTurn = {
  status: 'failed',
  outcomeKind: 'blocked',
  executedActionCount: 0,
  repairCount: 0,
  errorCode: publicError.code,
  errorMessage: publicError.message,
  rawErrorMessage: publicError.rawMessage,
};
```

### Task 3: CLI 展示与文档同步

**Files:**
- Modify: `client-cli/src/agent-api.ts`
- Modify: `client-cli/src/commands/agent.ts`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/dev/agent-gateway.md`

- [ ] **Step 1: 扩展 `AgentThreadView` 类型并在 `agent_thread` 输出最后一次 turn 摘要**

```ts
if (thread.lastTurn) {
  lines.push(`Last turn: ${thread.lastTurn.status}`);
  lines.push(`Executed actions: ${thread.lastTurn.executedActionCount}`);
}
```

- [ ] **Step 2: 更新文档，声明 `agent_thread` 会显示失败码、失败原因和真实 tool 证据**

```md
- `agent_thread` 现在会显示最近一次 turn 的状态、错误码、执行动作数，以及 thread 中的 tool call / execution log。
```

### Task 4: 完整验证

**Files:**
- Modify: `docs/process/running_task/T110_2026-04-15_CLI案例1李斯无法真实创建胡景并委派建矿.md`

- [ ] **Step 1: 运行新增与相关回归测试**

Run: `cd agent-gateway && npm test -- src/server.test.ts src/runtime/loop.test.ts`
Expected: PASS

Run: `cd client-cli && npm test -- src/case1.test.ts src/agent-api.test.ts src/commands/index.test.ts`
Expected: PASS

- [ ] **Step 2: 回填任务完成情况并移动到 finished_task**

```md
## 完成情况
- 已修复 ...
- 已验证 ...
```

- [ ] **Step 3: 提交并推送**

```bash
git add agent-gateway client-cli docs/process/running_task/T110_2026-04-15_CLI案例1李斯无法真实创建胡景并委派建矿.md docs/dev/客户端CLI.md docs/dev/agent-gateway.md docs/superpowers/plans/2026-04-16-t110-cli-agent-case1-thread-and-delegation.md
git commit -m "fix: persist direct agent thread execution context"
git push origin main
```
