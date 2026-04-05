# T096 设计方案：ray_receiver power 模式能量回灌最终电网

## 1. 问题定位

### 1.1 结算顺序（core.go:589-633）

每个 tick 的结算链路如下：

```
settlePowerGeneration(ws, env)   // ① 清空 PowerInputs，写入常规发电机条目，累加 player.Resources.Energy
settleSolarSails(ws.Tick)        // ② 更新太阳帆轨道能量（全局 map）
settleDysonSpheres(ws.Tick)      // ③ 更新戴森球层能量（全局 map）
settleRayReceivers(ws)           // ④ 读取戴森能量，追加 PowerInput，累加 player.Resources.Energy
settlePlanetaryShields(ws)
settleResources(ws)              // ⑤ 调用 settleEnergyStorage → filterStoragePowerInputs → ResolvePowerNetworks
                                 //    然后遍历所有建筑扣除维护能耗
...（物流、生产等）
gc.settleStats()                 // ⑥ 调用 buildPlayerEnergyStats → ResolvePowerNetworks(gc.world)
```

### 1.2 关键代码路径

| 组件 | 文件 | 行号 | 作用 |
|------|------|------|------|
| 清空 PowerInputs | `power_generation.go` | 15-16 | `ws.PowerInputs = ws.PowerInputs[:0]` |
| 常规发电写入 | `power_generation.go` | 59-68 | 追加 wind/solar/fuel 等 PowerInput |
| 射线接收站结算 | `ray_receiver_settlement.go` | 70-83 | 追加 PowerSourceRayReceiver 到 PowerInputs，直接写 player.Resources.Energy |
| 过滤存储源 | `energy_storage_settlement.go` | 10 | `filterStoragePowerInputs` 只移除 PowerSourceStorage，保留 ray_receiver |
| 电网聚合 | `power_grid_aggregation.go` | 22-99 | `ResolvePowerNetworks` 从 PowerInputs 构建 supply |
| 供给计算 | `power_grid_aggregation.go` | 115-139 | `powerSupplyForBuilding` 从 powerInputs map 读取 |
| 统计结算 | `stats_settlement.go` | 84-119 | `buildPlayerEnergyStats` 调用 ResolvePowerNetworks |
| 网络查询 | `query/networks.go` | 142-144 | 实时调用 ResolvePowerNetworks |

### 1.3 根因分析

经过代码审查，ray_receiver 的 PowerInput 条目在结算链路中**理论上是正确的**：

1. `settleRayReceivers` 在 `settlePowerGeneration` 之后运行，追加 `PowerSourceRayReceiver` 到 `ws.PowerInputs`
2. `filterStoragePowerInputs` 只移除 `PowerSourceStorage`，保留 ray_receiver 条目
3. `ResolvePowerNetworks` 通过 `powerInputsByBuilding` 读取所有 PowerInputs
4. `powerSupplyForBuilding` 对非 `IsPowerGeneratorModule` 的建筑，会检查 `powerInputs[building.ID]`

**但存在以下潜在问题：**

#### 问题 A：电网连通性

ray_receiver 的 `ConnectionPoint` 范围为 `DefaultPowerLineRange = 1`（`power_grid.go:20`）。如果 ray_receiver 与最近的电网节点（tesla_tower / wind_turbine）距离 > 1，它会形成**孤立网络**。此时：
- `ResolvePowerNetworks` 会为 ray_receiver 创建一个独立的 PowerNetwork
- 该网络的 supply 包含 ray_receiver 的输出，但不会合并到主网络的 supply 中
- `stats.Generation` 会包含所有网络的 supply 之和，但 `networks` API 会显示为独立网络

#### 问题 B：player.Resources.Energy 的多次写入与覆盖

结算链路中 `player.Resources.Energy` 被多个阶段修改：

```
① settlePowerGeneration: energy += 148（风机等）
④ settleRayReceivers:    energy += 60（射线接收站）
⑤ settleResources:       energy -= Σ(building_maintenance)  // 遍历所有建筑扣除维护
```

每个阶段都会发出 `EvtResourceChanged` 事件，导致同一 tick 内出现多次 energy 跳变。最终 `summary.energy` 是所有阶段叠加后的净值。

