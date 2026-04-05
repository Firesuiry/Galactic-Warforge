# T095 设计方案：戴森接收站 power 模式失效与缺电状态误判

## 问题概述

### 问题 1：ray_receiver power 模式不发电且仍产出 critical_photon

`ray_receiver` 设为 `power` 模式后，戴森能量已存在（`total_energy > 0`），但：
- 电网 `supply` / `generation` 没有增长
- `inspect` 显示 `critical_photon` 仍在累积
- `summary.resources.energy` 无变化

**根因分析：**

`model/ray_receiver.go:87-97` 中 `ResolveRayReceiver` 的 power 分支逻辑本身是正确的——`mode != RayReceiverModePhoton` 时产电，`mode != RayReceiverModePower` 时产光子。

真正的问题在 `gamecore/ray_receiver_settlement.go:11-113` 的 `settleRayReceivers` 函数：

1. **结算时机与电网感知断裂**：`settleRayReceivers` 在 `core.go:594` 被调用，它把 `result.PowerOutput` 加到 `ws.PowerInputs` 和 `player.Resources.Energy`。但 `settleResources`（`rules.go:929`）在同一 tick 内先于或后于此执行时，`ResolvePowerNetworks` 和 `ResolvePowerAllocations` 读取的 `ws.PowerInputs` 可能还没有包含 ray_receiver 的贡献，导致 `stats.energy_stats.generation` 和 `networks.supply` 看不到这部分供电。

2. **需要确认 tick 内调用顺序**：`core.go` 中 `settleDysonSpheres` → `settleRayReceivers` → `settleResources` 的顺序。如果 `settleResources` 在 `settleRayReceivers` 之前执行，那么 ray_receiver 的 `PowerInput` 还没写入 `ws.PowerInputs`，电网聚合自然看不到。

3. **stats 重新计算时机**：`settleStats`（`stats_settlement.go:8`）中 `buildPlayerEnergyStats` 调用 `ResolvePowerNetworks` 重新聚合，此时如果 `ws.PowerInputs` 已包含 ray_receiver 贡献，`generation` 应该能反映。需要确认 `settleStats` 是否在 `settleRayReceivers` 之后执行。

### 问题 2：缺电时建筑误报 `power_out_of_range`

已接入电网（`connected = true`）的建筑在供电不足时被报告为 `power_out_of_range`，而非 `under_power`。

**根因分析：**

`rules.go:958-969` 中 `settleResources` 的电力检查逻辑：

```go
if totalEnergyCost > 0 {
    cov, ok := coverage[b.ID]
    if !ok || !cov.Connected {
        reason := powerCoverageReasonToStateReason(cov.Reason)
        // ...
    }
    alloc, ok := allocations.Buildings[b.ID]
    if !ok || alloc.Allocated <= 0 {
        // 这里正确返回 stateReasonUnderPower
    }
}
```

第一层检查 `coverage[b.ID]` 时，如果 `ResolvePowerCoverage` 返回 `Connected: false, Reason: PowerCoverageOutOfRange`，就会走到 `powerCoverageReasonToStateReason` 返回 `"power_out_of_range"`。

但 `power_grid_coverage.go:113-123` 中的逻辑是：当一个连通域内有消费者但没有发电源（`componentSource == ""`）时，如果该玩家在其他地方有发电源（`ownerHasSource[owner] == true`），就标记为 `PowerCoverageOutOfRange`。

**关键矛盾**：`/world/planets/{planet_id}/networks` 端点通过 `ResolvePowerNetworks` 构建网络视图，它用 BFS 遍历电网图，把同一连通域的建筑归入同一网络。而 `ResolvePowerCoverage` 也用 BFS，但它额外要求连通域内必须有 `isPowerCoverageSource` 返回 true 的建筑。

当 ray_receiver 的 `PowerInput` 还没写入 `ws.PowerInputs` 时，`powerSupplyForBuilding` 对 ray_receiver 返回 0，`isPowerCoverageSource` 也返回 false。如果连通域内唯一的发电源是 ray_receiver（且其 PowerInput 尚未注册），整个连通域的消费者都会被标记为 `PowerCoverageOutOfRange`。

但根据 T095 复现步骤，问题出现在有风机供电的场景下，所以更可能的原因是：**某些 DSP 建筑（如 `orbital_collector`、`self_evolution_lab`）在电网图中没有被正确连接到发电源所在的连通域**，或者 `ResolvePowerCoverage` 的 BFS 遍历在某些边界条件下把它们归入了没有发电源的子图。

需要进一步排查 `BuildPowerGridGraph` 的连接逻辑，确认这些建筑是否真的在同一个连通域内。

