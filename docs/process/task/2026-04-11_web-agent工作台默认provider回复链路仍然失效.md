# 2026-04-11 Web 智能体工作台默认 Provider 回复链路仍然失效

## 背景

- 试玩日期：2026-04-11
- 试玩方式：`client-web` 为主，`client-cli` 与 `agent-gateway` 日志辅助核对
- 环境：全新隔离目录 `.run/deep-playtest-20260411/`
- 入口：`http://127.0.0.1:5173/agents`

## 复现结果

当前 Web 智能体工作台可以完成以下前半段动作：

- 新建成员
- 绑定默认内置 Provider `builtin-minimax-api`
- 保存权限范围
- 发起私聊
- 发送任务消息

但只要进入真实 turn 执行，成员就不会产出有效回复，页面只会收到 system failure。

本轮实测步骤：

1. 在 `/agents` 新建成员 `李斯`
2. 绑定 `builtin-minimax-api`
3. 保存权限：
   - `planetIds = ['planet-1-1']`
   - `commandCategories = ['observe', 'build', 'research', 'management']`
   - `canCreateAgents = true`
   - `canManageMembers = true`
4. 发起与 `李斯` 的私聊
5. 发送纯观察任务：
   - `请先只做观察，不要执行命令。汇报 planet-1-1 当前状态，并说明下一步最值得做的 2 件事。`

实际现象：

- Web 页面对话里出现：
  - `李斯 回复失败：执行失败，请稍后重试。`
- `agent-gateway` 后台日志仍然给出真实根因：
  - `rawError: 'action.type is required'`
- turn 落库结果为失败：
  - `conversationId = ee4d6b0f-822f-4b43-a163-261775525234`
  - `turnId = 69c54d96-04ca-4ba9-ab64-3b8cc1635d54`
  - `errorCode = unknown`

## 影响

- Web 端当前无法验证“指令智能体完成任务”这条主目标
- 纯观察请求都失败，后续更复杂的：
  - 创建下级智能体
  - 权限分配
  - 委派建造
  - 委派科研
  都无法进入真实可玩状态
- 从玩家视角看，工作台像是“能建成员但不能工作”

## 改动需求

1. 修复 `builtin-minimax-api` 的 turn 输出兼容，确保最简单的观察请求也能产出合法的 `{ assistantMessage, actions, done }` 结构。
2. 明确支持“无工具动作、直接回复”的场景，不应再因为缺少 `action.type` 把整轮 turn 判死。
3. 在 `agent-gateway` 增加回归用例：
   - 内置 MiniMax Provider
   - 纯观察消息
   - 空动作或仅 `final_answer`
   - Web 会话成功回挂正式回复
4. 修复后必须重新用 Web 复测以下链路：
   - 新建成员
   - 保存权限
   - 私聊观察任务成功回复
   - 让上级成员创建下级成员
   - 让成员执行至少 1 次建造或科研任务

## 验收标准

- `/agents` 中默认内置 Provider 可以稳定回复
- 会话中出现正式 agent 回复，而不是 system failure
- 至少能完成一条真实委派链：
  - `创建下级 -> 分配权限 -> 下级执行建造/科研 -> authoritative 成功`
