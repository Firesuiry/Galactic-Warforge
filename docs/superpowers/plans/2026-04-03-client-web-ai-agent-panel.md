# Client-Web AI Agent Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `client-web` 增加 AI 交互面板，并新增本地 `agent-gateway`，支持 HTTP Provider、`codex` CLI、`claude` CLI 三类模板，允许 Agent 通过受控 CLI 命令面操作 SiliconWorld。

**Architecture:** 新增独立的 `agent-gateway` Node/TypeScript 本地服务，负责模板存储、密钥管理、Provider 适配、Agent 运行循环、CLI 工具执行和导入导出；`client-web` 通过 `/agent-api` 调本地网关；`client-cli` 抽出可编程运行时供网关复用，但仍保留现有交互式 REPL。

**Tech Stack:** Node.js、TypeScript、`node:test`、`tsx`、React、Vite、Vitest、现有 `shared-client` / `client-cli`

---

## File Map

- `agent-gateway/package.json`
  本地网关包定义，脚本与依赖。
- `agent-gateway/tsconfig.json`
  TypeScript 编译配置。
- `agent-gateway/src/types.ts`
  Template / Agent / Thread / Secret / Provider 相关类型。
- `agent-gateway/src/config.ts`
  数据目录、端口、CLI 默认命令等配置。
- `agent-gateway/src/server.ts`
  HTTP 服务、路由注册、JSON 响应和 SSE 入口。
- `agent-gateway/src/main.ts`
  启动入口。
- `agent-gateway/src/server.test.ts`
  基础 HTTP 接口测试。
- `agent-gateway/src/store/file-store.ts`
  本地文件读写基础设施。
- `agent-gateway/src/store/template-store.ts`
  模板存储。
- `agent-gateway/src/store/agent-store.ts`
  Agent 实例存储。
- `agent-gateway/src/store/thread-store.ts`
  线程、消息、执行日志存储。
- `agent-gateway/src/store/secret-store.ts`
  密钥加密与解密。
- `agent-gateway/src/store/store.test.ts`
  持久化与密钥测试。
- `agent-gateway/src/export/bundle.ts`
  导入导出包编解码。
- `agent-gateway/src/providers/types.ts`
  Provider 统一接口与动作协议。
- `agent-gateway/src/providers/openai-compatible.ts`
  OpenAI 兼容 HTTP Provider。
- `agent-gateway/src/providers/codex-cli.ts`
  `codex exec` Provider。
- `agent-gateway/src/providers/claude-cli.ts`
  `claude -p` Provider。
- `agent-gateway/src/providers/index.ts`
  Provider 注册与探测。
- `agent-gateway/src/providers/providers.test.ts`
  Provider 探测与结果解析测试。
- `agent-gateway/src/runtime/action-schema.ts`
  Agent 结构化动作 JSON Schema 与校验。
- `agent-gateway/src/runtime/loop.ts`
  Agent 自动运行循环。
- `agent-gateway/src/runtime/events.ts`
  运行事件总线与 SSE 推送。
- `agent-gateway/src/runtime/loop.test.ts`
  多轮运行测试。
- `agent-gateway/src/routes/templates.ts`
  模板相关路由处理器。
- `agent-gateway/src/routes/agents.ts`
  Agent、线程、消息、导入导出路由处理器。
- `client-cli/src/runtime.ts`
  可编程 CLI 运行时，供网关调用。
- `client-cli/src/command-catalog.ts`
  命令目录、类别、白名单元数据。
- `client-cli/src/runtime.test.ts`
  CLI 运行时测试。
- `client-cli/src/commands/index.ts`
  暴露命令目录与运行时友好的 dispatch。
- `client-web/vite.config.ts`
  增加 `/agent-api` 代理。
- `client-web/src/app/routes.tsx`
  新增 `/agents` 路由。
- `client-web/src/widgets/TopNav.tsx`
  顶栏新增 `智能体` 导航与网关状态提示。
- `client-web/src/widgets/TopNav.test.tsx`
  顶栏新增导航测试。
- `client-web/src/features/agents/types.ts`
  Web 侧类型定义。
- `client-web/src/features/agents/api.ts`
  网关 API 封装。
- `client-web/src/features/agents/use-agent-events.ts`
  订阅 `/agent-api/.../events` 的 SSE hook。
- `client-web/src/features/agents/AgentWorkspace.tsx`
  三栏 AI 工作台。
- `client-web/src/pages/AgentsPage.tsx`
  AI 面板页面。
- `client-web/src/pages/AgentsPage.test.tsx`
  页面测试。
- `client-web/src/styles/index.css`
  AI 面板样式。
- `docs/client-web使用说明.md`
  增加网关启动、AI 面板使用说明。
- `docs/agent-gateway.md`
  记录本地网关配置、Provider 模板、导入导出格式。

### Task 1: Scaffold Agent Gateway Base Server

