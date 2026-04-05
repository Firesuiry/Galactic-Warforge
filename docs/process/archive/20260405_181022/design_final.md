# T104 最终实现方案：燃料型发电建筑运行态收口与人造恒星稳定供电

> 基于 `docs/process/design_claude.md` 与 `docs/process/design_codex.md` 的综合定稿。
>
> 本文不并列复述两份方案，而是对共同结论与分歧点做最终裁决，形成一份可直接执行的实现方案。

## 1. 最终结论

T104 的真实问题已经明确：

- 根因不在 `query`、`stats`、`networks` 或 Web/CLI 展示层；
- 根因在于同一个 tick 内，燃料型发电建筑先在 `settlePowerGeneration` 中完成“有燃料 -> 发电 -> 消耗燃料”，随后又在 `settleResources` 中按“库存已空”被二次写回 `no_power/no_fuel`；
- 这会导致 `artificial_star` 虽然短暂发过电，但玩家几乎无法从 `inspect` / `scene` / `building_state_changed` 上稳定观察到运行态，也很难把 `networks/stats` 的供电收益和建筑状态对应起来。

最终方案确定为：

1. **把燃料型发电建筑的运行态真相 authoritative 收口到 `settlePowerGeneration`。**
2. **移除 `settleResources` 对同类建筑的二次燃料可达性判定，只尊重前序已经写好的 `no_power/no_fuel` 结果。**
3. **不新增任何“燃烧缓存”“剩余燃烧 tick”“展示层补丁状态”或额外 API 字段。**
4. **本次规则一次覆盖 `artificial_star`、`thermal_power_plant`、`mini_fusion_power_plant` 三类燃料型发电建筑，不做单建筑特判。**
5. **同步修改旧的 T099 测试语义，并新增独立 T104 回归测试，锁定运行态、事件、`inspect`、`scene`、`networks`、`stats` 的一致性。**

## 2. 综合裁决

### 2.1 两份方案的一致主线

`design_claude` 与 `design_codex` 在核心方向上并不冲突，已经达成以下共识：

- 本轮范围只覆盖 `docs/process/task/T104_戴森终局人造恒星装燃料后无法稳定供电.md`
- 不需要新做一层 query/UI 补丁来掩盖 runtime 错误
- 不需要新增持久化燃烧态字段
- `ResolvePowerGeneration`、`FuelRules.consume_per_tick`、`PowerSettlementSnapshot` 这条主链路本身是可用的
- `inspect/scene` 读 runtime，`networks/stats` 读 snapshot；只要 tick 语义收口正确，观察面会自然一致

因此最终方案继续沿用“直接修核心结算语义”的主轴，不采用任何展示层圆谎方案。

### 2.2 根因裁决

最终认定的根因是：

- `settlePowerGeneration` 在 tick 前半段先判定有燃料，并通过 `ResolvePowerGeneration` 消耗燃料、写入 `ws.PowerInputs`
- `finalizePowerSettlement` 再把这次发电固化进 `ws.PowerSnapshot`
- 但 `settleResources` 又在 tick 后半段重新用 `fuelBasedGeneratorHasReachableFuel` 检查一次燃料
- 当最后一根燃料恰好在本 tick 被消耗后，这个后置检查会立即把建筑覆写成 `no_power/no_fuel`

所以 T104 的本质是**同一事实被两个阶段重复定义**，而不是“燃料被消耗了两次”或“snapshot 算法错了”。

### 2.3 不采用的两个方向

#### 方向 A：query / UI 层补展示态

不采用。原因：

- 会制造第三个事实源；
- runtime 仍然是错的；
- `building_state_changed` 仍会抖动；
- 违背项目“直接改核心定义，不靠兼容层圆谎”的准则。

#### 方向 B：新增燃烧状态机或持久化字段

不采用。原因：

- 对 T104 来说是过度设计；
- 会引入存档、回放、回滚和状态同步的额外复杂度；
- 当前 `FuelRules.consume_per_tick` 已足够表达目标语义。

### 2.4 细节裁决一：是否强制新增 helper

最终裁决：**不把新增 helper 作为本次必须项。**

原因：

- 真正必须修改的行为点只有 `rules.go` 中的一处分支；
- `fuel_generators.go` 当前只负责“是否存在可达燃料”的判定，职责已经清楚；
- 为一个单一生产调用点额外抽 `fuelGeneratorStoppedByNoFuel(...)`，收益有限，容易把本次修复从“语义收口”扩散成“抽象整理”。

最终要求是：

- `server/internal/gamecore/rules.go` 必须改；
- `server/internal/gamecore/power_generation.go` 应补注释，明确 authoritative 归属；
- `fuel_generators.go` 是否新增私有 helper，由实现时的实际重复度决定，但不是设计强约束。

### 2.5 细节裁决二：`building_state_changed` 事件的验收口径

最终裁决：

- **必须消除同一个 tick 内 `running -> no_power/no_fuel` 的反向闪烁。**
- **不要求为了 T104 额外重写通用 `applyBuildingState` 机制。**