---

## 修改方案

### 修改 1：确保 ray_receiver power 模式正确回灌电网

#### 1.1 确认并修正 tick 内结算顺序

**文件**：`server/internal/gamecore/core.go`

确保 tick 结算顺序为：
1. `settleDysonSpheres` — 刷新戴森能量
2. `settleRayReceivers` — 将戴森能量转为 PowerInput + 玩家 energy
3. `settleResources` — 读取 PowerInput 进行电网聚合与分配
4. `settleStats` — 基于最终状态计算统计

当前 `core.go:593-594` 已经是 `settleDysonSpheres` → `settleRayReceivers`，需要确认 `settleResources` 在其之后。如果顺序不对，调整调用顺序。

#### 1.2 确保 ws.PowerInputs 在每 tick 开始时清空

**文件**：`server/internal/gamecore/core.go` 或 `ray_receiver_settlement.go`

`ws.PowerInputs` 是 `[]PowerInput`，需要在每个 tick 开始时清空，避免上一 tick 的 ray_receiver 贡献残留。在 `settleRayReceivers` 开头或 tick 循环开头添加：

```go
ws.PowerInputs = ws.PowerInputs[:0]
```

#### 1.3 验证 ResolveRayReceiver 的 power 模式行为

**文件**：`server/internal/model/ray_receiver.go`

当前逻辑（第 87-97 行）：
- `mode != RayReceiverModePhoton` → 产电 ✓
- `mode != RayReceiverModePower` → 产光子

`power` 模式下：`mode != Photon` 为 true → 产电；`mode != Power` 为 false → 不产光子。逻辑正确。

但需要确认 `settleRayReceivers` 中传入的 `module.Mode` 确实是建筑上设置的模式，而不是默认值。检查 `ray_receiver_settlement.go:29`：

```go
module := building.Runtime.Functions.RayReceiver
```

这里直接读取建筑的 RayReceiver 模块，`Mode` 字段应该是 `set_ray_receiver_mode` 命令设置的值。如果 `Mode` 为空字符串，`ResolveRayReceiver` 会默认为 `hybrid`（第 57-58 行），这是正确的。

### 修改 2：修正缺电状态误判

#### 2.1 修改 settleResources 中的状态判定逻辑

**文件**：`server/internal/gamecore/rules.go`，第 958-976 行

当前逻辑在 `coverage` 检查失败时直接用 `powerCoverageReasonToStateReason` 转换原因。但问题是 `ResolvePowerCoverage` 可能把已经在同一电网中的建筑标记为 `PowerCoverageOutOfRange`。

**方案 A（推荐）：在 settleResources 中增加交叉校验**

在 `coverage` 检查失败后，额外检查 `allocations` 中是否有该建筑的记录。如果 `allocations.Buildings[b.ID]` 存在且 `NetworkID` 非空，说明该建筑实际上在电网中，只是分配不足，应该报 `under_power` 而非 `power_out_of_range`：

```go
if totalEnergyCost > 0 {
    cov, ok := coverage[b.ID]
    if !ok || !cov.Connected {
        // 交叉校验：如果 allocation 中有记录，说明实际已接入电网
        if alloc, allocOK := allocations.Buildings[b.ID]; allocOK && alloc.NetworkID != "" {
            if evt := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonUnderPower); evt != nil {
                events = append(events, evt)
            }
            continue
        }
        reason := powerCoverageReasonToStateReason(cov.Reason)
        if !ok {
            reason = powerCoverageReasonToStateReason(model.PowerCoverageNoConnector)
        }
        if evt := applyBuildingState(b, model.BuildingWorkNoPower, reason); evt != nil {
            events = append(events, evt)
        }
        continue
    }
    // ... 后续分配检查不变
}
```

**方案 B：修复 ResolvePowerCoverage 的根因**

`power_grid_coverage.go:113-123` 中，当连通域内没有 `isPowerCoverageSource` 返回 true 的建筑时，所有消费者被标记为 `OutOfRange` 或 `NoProvider`。但 `isPowerCoverageSource` 的判定依赖 `ws.PowerInputs`（通过 `powerSupplyForBuilding`），而 ray_receiver 的 PowerInput 可能在 coverage 计算时还没写入。

修复方式：让 `isPowerCoverageSource` 也识别 ray_receiver 类型的建筑（即使其 PowerInput 尚未注册），或者确保 `ResolvePowerCoverage` 在 `settleRayReceivers` 之后调用。

**推荐方案 A + B 结合**：
- 方案 B 修复根因，让 coverage 计算正确
- 方案 A 作为防御性校验，防止其他边界情况