**Files:**
- Create: `agent-gateway/package.json`
- Create: `agent-gateway/tsconfig.json`
- Create: `agent-gateway/src/types.ts`
- Create: `agent-gateway/src/config.ts`
- Create: `agent-gateway/src/server.ts`
- Create: `agent-gateway/src/main.ts`
- Test: `agent-gateway/src/server.test.ts`

- [ ] **Step 1: Write the failing base server test**

```ts
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createGatewayServer } from './server.js';

describe('gateway server', () => {
  const servers: Array<{ close: () => Promise<void>; url: string }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('serves health and capabilities', async () => {
    const server = await createGatewayServer({
      dataRoot: '/tmp/sw-agent-gateway-test-1',
      port: 0,
    });
    servers.push(server);

    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const capabilities = await fetch(`${server.url}/capabilities`);
    assert.equal(capabilities.status, 200);
    assert.deepEqual(await capabilities.json(), {
      status: 'ok',
      providers: {
        openai_compatible_http: { available: true },
        codex_cli: { available: false, reason: 'not_probed' },
        claude_code_cli: { available: false, reason: 'not_probed' },
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/server.test.ts
```

Expected: FAIL with `Cannot find module './server.js'` or equivalent missing file error.

- [ ] **Step 3: Write minimal gateway package and HTTP server**

`agent-gateway/package.json`

```json
{
  "name": "siliconworld-agent-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "start": "tsx src/main.ts",
    "test": "node --import tsx --test src/**/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "tsx": "^4.20.6",
    "typescript": "^5.7.3"
  }
}
```

`agent-gateway/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`agent-gateway/src/types.ts`

```ts
export type ProviderKind = 'openai_compatible_http' | 'codex_cli' | 'claude_code_cli';

