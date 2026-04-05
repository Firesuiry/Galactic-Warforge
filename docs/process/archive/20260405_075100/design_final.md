# T099 最终实现方案：终局高阶舰队线口径收口与燃料型终局电站运行态修正

## 0. 输入说明

当前仓库根目录下存在 `docs/process/design_claude.md`，但不存在用户指名的 `docs/process/design_codex.md`。

因此，本文不伪造“两份同题草案都存在”的前提，而是基于以下输入做单一定稿：

1. `docs/process/design_claude.md`
2. `docs/process/task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md`
3. 当前代码与文档现状

本文目标不是继续并列保留多种思路，而是给出一份可以直接进入实现阶段的最终方案。

---

## 1. 最终裁决

### 1.1 终局高阶舰队线

选择 **方案 B：继续隐藏，并彻底统一仓库口径**。

不在 T099 内实现：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

原因很明确：当前缺的不是一个开关，而是整条玩家可玩链路，包括生产、部署、编队、轨道/太空查询、战斗结算与事件回传。把它们硬塞进 T099，会把一个边界收口任务扩成新的大型功能迭代。

### 1.2 `artificial_star` 无燃料运行态

最终采用：

- `runtime.state = no_power`
- `runtime.state_reason = no_fuel`

同一逻辑同时适用于：

- `thermal_power_plant`
- `mini_fusion_power_plant`
- `artificial_star`

### 1.3 明确不采用的路线

不采用 `idle + no_fuel`，也不新增新的 `BuildingWorkState` 枚举值。

原因：

1. 当前 `applyBuildingState()` 会清空 `idle/running` 的 `state_reason`，`idle + no_fuel` 现状下无法稳定成立。
2. 当前 `settlePowerGeneration()` 与 `settleResources()` 都会跳过 `idle`，若直接走 `idle + no_fuel`，恢复语义会变得别扭，甚至需要额外改一圈状态机。
3. 当前任务只要求“空燃料时不能再显示 running，且观察面一致”，没有必要引入新的状态枚举。

---

## 2. 基于当前代码的事实判断

### 2.1 高阶舰队线当前已经被 runtime 降级为隐藏边界

当前代码里，T093 级别的降级已经存在：

- `server/internal/model/tech_alignment_test.go`
  - 已断言 `prototype`、`precision_drone`、`corvette`、`destroyer` 不再暴露 `TechUnlockUnit`
  - 已断言这 4 项科技为 `hidden=true`
- `server/internal/gamecore/rules.go` 的 `execProduce()`
  - 仍只接受 `worker|soldier`
- `client-cli/src/commands/action.ts`
  - `produce` 仍只接受 `worker|soldier`
- `client-cli/src/commands/util.ts`
  - `help produce` 仍显示 `Produce unit (worker/soldier)`

也就是说，代码真相已经是“高阶舰队线未开放”，T099 需要补的是：

1. 删掉剩余的夸大表述
2. 用测试把“继续隐藏”锁死

### 2.2 当前文档已大体对齐，但仍有残余夸大口径

当前文档里：

- `docs/player/玩法指南.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`

已经基本承认高阶舰队线未开放。

但 `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md` 仍存在“科技树完整覆盖”这类容易被理解成“终局科技树全线可玩”的说法。T099 需要把这类残余表述收口，而不是重写所有已经正确的文档。

### 2.3 `artificial_star` 的真正问题点在 `settleResources()`

当前实现里：

1. `server/internal/model/power.go` 的 `ResolvePowerGeneration()`
   - 无燃料时输出 `0`
   - 燃料消耗逻辑本身是正确的
2. `server/internal/gamecore/power_generation.go`
   - 对无燃料发电建筑不会写入 `ws.PowerInputs`
3. `server/internal/gamecore/rules.go` 的 `settleResources()`
   - 在维护费、电力条件通过后，会直接把建筑写回 `running`
   - 没有检查燃料型发电建筑是否真的还有可用燃料

