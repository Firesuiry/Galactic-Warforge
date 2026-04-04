# T091 Dyson Mid-Late Commands And Buildings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 落地 T091，修复两条公开命令的网关断档，补齐 4 个 DSP 建筑的真实玩法闭环，并更新 midgame 回归夹具、文档与任务状态。

**Architecture:** 公开命令仅补网关结构校验，业务语义仍留在 `gamecore`。`jammer_tower`、`sr_plasma_turret`、`self_evolution_lab` 复用现有模块与结算链；仅为 `planetary_shield_generator` 新增最小 `ShieldModule` 和护盾结算文件，再把吸伤挂到现有敌袭入口。测试按 TDD 先补模型/网关/闭环失败用例，再补实现并跑回归。

**Tech Stack:** Go 1.25, server gamecore/model/gateway tests, YAML config/docs

---

### Task 1: 补失败测试并锁定 T091 目标行为

**Files:**
- Modify: `server/internal/gateway/server_internal_test.go`
- Modify: `server/internal/model/t090_catalog_test.go`
- Modify: `server/internal/model/tech_alignment_test.go`
- Modify: `server/internal/model/recipe_test.go`
- Modify: `server/internal/gamecore/t090_closure_test.go`

- [ ] **Step 1: 先为网关命令结构校验补失败测试**

```go
func TestValidateCommandStructureAllowsPlanetAndRayReceiverCommands(t *testing.T) {
    cases := []model.Command{
        {Type: model.CmdSwitchActivePlanet, Payload: map[string]any{"planet_id": "planet-1-1"}},
        {Type: model.CmdSetRayReceiverMode, Payload: map[string]any{"building_id": "rr-1", "mode": "power"}},
    }
    for _, cmd := range cases {
        if err := validateCommandStructure(cmd); err != nil {
            t.Fatalf("expected %s to pass validation, got %v", cmd.Type, err)
        }
    }
}
```

- [ ] **Step 2: 运行网关测试，确认当前确实失败**

Run: `go test ./internal/gateway -run 'TestValidateCommandStructureAllowsPlanetAndRayReceiverCommands|TestValidateCommandStructureRejectsIncompletePlanetAndRayReceiverCommands'`
Expected: FAIL，错误指向 `unknown command type` 或缺少对应分支。

- [ ] **Step 3: 为 4 个建筑和新科技/runtime/配方补目录级失败测试**

```go
func TestT091BuildingsBecomeBuildableWithRuntimeAndTechCoverage(t *testing.T) {
    // assert defs buildable/build cost, runtime modules, tech unlocks, recipe building types, dark_fog_matrix item presence
}
```

- [ ] **Step 4: 运行模型测试，确认目录级约束尚未满足**

Run: `go test ./internal/model -run 'TestT091BuildingsBecomeBuildableWithRuntimeAndTechCoverage|TestTechDefinitionsAlignWithCatalog|TestRecipeCatalogBuildingTypesExist'`
Expected: FAIL，错误指向缺失 runtime、buildable、tech unlock、item 或 recipe 接线。

- [ ] **Step 5: 为闭环行为补失败测试**

```go
func TestT091JammerTowerRequiresPowerToSlowEnemyForce(t *testing.T) {}
func TestT091SRPlasmaTurretDamagesEnemyForceWhenPowered(t *testing.T) {}
func TestT091PlanetaryShieldGeneratorChargesAndAbsorbsDamage(t *testing.T) {}
func TestT091SelfEvolutionLabSupportsResearchAndMatrixRecipes(t *testing.T) {}
```

- [ ] **Step 6: 运行 gamecore 目标测试并确认失败**

Run: `go test ./internal/gamecore -run 'TestT091|TestSetRayReceiverModeRequiresUnlockAndPersistsOnBuilding'`
Expected: FAIL，错误指向建筑未接线或行为未实现。

### Task 2: 实现模型层最小闭环

**Files:**
- Modify: `server/internal/model/building_defs.go`
- Modify: `server/internal/model/building_runtime.go`
- Modify: `server/internal/model/defense.go`
- Modify: `server/internal/model/tech.go`
- Modify: `server/internal/model/item.go`
- Modify: `server/internal/model/recipe.go`

- [ ] **Step 1: 打开 4 个建筑的 buildable/build cost**

```go
{ID: BuildingTypeSelfEvolutionLab, BuildCost: BuildCost{Minerals: 400, Energy: 200}, Buildable: true}
{ID: BuildingTypeSRPlasmaTurret, BuildCost: BuildCost{Minerals: 300, Energy: 150}, Buildable: true}
{ID: BuildingTypeJammerTower, BuildCost: BuildCost{Minerals: 120, Energy: 60}, Buildable: true}
{ID: BuildingTypePlanetaryShieldGenerator, BuildCost: BuildCost{Minerals: 500, Energy: 250}, Buildable: true}
```

- [ ] **Step 2: 在 `building_runtime.go` 新增 4 个 runtime 与 `ShieldModule`**

```go
type ShieldModule struct {
    Capacity      int `json:"capacity" yaml:"capacity"`
    ChargePerTick int `json:"charge_per_tick" yaml:"charge_per_tick"`
    CurrentCharge int `json:"current_charge" yaml:"current_charge"`
}
```