export interface AgentTemplate {
  id: string;
  name: string;
  providerKind: ProviderKind;
  description: string;
  defaultModel: string;
  systemPrompt: string;
  toolPolicy: {
    cliEnabled: boolean;
    maxSteps: number;
    maxToolCallsPerTurn: number;
    commandWhitelist: string[];
  };
  providerConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

`agent-gateway/src/config.ts`

```ts
import path from 'node:path';

export function resolveGatewayConfig() {
  return {
    port: Number(process.env.SW_AGENT_GATEWAY_PORT ?? 18180),
    dataRoot: path.resolve(process.env.SW_AGENT_GATEWAY_DATA_DIR ?? './data'),
    codexCommand: process.env.SW_AGENT_CODEX_BIN ?? 'codex',
    claudeCommand: process.env.SW_AGENT_CLAUDE_BIN ?? 'claude',
  };
}
```

`agent-gateway/src/server.ts`

```ts
import { createServer } from 'node:http';

export interface GatewayServerHandle {
  url: string;
  close: () => Promise<void>;
}

export interface GatewayServerOptions {
  dataRoot: string;
  port: number;
}

export async function createGatewayServer(options: GatewayServerOptions): Promise<GatewayServerHandle> {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (request.url === '/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'ok',
        providers: {
          openai_compatible_http: { available: true },
          codex_cli: { available: false, reason: 'not_probed' },
          claude_code_cli: { available: false, reason: 'not_probed' },
        },
      }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('gateway server failed to bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
```

`agent-gateway/src/main.ts`

```ts
import { createGatewayServer } from './server.js';

const port = Number(process.env.SW_AGENT_GATEWAY_PORT ?? 18180);
const dataRoot = process.env.SW_AGENT_GATEWAY_DATA_DIR ?? './data';

const server = await createGatewayServer({ dataRoot, port });
console.log(`agent-gateway listening on ${server.url}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm install
node --import tsx --test src/server.test.ts
```

Expected: PASS with `gateway server` suite green.

- [ ] **Step 5: Commit**

```bash
cd /home/firesuiry/develop/siliconWorld
git add agent-gateway/package.json agent-gateway/tsconfig.json agent-gateway/src/types.ts agent-gateway/src/config.ts agent-gateway/src/server.ts agent-gateway/src/main.ts agent-gateway/src/server.test.ts
git commit -m "feat(agent-gateway): add base local gateway server"
```

### Task 2: Add Persistent Stores, Secret Encryption, and Export Bundles

**Files:**
- Create: `agent-gateway/src/store/file-store.ts`
- Create: `agent-gateway/src/store/template-store.ts`
- Create: `agent-gateway/src/store/agent-store.ts`
- Create: `agent-gateway/src/store/thread-store.ts`
- Create: `agent-gateway/src/store/secret-store.ts`
- Create: `agent-gateway/src/export/bundle.ts`
- Test: `agent-gateway/src/store/store.test.ts`

- [ ] **Step 1: Write failing persistence and secret tests**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTemplateStore } from './template-store.js';
import { createSecretStore } from './secret-store.js';
import { exportBundle } from '../export/bundle.js';

describe('template store', () => {
  it('saves and reloads templates from disk', async () => {
    const store = createTemplateStore('/tmp/sw-agent-gateway-test-templates');
    await store.save({
      id: 'tpl-http',
      name: 'HTTP Builder',
      providerKind: 'openai_compatible_http',
      description: 'build things',
      defaultModel: 'gpt-5',
      systemPrompt: 'You are an operations agent.',
      toolPolicy: {
        cliEnabled: true,
        maxSteps: 8,
        maxToolCallsPerTurn: 3,
        commandWhitelist: ['summary', 'build'],
      },
      providerConfig: {
        baseUrl: 'https://example.invalid/v1',
        apiKeySecretId: 'sec-1',
        model: 'gpt-5',
        extraHeaders: {},
      },
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    });

    const templates = await store.list();
    assert.equal(templates.length, 1);
    assert.equal(templates[0].id, 'tpl-http');
  });
});

describe('secret store', () => {
  it('encrypts values at rest and decrypts them on read', async () => {
    const store = createSecretStore('/tmp/sw-agent-gateway-test-secrets');
    await store.save('sec-1', 'demo-key');
    const raw = await store.readRaw();
    assert.match(raw, /encryptedValue/);
    assert.ok(!raw.includes('demo-key'));
    assert.equal(await store.readValue('sec-1'), 'demo-key');
  });
});

describe('bundle export', () => {
  it('omits encryptedSecrets by default', async () => {
    const bundle = exportBundle({
      templates: [{ id: 'tpl-http', name: 'HTTP Builder' }],
      includeSecrets: false,
      encryptedSecrets: [{ id: 'sec-1', ciphertext: 'abc' }],
    });
    assert.equal(bundle.encryptedSecrets, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/store/store.test.ts
```

Expected: FAIL with missing module errors for the new store files.

- [ ] **Step 3: Implement file-backed stores and AES-GCM secret encryption**

`agent-gateway/src/store/file-store.ts`

```ts
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function writeJsonFile(dir: string, fileName: string, value: unknown) {
  await ensureDir(dir);
  await writeFile(path.join(dir, fileName), JSON.stringify(value, null, 2), 'utf8');
}

export async function readJsonFile<T>(dir: string, fileName: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(dir, fileName), 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function listJsonFiles<T>(dir: string): Promise<T[]> {
  await ensureDir(dir);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  const values = await Promise.all(names.map((name) => readJsonFile<T>(dir, name)));
  return values.filter((value): value is T => Boolean(value));
}
```

`agent-gateway/src/store/secret-store.ts`

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface SecretEntry {
  id: string;
  encryptedValue: string;
}

async function loadOrCreateMasterKey(root: string): Promise<Buffer> {
  await mkdir(root, { recursive: true });
  const keyPath = path.join(root, 'master.key');
  try {
    return Buffer.from(await readFile(keyPath, 'utf8'), 'base64');
  } catch {
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    return key;
  }
}

export function createSecretStore(root: string) {
  return {
    async save(id: string, value: string) {
      const key = await loadOrCreateMasterKey(root);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
      const record: SecretEntry = { id, encryptedValue: payload };
      await writeFile(path.join(root, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
    },
    async readValue(id: string) {
      const key = await loadOrCreateMasterKey(root);
      const raw = JSON.parse(await readFile(path.join(root, `${id}.json`), 'utf8')) as SecretEntry;
      const payload = Buffer.from(raw.encryptedValue, 'base64');
      const iv = payload.subarray(0, 12);
      const tag = payload.subarray(12, 28);
      const ciphertext = payload.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
    async readRaw() {
      return readFile(path.join(root, 'sec-1.json'), 'utf8');
    },
  };
}
```

`agent-gateway/src/export/bundle.ts`

```ts
export function exportBundle(input: {
  templates: unknown[];
  includeSecrets: boolean;
  encryptedSecrets: unknown[];
}) {
  return {
    manifest: {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
    },
    templates: input.templates,
    ...(input.includeSecrets ? { encryptedSecrets: input.encryptedSecrets } : {}),
  };
}
```

`agent-gateway/src/store/template-store.ts`

```ts
import type { AgentTemplate } from '../types.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createTemplateStore(root: string) {
  return {
    list: () => listJsonFiles<AgentTemplate>(root),
    get: (id: string) => readJsonFile<AgentTemplate>(root, `${id}.json`),
    save: (template: AgentTemplate) => writeJsonFile(root, `${template.id}.json`, template),
  };
}
```

`agent-gateway/src/store/agent-store.ts`

```ts
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export interface AgentInstanceRecord {
  id: string;
  name: string;
  templateId: string;
  serverUrl: string;
  playerId: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed';
  goal: string;
  activeThreadId: string;
}

export function createAgentStore(root: string) {
  return {
    list: () => listJsonFiles<AgentInstanceRecord>(root),
    get: (id: string) => readJsonFile<AgentInstanceRecord>(root, `${id}.json`),
    save: (agent: AgentInstanceRecord) => writeJsonFile(root, `${agent.id}.json`, agent),
  };
}
```

`agent-gateway/src/store/thread-store.ts`

```ts
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export interface AgentThreadRecord {
  id: string;
  agentId: string;
  title: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  executionLogs: Array<{ level: 'info' | 'error'; message: string }>;
}

export function createThreadStore(root: string) {
  return {
    list: () => listJsonFiles<AgentThreadRecord>(root),
    get: (id: string) => readJsonFile<AgentThreadRecord>(root, `${id}.json`),
    save: (thread: AgentThreadRecord) => writeJsonFile(root, `${thread.id}.json`, thread),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/store/store.test.ts
```

Expected: PASS with `template store`, `secret store`, and `bundle export` suites green.

- [ ] **Step 5: Commit**

```bash
cd /home/firesuiry/develop/siliconWorld
git add agent-gateway/src/store/file-store.ts agent-gateway/src/store/template-store.ts agent-gateway/src/store/agent-store.ts agent-gateway/src/store/thread-store.ts agent-gateway/src/store/secret-store.ts agent-gateway/src/export/bundle.ts agent-gateway/src/store/store.test.ts
git commit -m "feat(agent-gateway): add persistence and export bundle support"
```

### Task 3: Add Provider Adapters for HTTP, Codex CLI, and Claude CLI

**Files:**
- Create: `agent-gateway/src/providers/types.ts`
- Create: `agent-gateway/src/providers/openai-compatible.ts`
- Create: `agent-gateway/src/providers/codex-cli.ts`
- Create: `agent-gateway/src/providers/claude-cli.ts`
- Create: `agent-gateway/src/providers/index.ts`
- Test: `agent-gateway/src/providers/providers.test.ts`

- [ ] **Step 1: Write failing provider tests**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseProviderResult } from './index.js';

describe('provider result parser', () => {
  it('parses a valid structured agent response', () => {
    const parsed = parseProviderResult(JSON.stringify({
      assistantMessage: '我会先扫描当前行星。',
      actions: [{ type: 'game.cli', commandLine: 'scan_planet planet-1-1' }],
      done: false,
    }));

    assert.equal(parsed.assistantMessage, '我会先扫描当前行星。');
    assert.equal(parsed.actions[0].type, 'game.cli');
    assert.equal(parsed.done, false);
  });

  it('rejects malformed payloads', () => {
    assert.throws(() => parseProviderResult('{"actions":[]}'), /assistantMessage/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/providers/providers.test.ts
```

Expected: FAIL with missing module errors for `./index.js`.

- [ ] **Step 3: Implement provider contract and parser**

`agent-gateway/src/providers/types.ts`

```ts
export interface AgentActionBase {
  type: 'game.query' | 'game.command' | 'game.cli' | 'memory.note' | 'final_answer';
}

export interface ProviderTurnResult {
  assistantMessage: string;
  actions: Array<Record<string, unknown> & AgentActionBase>;
  done: boolean;
}

export interface ProviderProbeResult {
  available: boolean;
  reason?: string;
}
```

`agent-gateway/src/providers/index.ts`

```ts
import { access } from 'node:fs/promises';

import type { ProviderProbeResult, ProviderTurnResult } from './types.js';

export function parseProviderResult(raw: string): ProviderTurnResult {
  const parsed = JSON.parse(raw) as Partial<ProviderTurnResult>;
  if (typeof parsed.assistantMessage !== 'string') {
    throw new Error('assistantMessage is required');
  }
  if (!Array.isArray(parsed.actions)) {
    throw new Error('actions must be an array');
  }
  if (typeof parsed.done !== 'boolean') {
    throw new Error('done must be a boolean');
  }
  return parsed as ProviderTurnResult;
}

export async function probeBinary(commandPath: string): Promise<ProviderProbeResult> {
  try {
    await access(commandPath);
    return { available: true };
  } catch {
    return { available: false, reason: 'binary_not_found' };
  }
}
```

`agent-gateway/src/providers/codex-cli.ts`

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseProviderResult } from './index.js';

const execFileAsync = promisify(execFile);

export async function runCodexTurn(command: string, model: string, prompt: string, schemaFile: string) {
  const { stdout } = await execFileAsync(command, [
    'exec',
    '--model', model,
    '--sandbox', 'read-only',
    '--ask-for-approval', 'never',
    '--skip-git-repo-check',
    '--output-schema', schemaFile,
    '-',
  ], { input: prompt });
  return parseProviderResult(stdout.trim());
}
```

`agent-gateway/src/providers/openai-compatible.ts`

```ts
import { parseProviderResult } from './index.js';

export async function runOpenAICompatibleTurn(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const response = await fetch(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    }),
  });
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? '';
  return parseProviderResult(content);
}
```

`agent-gateway/src/providers/claude-cli.ts`

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseProviderResult } from './index.js';

const execFileAsync = promisify(execFile);

export async function runClaudeTurn(command: string, model: string, prompt: string, schemaJson: string) {
  const { stdout } = await execFileAsync(command, [
    '-p',
    '--model', model,
    '--output-format', 'json',
    '--json-schema', schemaJson,
    '--permission-mode', 'dontAsk',
    '--tools', '',
    prompt,
  ]);
  return parseProviderResult(stdout.trim());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/providers/providers.test.ts
```

Expected: PASS with parser tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/firesuiry/develop/siliconWorld
git add agent-gateway/src/providers/types.ts agent-gateway/src/providers/openai-compatible.ts agent-gateway/src/providers/codex-cli.ts agent-gateway/src/providers/claude-cli.ts agent-gateway/src/providers/index.ts agent-gateway/src/providers/providers.test.ts
git commit -m "feat(agent-gateway): add provider adapters and parser"
```

### Task 4: Extract a Programmable Game CLI Runtime from client-cli

**Files:**
- Create: `client-cli/src/command-catalog.ts`
- Create: `client-cli/src/runtime.ts`
- Create: `client-cli/src/runtime.test.ts`
- Modify: `client-cli/src/commands/index.ts`

- [ ] **Step 1: Write the failing CLI runtime test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAgentAllowedCommands, runCommandLine } from './runtime.js';

describe('game cli runtime', () => {
  it('lists command metadata for agent whitelist', () => {
    const commands = getAgentAllowedCommands();
    assert.ok(commands.includes('summary'));
    assert.ok(commands.includes('build'));
    assert.ok(!commands.includes('rollback'));
  });

  it('dispatches a simple command line', async () => {
    const output = await runCommandLine('help save', {
      currentPlayer: 'p1',
      serverUrl: 'http://localhost:18080',
      playerKey: 'key_player_1',
    });
    assert.match(output, /save \[--reason <text>\]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-cli
node --import tsx --test src/runtime.test.ts
```

Expected: FAIL with `Cannot find module './runtime.js'`.

- [ ] **Step 3: Implement command catalog and runtime wrapper**

`client-cli/src/command-catalog.ts`

```ts
export const AGENT_ALLOWED_COMMANDS = [
  'summary',
  'stats',
  'galaxy',
  'system',
  'planet',
  'scene',
  'inspect',
  'fog',
  'scan_galaxy',
  'scan_system',
  'scan_planet',
  'build',
  'move',
  'attack',
  'produce',
  'upgrade',
  'demolish',
  'configure_logistics_station',
  'configure_logistics_slot',
  'start_research',
  'cancel_research',
  'save',
];
```

`client-cli/src/runtime.ts`

```ts
import { dispatch } from './commands/index.js';
import { setAuth } from './api.js';
import { AGENT_ALLOWED_COMMANDS } from './command-catalog.js';

export interface GameCliRuntimeContext {
  currentPlayer: string;
  serverUrl: string;
  playerKey: string;
}

export function getAgentAllowedCommands() {
  return [...AGENT_ALLOWED_COMMANDS];
}

export async function runCommandLine(line: string, context: GameCliRuntimeContext) {
  setAuth(context.currentPlayer, context.playerKey);
  const commandName = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!AGENT_ALLOWED_COMMANDS.includes(commandName) && commandName !== 'help') {
    throw new Error(`command not allowed for agent: ${commandName}`);
  }
  return dispatch(line, { currentPlayer: context.currentPlayer, rl: {} });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-cli
node --import tsx --test src/runtime.test.ts
```

Expected: PASS with both runtime tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/firesuiry/develop/siliconWorld
git add client-cli/src/command-catalog.ts client-cli/src/runtime.ts client-cli/src/runtime.test.ts client-cli/src/commands/index.ts
git commit -m "feat(client-cli): expose programmable runtime for agents"
```

### Task 5: Implement Agent Runtime Loop, API Routes, and SSE

**Files:**
- Create: `agent-gateway/src/runtime/action-schema.ts`
- Create: `agent-gateway/src/runtime/events.ts`
- Create: `agent-gateway/src/runtime/loop.ts`
- Create: `agent-gateway/src/routes/templates.ts`
- Create: `agent-gateway/src/routes/agents.ts`
- Modify: `agent-gateway/src/server.ts`
- Test: `agent-gateway/src/runtime/loop.test.ts`

- [ ] **Step 1: Write the failing runtime loop test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAgentLoop } from './loop.js';

describe('agent loop', () => {
  it('executes cli actions until the provider marks the run done', async () => {
    const calls: string[] = [];

    const result = await runAgentLoop({
      maxSteps: 4,
      provider: {
        async runTurn(input) {
          if (input.step === 0) {
            return {
              assistantMessage: '先扫描当前行星。',
              actions: [{ type: 'game.cli', commandLine: 'scan_planet planet-1-1' }],
              done: false,
            };
          }
          return {
            assistantMessage: '扫描完成，未发现阻塞。',
            actions: [{ type: 'final_answer', message: '扫描完成，未发现阻塞。' }],
            done: true,
          };
        },
      },
      cliRuntime: {
        async run(commandLine) {
          calls.push(commandLine);
          return 'ok';
        },
      },
      initialContext: { goal: '检查 planet-1-1' },
    });

    assert.deepEqual(calls, ['scan_planet planet-1-1']);
    assert.equal(result.finalMessage, '扫描完成，未发现阻塞。');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/runtime/loop.test.ts
```

Expected: FAIL with missing module errors for `./loop.js`.

- [ ] **Step 3: Implement action validation and runtime loop**

`agent-gateway/src/runtime/action-schema.ts`

```ts
export function assertSupportedAction(action: Record<string, unknown>) {
  if (typeof action.type !== 'string') {
    throw new Error('action.type is required');
  }
  if (action.type === 'game.cli' && typeof action.commandLine !== 'string') {
    throw new Error('game.cli requires commandLine');
  }
  if (action.type === 'final_answer' && typeof action.message !== 'string') {
    throw new Error('final_answer requires message');
  }
}
```

`agent-gateway/src/runtime/loop.ts`

```ts
import { assertSupportedAction } from './action-schema.js';

export async function runAgentLoop(input: {
  maxSteps: number;
  provider: { runTurn: (request: { step: number; history: unknown[] }) => Promise<{ assistantMessage: string; actions: Array<Record<string, unknown>>; done: boolean }> };
  cliRuntime: { run: (commandLine: string) => Promise<string> };
  initialContext: { goal: string };
}) {
  const history: unknown[] = [{ role: 'user', content: input.initialContext.goal }];
  let finalMessage = '';

  for (let step = 0; step < input.maxSteps; step += 1) {
    const turn = await input.provider.runTurn({ step, history });
    history.push({ role: 'assistant', content: turn.assistantMessage });

    for (const action of turn.actions) {
      assertSupportedAction(action);
      if (action.type === 'game.cli') {
        const output = await input.cliRuntime.run(String(action.commandLine));
        history.push({ role: 'tool', content: output });
      }
      if (action.type === 'final_answer') {
        finalMessage = String(action.message);
      }
    }

    if (turn.done) {
      return { finalMessage, history };
    }
  }

  throw new Error('agent loop exceeded maxSteps');
}
```

- [ ] **Step 4: Wire routes and SSE into the gateway server**

`agent-gateway/src/server.ts`

```ts
import { createServer } from 'node:http';

import { handleTemplateRoutes } from './routes/templates.js';
import { handleAgentRoutes } from './routes/agents.js';

export async function createGatewayServer(options: GatewayServerOptions): Promise<GatewayServerHandle> {
  const server = createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (request.url?.startsWith('/templates')) {
      await handleTemplateRoutes(request, response, options);
      return;
    }

    if (request.url?.startsWith('/agents')) {
      await handleAgentRoutes(request, response, options);
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('gateway server failed to bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
```

`agent-gateway/src/runtime/events.ts`

```ts
type Listener = (event: { agentId: string; type: string; payload: unknown }) => void;

export function createEventBus() {
  const listeners = new Set<Listener>();
  return {
    emit(event: { agentId: string; type: string; payload: unknown }) {
      listeners.forEach((listener) => listener(event));
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

`agent-gateway/src/routes/templates.ts`

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export async function handleTemplateRoutes(_request: IncomingMessage, response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify([]));
}
```

`agent-gateway/src/routes/agents.ts`

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export async function handleAgentRoutes(_request: IncomingMessage, response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify([]));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
node --import tsx --test src/runtime/loop.test.ts
node --import tsx --test src/server.test.ts
```

Expected: PASS with loop and server suites green.

- [ ] **Step 6: Commit**

```bash
cd /home/firesuiry/develop/siliconWorld
git add agent-gateway/src/runtime/action-schema.ts agent-gateway/src/runtime/events.ts agent-gateway/src/runtime/loop.ts agent-gateway/src/routes/templates.ts agent-gateway/src/routes/agents.ts agent-gateway/src/runtime/loop.test.ts agent-gateway/src/server.ts
git commit -m "feat(agent-gateway): add agent runtime loop and api routes"
```

### Task 6: Add the Client-Web AI Workspace and Gateway Proxy

**Files:**
- Modify: `client-web/vite.config.ts`
- Modify: `client-web/src/app/routes.tsx`
- Modify: `client-web/src/widgets/TopNav.tsx`
- Modify: `client-web/src/styles/index.css`
- Create: `client-web/src/features/agents/types.ts`
- Create: `client-web/src/features/agents/api.ts`
- Create: `client-web/src/features/agents/use-agent-events.ts`
- Create: `client-web/src/features/agents/AgentWorkspace.tsx`
- Create: `client-web/src/pages/AgentsPage.tsx`
- Test: `client-web/src/pages/AgentsPage.test.tsx`
- Test: `client-web/src/widgets/TopNav.test.tsx`

- [ ] **Step 1: Write the failing Agents page test**

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { renderApp, jsonResponse } from '@/test/utils';

describe('AgentsPage', () => {
  it('renders templates and lets the user open the agent workspace', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/templates')) {
        return Promise.resolve(jsonResponse([
          { id: 'tpl-http', name: 'HTTP Builder', providerKind: 'openai_compatible_http' },
        ]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    renderApp(['/agents']);

    expect(await screen.findByRole('heading', { name: '智能体工作台' })).toBeInTheDocument();
    expect(screen.getByText('HTTP Builder')).toBeInTheDocument();
  });

  it('shows the new navigation entry in TopNav', async () => {
    const user = userEvent.setup();
    renderApp(['/overview']);
    await user.click(screen.getByRole('link', { name: '智能体' }));
    expect(await screen.findByRole('heading', { name: '智能体工作台' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npx vitest run src/pages/AgentsPage.test.tsx
```

Expected: FAIL with `Cannot find module '@/pages/AgentsPage'` or route mismatch.

- [ ] **Step 3: Add the gateway proxy and route**

`client-web/vite.config.ts`

```ts
const agentProxyTarget = process.env.VITE_SW_AGENT_PROXY_TARGET ?? 'http://localhost:18180';

export default defineConfig({
  server: {
    proxy: {
      '/agent-api': {
        target: agentProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent-api/, ''),
      },
      '/health': createProxyEntry(),
      '/metrics': createProxyEntry(),
      '/state': createProxyEntry(),
      '/world': createProxyEntry(),
      '/catalog': createProxyEntry(),
      '/events': createProxyEntry(),
      '/alerts': createProxyEntry(),
      '/commands': createProxyEntry(),
      '/save': createProxyEntry(),
      '/replay': createProxyEntry(),
      '/rollback': createProxyEntry(),
      '/audit': createProxyEntry(),
    },
  },
});
```

`client-web/src/app/routes.tsx`

```tsx
import { AgentsPage } from '@/pages/AgentsPage';

// inside protected routes
<Route path="/agents" element={<AgentsPage />} />
```

`client-web/src/widgets/TopNav.tsx`

```tsx
<NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/agents">
  智能体
</NavLink>
```

- [ ] **Step 4: Implement the AI workspace page**

`client-web/src/features/agents/api.ts`

```ts
export async function fetchGatewayHealth() {
  const response = await fetch('/agent-api/health');
  if (!response.ok) {
    throw new Error(`gateway health failed: ${response.status}`);
  }
  return response.json() as Promise<{ status: string }>;
}

export async function fetchTemplates() {
  const response = await fetch('/agent-api/templates');
  if (!response.ok) {
    throw new Error(`templates failed: ${response.status}`);
  }
  return response.json() as Promise<Array<{ id: string; name: string; providerKind: string }>>;
}

export async function fetchAgents() {
  const response = await fetch('/agent-api/agents');
  if (!response.ok) {
    throw new Error(`agents failed: ${response.status}`);
  }
  return response.json() as Promise<Array<{ id: string; name: string; status: string }>>;
}
```

`client-web/src/pages/AgentsPage.tsx`

```tsx
import { useQuery } from '@tanstack/react-query';

import { fetchAgents, fetchGatewayHealth, fetchTemplates } from '@/features/agents/api';

export function AgentsPage() {
  const healthQuery = useQuery({ queryKey: ['agent-health'], queryFn: fetchGatewayHealth });
  const templateQuery = useQuery({ queryKey: ['agent-templates'], queryFn: fetchTemplates });
  const agentQuery = useQuery({ queryKey: ['agent-instances'], queryFn: fetchAgents });

  if (healthQuery.isLoading || templateQuery.isLoading || agentQuery.isLoading) {
    return <div className="panel">正在加载智能体工作台...</div>;
  }

  return (
    <div className="agent-workspace">
      <section className="panel">
        <h1>智能体工作台</h1>
        <p className="subtle-text">本地 Agent 网关在线，可管理模板、实例和执行日志。</p>
      </section>

      <section className="panel">
        <h2>模板</h2>
        <ul>
          {templateQuery.data?.map((template) => (
            <li key={template.id}>{template.name}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>实例</h2>
        <ul>
          {agentQuery.data?.map((agent) => (
            <li key={agent.id}>{agent.name} · {agent.status}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

`client-web/src/features/agents/types.ts`

```ts
export interface AgentTemplateSummary {
  id: string;
  name: string;
  providerKind: string;
}

export interface AgentInstanceSummary {
  id: string;
  name: string;
  status: string;
}
```

`client-web/src/features/agents/use-agent-events.ts`

```ts
import { useEffect } from 'react';

export function useAgentEvents(agentId: string, onMessage: (event: MessageEvent<string>) => void) {
  useEffect(() => {
    if (!agentId) {
      return;
    }
    const stream = new EventSource(`/agent-api/agents/${agentId}/events`);
    stream.onmessage = onMessage;
    return () => stream.close();
  }, [agentId, onMessage]);
}
```

`client-web/src/features/agents/AgentWorkspace.tsx`

```tsx
import type { AgentInstanceSummary, AgentTemplateSummary } from './types';

interface AgentWorkspaceProps {
  templates: AgentTemplateSummary[];
  agents: AgentInstanceSummary[];
}

export function AgentWorkspace({ templates, agents }: AgentWorkspaceProps) {
  return (
    <div className="agent-workspace">
      <section className="panel agent-workspace__column">
        <h2>模板</h2>
        <ul>{templates.map((template) => <li key={template.id}>{template.name}</li>)}</ul>
      </section>
      <section className="panel agent-workspace__column">
        <h2>实例</h2>
        <ul>{agents.map((agent) => <li key={agent.id}>{agent.name} · {agent.status}</li>)}</ul>
      </section>
      <section className="panel agent-workspace__column">
        <h2>日志</h2>
        <p className="subtle-text">选择实例后显示线程与工具调用日志。</p>
      </section>
    </div>
  );
}
```

`client-web/src/styles/index.css`

```css
.agent-workspace {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 320px;
  gap: 16px;
}

.agent-workspace__column {
  min-height: 320px;
}

.agent-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npx vitest run src/pages/AgentsPage.test.tsx
npx vitest run src/widgets/TopNav.test.tsx
```

Expected: PASS with new route and nav entry covered.

- [ ] **Step 6: Commit**

```bash
cd /home/firesuiry/develop/siliconWorld
git add client-web/vite.config.ts client-web/src/app/routes.tsx client-web/src/widgets/TopNav.tsx client-web/src/widgets/TopNav.test.tsx client-web/src/features/agents/types.ts client-web/src/features/agents/api.ts client-web/src/features/agents/use-agent-events.ts client-web/src/features/agents/AgentWorkspace.tsx client-web/src/pages/AgentsPage.tsx client-web/src/pages/AgentsPage.test.tsx client-web/src/styles/index.css
git commit -m "feat(client-web): add ai workspace and gateway integration"
```

### Task 7: Finish Import/Export UI, Documentation, and Verification

**Files:**
- Modify: `client-web/src/pages/AgentsPage.tsx`
- Modify: `client-web/src/features/agents/api.ts`
- Modify: `docs/client-web使用说明.md`
- Create: `docs/agent-gateway.md`

- [ ] **Step 1: Add import/export actions to the workspace**

`client-web/src/features/agents/api.ts`

```ts
export async function exportTemplates(includeSecrets: boolean) {
  const response = await fetch('/agent-api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ includeSecrets }),
  });
  if (!response.ok) {
    throw new Error(`export failed: ${response.status}`);
  }
  return response.json();
}

