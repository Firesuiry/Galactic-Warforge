# T100 Authoritative Fleet Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 真正开放终局高阶舰队线，补齐研究、生产载荷、部署、查询、战斗、存档与 CLI/文档闭环。

**Architecture:** 以 authoritative runtime 为唯一真相来源。`prototype`/`precision_drone` 写入行星 `CombatRuntimeState`，`corvette`/`destroyer` 写入星系 `SpaceRuntimeState`；高阶单位通过工厂 recipe 生产为 item，再由 `battlefield_analysis_base` 消耗本地存储完成部署。`produce` 只保留 `worker`/`soldier` 两种 world unit。

**Tech Stack:** Go server, Go test, TypeScript shared-client/client-cli, Node test, Markdown docs

---

### Task 1: 收口目录、科技与载荷配方

**Files:**
- Modify: `server/internal/model/unit_catalog.go`
- Modify: `server/internal/model/item.go`
- Modify: `server/internal/model/recipe.go`
- Modify: `server/internal/model/tech.go`
- Modify: `server/internal/model/tech_alignment_test.go`
- Modify: `server/internal/query/catalog.go`
- Modify: `server/internal/gamecore/research.go`

- [ ] 写失败测试，锁住 hidden tech gate、`/catalog.units` 公开边界、4 个载荷 item/recipe 与 tech unlock
- [ ] 让 `prototype` / `precision_drone` / `corvette` / `destroyer` 成为 authoritative item 与 recipe
- [ ] 给 `start_research` 增加 hidden tech 校验
- [ ] 执行相关 Go 测试直到通过

### Task 2: 落地 authoritative combat/system runtime 与部署命令

**Files:**
- Create: `server/internal/model/combat_runtime.go`
- Modify: `server/internal/model/space_runtime.go`
- Modify: `server/internal/model/orbital_combat.go`
- Modify: `server/internal/model/building_runtime.go`
- Modify: `server/internal/model/command.go`
- Modify: `server/internal/model/event.go`
- Modify: `server/internal/model/world.go`
- Modify: `server/internal/snapshot/snapshot.go`
- Modify: `server/internal/gamecore/core.go`
- Modify: `server/internal/gamecore/rules.go`
- Modify: `server/internal/gamecore/replay.go`
- Modify: `server/internal/gamecore/rollback.go`
- Modify: `server/internal/gamecore/save_state.go`
- Create: `server/internal/gamecore/deployment_commands.go`
- Create: `server/internal/gamecore/runtime_fleet_settlement.go`

- [ ] 写失败测试，覆盖 `deploy_squad` / `commission_fleet` / `fleet_assign` / `fleet_attack` / `fleet_disband`
- [ ] 把 `battlefield_analysis_base` 改成带存储与 deployment module 的枢纽
- [ ] 让 squad / fleet 进入 snapshot、save、replay、rollback
- [ ] 让 tick 在 planet/system scope 上结算 squad 与 fleet
- [ ] 执行相关 Go 测试直到通过

### Task 3: 打通查询面、gateway、shared-client 与 CLI

**Files:**
- Modify: `server/internal/query/runtime.go`
- Create: `server/internal/query/fleet_runtime.go`
- Modify: `server/internal/query/query.go`
- Modify: `server/internal/gateway/server.go`
- Modify: `shared-client/src/types.ts`
- Modify: `shared-client/src/api.ts`
- Modify: `client-cli/src/api.ts`
- Modify: `client-cli/src/commands/action.ts`
- Modify: `client-cli/src/commands/query.ts`
- Modify: `client-cli/src/commands/util.ts`
- Modify: `client-cli/src/format.ts`

- [ ] 写失败测试，覆盖 `GET /world/systems/{system_id}/runtime`、`GET /world/fleets`、`GET /world/fleets/{fleet_id}`、CLI 新命令
- [ ] 补 `fleet_status`、`deploy_squad`、`commission_fleet`、`fleet_assign`、`fleet_attack`、`fleet_disband`
- [ ] 让 shared-client 类型与 server 响应一致
- [ ] 执行 Go/Node 测试直到通过

### Task 4: 文档同步、实验验证与任务清理

**Files:**
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/player/已知问题与回归.md`
- Modify: `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`
- Delete: `docs/process/task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`
- Add/Modify when needed: `docs/process/finished_task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`

- [ ] 同步 API/CLI/玩家文档到“研究 -> 生产载荷 -> 部署 -> 查询/战斗”的正式口径
- [ ] 启动真实服务，用 `client-cli` 完成至少一条高阶链路实验
- [ ] 回归 T100 指定的中后期建筑与戴森链路关键命令
- [ ] 清理已完成任务文件并整理最终结果