所以问题不是“发电结算错了”，而是“运行态写回错了”。

### 2.4 燃料可用性判断必须严格镜像真实消耗语义

当前 `ResolvePowerGeneration()` 的 `consumeFuel()` 只会从以下区域取燃料：

1. `InputBuffer`
2. `Inventory`

它 **不会** 从 `OutputBuffer` 取燃料。

因此，T099 的燃料门禁判断也必须只检查：

- `InputBuffer`
- `Inventory`

不能像旧草案那样把 `OutputBuffer` 也算进“可用燃料”，否则查询口径会再次和真实消耗逻辑脱节。

### 2.5 `applyBuildingState()` 的“同状态刷新原因”已经修好，不要重复设计

当前 `server/internal/gamecore/building_lifecycle.go` 已经允许：

- `prev_state == next_state`
- 但 `reason` 变化时仍然写回并发事件

因此，T099 不需要再重做一遍“同状态 reason 刷新”的设计。这里只需要新增 `no_fuel` 原因，并复用当前状态写回机制即可。

---

## 3. 最终方案

### 3.1 高阶舰队线：继续隐藏，统一文档与测试口径

#### 3.1.1 代码层保持现状，不假开放

以下部分保持不变：

- `server/internal/model/tech.go`
  - `prototype`、`precision_drone`、`corvette`、`destroyer` 继续 `hidden=true`
- `server/internal/model/tech_alignment_test.go`
  - 继续要求上述科技不暴露 `TechUnlockUnit`
- `server/internal/gamecore/rules.go`
  - `execProduce()` 继续只接受 `worker|soldier`
- `client-cli`
  - 不新增高阶舰队生产/部署命令

#### 3.1.2 文档统一使用单一句式

统一推荐表述：

> `prototype`、`precision_drone`、`corvette`、`destroyer` 这条终局高阶舰队线当前仍处于隐藏状态，玩家侧没有公开的生产、部署、编队、查询和战斗入口。当前版本的 DSP 科技树覆盖不包含这条线。

#### 3.1.3 文档改动范围

1. `docs/player/玩法指南.md`
   - 保留现有“高阶舰队线未开放”说明
   - 再确认 `produce` 的玩家可用单位只写 `worker|soldier`
2. `docs/player/已知问题与回归.md`
   - 将该项从“实现宣称不成立”收口成“当前版本明确边界”
   - 保留复现证据，避免后续再次误报“已完整实现”
3. `docs/dev/客户端CLI.md`
   - 继续明确 CLI 没有高阶舰队命令
   - `produce` 帮助口径只保留 `worker|soldier`
4. `docs/dev/服务端API.md`
   - 继续明确 `/catalog.techs[].hidden`
   - `POST /commands` 的 `produce.payload.unit_type` 只写 `worker|soldier`
5. `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`
   - 把“科技树完整覆盖”改成带边界的表述
   - 明确高阶舰队线不在当前公开可玩范围内

#### 3.1.4 实现时做一次 repo 内全文检索

除以上 5 份文档外，实现时还应全文检索以下关键词，补掉残余夸大口径：

- `已全部实现`
- `全部实现`
- `完整覆盖`
- `终局玩法已全部覆盖`

原则不是全仓库大改，而是只修和 T099 相关、会误导“高阶舰队线已开放”的表述。

### 3.2 燃料型发电建筑：采用 `no_power + no_fuel`

#### 3.2.1 新增状态原因常量

文件：

- `server/internal/gamecore/building_lifecycle.go`

新增：

```go
stateReasonNoFuel = "no_fuel"
```

不新增新的 `BuildingWorkState` 枚举值。

#### 3.2.2 新增“可达燃料”判断 helper

建议放在 `server/internal/gamecore` 层，供发电结算与资源结算共同复用。

推荐 helper 语义：

```go
func fuelBasedGeneratorHasReachableFuel(b *model.Building) bool
```

判断规则：

