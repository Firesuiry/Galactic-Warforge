# T101 Final Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 实现 T101：收口公开单位边界，并把太阳帆迁入 snapshot-backed 的 system-scoped authoritative runtime。

**Architecture:** 服务端新增 authoritative `unit catalog` 作为 `/catalog.units`、`produce` 与 CLI 帮助的唯一真相来源；同时新增顶层 `SpaceRuntimeState` 挂到 snapshot/save/replay/rollback，替代包级 `solarSailOrbits`。实现顺序按“先边界、后 runtime、再客户端与文档、最后验证与清理”推进。

**Tech Stack:** Go server, TypeScript shared-client/client-cli, Markdown docs, Go test, Node test

---

### Task 1: 锁住单位目录边界

**Files:**
- Modify: `server/internal/model/tech_alignment_test.go`
- Modify: `server/internal/query/runtime_networks_catalog_test.go`
- Modify: `server/internal/gamecore/t099_fuel_generator_state_test.go`
- Modify: `client-cli/src/commands/action.test.ts`
- Modify: `client-cli/src/commands/index.test.ts`

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行这些测试并确认因 `catalog.units`/`produce` 旧实现失败**
- [ ] **Step 3: 实现 authoritative unit catalog、`/catalog.units` 与 `produce` 新校验**
- [ ] **Step 4: 重新运行单测直到通过**

### Task 2: 迁移太阳帆到 SpaceRuntimeState

**Files:**
- Create: `server/internal/model/unit_catalog.go`
- Create: `server/internal/model/space_runtime.go`
- Modify: `server/internal/model/solar_sail_orbit.go`
- Modify: `server/internal/snapshot/snapshot.go`
- Modify: `server/internal/gamecore/core.go`
- Modify: `server/internal/gamecore/rules.go`
- Modify: `server/internal/gamecore/solar_sail_settlement.go`
- Modify: `server/internal/gamecore/ray_receiver_settlement.go`
- Modify: `server/internal/gamecore/replay.go`
- Modify: `server/internal/gamecore/rollback.go`
- Modify: `server/internal/gamecore/save_state.go`
- Modify: `server/internal/model/replay.go`
- Modify: `server/internal/gamecore/dyson_commands_test.go`
- Modify: `server/internal/gamecore/ray_receiver_settlement_test.go`
- Modify: `server/internal/gamecore/save_state_test.go`
- Modify: `server/internal/gamecore/rollback_test.go`

- [ ] **Step 1: 写失败测试，覆盖唯一 ID、system scope、save/restore、replay/rollback digest**
- [ ] **Step 2: 运行失败测试确认当前全局太阳帆实现不满足要求**
- [ ] **Step 3: 实现 `SpaceRuntimeState` 与快照链路**
- [ ] **Step 4: 重新运行 Go 测试直到通过**

### Task 3: 同步 shared-client、CLI 与文档

**Files:**
- Modify: `shared-client/src/types.ts`
- Modify: `shared-client/src/api.ts`
- Modify: `client-cli/src/api.ts`
- Modify: `client-cli/src/commands/action.ts`
- Modify: `client-cli/src/commands/util.ts`
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/player/已知问题与回归.md`

- [ ] **Step 1: 让类型、CLI 帮助与服务端新语义对齐**
- [ ] **Step 2: 更新文档说明 `/catalog.units`、`produce` 与太阳帆 runtime 语义**
- [ ] **Step 3: 运行 Node 测试确认 CLI 行为通过**

### Task 4: 验证与收尾

**Files:**
- Delete: `docs/process/task/T101_戴森深度试玩复测后终局舰队线仍未开放且太阳帆批量发射实体ID冲突.md`

- [ ] **Step 1: 运行 T101 相关 Go/Node 测试并检查输出**
- [ ] **Step 2: 删除已完成任务文件**
- [ ] **Step 3: 复查 `git diff`，确认只包含 T101 相关改动**