原因：

- 当前 `settleResources` 末尾仍会统一执行一次 `applyBuildingState(..., running, "")`，这可能带来“同状态、不同 reason”的原因清理事件；
- 这属于现有通用状态机的次级噪音，不是 T104 的主 bug；
- 本次必须修掉的是“已经真实发电却在同 tick 末被打回 `no_fuel`”这一错误语义。

因此测试口径应写成：

- 必须存在正确的 `no_power/no_fuel -> running(start)` 恢复事件；
- 必须存在真正耗尽燃料后的 `running -> no_power/no_fuel` 事件；
- 禁止再出现同 tick 的 `running -> no_power/no_fuel` 闪回；
- 对 `running` 同状态 reason 清理事件按“允许存在但不作为主验收对象”处理。

## 3. 最终语义定义

### 3.1 单一 authoritative 规则

本次明确规定：

- `runtime.state` 表示的是**刚刚完成结算的这个 tick 的工作结果**
- 它不是“下一 tick 的预测状态”

因此当 `artificial_star` 在 tick N 成功消耗最后一根 `antimatter_fuel_rod` 并发出了 `+80` 供电时：

- tick N 结束时仍然允许显示 `running`
- tick N 的 `networks/stats` 必须体现这次供电
- 此时建筑本地库存已经为 `0` 也是合法结果
- 如果没有新燃料补入，则 tick N+1 才切换为 `no_power/no_fuel`

这条语义同样适用于：

- `thermal_power_plant`
- `mini_fusion_power_plant`

### 3.2 观察面一致性

修复后，各观察面的关系应为：

- `inspect`：直接反映建筑 runtime 与本地存储
- `scene`：直接复用建筑 runtime
- `building_state_changed`：围绕真实结算后的 runtime 发事件
- `GET /world/planets/{planet_id}/networks`：继续读取 `PowerSettlementSnapshot`
- `GET /state/stats`：继续读取 `PowerSettlementSnapshot`

也就是说，本次不额外发明“观察面专属语义”，而是让它们围绕同一个 tick 事实工作。

## 4. 文件级实现设计

### 4.1 `server/internal/gamecore/rules.go`

这是本次唯一必须发生行为修改的文件。

当前错误分支是：

```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) && !fuelBasedGeneratorHasReachableFuel(b) {
    if evt := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonNoFuel); evt != nil {
        events = append(events, evt)
    }
    continue
}
```

最终方案改为：

```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) {
    if b.Runtime.State == model.BuildingWorkNoPower && b.Runtime.StateReason == stateReasonNoFuel {
        continue
    }
}
```

这段改动的含义是：

- `settleResources` 不再重新检查“当前库存里还有没有燃料”
- 如果前序阶段已经判定本 tick 无燃料并写成 `no_power/no_fuel`，这里直接跳过
- 如果前序阶段已经判定本 tick 成功发电，那么这里不得再把它打回 `no_fuel`

### 4.2 `server/internal/gamecore/power_generation.go`

本文件不需要改结构，但要明确其职责归属：

1. 检查燃料型发电建筑是否有可达燃料
2. 无燃料时写入 `no_power/no_fuel`
3. 从 `no_fuel` 恢复时写入 `running/start`
4. 调用 `ResolvePowerGeneration(...)` 扣减燃料并写入 `ws.PowerInputs`

实现要求：

- 补充注释，明确“燃料型发电建筑的运行态由本阶段 authoritative 管理”
- 不新增新的状态机层
- 不改 `ResolvePowerGeneration(...)` 与 `consumeFuel(...)` 的已有逻辑

### 4.3 明确保持不变的文件

以下文件本轮不应承接行为层改动：

- `server/internal/model/power.go`
- `server/internal/gamecore/fuel_generators.go`（除非实现时确实需要一个很小的私有 helper）
- `server/internal/query/query.go`
- `server/internal/query/networks.go`
- `server/internal/query/planet_inspector.go`
- `server/internal/gamecore/stats_settlement.go`

原因很明确：

- 这些模块消费的事实源已经正确；
- 问题出在前序 runtime 语义被后序阶段覆写，而不是它们各自的公式错误。

## 5. 测试设计

### 5.1 必改旧测试：`server/internal/gamecore/t099_fuel_generator_state_test.go`

当前旧测试把错误语义锁死了，必须同步修改。

其中至少要调整：

- `TestT099ArtificialStarFallsBackToNoFuelAfterLastRodIsConsumed`

旧预期：

- 单根燃料在一个 `processTick()` 后立刻回到 `no_power/no_fuel`

新预期：

1. 第 1 个 tick：
   - `runtime.state = running`
   - 允许库存已变成 `0`
   - `PowerInput.Output = 80`
   - `networks/stats` 能看到本 tick 的供电收益
2. 第 2 个 tick（未补燃料）：
   - 才回到 `no_power/no_fuel`

