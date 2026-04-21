# T123 AI Agent 军事自治、权限边界与战区委派闭环

## 背景

SiliconWorld 的核心差异之一是 AI Agent 是一等公民。战争系统如果不能被 agent 接手，就会和项目总体方向脱节。

设计文档已经明确军事自治应拆成：

- 军工参谋
- 后勤参谋
- 舰队参谋
- 地面指挥官
- 情报官
- 总参谋

同时又要满足权限可控、结果可审计，避免 agent 越权乱用全局资源。

## 设计参考

- `docs/dev/战争组件设计.md`
  - 第 18 章“AI Agent 职责切分”
  - 第 9.3 节“战区”

## 需求细节

1. agent 必须能接手军事工作流，而不是只能做经济和建造。
2. 军事自治必须建立在：
   - 战区
   - 权限范围
   - 可审计结果
   上，而不是全局无限控制。
3. 任务模型必须允许玩家把“目标”交给 agent，而不要求每一步手写命令。

## 前提任务

- `T114_舰队任务群战区与姿态指挥链路.md`
- `T115_军事情报分级侦察链路与电子战基础.md`
- `T116_军事补给燃料弹药与维修体系.md`
- `T118_制轨权轨道封锁与登陆投送闭环.md`
- `T119_行星层机甲战前线据点与轨道支援闭环.md`
- `T120_客户端CLI战争命令与查询链路补齐.md`
- `T122_战争验证场景与自动化回归基线.md`

## 可能涉及的代码范围

- `agent-gateway/src/*`
- `client-web/src/pages/*agents*`
- `client-cli/src/agent-api.ts`
- `shared-client/src/api.ts`

## 改动需求

1. 为军事 agent 定义清晰职责与权限边界，至少覆盖：
   - 战区范围
   - 可调用命令类型
   - 资源上限
   - 是否允许发起登陆 / 封锁 / 量产
2. 建立战区委派链路，允许玩家把战区或任务群交给特定 agent。
3. agent 执行军事任务后，必须返回可审计结果：
   - 做了什么
   - 为什么这么做
   - 当前战区状态如何
   - 是否需要玩家批准更高风险动作
4. 至少补齐以下高价值军事任务模板：
   - 侦察某恒星系
   - 维持某战区补给
   - 组织某次登陆准备
   - 维持某任务群巡逻 / 护航

## 不在本任务范围

- 不要求把所有战争细节都自动化
- 不要求新增完整战役脚本系统
- 不要求最终玩家文档收口

## 验收标准

1. 玩家可把战区或战争任务委派给 agent，而不是只能手工操控。
2. agent 军事权限具备明确边界，不是默认全局最高权限。
3. 军事 agent 返回的是实际执行结果和局势总结，而不是空泛“已开始处理”。
4. 至少一条军事自治链路可在官方战争验证场景中稳定回归。

## 完成情况

- 完成时间：2026-04-20
- 结果：已完成
- 实现摘要：
  - `agent-gateway` 新增军事 policy 模型与统一归一化逻辑，补上 `theaterIds`、`taskForceIds`、`allowedCommandIds`、量产上限和 `allowBlockade / allowLanding / allowMilitaryProduction` 三个高风险开关；下级 agent 创建与更新也会继承并受父级边界约束。
  - `agent-gateway` 的 typed `game.command` 扩展到战争链路，已支持 `system_runtime`、`war_industry`、`task_forces`、`theaters`、`queue_military_production`、`task_force_set_stance`、`task_force_deploy`、`blockade_planet`、`landing_start`，并把军事委派上下文与任务模板注入 provider prompt。
  - `client-cli` runtime 新增军事硬限制：战争命令必须命中 `allowedCommandIds`，并基于 authoritative `/world/warfare/theaters` 与 `/world/warfare/task-forces` 校验战区 / 任务群 / system / planet 是否越界；封锁、登陆、量产会继续受风险开关和量产上限约束。
  - agent 完成军事动作后会自动补一段可审计摘要，至少覆盖“做了什么 / 为什么 / 当前战区状态 / 需要玩家批准”，避免只返回空泛中间态。
  - CLI 侧 `agent_create` / `agent_update` 已补齐军事委派参数；`docs/dev/agent-gateway.md` 与 `docs/dev/客户端CLI.md` 已同步更新本次真实口径。
- 关键验证：
  - `cd client-cli && npm test`
  - `cd agent-gateway && npm test`
  - `cd agent-gateway && npm test -- src/t123_military_autonomy.test.ts`
