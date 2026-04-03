# Client-Web AI 交互面板与本地 Agent 网关设计

## 1. 背景

当前仓库已经具备三块可直接复用的能力：

- `client-web`：React + Vite 的可视化客户端，已经有登录、总览、星图、行星、回放等页面。
- `shared-client`：对 SiliconWorld 服务端查询接口、事件接口、`/commands` 的共享 TypeScript 封装。
- `client-cli`：面向人类玩家的 Node CLI，已经覆盖查询、建造、移动、研究、物流、回放、保存等常用命令。

当前不存在可直接复用的正式 Agent 托管接口。`docs/设定.md` 中虽然描述了未来的 `/agents` API，但现有 `server/` 实现并未提供对应能力。因此，在 `client-web` 中增加 AI 交互面板时，最稳妥的第一阶段落点不是 `server/`，而是一个本地 Agent 网关进程。

本轮已经确认的约束如下：

- 采用方案 2：新增本地 `agent-gateway`，`client-web` 只做控制台 UI。
- Agent 默认运行模式为全自动：用户给目标后，Agent 可以连续自主执行操作，直到完成、失败、被暂停，或达到预算上限。
- Provider 同时支持：
  - OpenAI 兼容 HTTP API
  - 本机已安装的 `codex` CLI
  - 本机已安装的 `claude` / Claude Code CLI
- 模板和实例要支持导入导出，便于分享。
- Agent 允许“使用 CLI 对游戏进行操作”，但不能给模型任意 shell，必须是受控、可审计、可限权的 CLI 工具层。

## 2. 目标与非目标

### 2.1 目标

第一阶段需要交付以下能力：

1. 在 `client-web` 中新增 AI 交互面板，允许管理 Agent 模板、智能体实例、对话线程、运行状态。
2. 新增本地 `agent-gateway`，负责模板持久化、Provider 调用、会话编排、CLI 工具执行、审计日志、导入导出。
3. 让 Agent 能基于玩家输入，通过统一的“游戏 CLI 工具层”查询局势并执行游戏命令。
4. 让 HTTP Provider、`codex` CLI、`claude` CLI 都能挂到统一的 Provider 抽象下运行。
5. 保证密钥不进入浏览器，不通过 `client-web` 直接请求第三方模型服务。

### 2.2 非目标

第一阶段明确不做以下内容：

- 不在 `server/` 中引入正式的远程 Agent 托管 API。
- 不开放任意 shell、任意文件系统写入、任意网络访问给游戏 Agent。
- 不引入多机协同、多人共享在线模板库、云同步。
- 不做复杂权限策略编辑器，只做受控的模板级执行约束。
- 不做泛化的“任意 MCP 工具平台”；工具范围先收敛在游戏查询、游戏命令、会话记忆、运行控制。

## 3. 总体架构

### 3.1 系统拓扑

第一阶段拓扑如下：

```text
client-web  <----HTTP/SSE---->  agent-gateway  <----HTTP---->  SiliconWorld server
                                     |
                                     +---- provider adapter ----> OpenAI-compatible API
                                     |
                                     +---- provider adapter ----> codex exec
                                     |
                                     +---- provider adapter ----> claude -p
                                     |
                                     +---- game-cli tool layer ----> shared-client / client-cli runtime
```

职责边界：

- `client-web`
  - 展示 AI 面板
  - 管理模板表单、实例列表、对话视图、日志时间线、导入导出入口
  - 通过本地 API 调 `agent-gateway`
  - 不接触第三方模型密钥
- `agent-gateway`
  - 管模板、实例、线程、日志、密钥
  - 调模型
  - 执行 CLI 工具
  - 拉取当前游戏上下文
  - 对外提供本地 HTTP / SSE API
- `server`
  - 继续作为游戏状态与命令执行后端
  - 第一阶段无需知道 Agent 具体实现

### 3.2 技术选型

- `agent-gateway` 使用 Node.js + TypeScript。
- 原因：
  - 现有 `client-cli` 与 `shared-client` 都是 TypeScript，可直接复用接口类型与命令逻辑。
  - 需要直接拉起本机 `codex` / `claude` CLI，Node 的 `child_process` 实现成本最低。
  - 本地工具型服务不需要引入 Go 侧构建链和额外二进制发布复杂度。

`agent-gateway` 不引入数据库。第一阶段采用本地文件持久化，确保结构简单、迁移容易、导入导出直观。

## 4. 核心对象模型

### 4.1 Agent Template

模板表示“如何调用模型”，而不是一个正在运行的智能体。