如果总维护消耗 ≈ 总发电量，则 energy 变化不明显，但 **generation/supply 应该仍然反映 ray_receiver 的贡献**。

#### 问题 C：settleStats 只在 activeWorld 上运行

`gc.settleStats()`（`core.go:633`）使用 `gc.world`，即 `gc.WorldForPlanet(gc.activePlanetID)`。如果 ray_receiver 所在星球不是 activePlanet，其 PowerInputs 不会被 `buildPlayerEnergyStats` 读取。

但在 midgame 场景中，ray_receiver 在 `planet-1-2`（活跃星球），此问题不适用。

#### 问题 D（最可能的根因）：ResolvePowerNetworks 的 grid 遍历逻辑

`ResolvePowerNetworks`（`power_grid_aggregation.go:40-77`）遍历 `grid.Nodes`，对每个连通分量计算 supply。关键在于：

```go
for len(queue) > 0 {
    id := queue[0]
    queue = queue[1:]
    current := grid.Nodes[id]
    if current == nil || current.OwnerID != owner { continue }
    component = append(component, id)
    if building := ws.Buildings[id]; building != nil {
        supply += powerSupplyForBuilding(building, powerInputs)  // ← 这里
        demand += powerDemandForBuilding(building)
    }
    // BFS 邻居...
}
```

`powerSupplyForBuilding` 对 ray_receiver 的处理：

```go
func powerSupplyForBuilding(building *Building, powerInputs map[string]int) int {
    module := building.Runtime.Functions.Energy  // ray_receiver: nil
    if IsPowerGeneratorModule(module) { ... }    // false
    if powerInputs != nil {
        if output := powerInputs[building.ID]; output > 0 {
            return output  // ← 应该返回 ray_receiver 的输出
        }
    }
    output := building.Runtime.Params.EnergyGenerate  // 0
    ...
    return output  // 0
}
```

如果 `powerInputs[ray_receiver_id]` 确实 > 0，supply 应该正确。但如果 ray_receiver 不在 grid 中（`grid.Nodes` 没有它），则 BFS 永远不会访问到它，supply 不会包含它的贡献。

**验证方式**：检查 ray_receiver 是否被 `BuildPowerGridGraph` → `AddBuilding` → `isPowerGridNode` 正确识别。

ray_receiver 的 runtime 定义（`building_runtime.go:1015-1038`）包含：
```go
ConnectionPoints: []ConnectionPoint{
    {ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
},
```

`isPowerGridNode` → `hasPowerConnection` 检查 `ConnectionPower`，返回 `true`。所以 ray_receiver **会被加入 grid**。

但 `DefaultPowerLineRange = 1`，如果 ray_receiver 与最近的电网节点距离 > 1，它会形成孤立网络。

---

## 2. 修复方案

### 2.1 确保 ray_receiver power 模式的能量稳定回灌

#### 修改 1：统一能量写入时序

当前 `settleRayReceivers` 直接写 `player.Resources.Energy`（`ray_receiver_settlement.go:80`），这与 `settlePowerGeneration` 的写入模式一致。但问题是 `settleResources` 随后会扣除维护能耗，导致 energy 在同一 tick 内多次变化。

**方案**：不修改写入时序（当前逻辑正确），但需要确保以下 4 个观察面一致：

1. `inspect building` → 显示 `mode = power`、`state = running`
2. `summary.energy` → 反映 ray_receiver 的净贡献
3. `stats.generation` → 包含 ray_receiver 的 PowerInput.Output
4. `networks.supply` → 包含 ray_receiver 的 PowerInput.Output

#### 修改 2：确保 ray_receiver 在电网中可见

在 `powerSupplyForBuilding`（`power_grid_aggregation.go:115`）中，ray_receiver 的供给已经通过 `powerInputs[building.ID]` 正确返回。无需修改。

但需要确保 ray_receiver 在 `power` 模式下被 `isPowerCoverageSource` 识别为电源：

```go
// power_grid_coverage.go:165
func isPowerCoverageSource(building *Building, powerInputs map[string]int) bool {
    if powerInputs != nil && powerInputs[building.ID] > 0 {
        return true  // ← ray_receiver 在 PowerInputs 中有条目时，返回 true
    }
    ...
}
```

当前逻辑正确。