- [ ] **Step 3: 扩展 runtime clone/validate/build catalog**

Run: `go test ./internal/model -run 'TestT091BuildingsBecomeBuildableWithRuntimeAndTechCoverage|TestBuildingRuntimeCatalog'`
Expected: PASS

- [ ] **Step 4: 把 `sr_plasma_turret` 接入 defense helpers，把 `planetary_shield` / `self_evolution` 接入 tech tree**

```go
{Type: TechUnlockBuilding, ID: "jammer_tower"}
{Type: TechUnlockBuilding, ID: "sr_plasma_turret"}
{ID: "planetary_shield", Unlocks: []TechUnlock{{Type: TechUnlockBuilding, ID: "planetary_shield_generator"}}}
{ID: "self_evolution", Unlocks: []TechUnlock{{Type: TechUnlockBuilding, ID: "self_evolution_lab"}}}
```

- [ ] **Step 5: 补 `dark_fog_matrix` 物品定义和矩阵配方 building types**

Run: `go test ./internal/model -run 'TestT091BuildingsBecomeBuildableWithRuntimeAndTechCoverage|TestTechDefinitionsAlignWithCatalog|TestRecipeCatalogBuildingTypesExist'`
Expected: PASS

### Task 3: 实现 gateway 与 gamecore 行为

**Files:**
- Modify: `server/internal/gateway/server.go`
- Add: `server/internal/gamecore/planetary_shield_settlement.go`
- Modify: `server/internal/gamecore/enemy_force_settlement.go`
- Modify: `server/internal/gamecore/core.go`
- Modify: `server/internal/model/event.go`

- [ ] **Step 1: 为两条公开命令补结构校验**

```go
case model.CmdSwitchActivePlanet:
    if _, ok := cmd.Payload["planet_id"]; !ok { return fmt.Errorf("switch_active_planet requires payload.planet_id") }
case model.CmdSetRayReceiverMode:
    if _, ok := cmd.Payload["building_id"]; !ok { return fmt.Errorf("set_ray_receiver_mode requires payload.building_id") }
    if _, ok := cmd.Payload["mode"]; !ok { return fmt.Errorf("set_ray_receiver_mode requires payload.mode") }
```

- [ ] **Step 2: 新增护盾充能与吸伤结算**

```go
func settlePlanetaryShields(ws *model.WorldState) {}
func absorbPlanetaryShieldDamage(ws *model.WorldState, ownerID string, damage int) (absorbed int, remaining int) {}
```

- [ ] **Step 3: 在 tick 结算与敌袭入口接入护盾，并为伤害事件补 `shield_absorbed` / `shield_remaining`**

Run: `go test ./internal/gateway ./internal/gamecore -run 'TestValidateCommandStructureAllowsPlanetAndRayReceiverCommands|TestValidateCommandStructureRejectsIncompletePlanetAndRayReceiverCommands|TestT091|TestSetRayReceiverModeRequiresUnlockAndPersistsOnBuilding'`
Expected: PASS

### Task 4: 更新 midgame 夹具、文档与任务状态

**Files:**
- Modify: `server/config-midgame.yaml`
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/player/上手与验证.md`
- Modify: `docs/archive/analysis/server现状详尽分析报告.md`
- Move/Delete: `docs/process/task/T091_戴森中后期公开命令断档与剩余DSP建筑补齐.md`

- [ ] **Step 1: 更新 midgame 已完成科技**

```yaml
completed_techs:
  - signal_tower
  - plasma_turret
  - gravity_matrix
  - planetary_shield
  - self_evolution
```

- [ ] **Step 2: 同步文档声明为真实可用，并补护盾事件字段与 midgame 验证步骤**

Run: `rg -n "switch_active_planet|set_ray_receiver_mode|jammer_tower|sr_plasma_turret|planetary_shield_generator|self_evolution_lab" docs/dev docs/player`
Expected: 输出与当前实现一致，不再出现“挂名未实现”的描述。

- [ ] **Step 3: 清理已完成任务文件**

Run: `test ! -e docs/process/task/T091_戴森中后期公开命令断档与剩余DSP建筑补齐.md`
Expected: PASS

### Task 5: 全量验证

**Files:**
- Verify only

- [ ] **Step 1: 跑目标 Go 测试**

Run: `go test ./internal/model ./internal/gateway ./internal/gamecore`
Expected: PASS

- [ ] **Step 2: 跑关键端到端/配置相关测试**

Run: `go test ./internal/startup ./internal/query`
Expected: PASS

- [ ] **Step 3: 手工核对计划要求与实际 diff**

Run: `git diff -- server/internal/gateway/server.go server/internal/model/building_defs.go server/internal/model/building_runtime.go server/internal/model/defense.go server/internal/model/tech.go server/internal/model/item.go server/internal/model/recipe.go server/internal/gamecore/enemy_force_settlement.go server/internal/gamecore/planetary_shield_settlement.go server/config-midgame.yaml docs/dev/服务端API.md docs/dev/客户端CLI.md docs/player/玩法指南.md docs/player/上手与验证.md docs/archive/analysis/server现状详尽分析报告.md`
Expected: 改动与 T091 设计一致，无无关回退。