```ts
type ProviderKind =
  | 'openai_compatible_http'
  | 'codex_cli'
  | 'claude_code_cli';

interface AgentTemplate {
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
  providerConfig:
    | OpenAICompatibleProviderConfig
    | CodexCliProviderConfig
    | ClaudeCodeCliProviderConfig;
  createdAt: string;
  updatedAt: string;
}
```

三类配置：

- `openai_compatible_http`
  - `baseUrl`
  - `apiKeySecretId`
  - `model`
  - `extraHeaders`
- `codex_cli`
  - `command`
  - `model`
  - `workdir`
  - `argsTemplate`
  - `envOverrides`
- `claude_code_cli`
  - `command`
  - `model`
  - `workdir`
  - `argsTemplate`
  - `envOverrides`

关键原则：

- 模板内不直接保存明文 API Key，只保存 `apiKeySecretId`。
- CLI Provider 是独立类型，不伪装成 HTTP 模板。
- 后续新增 Gemini CLI、其他 OpenAI 兼容模型时，只增 Provider，不动 Web 业务层。

### 4.2 Agent Instance

实例表示“某个模板在某个玩家会话上的运行实体”。

```ts
interface AgentInstance {
  id: string;
  name: string;
  templateId: string;
  serverUrl: string;
  playerId: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed';
  goal: string;
  modelOverride?: string;
  systemPromptAppend?: string;
  lastTickSeen?: number;
  activeThreadId: string;
  createdAt: string;
  updatedAt: string;
}
```

实例不复制整份模板，只保留少量运行时 override，避免模板与实例长期漂移。

### 4.3 Conversation Thread

线程表示用户和 Agent 的一个工作会话。

```ts
interface AgentThread {
  id: string;
  agentId: string;
  title: string;
  messages: AgentMessage[];
  toolCalls: AgentToolCallRecord[];
  executionLogs: AgentExecutionLog[];
  createdAt: string;
  updatedAt: string;
}
```

第一阶段 UI 只暴露单个主线程，但底层结构允许后续扩展出复盘线程、调试线程。

### 4.4 Secret Record

密钥与模板分离存储：

```ts
interface SecretRecord {
  id: string;
  providerKind: 'openai_compatible_http';
  label: string;
  encryptedValue: string;
  createdAt: string;
  updatedAt: string;
}
```

Web 只能知道模板“是否已配置密钥”，看不到明文值。

## 5. 本地持久化与导入导出

### 5.1 本地目录结构

建议新增：

```text
agent-gateway/
  data/
    templates/
      <template-id>.json
    agents/
      <agent-id>.json
    threads/
      <thread-id>.json
    secrets/
      index.json
    exports/
```

理由：

- 文件粒度小，读写简单，避免一个大 JSON 成为单点冲突。
- 导出时可直接装配成 bundle。
- 后续若要迁移 SQLite，也可按对象边界平滑迁移。

### 5.2 密钥存储策略

第一阶段不接 OS keychain，避免平台差异拖慢落地。采用以下折中设计：

- 网关首次启动时生成本地主密钥文件，仅本机可读。
- API Key 以 AES-GCM 加密后存储。
- 导出模板时默认不导出密钥。
- 用户显式选择“导出密钥”时，要求输入导出口令，再次加密密钥包。

这不是对本机高权限攻击者的强防护，但足以避免：

- 模板 JSON 被直接分享时泄露密钥
- 浏览器本地存储暴露明文 key
- 普通导出误带密钥

### 5.3 导入导出包格式

统一使用一个 JSON bundle：

```ts
interface AgentExportBundle {
  manifest: {
    version: 1;
    exportedAt: string;
    appVersion: string;
  };
  templates: AgentTemplateExport[];
  agents?: AgentInstanceExport[];
  threads?: AgentThreadExport[];
  encryptedSecrets?: ExportedSecretBundle[];
}
```

导出分三级：

1. 仅模板
2. 模板 + 实例 + 线程
3. 模板 + 实例 + 线程 + 加密密钥

导入时若发现模板引用的密钥不存在，则把模板标记为“待补全密钥”。

## 6. Provider 抽象与执行协议

### 6.1 统一 Provider 接口

三类 Provider 都实现同一个运行接口：

```ts
interface AgentProvider {
  kind: ProviderKind;
  probe(config: ProviderConfig): Promise<ProviderProbeResult>;
  runTurn(request: ProviderTurnRequest): Promise<ProviderTurnResult>;
}
```

`runTurn` 的输入包含：

