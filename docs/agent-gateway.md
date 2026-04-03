# agent-gateway 使用说明

`agent-gateway` 是本地 AI 运行时，不属于 `server/`。它负责：

- 存模板、实例、线程、密钥
- 调 OpenAI 兼容 HTTP 模型
- 拉起本机 `codex` / `claude` CLI
- 调用受控的 `client-cli` 命令运行时
- 为 `client-web` 提供 `/agent-api` HTTP / SSE 接口

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

## 2. 支持的模板类型

### 2.1 OpenAI 兼容 HTTP

必填字段：

- `base_url`
- `api_key`
- `model`

说明：

- `api_key` 会先写入本地密钥库，再在模板里保存 `apiKeySecretId`
- 浏览器不会持久化明文 key

### 2.2 Codex CLI

必填字段：

- `command`，通常是 `codex`
- `workdir`
- `model`

当前调用方式：

- `codex exec`
- 通过 JSON Schema 约束最终输出结构
- 不向 Codex 直接开放任意 Bash

### 2.3 Claude Code CLI

必填字段：

- `command`，通常是 `claude`
- `workdir`
- `model`

当前调用方式：

- `claude -p`
- `--tools ""`
- `--permission-mode dontAsk`
- 通过 JSON Schema 输出结构化结果

## 3. CLI 工具边界

Agent 不能直接拿 shell。它只能通过受控的 `client-cli` 运行时使用白名单命令，例如：

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

## 4. 导入导出

导出接口：`POST /export`

导入接口：`POST /import`

当前 bundle 内容支持：

- `templates`
- `agents`
- `threads`

默认不导出密钥。分享模板时建议只导出模板定义。

## 5. 数据目录

默认数据目录位于：

- `agent-gateway/data`

结构如下：

```text
agent-gateway/data/
  templates/
  agents/
  threads/
  secrets/
  schemas/
```

其中：

- `templates/`：模板 JSON
- `agents/`：实例 JSON
- `threads/`：线程 JSON
- `secrets/`：加密后的 API Key / player key
- `schemas/`：Provider 结构化输出所需的 JSON Schema