#### 2.2 修改 powerCoverageReasonToStateReason 的映射

**文件**：`server/internal/gamecore/rules.go`，第 1083-1096 行

当前 `PowerCoverageOutOfRange` 映射到 `"power_out_of_range"`。考虑到 `ResolvePowerCoverage` 的 `OutOfRange` 语义是"玩家有发电源但不在同一连通域"，这个映射本身是合理的。问题在于上游 coverage 计算不准确，而非映射错误。

#### 2.3 确保 inspect / scene / building_state_changed 事件一致

**文件**：`server/internal/gamecore/building_lifecycle.go`

`applyBuildingState` 函数在设置 `BuildingWorkNoPower` 时，会把 `reason` 写入 `building.Runtime.StateReason` 和事件 payload。只要上游传入正确的 reason（`under_power` 而非 `power_out_of_range`），下游的 inspect 和事件流自然一致。

### 修改 3：确保观察面一致性

#### 3.1 stats.energy_stats.generation 包含 ray_receiver 贡献

**文件**：`server/internal/gamecore/stats_settlement.go`，第 84-119 行

`buildPlayerEnergyStats` 调用 `ResolvePowerNetworks`，后者通过 `powerSupplyForBuilding` 读取 `ws.PowerInputs`。只要 `settleStats` 在 `settleRayReceivers` 之后执行，`generation` 就能包含 ray_receiver 的贡献。

需要确认 `settleStats` 的调用位置在 `settleRayReceivers` 之后。

#### 3.2 networks.power_networks[].supply 包含 ray_receiver 贡献

**文件**：`server/internal/query/networks.go`

`PlanetNetworks` 调用 `ResolvePowerNetworks`，同样依赖 `ws.PowerInputs`。只要 PowerInputs 已包含 ray_receiver 贡献，supply 就正确。

#### 3.3 summary.players[].resources.energy 同步

`player.Resources.Energy` 在 `settleRayReceivers` 中直接累加了 `result.PowerOutput`，summary 读取的就是这个值，应该已经同步。

---

## 具体修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `server/internal/gamecore/core.go` | 确认/调整 tick 结算顺序：dyson → ray_receiver → resources → stats；确保每 tick 开始清空 `ws.PowerInputs` |
| `server/internal/gamecore/rules.go` | 在 `settleResources` 的 coverage 检查失败分支增加 allocation 交叉校验，避免已接入电网的建筑被误报为 `power_out_of_range` |
| `server/internal/model/power_grid_coverage.go` | （可选）让 `isPowerCoverageSource` 识别 `ray_receiver` 类型建筑为潜在电源，即使 PowerInput 尚未注册 |
| `server/internal/gamecore/ray_receiver_settlement.go` | 确认 `ws.PowerInputs` 清空逻辑；确认 module.Mode 正确传递 |

## 新增测试

| 测试文件 | 测试内容 |
|----------|----------|
| `server/internal/gamecore/ray_receiver_settlement_test.go` | 新增：power 模式下 `PhotonOutput == 0` 且 `PowerOutput > 0` 的断言 |
| `server/internal/gamecore/power_shortage_test.go` | 新增：建筑 `connected = true` + 网络 `shortage = true` 时，低优先级建筑状态原因为 `under_power` 而非 `power_out_of_range` |
| `server/internal/gamecore/t095_power_mode_e2e_test.go` | 端到端测试：戴森能量存在 → ray_receiver power 模式 → generation/supply 增长 + critical_photon 不增长 |

## 验收标准对照

1. ✅ 官方 midgame 场景下，戴森结构存在能量输出时，`ray_receiver power` 模式必须能真实提高电网收益，并停止产出 `critical_photon`
   - 通过修正 tick 结算顺序 + PowerInputs 清空 + 确认 ResolveRayReceiver 逻辑
2. ✅ 缺电场景下，`inspect` 与事件流对建筑状态原因的描述必须和 `networks` 的覆盖/分配结果一致
   - 通过 settleResources 中增加 allocation 交叉校验
3. ✅ `orbital_collector`、`advanced_mining_machine`、`recomposing_assembler`、`self_evolution_lab` 不应再被误报为"未接电网"
   - 同上，统一归类为 `under_power`

## 实施顺序

1. 先排查 `core.go` 中 tick 结算顺序，确认 `settleRayReceivers` 在 `settleResources` 之前
2. 修复 `rules.go` 中 coverage 检查的交叉校验逻辑
3. 确认 `ws.PowerInputs` 每 tick 清空
4. 编写并运行测试
5. 在 midgame 场景下端到端验证
