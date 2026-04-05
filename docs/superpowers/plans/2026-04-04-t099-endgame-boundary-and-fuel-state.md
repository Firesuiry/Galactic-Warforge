# T099 Endgame Boundary And Fuel State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 落地 T099，统一高阶舰队线未开放边界，并修正燃料型发电建筑在无燃料时的运行态。

**Architecture:** 服务端继续保持高阶舰队线隐藏，只补边界测试与文档锁定。燃料型发电建筑通过一套与真实取料路径一致的 helper，在发电前和资源结算末端两次同步状态，把无燃料统一写成 `no_power/no_fuel`，不改 query 层补丁逻辑。

**Tech Stack:** Go 1.25、Node.js test runner、shell 校验脚本

---

### Task 1: 先补失败测试锁定 T099 目标

**Files:**
- Create: `server/internal/gamecore/t099_fuel_generator_state_test.go`
- Create: `client-cli/src/commands/action.test.ts`
- Modify: `client-cli/src/commands/index.test.ts`

- [ ] **Step 1: 写服务端失败测试，覆盖燃料状态与 produce 边界**

```go
func TestT099ArtificialStarWithoutFuelShowsNoPowerReason(t *testing.T) {}
func TestT099ArtificialStarRecoversAfterFuelIsLoaded(t *testing.T) {}
func TestT099ArtificialStarFallsBackToNoFuelAfterConsumption(t *testing.T) {}
func TestT099FuelGeneratorsShareNoFuelRule(t *testing.T) {}
func TestT099ProduceCorvetteStillRejected(t *testing.T) {}
```

- [ ] **Step 2: 运行 Go 定向测试并确认失败原因正确**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/gamecore -run T099 -count=1`
Expected: FAIL，缺少 `no_fuel` 状态逻辑或断言不成立

- [ ] **Step 3: 写 CLI 失败测试，锁定 help produce 与 corvette 拒绝**

```ts
it('shows worker and soldier only in produce help', async () => {})
it('rejects corvette in cmdProduce', async () => {})
```

- [ ] **Step 4: 运行 CLI 定向测试并确认测试先红**

Run: `cd client-cli && npm test -- --test-name-pattern T099`
Expected: FAIL 或当前无测试匹配，需要补入命名后重跑

### Task 2: 实现燃料型发电建筑 `no_power/no_fuel`

**Files:**
- Modify: `server/internal/gamecore/building_lifecycle.go`
- Modify: `server/internal/gamecore/power_generation.go`
- Modify: `server/internal/gamecore/rules.go`
- Modify: `server/internal/model/power.go`

- [ ] **Step 1: 新增状态原因与可达燃料判断 helper**

```go
const stateReasonNoFuel = "no_fuel"

func fuelBasedGeneratorHasReachableFuel(b *model.Building) bool
```

- [ ] **Step 2: 让 helper 严格镜像真实取料范围**

```go
// 仅检查 InputBuffer + Inventory，不把 OutputBuffer 视为可达燃料。
```

- [ ] **Step 3: 在发电结算前同步燃料型发电建筑状态**

```go
if !fuelBasedGeneratorHasReachableFuel(building) {
    applyBuildingState(building, model.BuildingWorkNoPower, stateReasonNoFuel)
    continue
}
if building.Runtime.State == model.BuildingWorkNoPower && building.Runtime.StateReason == stateReasonNoFuel {
    applyBuildingState(building, model.BuildingWorkRunning, stateReasonStart)
}
```

- [ ] **Step 4: 在 `settleResources()` 末段补二次燃料门禁**

```go
if isFuelGenerator && !fuelBasedGeneratorHasReachableFuel(b) {
    applyBuildingState(b, model.BuildingWorkNoPower, stateReasonNoFuel)
    continue
}
```

- [ ] **Step 5: 运行 Go 定向测试直到变绿**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/gamecore -run T099 -count=1`
Expected: PASS

### Task 3: 补 CLI 与文档一致性回归

**Files:**
- Create: `develop_tools/verify_t099_docs.sh`
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/player/已知问题与回归.md`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`

- [ ] **Step 1: 仅修与 T099 相关的残余夸大口径**

```text
统一表述：prototype / precision_drone / corvette / destroyer 当前仍处于隐藏状态，玩家侧没有公开生产、部署、编队、查询和战斗入口。
```

- [ ] **Step 2: 新增文档校验脚本**

```bash
./develop_tools/verify_t099_docs.sh
```

- [ ] **Step 3: 运行脚本并确认边界文档通过**

Run: `./develop_tools/verify_t099_docs.sh`
Expected: exit 0，并输出校验通过信息

### Task 4: 清理已完成任务文件并做最终验证

**Files:**
- Delete: `docs/process/task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md`
- Create if needed: `docs/process/finished_task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md`

- [ ] **Step 1: 在完成实现和验证后清理 `docs/process/task` 下对应任务文件**

```bash
rm docs/process/task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md
```

- [ ] **Step 2: 运行完整验证**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./...`
Expected: PASS

Run: `cd client-cli && npm test`
Expected: PASS

Run: `./develop_tools/verify_t099_docs.sh`
Expected: PASS

- [ ] **Step 3: 自检需求覆盖**

```text
核对 design_final：高阶舰队线继续隐藏；燃料型发电建筑无燃料为 no_power/no_fuel；CLI 与文档边界一致；任务文件已清理。
```
