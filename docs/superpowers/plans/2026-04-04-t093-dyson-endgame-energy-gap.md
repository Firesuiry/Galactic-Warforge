# T093 Dyson Endgame And Energy Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 收口戴森终局科技树与能源摘要缺口，使终局弹药、科技胜利、能源统计和玩家可见科技树重新与运行时实现一致。

**Architecture:** 保持现有 authoritative world + command/query 分层，不引入兼容层或新玩法外壳。服务端只补当前 runtime 已能承载的闭环，未有承载层的高阶单位科技改为在 catalog 中降级隐藏。能源摘要统一从 power network / allocation / energy storage 的真实结算结果聚合，胜利状态统一抽成结构化 runtime 信息并同步到事件、摘要、持久化和审计。

**Tech Stack:** Go 1.25、现有 `server/internal/model` 与 `server/internal/gamecore`、HTTP gateway/query 层、仓库内 Markdown 文档。

---

## 文件边界

- `server/internal/model/item.go`
  - 新增 `antimatter_capsule`、`gravity_missile` 的 runtime item 定义。
- `server/internal/model/recipe.go`
  - 新增两条终局弹药 recipe，并挂到 `recomposing_assembler`。
- `server/internal/model/tech.go`
  - 为 `unit unlock` 增加 runtime 支持名单校验。
  - 隐藏 `prototype`、`precision_drone`、`corvette`、`destroyer`。
- `server/internal/model/event.go`
  - 新增 `victory_declared` 事件类型。
- `server/internal/model/victory.go`（若无则新增）
  - 定义结构化胜利信息与胜利规则常量，避免字符串散落。
- `server/internal/gamecore/research.go`
  - 保持 `research_completed` 先发出，为后续科技胜利判定提供输入。
- `server/internal/gamecore/rules.go`
  - 将 `checkVictory` 替换为统一的胜利解析逻辑。
- `server/internal/gamecore/core.go`
  - 在 tick 结算时写入结构化胜利状态并发出 `victory_declared` 事件。
- `server/internal/gamecore/stats_settlement.go`
  - 从真实网络/分配/储能状态聚合玩家能源摘要。
- `server/internal/gamecore/save_state.go`
  - 保存和恢复扩展后的胜利状态。
- `server/internal/gamecore/audit.go`
  - 增加 victory 审计记录。
- `server/internal/gamedir/files.go`
  - 扩展 `RuntimeState` 持久化字段。
- `server/internal/query/query.go`
  - `/state/summary` 返回 `victory_reason`、`victory_rule`。
- `server/internal/gateway/server.go`
  - 将新的胜利信息注入 summary。
- `server/config.yaml`
  - 改为 `victory_rule: hybrid`。
- `server/config-dev.yaml`
  - 改为 `victory_rule: hybrid`。
- `server/config-midgame.yaml`
  - 改为 `victory_rule: hybrid`。
- `server/internal/model/tech_alignment_test.go`
  - 增加 tech unlock 与 runtime catalog/unit 支持名单的一致性测试。
- `server/internal/model/t090_catalog_test.go`
  - 增加终局弹药 item/recipe/runtime 建筑覆盖测试。
- `server/internal/gamecore/t093_endgame_closure_test.go`（新增）
  - 覆盖科技胜利、事件、审计、摘要和能源统计。
- `server/internal/gamecore/save_state_test.go`
  - 补结构化胜利状态的保存恢复断言。
- `server/internal/gamedir/files_test.go`
  - 补 `RuntimeState` 新字段读写断言。
- `docs/dev/服务端API.md`
  - 同步 `victory_declared`、`/state/summary` 新字段、`hybrid` 胜利规则和终局弹药 recipe。
- `docs/dev/客户端CLI.md`
  - 明确 CLI 继续复用现有 `build ... --recipe ...` 生产终局弹药，无新增命令。
- `docs/player/玩法指南.md`
  - 补终局科研与弹药生产路径、科技胜利说明。
- `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`
  - 同步当前真实可玩范围和隐藏的未实现高阶单位线。
- `config/defs/items/combat/gravity_missile.yaml`
  - 重命名或改 canonical id 为 `gravity_missile`，与 runtime 一致。
- `docs/process/task/T093_戴森终局科技树与能源局势统计缺口.md`
  - 完成后删除。

## 任务 1：先写失败测试锁定 T093 边界

- [ ] 在 `server/internal/model/tech_alignment_test.go` 增加断言：
  - `mass_energy_storage` 暴露 `recipe: antimatter_capsule`
  - `gravity_missile` 暴露 `recipe: gravity_missile`
  - `engine` 不再暴露假的 `unit unlock`
  - `prototype`、`precision_drone`、`corvette`、`destroyer` 为 `hidden=true`