- system prompt
- 当前游戏上下文摘要
- 线程历史
- 可用工具定义
- 本轮预算信息

输出统一为结构化结果，而不是依赖不同厂商的原生 tool-call 协议：

```ts
interface ProviderTurnResult {
  assistantMessage: string;
  actions: AgentAction[];
  done: boolean;
}
```

### 6.2 结构化动作协议

第一阶段不依赖各家原生函数调用接口，统一采用“模型输出符合 JSON Schema 的动作包”的方式，原因如下：

- `codex exec` 与 `claude -p` 的能力模型不完全一致。
- HTTP Provider 虽然可以走 OpenAI 兼容接口，但并不保证所有兼容方都稳定支持函数调用。
- 项目需要同时支持本地 CLI provider 与 HTTP provider，统一动作用 JSON Schema 更稳。

动作类型收敛为：

- `game.query`
- `game.command`
- `game.cli`
- `memory.note`
- `final_answer`

其中：

- `game.query`：调用共享查询工具，例如 `summary`、`stats`、`planet_scene`、`inspect`
- `game.command`：直接提交结构化游戏命令，例如 `build`、`move`
- `game.cli`：使用文本 CLI 命令面向 Agent 暴露统一命令面，例如 `build 8 8 wind_turbine`
- `memory.note`：把中间结论写入工作记忆
- `final_answer`：向用户总结结果

### 6.3 OpenAI 兼容 HTTP Provider

第一阶段 HTTP Provider 的范围明确收窄为：**OpenAI 兼容聊天接口**。

这样模板只需要三项核心字段：

- `base_url`
- `api_key`
- `model`

网关负责：

- 组装 system prompt
- 附加 JSON Schema 输出要求
- 解析结构化结果

后续如果需要接非 OpenAI 兼容协议，再新增 provider kind，不污染现有模板模型。

### 6.4 Codex CLI Provider

本机已确认存在 `codex exec` 非交互入口，第一阶段按此适配。

建议调用形态：

```bash
codex exec \
  --model <model> \
  --sandbox read-only \
  --ask-for-approval never \
  --skip-git-repo-check \
  --cd <workdir> \
  --output-schema <schema-file> \
  --output-last-message <result-file> \
  -
```

其中：

- prompt 通过 stdin 输入
- schema 文件用于约束最终输出结构
- CLI provider 不允许自行获得任意 Bash 权限
- 网关只把“游戏工具说明”和“当前上下文”交给它，真正执行命令仍由网关完成

### 6.5 Claude Code CLI Provider

本机已确认存在 `claude -p` 非交互入口，第一阶段按此适配。

建议调用形态：

```bash
claude -p \
  --model <model> \
  --output-format json \
  --json-schema '<schema-json>' \
  --permission-mode dontAsk \
  --tools "" \
  --system-prompt '<system-prompt>' \
  -
```

其中：

- 使用 `--tools ""` 禁用 Claude 自带工具，避免它绕过网关直接做本地操作
- 通过 `--json-schema` 强制输出结构化动作
- prompt 同样走 stdin

### 6.6 Provider 探测

网关启动时应探测 Provider 可用性：

- `codex_cli`
  - 检查命令存在
  - 检查 `codex exec --help` 可用
- `claude_code_cli`
  - 检查命令存在
  - 检查 `claude -p --help` 可用
- `openai_compatible_http`
  - 在模板测试时做一次轻量请求

探测结果通过 API 返回给 `client-web`，用于模板页显示“可用 / 缺少二进制 / 未配置密钥 / 认证失败”。

## 7. 游戏 CLI 工具层

### 7.1 设计原则

用户要求“允许智能体使用 CLI 对游戏进行操作”，但不能简单让模型直接拿 shell。

因此第一阶段的正确做法是：

- 对 Agent 暴露 CLI 语义
- 对实现层暴露受控命令执行器

也就是说，Agent 看到的是：

```text
build 8 8 wind_turbine
scan_planet planet-1-1
configure_logistics_slot b-20 planetary iron_ore supply 20
```

但网关内部执行的不是一个开放 REPL，而是**经过白名单校验的命令运行时**。

### 7.2 抽取方式

需要把 `client-cli` 中适合复用的逻辑从 REPL 交互层抽离为库层：

- 保留 `client-cli` 当前命令名与参数形式
- 新增一个 programmatic runtime，例如：

```ts
interface GameCliRuntime {
  run(commandLine: string, context: RuntimeContext): Promise<RuntimeResult>;
  listCommands(): CommandDescriptor[];
}
```

复用来源：