### 5.2 新增测试文件：`server/internal/gamecore/t104_artificial_star_stable_power_test.go`

新增独立 T104 回归，用来锁住“装燃料后可稳定供电”的目标语义，不把所有时序细节继续堆进 T099。

建议覆盖以下场景：

1. 空燃料基线
   - `artificial_star` 无燃料时保持 `no_power/no_fuel`
   - `networks/stats` 没有虚假供电
2. 单根燃料最小运行期
   - 第 1 个 tick 可观察到合法 `running`
   - 第 2 个 tick 才回到 `no_power/no_fuel`
3. 多根燃料持续时间
   - 装入 `3` 根时，连续 `3` 个 tick 保持 `running`
   - 第 `4` 个 tick 才回落
4. 事件序列
   - 存在 `no_power/no_fuel -> running(start)`
   - 真实耗尽后才出现 `running -> no_power/no_fuel`
   - 不再出现同 tick 闪回
5. 共享分支回归
   - `thermal_power_plant`
   - `mini_fusion_power_plant`
   - 两者也遵守同一规则

### 5.3 查询层验证方式

T104 新测试不应只测内部函数，建议直接在 `GameCore + query` 组合层锁观察面：

- `query.PlanetInspect(...)`
- `query.PlanetScene(...)`
- `query.PlanetNetworks(...)`
- `ws.Players["p1"].Stats.EnergyStats`

这样可以一次性把任务要求中的五条观察面一起锁住，而不是只证明内部函数返回值正确。

## 6. 文档同步设计

实现完成后，必须同步以下文档：

- `docs/player/已知问题与回归.md`
- `docs/player/玩法指南.md`
- `docs/dev/服务端API.md`

同步要求：

1. `docs/player/已知问题与回归.md`
   - 把 T104 从“当前缺口”改成“已修复”
   - 保留原始复现现象与修复后的新语义
2. `docs/player/玩法指南.md`
   - 明确 `artificial_star` 使用 `antimatter_fuel_rod`
   - 明确当前按 `consume_per_tick = 1` 逐 tick 消耗
   - 明确“最后一根燃料被本 tick 消耗完时，该 tick 仍可观察到发电”
3. `docs/dev/服务端API.md`
   - 保持接口结构不变
   - 仅更新燃料型发电建筑的运行态与观察面语义说明
   - 明确 `networks/stats` 在燃料存在的发电 tick 内会持续反映真实供电

## 7. 验证方案

### 7.1 自动化验证

至少执行：

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore
```

重点确认：

- 修改后的 T099 通过
- 新增 T104 通过
- 共享分支 `thermal_power_plant` / `mini_fusion_power_plant` 没有回归

### 7.2 真实玩法验证

按任务文档中的终局复现路径，至少重放一次：

1. 在 `planet-1-2` 建造 `artificial_star`
2. `transfer <artificial_star_id> antimatter_fuel_rod 1`
3. 再执行 `transfer <artificial_star_id> antimatter_fuel_rod 3`
4. 依次检查：
   - `inspect`
   - `scene`
   - `building_state_changed`
   - `GET /world/planets/{planet_id}/networks`
   - `GET /state/stats`

预期：

- 单根燃料至少形成一个可观察发电 tick
- 3 根燃料连续支撑 3 个 tick，而不是约 2 tick 就掉空
- 供电收益与建筑运行态对得上

## 8. 验收标准

1. `transfer <artificial_star_id> antimatter_fuel_rod <n>` 后，只要本 tick 成功发电，结算后的 `inspect/scene` 就应显示 `running`；如果最后一根燃料在本 tick 被消耗完，该 tick 仍允许显示 `running`。
2. `GET /world/planets/{planet_id}/networks` 与 `GET /state/stats.energy_stats` 在燃料存在且成功发电的 tick 内持续体现 `artificial_star` 的供电贡献。
3. 多根燃料棒的持续时间与 `consume_per_tick` 一致，不再出现“3 根燃料棒仅维持约 2 tick 就全部消失”的现象。
4. 燃料真正耗尽后，建筑才在下一 tick 回到 `no_power/no_fuel`。
5. 本次修复一次覆盖 `artificial_star`、`thermal_power_plant`、`mini_fusion_power_plant` 三类燃料型发电建筑，不引入专属特判。
6. 相关玩家文档与服务端 API 文档口径与实现保持一致。

## 9. 推荐落地顺序

1. 修改 `server/internal/gamecore/rules.go`
2. 在 `server/internal/gamecore/power_generation.go` 补充 authoritative 注释
3. 修改 `server/internal/gamecore/t099_fuel_generator_state_test.go`
4. 新增 `server/internal/gamecore/t104_artificial_star_stable_power_test.go`
5. 同步更新 `docs/player/*` 与 `docs/dev/服务端API.md`
6. 跑 `go test ./internal/gamecore`
7. 做一次真实终局重放验证

这样可以用最小改动、最低耦合，把 T104 从“装了燃料但观察不到稳定供电”收口为一条真实成立的终局能源闭环。