1. 建筑必须有 `EnergyModule`
2. `SourceKind` 必须是燃料型发电源
3. 逐条检查 `FuelRules`
4. 只统计 `InputBuffer + Inventory`
5. 只要任一规则的可达库存 `>= ConsumePerTick`，就视为“本 tick 有燃料可用”

这必须严格镜像 `consumeFuel()` 的真实取料路径，不能另外发明一套“看起来像有燃料”的判断。

#### 3.2.3 在发电结算前增加一次状态同步

文件：

- `server/internal/gamecore/power_generation.go`

在真正调用 `ResolvePowerGeneration()` 前，对所有燃料型发电建筑做一次 readiness 同步：

1. `paused` / `error` 保持现状，不篡改
2. 无燃料时：
   - `applyBuildingState(b, model.BuildingWorkNoPower, stateReasonNoFuel)`
3. 有燃料且当前正处于 `no_power/no_fuel` 时：
   - `applyBuildingState(b, model.BuildingWorkRunning, stateReasonStart)`

这样做的目的不是提前造电，而是保证：

1. 建筑在本 tick 发电前，运行态已经和燃料条件一致
2. 玩家在“装燃料后的下一个 tick”就能同时看到：
   - `state = running`
   - `generation / supply` 上升

#### 3.2.4 在 `settleResources()` 末段再做一次燃料门禁

文件：

- `server/internal/gamecore/rules.go`

在维护费与外部供电检查通过后、写回 `running` 之前，再做一次燃料检查：

1. 若是燃料型发电建筑且已无可达燃料：
   - `applyBuildingState(b, model.BuildingWorkNoPower, stateReasonNoFuel)`
   - `continue`
2. 其余情况再进入 `running`

这一步不能省。原因是：

- 发电结算发生在前半段
- 燃料可能在本 tick 内刚好被消耗完

若只做前置检查，不做后置检查，那么“本 tick 刚耗尽最后一根燃料棒”的建筑，在 tick 结束后的查询面上仍可能错误显示为 `running`。

#### 3.2.5 状态语义表

| 条件 | `runtime.state` | `runtime.state_reason` | 备注 |
| --- | --- | --- | --- |
| 无燃料 | `no_power` | `no_fuel` | 不再对外显示为 `running` |
| 有燃料且本 tick 可运行 | `running` | `""` | 正常发电 |
| 刚在本 tick 内耗尽最后燃料 | `no_power` | `no_fuel` | tick 结束后即可观察到缺燃料 |

### 3.3 观察面统一方式

T099 不在 query 层补丁式造数，只修 runtime 真相来源。

统一方式如下：

1. `inspect`
   - 直接读取 `building.Runtime.State/StateReason`
2. `scene`
   - 直接读取建筑 runtime state
3. `building_state_changed`
   - 由 `applyBuildingState()` 发出
4. `state/stats.energy_stats`
   - 继续读取 authoritative power snapshot
5. `world/planets/{planet_id}/networks`
   - 继续读取 `ws.PowerInputs -> ResolvePowerNetworks()`

结论是：

- 无燃料时，不会再有发电输入，因此 `stats/networks` 自然为 0
- 同时 runtime state 被写成 `no_power/no_fuel`
- 不需要额外改 query 层

### 3.4 为什么最终不用 `idle + no_fuel`

这是本文与 `design_claude.md` 的主要取舍差异。

不采用它的原因是当前代码事实已经证明：

1. `idle` 的 `state_reason` 会被清空
2. `settlePowerGeneration()` 跳过 `idle`
3. `settleResources()` 也跳过 `idle`

若继续坚持 `idle + no_fuel`，实现就不得不同时修改：

- 状态写回语义
- idle 建筑的 tick 参与规则
- 恢复路径

这会把一个简单修复扩成状态机改造，不符合 T099 的收口目标。

---

## 4. 自动化测试与验证方案

### 4.1 服务端测试

新增或补充以下测试：

