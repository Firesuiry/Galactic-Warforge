# T120 客户端 CLI 战争命令与查询链路补齐

## 背景

前面任务主要解决服务端 authoritative 能力，但当前玩家真实可操作入口仍高度依赖：

- `client-cli`
- `shared-client`

如果 CLI 不能覆盖蓝图、量产、补给、任务群、战区、情报、战报和登陆，后续：

- 自动化回归
- AI agent 真实执行
- 纯 CLI 验证

都会被卡住。

## 设计参考

- `docs/dev/战争组件设计.md`
  - 第 16 章“命令、API 与 CLI 草案”

## 需求细节

1. `client-cli` 需要覆盖战争系统的最小玩家闭环。
2. `shared-client` 需要同步更新类型与 API helper。
3. CLI 帮助和格式化输出不能继续停留在旧舰队线语义。

## 前提任务

- `T113_战争蓝图量产改型翻修与部署枢纽闭环.md`
- `T114_舰队任务群战区与姿态指挥链路.md`
- `T115_军事情报分级侦察链路与电子战基础.md`
- `T116_军事补给燃料弹药与维修体系.md`
- `T117_太空导弹战点防御子系统伤害与战报闭环.md`
- `T118_制轨权轨道封锁与登陆投送闭环.md`
- `T119_行星层机甲战前线据点与轨道支援闭环.md`

## 可能涉及的代码范围

- `shared-client/src/api.ts`
- `shared-client/src/types.ts`
- `client-cli/src/command-catalog.ts`
- `client-cli/src/api.ts`
- `client-cli/src/format.ts`
- `client-cli/src/main.ts`

## 改动需求

1. CLI 至少补齐以下能力或等价能力：
   - 蓝图创建、编辑、校验、定型、改型查询
   - 军工排产、翻修、部署
   - 任务群 / 战区创建与状态查询
   - contacts / supply / battle_report 查询
   - 封锁、登陆、轨道支援相关命令
2. `help`、命令目录和格式化输出必须同步反映新战争系统能力。
3. 关键查询输出要面向玩家可读，而不是只能看原始 JSON。
4. 现有旧舰队命令要完成迁移或收口：
   - 能复用则明确与新模型的关系
   - 不能复用则停止伪装“已完成”

## 不在本任务范围

- 不要求实现 Web 交互
- 不要求实现 AI agent 自治
- 不要求更新最终玩家文档

## 验收标准

1. 纯 CLI 可完成战争系统核心闭环：
   - 设计
   - 量产
   - 部署
   - 编制
   - 情报查询
   - 补给查询
   - 战报查询
   - 登陆 / 封锁操作
2. `shared-client`、CLI 命令目录、帮助输出和服务端能力口径一致。
3. CLI 查询输出足以支撑自动化回归和人工试玩，不必依赖读原始 HTTP JSON。

## 完成情况

- 完成时间：2026-04-20
- 结果：已完成
- 实现摘要：
  - `shared-client` 补齐战争命令与运行态类型，新增 `blockade_planet`、`landing_start` 等命令类型，并扩展 `task_force_deploy` 所需的 `frontline_id`、`ground_order`、`support_mode` 参数。
  - `client-cli` 补齐战争查询链路，新增 `planet_runtime`、`blueprints`、`war_industry`、`task_forces`、`theaters`，并为行星运行态、军工、任务群、战区增加面向玩家可读的格式化输出。
  - `client-cli` 补齐战争动作链路，新增蓝图创建/编辑/校验/定型/改型、军工排产与翻修、任务群/战区指挥、封锁与登陆等独立命令，并同步更新帮助与命令注册。
  - 原有 `deploy_squad` / `commission_fleet` 不再硬编码限制公开蓝图，允许玩家使用自定义已定型蓝图进入部署链路，避免 CLI 继续停留在旧舰队线语义。
  - 已同步更新 `docs/dev/客户端CLI.md`，补充战争命令、查询、帮助口径和最小 CLI 闭环说明。
- 关键验证：
  - `npm --prefix client-cli test`
  - `cd client-cli && npx tsc --noEmit`
  - 实机 CLI 验证：
    - `blueprints` 可正常返回无蓝图提示 `No warfare blueprints.`
    - `war_industry` 可输出 `Production Orders / Refit Orders / Deployment Hubs / Supply Nodes`
    - `task_force_create tf-cli-20260420b` 最终 `command_result.status=executed`
    - `task_forces` 可查询到 `tf-cli-20260420b`
    - `blockade_planet tf-cli-20260420b planet-1-1` 最终 `command_result.status=failed`，失败原因是任务群没有舰队成员，说明 CLI 已能走通失败回执与对账链路
