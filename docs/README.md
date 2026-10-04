# 文档索引

历史文档已删除，需要时从 git tag `pre-refactor-2026-10` 找回。

## 开发（docs/dev）

| 文档 | 内容 |
| --- | --- |
| [architecture.md](dev/architecture.md) | 系统边界、模块划分、数据流与当前能力 |
| [服务端API.md](dev/服务端API.md) | HTTP / SSE 契约；命令一览由脚本生成 |
| [客户端CLI.md](dev/客户端CLI.md) | CLI 用法；命令一览由脚本生成 |
| [client-web.md](dev/client-web.md) | Web 客户端页面、启动与回归 |
| [agent-gateway.md](dev/agent-gateway.md) | 本地 Agent 网关 |
| [数据配置文件.md](dev/数据配置文件.md) | `server/data/*.yaml` 格式 |
| [本地环境与测试.md](dev/本地环境与测试.md) | 启动本地环境、各端测试命令 |
| [战争系统设计.md](dev/战争系统设计.md) | 战争系统当前设计 |

命令一览更新：`python3 scripts/gen_command_docs.py`；校验：`python3 scripts/command_coverage.py --check`。

## 规划（docs/guide）

| 文档 | 内容 |
| --- | --- |
| [整体规划.md](guide/整体规划.md) | 阶段路线图 |
| [缺失内容清单.md](guide/缺失内容清单.md) / [进度](guide/缺失内容清单-进度.md) | 剩余缺口与实施进度 |
| [对局设计决策.md](guide/对局设计决策.md) | 已拍板的对局设计 |
| [星球玩法覆盖与验收.md](guide/星球玩法覆盖与验收.md) | DSP 行星内对齐范围、覆盖状态与浏览器回归 |
| [3D与画质.md](guide/3D与画质.md) | 立方体球面网格、3D 表现、画质与素材 |
| [视频制作指南.md](guide/视频制作指南.md) | 试玩介绍视频流程 |
| [重构方案.md](guide/重构方案.md) | 2026-10 重构分阶段计划 |

## 玩家与测试（docs/player）

| 文档 | 内容 |
| --- | --- |
| [玩法指南.md](player/玩法指南.md) | 当前能玩什么、推进路线、CLI 示例 |
| [试玩验收清单.md](player/试玩验收清单.md) | 大版本人工试玩脚本 |
| [known-issues.md](player/known-issues.md) | 未解决问题 |

`docs/remotion/` 是独立的视频工程。