- [ ] 在 `server/internal/model/t090_catalog_test.go` 增加断言：
  - `Item(\"antimatter_capsule\")`、`Item(\"gravity_missile\")` 存在
  - 对应 recipe 存在并绑定 `recomposing_assembler`
- [ ] 新增 `server/internal/gamecore/t093_endgame_closure_test.go`：
  - 构造 `mission_complete` 完成场景，先看到 `research_completed`，再看到 `victory_declared`
  - 断言 `Winner/VictoryReason/VictoryRule/TechID` 被写入 runtime
  - 构造 `ray_receiver + energy_storage` 场景，断言 `generation/current_stored/shortage_ticks` 来自真实结算值
- [ ] 扩展 `server/internal/gamecore/save_state_test.go` 与 `server/internal/gamedir/files_test.go`：
  - 先写会失败的保存/恢复胜利信息断言。
- [ ] 运行定向测试，确认当前代码真实失败：
  - `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model ./internal/gamecore ./internal/gamedir ./internal/gateway`

## 任务 2：补齐终局弹药与科技树 runtime 闭环

- [ ] 在 `server/internal/model/item.go` 新增终局弹药 item 常量与 catalog 项。
- [ ] 在 `server/internal/model/recipe.go` 新增两个 recipe：
  - `antimatter_capsule`
  - `gravity_missile`
- [ ] 在 `server/internal/model/tech.go` 实现 `TechUnlockUnit` runtime 支持名单过滤。
- [ ] 将 `prototype`、`precision_drone`、`corvette`、`destroyer` 标记为 `Hidden: true`，保留 `engine` 为可见 prerequisite tech。
- [ ] 修正 `config/defs/items/combat/gravity_missile.yaml` 的 canonical id 与文件名。
- [ ] 重新运行 model 相关测试直至转绿：
  - `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model`

## 任务 3：接入结构化科技胜利

- [ ] 新增或扩展 victory model，统一 `winner_id`、`reason`、`victory_rule`、`tech_id`。
- [ ] 在 `server/internal/gamecore/rules.go` 把胜负判定升级为：
  - `mission_complete`
  - `elimination`
  - `hybrid`
- [ ] 在 `server/internal/gamecore/core.go`：
  - tick 内锁定胜利状态
  - 只在首次宣告时追加 `victory_declared` 事件
  - 写入 victory 审计
- [ ] 在 `server/internal/gamecore/save_state.go`、`server/internal/gamedir/files.go`、`server/internal/query/query.go`、`server/internal/gateway/server.go` 串起摘要与持久化字段。
- [ ] 将三个公开配置改为 `victory_rule: hybrid`。
- [ ] 运行胜利相关定向测试：
  - `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/gamecore ./internal/gamedir ./internal/gateway`

## 任务 4：把能源摘要切换到真实结算数据源

- [ ] 在 `server/internal/gamecore/stats_settlement.go` 抽出玩家级能源聚合 helper。
- [ ] 聚合来源固定为：
  - `ResolvePowerNetworks`
  - `ResolvePowerAllocations`
  - `building.EnergyStorage.Energy`
- [ ] `generation` 使用玩家网络的真实 `Supply` 合计。
- [ ] `consumption` 使用真实 `Allocated` 合计。
- [ ] `storage/current_stored` 只从自有储能建筑读取。
- [ ] `shortage_ticks` 仅当任一玩家网络 shortage 为真时递增。
- [ ] 运行能源统计相关测试直到转绿：
  - `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/gamecore ./internal/query`

## 任务 5：同步文档并清理任务文件

- [ ] 更新 `docs/dev/服务端API.md` 的事件、summary 字段、胜利规则和终局弹药说明。
- [ ] 更新 `docs/dev/客户端CLI.md`，说明终局弹药仍由 `build ... --recipe ...` 进入生产。
- [ ] 更新 `docs/player/玩法指南.md` 的终局玩法与研究获胜说明。
- [ ] 更新 `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`，写明高阶单位线当前被隐藏降级。
- [ ] 删除已完成任务文件 `docs/process/task/T093_戴森终局科技树与能源局势统计缺口.md`。

## 最终验证

- [ ] 运行最小回归集：
  - `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model ./internal/gamecore ./internal/gamedir ./internal/gateway ./internal/query`
- [ ] 如服务端集成测试依赖完整启动，再运行：
  - `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./...`
- [ ] 若改动影响玩家视图，检查 `/state/summary`、`/state/stats`、`/catalog` 与事件接口返回字段是否一致。
