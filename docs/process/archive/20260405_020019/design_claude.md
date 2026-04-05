# T094 设计方案：戴森中后期闭环缺口修复

## 概述

本设计方案针对 `docs/process/task/T094_戴森中后期深度试玩新增闭环缺口.md` 中记录的两个问题：

1. `ray_receiver` 的 `power` 模式没有把戴森能量转成可见的电网收益
2. 官方 midgame 场景无法覆盖 `advanced_mining_machine` / `pile_sorter` / `recomposing_assembler`

---

## 问题 1：ray_receiver power 模式电网收益不可见

### 根因分析

通过阅读 `server/internal/gamecore/core.go:589-596` 的 tick 结算顺序：

```
settlePowerGeneration(ws, env)   // ① 清空 PowerInputs，结算常规发电
settleRayReceivers(ws)           // ② 结算射线接收站，追加 PowerInputs
settlePlanetaryShields(ws)
settleSolarSails(ws.Tick)        // ③ 结算太阳帆衰减
settleDysonSpheres(ws.Tick)      // ④ 结算戴森球能量
```

关键问题在于 **结算顺序**：

- `settleRayReceivers`（步骤②）在 `settleDysonSpheres`（步骤④）**之前**执行
- `settleRayReceivers` 调用 `GetSolarSailEnergyForPlayer()` + `GetDysonSphereEnergyForPlayer()` 获取可用戴森能量
- 但 `settleDysonSpheres` 中的 `sphere.CalculateTotalEnergy()` 在步骤④才执行
- 这意味着在**首次启动**时，`dysonSphereStates[playerID].TotalEnergy` 可能为 0（因为还没被 `CalculateTotalEnergy` 更新过）

然而，从测试 `ray_receiver_settlement_test.go:71-107` 来看，测试中**手动先调用了 `settleDysonSpheres`**，所以测试能通过。但在实际 tick 循环中，第一个 tick 的 `settleRayReceivers` 看到的是上一个 tick 的戴森能量值。

**更深层的问题**：即使 `settleRayReceivers` 正确计算了 `PowerOutput` 并追加到 `ws.PowerInputs`，以及直接增加了 `player.Resources.Energy`，但 `settleStats`（`core.go:633`）中的 `updateEnergyStats` 调用 `buildPlayerEnergyStats` → `ResolvePowerNetworks` → `powerSupplyForBuilding`，这个链路依赖 `ws.PowerInputs` 中的数据。

问题出在 `power_grid_aggregation.go:115-139` 的 `powerSupplyForBuilding` 函数：

```go
func powerSupplyForBuilding(building *Building, powerInputs map[string]int) int {
    module := building.Runtime.Functions.Energy
    if IsPowerGeneratorModule(module) {
        return powerInputs[building.ID]  // 常规发电机走这里
    }
    if powerInputs != nil {
        if output := powerInputs[building.ID]; output > 0 {
            return output  // ray_receiver 的 PowerInput 走这里
        }
    }
    output := building.Runtime.Params.EnergyGenerate
    ...
}
```

`ray_receiver` 的 `PowerInput` 确实被追加到了 `ws.PowerInputs`（`ray_receiver_settlement.go:71-79`），所以 `powerSupplyForBuilding` 应该能读到。但前提是 `ray_receiver` 建筑必须在电网图（`PowerGrid`）中有节点。

**最可能的根因**：`ray_receiver` 建筑没有被纳入电网图（`PowerGridGraph`），导致 `ResolvePowerNetworks` 遍历电网时跳过了它，`powerSupplyForBuilding` 永远不会被调用到 `ray_receiver` 的节点上。因此：
- `stats.energy_stats.generation` 不包含 ray_receiver 的供电
- `power_networks[].supply` 不包含 ray_receiver 的供电
- `player.Resources.Energy` 虽然被直接加了，但统计面看不到

### 修复方案

#### 方案 A（推荐）：调整 tick 结算顺序 + 确保电网可见性

**步骤 1**：调整 `core.go` 中的结算顺序，将 `settleSolarSails` 和 `settleDysonSpheres` 移到 `settleRayReceivers` 之前：

```go
// core.go 修改后的顺序
allEvents = append(allEvents, settleSolarSails(ws.Tick)...)
allEvents = append(allEvents, settleDysonSpheres(ws.Tick)...)
allEvents = append(allEvents, settlePowerGeneration(ws, env)...)
allEvents = append(allEvents, settleRayReceivers(ws)...)
settlePlanetaryShields(ws)
```

这样 `settleRayReceivers` 在同一 tick 内就能读到最新的戴森能量。

