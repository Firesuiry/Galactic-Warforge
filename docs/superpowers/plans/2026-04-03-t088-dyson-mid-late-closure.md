# T088 Dyson Mid/Late Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 补齐中后期配方、垂直发射井玩法闭环、官方中后期气态行星场景，并完成回归测试与文档同步。

**Architecture:** 先在 `server/internal/model` 收敛静态目录与科技解锁，再在 `server/internal/gamecore` 补默认配方与 `launch_rocket` 行为，最后通过 `config/mapgen/startup` 打通中后期场景启动。客户端只同步命令协议与事件类型，不增加独立玩法分支。

**Tech Stack:** Go 1.25, TypeScript, shared-client, client-cli, YAML config, Go test, npm test

---

### Task 1: 静态目录与科技解锁

**Files:**
- Modify: `server/internal/model/item.go`
- Modify: `server/internal/model/recipe.go`
- Modify: `server/internal/model/tech.go`
- Modify: `server/internal/model/building_catalog.go`
- Modify: `server/internal/model/building_defs.go`
- Modify: `server/internal/model/building_runtime.go`
- Test: `server/internal/model/item_test.go`
- Test: `server/internal/model/recipe_test.go`
- Test: `server/internal/model/tech_alignment_test.go`
- Test: `server/internal/model/building_catalog_test.go`

- [ ] **Step 1: 先写失败测试**

```go
func TestMidLateItemsExist(t *testing.T) {}
func TestMidLateRecipesExistAndUseSupportedBuildings(t *testing.T) {}
func TestVerticalLaunchingUnlocksRocketRecipe(t *testing.T) {}
func TestVerticalLaunchingSiloHasDefaultRecipeAndRocketIO(t *testing.T) {}
```

- [ ] **Step 2: 跑模型测试确认失败**

Run: `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model -run 'TestMidLate|TestVerticalLaunching'`
Expected: FAIL，提示缺少新物品/配方/默认配方/tech unlock。

- [ ] **Step 3: 实现最小目录改动**

```go
const (
	ItemTitaniumCrystal = "titanium_crystal"
	ItemTitaniumAlloy   = "titanium_alloy"
	ItemFrameMaterial   = "frame_material"
	ItemQuantumChip     = "quantum_chip"
)

type BuildingDefinition struct {
	// ...
	DefaultRecipeID string `json:"default_recipe_id,omitempty" yaml:"default_recipe_id,omitempty"`
}
```

- [ ] **Step 4: 回跑模型测试**

Run: `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model`
Expected: PASS。

### Task 2: 默认配方、火箭发射与戴森收益

**Files:**
- Modify: `server/internal/model/command.go`
- Modify: `server/internal/model/event.go`
- Modify: `server/internal/model/dyson_sphere.go`
- Modify: `server/internal/gamecore/construction.go`
- Modify: `server/internal/gamecore/rules.go`
- Modify: `server/internal/gamecore/core.go`
- Create: `server/internal/gamecore/rocket_launch.go`
- Modify: `server/internal/gamecore/dyson_sphere_settlement.go`
- Test: `server/internal/gamecore/dyson_commands_test.go`
- Test: `server/internal/gamecore/ray_receiver_settlement_test.go`
- Test: `server/internal/gamecore/e2e_test.go`

- [ ] **Step 1: 先写失败测试**

```go
func TestBuildVerticalLaunchingSiloUsesDefaultRecipe(t *testing.T) {}
func TestLaunchRocketConsumesStoredRocketAndBoostsDysonLayer(t *testing.T) {}
func TestLaunchRocketRequiresExistingDysonScaffold(t *testing.T) {}
func TestRocketBonusImprovesRayReceiverIncome(t *testing.T) {}
```

- [ ] **Step 2: 跑 gamecore 测试确认失败**

Run: `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run 'TestBuildVerticalLaunchingSilo|TestLaunchRocket|TestRocketBonus'`
Expected: FAIL，提示缺少默认配方或 `launch_rocket`。

- [ ] **Step 3: 实现命令与收益闭环**