#### 修改 3：power 模式语义

根据任务要求：
- `power` 模式下不再新增 `critical_photon`
- 保留切模式前已有的 `critical_photon` 库存
- 把可用戴森能量稳定回灌到电网

当前 `ResolveRayReceiver`（`ray_receiver.go:87-97`）在 `mode == power` 时：
- `photonOutput = 0`（因为 `mode != RayReceiverModePhoton` 但 `mode == RayReceiverModePower` 跳过光子分支）
- `powerOutput` 正常计算

这是正确的。

### 2.2 需要排查的具体代码路径

基于以上分析，最可能的根因是以下之一：

#### 排查路径 1：ray_receiver 的电网连通性

在实战中，ray_receiver 可能因为放置位置与 tesla_tower 距离 > 1 而形成孤立网络。此时 `networks` API 会显示 3 个网络（主网络 + 孤立风机 + 孤立 ray_receiver），但任务描述只提到 2 个网络。

**验证**：在 midgame 场景中检查 `GET /world/planets/planet-1-2/networks` 返回的网络数量和 node_ids。

**修复**：如果确认是连通性问题，需要：
1. 增大 ray_receiver 的连接范围，或
2. 在文档中说明 ray_receiver 必须与电网节点相邻

#### 排查路径 2：settleRayReceivers 的 PowerInput 未被后续结算保留

虽然 `filterStoragePowerInputs` 只移除 `PowerSourceStorage`，但需要确认在 `settleResources` 之后、`settleStats` 之前，`ws.PowerInputs` 仍然包含 ray_receiver 条目。

**验证**：在 `settleStats` 入口处打印 `ws.PowerInputs` 的内容。

#### 排查路径 3：Dyson 能量为 0

如果 `GetSolarSailEnergyForPlayer` + `GetDysonSphereEnergyForPlayer` 返回 0，`settleRayReceivers` 会在 `effectiveInput <= 0` 处 `continue`，不产生任何 PowerInput。

**验证**：在 `settleRayReceivers` 入口处打印 `availableDysonEnergy`。

任务描述中 `rocket_launched` 事件的 `layer_energy_output = 102` 表明戴森球有能量。但 `settleDysonSpheres` 是否正确更新了 `dysonSphereStates[playerID].TotalEnergy` 需要确认。

---

## 3. 具体代码修改计划

### 3.1 修复 ray_receiver power 模式的电网回灌

**文件**：`server/internal/gamecore/ray_receiver_settlement.go`

当前代码（第 70-83 行）已经正确地：
1. 追加 `PowerInput` 到 `ws.PowerInputs`
2. 直接写 `player.Resources.Energy`

无需修改结算逻辑本身。

### 3.2 确保 4 个观察面一致

**文件**：`server/internal/gamecore/stats_settlement.go`

`buildPlayerEnergyStats` 当前只遍历 `gc.world` 的网络。如果需要跨星球统计，需要修改为遍历所有 worlds。但当前任务场景中 ray_receiver 在活跃星球，此问题不适用。

### 3.3 减少同一 tick 内的 resource_changed 事件噪声

**文件**：`server/internal/gamecore/core.go`

**方案**：在 tick 结算结束后，对同一玩家的多个 `EvtResourceChanged` 事件进行去重，只保留最终状态。

```go
// 在 allEvents 发布前，合并同一 tick 内同一玩家的 resource_changed 事件
allEvents = deduplicateResourceEvents(allEvents)
```

```go
func deduplicateResourceEvents(events []*model.GameEvent) []*model.GameEvent {
    lastByPlayer := make(map[string]int) // playerID -> index in events
    for i, evt := range events {
        if evt.EventType != model.EvtResourceChanged {
            continue
        }
        playerID, _ := evt.Payload["player_id"].(string)
        if playerID == "" {
            continue
        }
        lastByPlayer[playerID] = i
    }
    out := make([]*model.GameEvent, 0, len(events))
    for i, evt := range events {
        if evt.EventType != model.EvtResourceChanged {
            out = append(out, evt)
            continue
        }
        playerID, _ := evt.Payload["player_id"].(string)
        if lastByPlayer[playerID] == i {
            out = append(out, evt)
        }
    }
    return out
}
```

