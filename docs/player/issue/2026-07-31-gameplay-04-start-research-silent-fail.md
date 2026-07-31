# start_research 缺矩阵时静默失败，无可见错误反馈

- 状态：待修复
- 首次记录：2026-07-31
- 来源：路径 A 试玩
- 类别：Gameplay / 科研 / 反馈

## 问题描述

玩家在空矩阵研究站（无 electromagnetic_matrix）时执行 `start_research electromagnetism`，
HTTP 网关返回 `{"status":"accepted","message":"accepted, will execute at next tick"}`，
但 tick 结算时因矩阵为 0 被 `execStartResearch` 拒绝，`current_research` 保持为 null，
玩家看不到任何失败提示。

## 实际现象

```
POST /commands  {"type":"start_research","payload":{"tech_id":"electromagnetism"}}
→ {"status":"accepted"}   ← 玩家以为成功
→ 等待数十 tick
→ GET /state/summary: current_research=null  ← 研究从未开始
→ audit log: CodeValidationFailed "missing electromagnetic_matrix in research labs"  ← 藏在审计日志
```

## 根因

`execStartResearch` 在 tick 时做业务校验（实验室存在 + 矩阵库存 > 0），失败返回
`CodeValidationFailed`，但该结果只进审计日志，不在 summary/briefing/events 中推送给玩家。

## 推荐改进

两种方案，取第一种（低风险）：

**A（推荐）**：网关 `pre-validate` 对 `start_research` 增加即时检查：
- 有无运行中研究站（可查 worldstate）
- 研究站库存中有无所需矩阵
若不满足直接返回 `status:rejected` + 中文原因；不改动 tick 逻辑。

**B（更彻底）**：`execStartResearch` 失败时同时 emit 一条 `EvtCommandFailed` 事件，
客户端 SSE / briefing/alerts 能展示。