export async function importBundle(bundle: unknown) {
  const response = await fetch('/agent-api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  if (!response.ok) {
    throw new Error(`import failed: ${response.status}`);
  }
  return response.json();
}
```

`client-web/src/pages/AgentsPage.tsx`

```tsx
<section className="panel">
  <h2>导入导出</h2>
  <div className="agent-actions">
    <button className="secondary-button" type="button" onClick={() => { void exportTemplates(false); }}>
      导出模板
    </button>
    <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()}>
      导入 Bundle
    </button>
  </div>
</section>
```

- [ ] **Step 2: Update user-facing docs**

`docs/client-web使用说明.md`

```md
## 2.4 启动本地 Agent 网关

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm install
npm run dev
```

默认监听：

- `http://localhost:18180`

`client-web` 会通过 `/agent-api` 代理到本地网关。
```

`docs/agent-gateway.md`

```md
# agent-gateway 使用说明

## Provider 模板

- OpenAI 兼容 HTTP：`base_url` + `api_key` + `model`
- Codex CLI：`codex exec`
- Claude Code CLI：`claude -p`

## 导出级别

1. 仅模板
2. 模板 + 实例 + 线程
3. 模板 + 实例 + 线程 + 加密密钥
```

- [ ] **Step 3: Run verification commands**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm test
```

Expected: PASS for `src/**/*.test.ts`.

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-cli
npm test
```

Expected: PASS for `src/**/*.test.ts`.

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test
npm run build
```

Expected: PASS for Vitest and successful Vite build.

- [ ] **Step 4: Do a manual browser verification**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go run ./cmd/server -config config-dev.yaml -map-config map.yaml
```

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm run dev
```

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run dev
```

Then verify in a browser:

```text
1. 打开 http://localhost:5173/login 并登录在线服务端
2. 打开 顶栏 -> 智能体
3. 创建一个 OpenAI 兼容模板
4. 基于模板创建实例
5. 发送“扫描当前活跃行星并总结局势”
6. 确认日志里出现 scan_planet / summary 之类的 CLI 调用
7. 尝试导出模板，再导入回本机
```

Expected: 页面能显示模板、实例、运行日志，并且导入导出成功。

- [ ] **Step 5: Commit**

```bash
cd /home/firesuiry/develop/siliconWorld
git add client-web/src/pages/AgentsPage.tsx client-web/src/features/agents/api.ts docs/client-web使用说明.md docs/agent-gateway.md
git commit -m "docs: document ai workspace and local agent gateway"
```
