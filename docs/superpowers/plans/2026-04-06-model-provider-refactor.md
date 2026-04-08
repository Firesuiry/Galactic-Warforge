# Model Provider Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把智能体平台中的“模板”彻底重构为“模型 Provider”，为 API 模式补充 `API URL`、`接口类型(openai/claude)`、`模型名称` 配置，并允许在成员详情页切换绑定的 Provider。

**Architecture:** 后端把 `template/templateId/templates` 统一改为 `provider/providerId/providers`，并把原来的 `openai_compatible_http` 提升为通用 `http_api` Provider，配置中显式区分 `apiStyle=openai|claude`。前端同步重命名 UI 文案、类型和接口调用；成员详情页新增 Provider 切换并直接通过 `PATCH /agents/:id` 保存。

**Tech Stack:** TypeScript, Node.js HTTP server, React, TanStack Query, Vitest, Playwright

---

### Task 1: 后端 Provider 模型与 HTTP API 结构重构

**Files:**
- Modify: `agent-gateway/src/types.ts`
- Modify: `agent-gateway/src/runtime/turn.ts`
- Modify: `agent-gateway/src/providers/openai-compatible.ts`
- Test: `agent-gateway/src/providers/providers.test.ts`

- [ ] **Step 1: 写失败测试，锁定新 HTTP API 配置结构**

在 `agent-gateway/src/providers/providers.test.ts` 增加两个测试：
- `parses claude style api responses`
- `supports http_api provider config with apiStyle`

测试样例要覆盖：
```ts
const config = {
  apiUrl: 'https://api.example.com',
  apiStyle: 'claude',
  model: 'claude-sonnet-4-5',
};
```
以及 Claude 风格响应：
```json
{
  "content": [
    { "type": "text", "text": "{\"assistantMessage\":\"收到\",\"actions\":[],\"done\":true}" }
  ]
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/providers/providers.test.ts
```

Expected:
- 至少有关于 `http_api` / `claude` 风格缺失的失败

- [ ] **Step 3: 写最小实现**

在 `agent-gateway/src/types.ts`：
- 把 `openai_compatible_http` 改为 `http_api`
- 把 `OpenAICompatibleProviderConfig` 改成：
```ts
export interface HttpApiProviderConfig {
  apiUrl: string;
  apiStyle: 'openai' | 'claude';
  apiKeySecretId: string;
  model: string;
  extraHeaders?: Record<string, string>;
}
```

在 `agent-gateway/src/providers/openai-compatible.ts`：
- 保留文件名也可以，但实现改成通用 HTTP API provider
- `apiStyle === 'openai'` 时发：
  - `POST ${apiUrl}/chat/completions`
  - Bearer token
  - `messages + response_format`
- `apiStyle === 'claude'` 时发：
  - `POST ${apiUrl}/messages`
  - `x-api-key`
  - `anthropic-version: 2023-06-01`
  - `system + messages + max_tokens`
- 统一提取文本后继续走 `parseProviderResult()`

在 `agent-gateway/src/runtime/turn.ts`：
- 把 `openai_compatible_http` 分支改成 `http_api`
- 读取新字段 `apiUrl/apiStyle`

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/providers/providers.test.ts
```

Expected:
- `providers.test.ts` 全绿

- [ ] **Step 5: Commit**

```bash
git add agent-gateway/src/types.ts agent-gateway/src/runtime/turn.ts agent-gateway/src/providers/openai-compatible.ts agent-gateway/src/providers/providers.test.ts
git commit -m "refactor: support model providers and http api styles"
```

### Task 2: 后端路由与存储从 template 重命名为 provider

**Files:**
- Modify: `agent-gateway/src/server.ts`
- Modify: `agent-gateway/src/routes/templates.ts`
- Modify: `agent-gateway/src/routes/agents.ts`
- Modify: `agent-gateway/src/bootstrap/minimax.ts`
- Modify: `agent-gateway/src/store/template-store.ts`
- Test: `agent-gateway/src/server.test.ts`
- Test: `agent-gateway/src/bootstrap/minimax.test.ts`

- [ ] **Step 1: 写失败测试，锁定 providers 路由和成员 providerId**

在 `agent-gateway/src/server.test.ts`：
- 把现有 `/templates` 相关断言改为 `/providers`
- 把 `templateId` 改为 `providerId`
- 增加成员 `PATCH /agents/:id` 可更新 `providerId`

在 `agent-gateway/src/bootstrap/minimax.test.ts`：
- 断言内置 Provider 保存到 `providers` 存储语义，并且 `providerKind === 'http_api'`

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/server.test.ts src/bootstrap/minimax.test.ts
```

Expected:
- 路由名或字段名不匹配导致失败

- [ ] **Step 3: 写最小实现**

在这些文件里统一改名：
- `AgentTemplate` -> `ModelProvider`
- `templateId` -> `providerId`
- `/templates` -> `/providers`
- `templateStore` -> `providerStore`
- `data/templates` -> `data/providers`