- `client-cli/src/commands/*.ts`
- `client-cli/src/api.ts`
- `shared-client/src/api.ts`

不复用：

- `readline` 交互
- prompt 渲染
- 人类终端输出控制

### 7.3 命令执行边界

Agent 可执行的命令必须走白名单：

- 查询类：`summary`、`stats`、`galaxy`、`system`、`planet`、`scene`、`inspect`、`fog`
- 低风险动作：`scan_galaxy`、`scan_system`、`scan_planet`
- 直接动作：`build`、`move`、`attack`、`produce`、`upgrade`、`demolish`
- 物流与研究：`configure_logistics_station`、`configure_logistics_slot`、`start_research`、`cancel_research`
- 调试类默认禁用：`rollback`
- 运维类谨慎开放：`save` 允许，`replay` 可选

每个模板还可进一步收窄白名单，例如只允许“查询 + 建造”，不允许“战斗 + 拆除”。

### 7.4 审计日志

每次工具调用都记录：

- 调用时间
- agent_id
- thread_id
- provider_kind
- 原始动作
- 规范化 CLI 命令
- 执行结果
- 服务端 request_id
- 关联 tick

这样 Web 可以把“这一步 Agent 实际执行了什么”完整展示出来。

## 8. Agent Runtime 与自动执行流

### 8.1 运行循环

用户在 Web 中向某个 Agent 发送目标后，运行流如下：

1. 网关装载模板、实例、线程、密钥。
2. 网关拉取基础游戏上下文：
   - `summary`
   - `stats`
   - 当前活跃行星
   - 若前端传来当前页面上下文，则追加该页面上下文
3. 网关把：
   - 系统提示词
   - 历史消息
   - 当前目标
   - 工具清单
   - 上轮工具结果
   送入 Provider。
4. Provider 返回结构化动作。
5. 网关逐条校验动作是否合法。
6. 合法动作进入工具执行器，并把结果回填给线程。
7. 若 `done=false` 且步数未超限，则继续下一轮。
8. 直到：
   - Provider 显式结束
   - 达到 `maxSteps`
   - 连续失败超限
   - 用户点击暂停 / 停止

### 8.2 全自动模式下的硬约束

虽然是全自动模式，但仍然必须保留机械约束：

- 单次运行最大步数
- 单轮最大工具调用数
- 单次运行总时长限制
- 连续错误上限
- 命令白名单
- 不开放任意 shell
- 不允许 Provider 直接持有第三方执行工具

这类约束由网关硬编码执行，不能交给 prompt 自觉遵守。

### 8.3 前端上下文注入

`client-web` 除了发用户消息，还应附带当前 UI 上下文：

- 当前路由
- 当前 `planetId` / `systemId`
- 当前选中对象
- 当前视角坐标、图层、缩放

这样用户在行星页点中一个建筑后，可以直接说：

> “帮我检查这个物流站为什么没出货，并自动修好。”

Agent 不需要先重新询问“你说的是哪个建筑”。

## 9. Agent Gateway API

### 9.1 基础接口

- `GET /health`
- `GET /capabilities`

`/capabilities` 返回：

- CLI provider 探测结果
- 当前数据目录
- 网关版本

### 9.2 模板接口

- `GET /templates`
- `POST /templates`
- `GET /templates/:templateId`
- `PATCH /templates/:templateId`
- `DELETE /templates/:templateId`
- `POST /templates/:templateId/validate`

`validate` 用于测试：

- CLI 模板是否能拉起对应命令
- HTTP 模板是否能完成一次最小响应

### 9.3 实例接口

- `GET /agents`
- `POST /agents`
- `GET /agents/:agentId`
- `PATCH /agents/:agentId`
- `DELETE /agents/:agentId`
- `POST /agents/:agentId/start`
- `POST /agents/:agentId/pause`
- `POST /agents/:agentId/resume`
- `POST /agents/:agentId/stop`

### 9.4 线程与消息接口

- `GET /agents/:agentId/thread`
- `POST /agents/:agentId/messages`
- `GET /agents/:agentId/events`

`/events` 采用 SSE，把以下内容推给前端：

- 状态切换
- assistant message
- tool started
- tool finished
- error
- run completed

### 9.5 导入导出接口

- `POST /import`
- `POST /export`

导出请求包含：

- 导出范围
- 是否带实例
- 是否带线程
- 是否带加密密钥

## 10. Client-Web AI 面板设计

### 10.1 UI 入口

第一阶段不做悬浮覆盖全站的复杂 HUD。采用一个稳定入口：