1. `artificial_star` 无燃料时为 `no_power/no_fuel`
   - 断言 `runtime.state != running`
   - 断言 `runtime.state == no_power`
   - 断言 `runtime.state_reason == no_fuel`
   - 断言 `PowerSnapshot/Networks` 中该建筑供电为 0
2. `artificial_star` 装入燃料后恢复运行
   - 下一 tick 后断言 `runtime.state == running`
   - 断言 `generation/supply` 上升
   - 断言有 `building_state_changed`
3. `artificial_star` 燃料耗尽后回到 `no_power/no_fuel`
4. `thermal_power_plant` 与 `mini_fusion_power_plant` 复用同一逻辑
5. `produce corvette` 仍被拒绝
   - 断言服务端返回 `unknown unit type`

建议测试文件：

- `server/internal/gamecore/t099_fuel_generator_state_test.go`
- 复用 `server/internal/model/tech_alignment_test.go`

### 4.2 CLI 测试

在 `client-cli` 现有 Node test 体系中补两类回归：

1. `help produce`
   - 仍只显示 `worker/soldier`
2. `cmdProduce(['b-1', 'corvette'])`
   - 仍返回 `unit_type 必须是 worker 或 soldier`

建议位置：

- `client-cli/src/commands/index.test.ts`
- `client-cli/src/commands/action.test.ts`（若当前无文件则新增）

### 4.3 文档一致性回归

T099 的验收明确要求“若高阶舰队线继续隐藏，测试必须锁定文档不再宣称已全部实现”。

这里不建议把文档扫描塞进 server 单元测试；更直接的做法是新增一个独立校验脚本，例如：

- `develop_tools/verify_t099_docs.sh`

脚本职责：

1. 校验指定 5 份文档都包含“高阶舰队线未开放”或等价表述
2. 校验不再出现 T099 明确禁止的夸大句式

这样能把“文档边界”与“server runtime 单测”解耦。

### 4.4 最终验证命令

实现完成后至少执行：

```bash
cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./...
cd client-cli && npm test
./develop_tools/verify_t099_docs.sh
```

---

## 5. 实施步骤

### 步骤 1：锁定高阶舰队线边界

1. 复核 `tech.go` / `tech_alignment_test.go` / `execProduce()` / `client-cli` 帮助文本
2. 不做功能开放，只补测试与文档

### 步骤 2：修正燃料型发电建筑运行态

1. 在 `building_lifecycle.go` 新增 `stateReasonNoFuel`
2. 实现燃料可达性 helper
3. 在 `power_generation.go` 前置同步燃料型发电建筑状态
4. 在 `settleResources()` 末段补二次燃料门禁

### 步骤 3：补回归测试

1. 服务端燃料门禁测试
2. 服务端 `produce corvette` 拒绝测试
3. CLI `help produce` / `cmdProduce corvette` 测试
4. 文档一致性脚本

### 步骤 4：文档回写

1. 只改 5 份指定文档与 repo 内残余相关口径
2. 不重写已经正确的段落

---

## 6. 不做的事

1. 不在 T099 内实现高阶舰队生产/部署/编队/太空战系统
2. 不新增 `BuildingWorkState` 枚举值
3. 不采用 `idle + no_fuel`
4. 不在 query 层单独补假状态或假供电值
5. 不修改 T093 已经正确完成的隐藏科技与 `produce` 白名单结论

---

## 7. 结论

T099 的正确收口方式不是“把所有终局残项一次性补完”，而是把当前真实可玩的部分与未开放边界重新拉回一致。

最终唯一推荐路线是：

1. 高阶舰队线继续隐藏，并把文档、CLI、API、能力盘点口径统一成“未开放边界”
2. 燃料型发电建筑在无燃料时统一表现为 `no_power + no_fuel`
3. 用 server、CLI 与文档三层回归把这条边界锁死

这样既能修正 `artificial_star` 的错误运行态，也能避免仓库继续对外宣称并不存在的终局舰队玩法。