```go
const CmdLaunchRocket CommandType = "launch_rocket"
const EvtRocketLaunched EventType = "rocket_launched"

type DysonLayer struct {
	// ...
	RocketLaunches    int     `json:"rocket_launches,omitempty"`
	ConstructionBonus float64 `json:"construction_bonus,omitempty"`
}
```

- [ ] **Step 4: 回跑定向测试**

Run: `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run 'TestBuildVerticalLaunchingSilo|TestLaunchRocket|TestRocketBonus|TestSettleRayReceivers'`
Expected: PASS。

### Task 3: Midgame 启动场景与地图 override

**Files:**
- Modify: `server/internal/config/config.go`
- Modify: `server/internal/mapconfig/config.go`
- Modify: `server/internal/mapgen/generate.go`
- Modify: `server/internal/gamecore/core.go`
- Modify: `server/internal/startup/game.go`
- Modify: `server/internal/startup/game_test.go`
- Modify: `server/internal/mapgen/generate_test.go`
- Create: `server/config-midgame.yaml`
- Create: `server/map-midgame.yaml`

- [ ] **Step 1: 先写失败测试**

```go
func TestGenerateAppliesPlanetKindOverride(t *testing.T) {}
func TestBootstrapUsesInitialActivePlanetAndPlayerBootstrap(t *testing.T) {}
```

- [ ] **Step 2: 跑 startup/mapgen 测试确认失败**

Run: `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/mapgen ./internal/startup`
Expected: FAIL，提示缺少 override/bootstrap/initial active planet。

- [ ] **Step 3: 实现场景配置能力并新增 midgame YAML**

```go
type BattlefieldConfig struct {
	InitialActivePlanetID string `yaml:"initial_active_planet_id,omitempty"`
}

type PlayerBootstrapConfig struct {
	Minerals       int                   `yaml:"minerals"`
	Energy         int                   `yaml:"energy"`
	Inventory      []BootstrapItemConfig `yaml:"inventory,omitempty"`
	CompletedTechs []string              `yaml:"completed_techs,omitempty"`
}
```

- [ ] **Step 4: 回跑定向测试**

Run: `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/mapgen ./internal/startup`
Expected: PASS。

### Task 4: shared-client / CLI / 文档同步

**Files:**
- Modify: `shared-client/src/types.ts`
- Modify: `shared-client/src/api.ts`
- Modify: `shared-client/src/config.ts`
- Modify: `client-cli/src/api.ts`
- Modify: `client-cli/src/commands/action.ts`
- Modify: `client-cli/src/commands/index.ts`
- Modify: `client-cli/src/commands/util.ts`
- Modify: `client-cli/src/command-catalog.ts`
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/player/上手与验证.md`

- [ ] **Step 1: 先补命令/事件类型测试或现有 CLI 测试**

```ts
test('launch_rocket command is registered');
test('shared client exposes cmdLaunchRocket');
```

- [ ] **Step 2: 跑 CLI 测试确认失败**

Run: `cd client-cli && npm test -- --runInBand`
Expected: FAIL，提示命令未注册或类型未同步。

- [ ] **Step 3: 实现协议与文档同步**

```ts
export type CommandType = /* ... */ | 'launch_rocket';
export type EventType = /* ... */ | 'rocket_launched';
```

- [ ] **Step 4: 回跑客户端测试**

Run: `cd client-cli && npm test -- --runInBand`
Expected: PASS。

### Task 5: 全量验证与任务清理

**Files:**
- Modify: `docs/process/task/T088_dyson_mid_late_gameplay_gaps.md` 或删除该文件

- [ ] **Step 1: 运行服务端全量测试**

Run: `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./...`
Expected: PASS。

- [ ] **Step 2: 运行客户端测试与必要构建**

Run: `cd client-cli && npm test -- --runInBand`
Expected: PASS。

- [ ] **Step 3: 清理已完成任务文件**

```bash
rm docs/process/task/T088_dyson_mid_late_gameplay_gaps.md
```

- [ ] **Step 4: 最终核对 midgame 场景文件与文档**

Run: `git status --short`
Expected: 只剩本次实现涉及文件改动；`docs/process/task/T088_dyson_mid_late_gameplay_gaps.md` 不再存在。