同时更新 `bootstrap/minimax.ts`：
- 生成内置 Provider `builtin-minimax-api`
- `providerKind: 'http_api'`
- `apiStyle: 'openai'`
- `apiUrl: 'https://api.minimaxi.com/v1'`

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/server.test.ts src/bootstrap/minimax.test.ts
```

Expected:
- 两个测试文件全绿

- [ ] **Step 5: Commit**

```bash
git add agent-gateway/src/server.ts agent-gateway/src/routes/templates.ts agent-gateway/src/routes/agents.ts agent-gateway/src/bootstrap/minimax.ts agent-gateway/src/store/template-store.ts agent-gateway/src/server.test.ts agent-gateway/src/bootstrap/minimax.test.ts
git commit -m "refactor: rename templates to model providers"
```

### Task 3: 前端把“模板”改成“模型 Provider”，并补成员切换入口

**Files:**
- Modify: `client-web/src/features/agents/types.ts`
- Modify: `client-web/src/features/agents/api.ts`
- Modify: `client-web/src/features/agents/TemplateManagerView.tsx`
- Modify: `client-web/src/features/agents/MemberWorkspaceView.tsx`
- Modify: `client-web/src/features/agents/AgentWorkspace.tsx`
- Modify: `client-web/src/pages/AgentsPage.tsx`
- Test: `client-web/src/pages/AgentsPage.test.tsx`
- Test: `client-web/tests/agent-platform.spec.ts`

- [ ] **Step 1: 写失败测试，锁定 UI 名称和 Provider 切换**

在 `client-web/src/pages/AgentsPage.test.tsx` 增加或改造测试：
- “新建模型 Provider 时 API 模式支持 `API URL / 接口类型 / 模型名称`”
- “成员详情页可以切换绑定 Provider 并触发 `PATCH /agent-api/agents/:id`”
- 所有用户可见文案使用“模型 Provider”，不再出现“模板”

在 `client-web/tests/agent-platform.spec.ts`：
- 覆盖 API 模式下的 `openai` / `claude` 选择控件可见
- 覆盖成员详情页切换绑定 Provider

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npx vitest run src/pages/AgentsPage.test.tsx
npx playwright test tests/agent-platform.spec.ts
```

Expected:
- 因文案、字段或交互不存在而失败

- [ ] **Step 3: 写最小实现**

前端统一改名：
- UI 文案：`模板` -> `模型 Provider`
- 类型：`AgentTemplateView` -> `ModelProviderView`
- API：`fetchTemplates/createTemplate` -> `fetchProviders/createProvider`
- 成员字段：`templateId` -> `providerId`

在 `TemplateManagerView.tsx`：
- API 模式表单字段改为：
  - `API URL`
  - `接口类型`
  - `模型名称`
  - `API Key`
- `接口类型` 下拉值：
```ts
<option value="openai">OpenAI</option>
<option value="claude">Claude</option>
```

在 `MemberWorkspaceView.tsx`：
- 详情页增加 `绑定模型 Provider` 下拉框
- 保存时调用 `onSaveAgentProvider(providerId)`

在 `AgentsPage.tsx`：
- `updateAgentMutation` 同时支持 `providerId` 更新

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npx vitest run src/pages/AgentsPage.test.tsx
npx playwright test tests/agent-platform.spec.ts
```

Expected:
- 两套测试全绿

- [ ] **Step 5: Commit**

```bash
git add client-web/src/features/agents/types.ts client-web/src/features/agents/api.ts client-web/src/features/agents/TemplateManagerView.tsx client-web/src/features/agents/MemberWorkspaceView.tsx client-web/src/features/agents/AgentWorkspace.tsx client-web/src/pages/AgentsPage.tsx client-web/src/pages/AgentsPage.test.tsx client-web/tests/agent-platform.spec.ts
git commit -m "refactor: rename templates to model providers in agent ui"
```

### Task 4: 文档与全量回归

**Files:**
- Modify: `docs/dev/agent-gateway.md`
- Modify: `docs/dev/本地试玩环境启动.md`

- [ ] **Step 1: 更新文档**

文档中统一替换：
- `模板` -> `模型 Provider`
- `/templates` -> `/providers`
- 记录 API 模式新增字段：
  - `API URL`
  - `接口类型`
  - `模型名称`

- [ ] **Step 2: 跑全量回归**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm test

cd /home/firesuiry/develop/siliconWorld/client-web
npm test
npx playwright test tests/agent-platform.spec.ts
```

Expected:
- 全部通过

- [ ] **Step 3: 真实联调**

Run:
```bash
cd /home/firesuiry/develop/siliconWorld
bash scripts/start-local-playtest.sh
curl http://127.0.0.1:18180/providers
curl http://127.0.0.1:5173/agent-api/health
```

Expected:
- `/providers` 返回可用 Provider 列表
- Web 代理健康检查通过

- [ ] **Step 4: Commit**

```bash
git add docs/dev/agent-gateway.md docs/dev/本地试玩环境启动.md
git commit -m "docs: update model provider terminology"
```