- 顶栏新增 `智能体` 导航，路由为 `/agents`

这样实现最简单，信息密度最高，也不会挤压当前已经比较复杂的行星页。

### 10.2 页面骨架

`/agents` 页面采用三栏工作台：

1. 左栏：模板与实例列表
2. 中栏：对话线程与运行日志
3. 右栏：上下文、模板配置、实例状态、导入导出面板

页面上的主要区块：

- 模板列表
- 新建模板表单
- 从模板创建实例
- 实例状态卡片
- 对话输入框
- 运行时间线
- CLI 命令回放列表
- 导入导出按钮

### 10.3 与现有会话的关系

Agent 实例默认绑定当前 `client-web` 登录态中的：

- `serverUrl`
- `playerId`

如果用户切换登录玩家：

- 不自动篡改已有 Agent 实例
- 新建实例时默认继承当前会话
- 实例卡片明确显示绑定的是哪个玩家和哪个服务端

### 10.4 fixture 模式

`client-web` 当前支持 fixture 模式。AI 面板在 fixture 模式下默认禁用主动执行：

- 允许浏览模板
- 允许创建实例
- 不允许真正启动 run

避免用户误以为离线样例也会真实操作游戏世界。

## 11. 安全、可靠性与故障处理

### 11.1 不给任意 shell

网关必须坚持以下原则：

- Agent 不能直接拿到 Bash
- Agent 不能直接读写仓库文件
- Agent 不能自己发任意 HTTP 请求
- 所有“操作游戏”的动作都必须落到白名单命令运行时

### 11.2 Provider 故障降级

典型故障：

- `codex` 二进制不存在
- `claude` 未登录
- HTTP API 401/429/5xx
- 模型输出 JSON 不合法

统一降级策略：

- 记录错误事件
- 当前 run 标记为 `error`
- 保留最后一轮原始输出与解析错误
- 前端允许用户“重试本轮”或“复制错误详情”

### 11.3 运行互斥

第一阶段每个 Agent 实例只允许一个 active run：

- 避免并发 run 相互污染记忆
- 避免多个循环同时操作同一玩家资源

若需要并行处理，用户应显式创建多个实例。

## 12. 测试策略

### 12.1 Agent Gateway 单元测试

覆盖：

- 模板存储
- 实例存储
- 导入导出编解码
- CLI provider 探测
- HTTP provider 响应解析
- 动作协议校验
- 白名单校验

### 12.2 CLI 工具层测试

覆盖：

- 文本命令到运行时的解析
- 命令白名单
- 查询命令与动作命令的返回规范化

优先复用 `client-cli/src/commands/*.test.ts` 的已有逻辑，再补网关侧运行时测试。

### 12.3 Client-Web 测试

覆盖：

- `/agents` 路由渲染
- 模板新增/编辑/校验
- 从模板创建实例
- 发送消息并展示 SSE 日志
- 导入/导出流程
- fixture 模式下的禁用状态

### 12.4 手工联调

必须至少做四组联调：

1. HTTP Provider + 在线服务端
2. `codex` CLI Provider + 在线服务端
3. `claude` CLI Provider + 在线服务端
4. fixture 模式 + AI 面板禁用校验

## 13. 里程碑拆分

建议按以下顺序推进：

### M1. Agent Gateway 骨架

- 起本地 HTTP 服务
- 打通健康检查和模板存储
- Web 可连接到网关

### M2. Provider 接入

- 先接 OpenAI 兼容 HTTP Provider
- 再接 `codex exec`
- 最后接 `claude -p`

### M3. 游戏 CLI 工具层

- 从 `client-cli` 抽出可编程执行层
- 网关能稳定执行查询和命令

### M4. Web AI 面板

- `/agents` 页面
- 模板/实例/线程
- 运行日志与 SSE

### M5. 导入导出与收尾

- bundle 导入导出
- 加密密钥导出
- 文档、测试、联调

## 14. 结论

本方案的核心不是“把一个聊天框塞进 `client-web`”，而是把模型调用、游戏命令、执行约束、日志审计拆成清晰边界：

- `client-web` 只做 AI 控制台
- `agent-gateway` 负责模型与运行时
- `client-cli` 负责沉淀统一命令面
- `shared-client` 继续作为游戏 API 共享封装

这样可以同时满足：

- API Key 不进入浏览器
- 支持 HTTP 模型模板
- 支持本机 `codex` / `claude code`
- Agent 能“用 CLI 操作游戏”
- 后续再演进到服务端托管时，也不会推翻前端与运行时边界
