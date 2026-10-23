# API 重试代理

默认子代理（deepseek-v4.1-flash，经 tako 网关）约 1/4 的会话会撞上网关偶发的 400：

| 次数（截至 2026-10-21） | 错误 |
|---|---|
| 30 | `400 {"code":11128,"msg":"conversation id missing",…"Request blocked. Please send it again"}` |
| 28 | `400 {"type":"invalid_request_error","code":"","message":"invalid request error trace_id: …"}` |
| 10 | `400 {"code":11133,…"model_param_invalid"}` |
| 5 | `500 upstream error: do request failed` |
| 2（2026-10-23 起） | `400 The \`content[].thinking\` in the thinking mode must be passed back to the API` |

Claude Code 把 400 当客户端错误、不重试，子代理当场结束，只能靠主代理再派或说「继续」。
本代理夹在 Claude Code 和网关之间：上游回这几类 400 或 5xx 时，在任何字节回给客户端之前原样重发
（退避 1/2/4/8/15 秒，最多 6 次、总计 90 秒），成功的响应（SSE 流）不缓冲直接透传。
别的 400（真的参数错误）立即原样返回。主代理的请求也走这里，行为不变。

### 放弃之后

| 错误 | 重试用尽后交回 | 理由 |
|---|---|---|
| `11128`（原文要求重新发送） | **503** + `x-should-retry: true` | 明确是临时的，让 Claude Code 再按 5xx 自己重试（默认最多 10 次，每次又经过本代理） |
| `11133 model_param_invalid`、`invalid_request_error code:""`、`thinking must be passed back` | 原样 400 | 可能是请求本身固定会错，尽快失败、重派；看 `retry.log` 的 `giveup` 行积累数据后再决定要不要也改 503 |
| 5xx / 连不上 | 原样 5xx / 502 | Claude Code 本来就会重试 |

不用 529：Claude Code 对 529 有特殊处理（Opus 连续 3 次就停），比普通 5xx 重试得少。

Claude Code 等得住：走自定义 `ANTHROPIC_BASE_URL` 时，等响应头最先到的限制是 5 分钟无字节超时（首字节 3 分钟期限对网关连接不生效）。2026-10-21 实测让它干等 90 秒（9 次重试）照常完成。

## 用法

```bash
bash develop_tools/api-retry-proxy/install.sh        # 装成 systemd 用户服务，监听 127.0.0.1:18990
bash develop_tools/api-retry-proxy/switch-tako.sh on # tako 改走代理；off 改回直连；不带参数看状态
# 重启 tako --claude 生效
```

tako 启动 Claude Code 时用 `--settings` 写死 `ANTHROPIC_BASE_URL`，优先级高于项目和用户 settings，
所以只能改 tako 的 provider 地址（`~/.tako/config.json`，脚本会先备份）。tako 升级后若被改回，
`switch-tako.sh` 不带参数能看出来。

## 观察

- 重试日志：`~/.local/state/api-retry-proxy/retry.log`（每行一个 JSON：`retry` / `recovered` / `giveup`，不记请求内容和密钥）。
- 每个响应带 `x-retry-proxy-attempts` 头。
- 服务状态：`systemctl --user status api-retry-proxy`。

## 测试（故障注入）

```bash
PORT=18991 FAULT_400=3 FAULT_MODEL=deepseek LOG_FILE=/tmp/arp/retry.log node proxy.mjs
```

对 model 匹配 `FAULT_MODEL` 的前 `FAULT_400` 个 POST 假装上游回 11128，走正常重试路径。
2026-10-21 用它端到端验证过：`claude -p --settings '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:18991/api"}}'`
派出的子代理连吃 3 次 400 后正常完成，主进程无感知。

## 配套：SubagentStop 钩子

`.claude/hooks/subagent-deliver-check.py`（在 `.claude/settings.json` 注册）处理另一种失败——子代理没报错、
只回一句 "Now let me…" 就结束。prompt 里提到「子代理须知」的子代理，最后一条回复没有 `## 交付` 段就被
推回去继续，每个子代理最多 5 次。