**步骤 2**：确认 `ray_receiver` 建筑定义中包含电网连接器（`PowerConnector`），使其能被 `BuildPowerGridGraph` 纳入电网图。如果缺失，需要在建筑定义中补充。

**步骤 3**：验证 `buildPlayerEnergyStats` 的 `Generation` 累加逻辑能正确包含 `ray_receiver` 通过 `PowerInputs` 贡献的供电量。

#### 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `server/internal/gamecore/core.go` | 调整 tick 结算顺序 |
| `server/internal/model/item.go` 或建筑定义文件 | 确认 ray_receiver 有电网连接器 |
| `server/internal/gamecore/ray_receiver_settlement_test.go` | 补充端到端验证测试 |

#### 新增测试用例

在 `ray_receiver_settlement_test.go` 中新增：

```go
func TestRayReceiverPowerModeVisibleInEnergyStats(t *testing.T) {
    // 1. 创建带 ray_receiver + 戴森结构的世界
    // 2. 先 settleDysonSpheres 确保有能量
    // 3. 再 settleRayReceivers
    // 4. 调用 buildPlayerEnergyStats 验证 Generation > 0
    // 5. 验证 ResolvePowerNetworks 中包含 ray_receiver 的 supply
}
```

### 验收检查点

- [ ] `summary.players[pid].resources.energy` 在 ray_receiver power 模式下随 tick 增长
- [ ] `state/stats.energy_stats.generation` 包含 ray_receiver 的供电贡献
- [ ] `world/planets/{planet_id}/networks.power_networks[].supply` 包含 ray_receiver 的供电贡献
- [ ] 已有测试全部通过（`go test ./...`）

---

## 问题 2：midgame 场景无法覆盖三个高级建筑

### 现状分析

三个建筑及其科技依赖：

| 建筑 | 科技依赖 | 科技等级 |
|------|----------|----------|
| `recomposing_assembler` | `annihilation` (Level 13) | 依赖 `dirac_inversion` |
| `pile_sorter` | `integrated_logistics` (Level 7) | — |
| `advanced_mining_machine` | `photon_mining` (Level 11) | — |

当前 `config-midgame.yaml` 的 `completed_techs` 列表（约 20 项）不包含这三个科技。

### 推荐方案：方案 A — 扩展 midgame 预置科技

理由：
- 这三个建筑的代码实现已经存在且通过了单元测试
- midgame 场景的目的就是验证中后期功能
- 仅修改配置文件，零代码风险
- 避免在多处文档中维护"部分可验证"的复杂说明

#### 修改内容

在 `server/config-midgame.yaml` 的两个玩家的 `completed_techs` 列表中追加：

```yaml
completed_techs:
  # ... 现有科技 ...
  - annihilation        # 解锁 recomposing_assembler
  - integrated_logistics # 解锁 pile_sorter
  - photon_mining       # 解锁 advanced_mining_machine
```

#### 前置科技检查

需要确认这三个科技的前置科技是否已在 `completed_techs` 中：

- `annihilation` (Level 13) 依赖 `dirac_inversion`
  - `dirac_inversion` 目前**不在** `completed_techs` 中
  - 需要同时添加 `dirac_inversion`（以及它的前置科技链）
- `integrated_logistics` (Level 7) — 需检查前置
- `photon_mining` (Level 11) — 需检查前置

#### 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `server/config-midgame.yaml` | 两个玩家的 `completed_techs` 追加科技 |

#### 前置科技链补全步骤

1. 读取 `server/internal/model/tech.go` 中 `annihilation`、`integrated_logistics`、`photon_mining` 的 `Prerequisites` 字段
2. 递归检查每个前置科技是否已在 `completed_techs` 中
3. 将缺失的前置科技一并加入

### 验收检查点

- [ ] 启动 midgame 场景后，`build 8 6 recomposing_assembler` 不再被科技门禁拒绝
- [ ] `build 8 7 pile_sorter` 不再被科技门禁拒绝
- [ ] `build 10 7 advanced_mining_machine` 不再被科技门禁拒绝
- [ ] 已有测试全部通过

---

## 实施顺序

1. **问题 2 先行**（低风险，纯配置变更）
   - 补全 `config-midgame.yaml` 的科技链
   - 启动验证三个建筑可建造

2. **问题 1 跟进**（需要代码变更）
   - 调整 tick 结算顺序
   - 确认 ray_receiver 电网连接
   - 补充端到端测试
   - 运行全量测试

3. **回归验证**
   - `go test ./...` 全部通过
   - 启动 midgame 场景完整走一遍戴森闭环流程