### 3.4 端到端回归测试

**文件**：`server/internal/gamecore/ray_receiver_settlement_test.go`（新增测试用例）

测试用例需要覆盖完整链路：

```go
func TestRayReceiverPowerModeEndToEnd(t *testing.T) {
    // 1. 创建测试世界，包含 wind_turbine + tesla_tower + ray_receiver
    // 2. 确保 ray_receiver 与 tesla_tower 相邻（距离 <= 1）
    // 3. 发射太阳帆 / 火箭，建立戴森能量
    // 4. 设置 ray_receiver 为 power 模式
    // 5. 执行完整结算链路：
    //    settlePowerGeneration → settleSolarSails → settleDysonSpheres →
    //    settleRayReceivers → settleResources
    // 6. 断言：
    //    a. ws.PowerInputs 包含 PowerSourceRayReceiver 条目
    //    b. ResolvePowerNetworks 的 supply 包含 ray_receiver 输出
    //    c. player.Resources.Energy 高于纯风机基线
    //    d. buildPlayerEnergyStats 的 Generation 包含 ray_receiver 输出
    //    e. power 模式下不新增 critical_photon
    //    f. 切模式前已有的 critical_photon 库存保留
}
```

具体断言：

```go
// 基线：只有风机
baseGeneration := windTurbineOutput  // e.g., 10

// 结算后
networks := model.ResolvePowerNetworks(ws)
totalSupply := 0
for _, network := range networks.Networks {
    if network.OwnerID == "p1" {
        totalSupply += network.Supply
    }
}

// ray_receiver 的贡献应该体现在 supply 中
if totalSupply <= baseGeneration {
    t.Fatalf("expected supply > %d (base), got %d", baseGeneration, totalSupply)
}

// stats.Generation 应该包含 ray_receiver
stats := buildPlayerEnergyStats(ws, "p1")
if stats.Generation <= baseGeneration {
    t.Fatalf("expected generation > %d (base), got %d", baseGeneration, stats.Generation)
}

// energy 应该高于纯风机基线
if player.Resources.Energy <= 0 {
    t.Fatalf("expected positive energy, got %d", player.Resources.Energy)
}

// power 模式下不新增 critical_photon
photons := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton)
if photons > seedPhotons {
    t.Fatalf("expected no new photons in power mode, got %d (seed=%d)", photons, seedPhotons)
}
```

---

## 4. 验收检查清单

| # | 检查项 | 验证方式 |
|---|--------|----------|
| 1 | `summary.players[pid].resources.energy` 稳定高于切模式前 | midgame 实测 + 单元测试 |
| 2 | `stats.energy_stats.generation` 包含 ray_receiver 输出 | `buildPlayerEnergyStats` 单元测试 |
| 3 | `networks.power_networks[].supply` 包含 ray_receiver 输出 | `ResolvePowerNetworks` 单元测试 |
| 4 | 上述增益出现在最终 authoritative 查询结果中 | HTTP 端点集成测试 |
| 5 | `power` 模式下不新增 `critical_photon` | 已有测试覆盖（`TestSettleRayReceiversRespectModesAndKeepExistingPhotonStock`） |
| 6 | 切模式前已有 `critical_photon` 库存保留 | 已有测试覆盖 |
| 7 | 同一 tick 内 `resource_changed` 事件不再反复跳变 | 事件去重后验证 |

## 5. 风险与注意事项

1. **事件去重可能影响下游消费者**：如果有客户端依赖中间态的 `resource_changed` 事件，去重会改变行为。需要确认 SSE 消费者只关心最终态。

2. **电网连通性是前置条件**：ray_receiver 必须与电网节点相邻（距离 ≤ 1）才能将供给注入主网络。如果玩家放置不当，ray_receiver 会形成孤立网络。这是设计预期，但需要在玩法指南中说明。

3. **跨星球统计**：当前 `settleStats` 只统计活跃星球的电网。如果未来支持多星球 ray_receiver，需要扩展统计逻辑。

4. **全局状态依赖**：`solarSailOrbits` 和 `dysonSphereStates` 是全局 map，`settleSolarSails` 和 `settleDysonSpheres` 在 tick 循环中对每个 world 都会调用。需要确认不会重复计算或覆盖。
