# T091 设计方案：戴森中后期公开命令断档与剩余 DSP 建筑补齐（Codex）

## 1. 文档目标

`docs/process/task/` 当前只有一个待处理任务：`T091_戴森中后期公开命令断档与剩余DSP建筑补齐.md`。本设计文档只服务这一项任务，目标是把“文档、CLI、API 已公开”与“服务端真实可玩”重新对齐。

本轮要解决的真实问题只有两类：

1. `switch_active_planet`、`set_ray_receiver_mode` 已在 `gamecore`、`shared-client`、`client-cli` 和文档里公开，但网关仍把它们当成未知命令拒绝。
2. `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab` 仍停留在“有名词、无玩法闭环”的半定义态。

本方案遵循仓库的“激进式演进”原则：

- 不为了保留旧的半真半假状态去做兼容层。
- 能并入真实主线的能力就直接补齐。
- 不能形成闭环的内容必须显式降级，而不是继续挂在“已覆盖”列表里。

本设计的推荐结论是：**两条公开命令直接修复；4 个建筑全部做成真实可玩，但只引入一个新的最小抽象 `ShieldModule`，其余能力尽量复用现有结算链。**

## 2. 基于当前代码的事实判断

### 2.1 公开命令的真实断点

当前代码里，`switch_active_planet` 和 `set_ray_receiver_mode` 并不是“底层没做”，而是“网关漏接线”：

- `server/internal/model/command.go` 已定义：
  - `CmdSwitchActivePlanet`
  - `CmdSetRayReceiverMode`
- `server/internal/gamecore/core.go` 已有命令分发。
- `server/internal/gamecore/planet_commands.go` 已有：
  - `execSwitchActivePlanet`
  - `execSetRayReceiverMode`
- `shared-client/src/api.ts`、`client-cli`、开发文档和玩家文档都已经把它们当作公开命令使用。
- 真正缺失的是 `server/internal/gateway/server.go` 的 `validateCommandStructure` 没有这两个 `case`，请求在进入 `gamecore` 之前就被 `unknown command type` 拦截。

这意味着本轮对命令问题的设计不需要再动 CLI、shared-client 或多星球 runtime 主体，只要补齐网关校验与对应测试即可。

### 2.2 4 个建筑的真实实现状态

| 建筑 | 当前状态 | 已可复用的代码 | 当前缺口 |
| --- | --- | --- | --- |
| `jammer_tower` | `Buildable=false`，无 runtime 定义 | `server/internal/gamecore/enemy_force_settlement.go` 已有 `applySlowFieldEffects()`，并且直接按 `BuildingTypeJammerTower` 生效 | 需要 buildability、科技入口、供电 runtime、可观测测试 |
| `sr_plasma_turret` | `Buildable=false`，无 runtime 定义 | `server/internal/gamecore/rules.go` 的 `settleTurrets()` 已能处理任意带 `CombatModule` 的防御建筑 | 需要 buildability、科技入口、runtime、`IsDefenseBuilding/GetDefenseType` 接线 |
| `planetary_shield_generator` | `Buildable=false`，无 runtime，无护盾结算 | 无现成护盾结算，但现有敌袭入口集中在 `executeEnemyAttack()`，适合做最小切入 | 需要科技、runtime、新模块、新结算、新可观测字段 |
| `self_evolution_lab` | `Buildable=false`，无 runtime | 现有 `matrix_lab` 已具备 `Production + Research + Storage + Energy` 四件套；研究系统已经是真实矩阵消耗 | 需要 buildability、公开科技入口、runtime、矩阵配方兼容、隐藏科技一致性修正 |

### 2.3 额外的一致性约束

还有两个细节会直接影响设计选型：

1. `self_evolution_lab` 现在只通过隐藏科技 `dark_fog_matrix` 的 alias 间接解锁，但 `server/internal/model/item.go` 里没有 `dark_fog_matrix` 这个物品定义；配置目录里虽然已经有 `config/defs/items/science/dark_fog_matrix.yaml`，但服务端运行时真相仍以 `item.go` 为准。
2. 现有很多老防御建筑并没有完整 runtime，`signal_tower` 的效果更多依赖类型分支而不是统一模块化数据。这说明本轮不适合顺手做“大一统防御框架重构”，否则范围会迅速失控。

## 3. 方案对比

### 3.1 方案 A：只修公开命令，4 个建筑全部降级为未实现

做法：

- 修网关校验。
- 把 4 个建筑从玩家文档、能力盘点和 API 示例里全部移出。

优点：

- 风险最小。
- 不需要新增运行时结构。

问题：

- 和 T091“补齐剩余 DSP 建筑”的标题方向不一致。
- `jammer_tower`、`sr_plasma_turret`、`self_evolution_lab` 其实都已经有足够多的底座，继续降级是浪费现有实现。
- 会让项目继续停留在“late game 只剩少量名词没收口”的状态。

结论：**不推荐。**

### 3.2 方案 B：趁机重构整个战斗建筑体系

做法：

- 把所有炮塔、信号塔、干扰塔、护盾建筑统一收敛到新的 `DefenseModule/AuraModule/ShieldModule` 框架。
- 顺手补齐现有 `missile_turret`、`laser_turret`、`plasma_turret`、`signal_tower` 的 runtime 缺失。

优点：

- 长期结构最整齐。
- 防御建筑数据模型会明显更一致。

问题：

- 范围已经超出 T091。
- 会同时改动旧防御塔、敌袭、侦测、事件、文档与回归场景。
- 当前仓库没有要求“把所有历史防御建筑一起翻修”，强行做只会扩大回归面。

结论：**长期可做，但不适合作为 T091 方案。**

### 3.3 方案 C：推荐方案，定点补齐

做法：

- 命令问题只修网关校验与测试。
- `jammer_tower` 复用现有减速场逻辑。
- `sr_plasma_turret` 复用现有炮塔结算逻辑。
- `self_evolution_lab` 复用 `matrix_lab` 的生产/科研模型。
- 只为 `planetary_shield_generator` 新增一个最小 `ShieldModule`，并把吸伤逻辑挂在现有敌袭入口上。
- 官方 `config-midgame.yaml` 作为回归场景，预置新建筑所需科技，但**不**预置 `dirac_inversion`，以保留 `photon` 模式的负向验收。

结论：**这是本轮推荐方案。**

## 4. 总体设计原则

### 4.1 只新增一个新抽象：`ShieldModule`

`jammer_tower`、`sr_plasma_turret`、`self_evolution_lab` 都可以复用现有循环，不需要再造通用框架。只有行星护盾无法塞进 `CombatModule` 或 `ResearchModule`，因此只新增：

- `ShieldModule`

不新增泛化的 `DefenseModule`、`AuraSystem`、`Buff/Debuff` 总线。

### 4.2 不引入弹药系统

参考文档里干扰塔和高阶电浆炮都可以有“胶囊/弹药”设定，但当前项目的真实防御模型是“供电即工作”。T091 不应为了 4 个建筑反向引入一套半成品弹药经济。

因此本轮约束为：

- 防御建筑继续使用“通电 + 运行态”作为主前提。
- `jammer_tower` 和 `sr_plasma_turret` 只吃电，不额外消耗弹药。
- 后续如果真的要做弹药体系，应统一覆盖所有炮塔，而不是只给新建筑单独加例外。

### 4.3 midgame 场景是回归夹具，不是自然存档

官方 `config-midgame.yaml` 的职责是“快速验证中后期链路”，不是“模拟一局自然打到这里的完整存档”。因此为 T091 额外预置科技是合理的，只要：

- 预置内容只服务可回归验证。
- 文档明确这是官方验证场景，而不是普通新局默认状态。
- 仍然保留 `dirac_inversion` 未解锁，以验证 `photon` 模式前置校验。

## 5. 详细设计

### 5.1 公开命令修复

#### 5.1.1 结构校验

在 `server/internal/gateway/server.go` 的 `validateCommandStructure` 中新增两个分支：

- `CmdSwitchActivePlanet`
  - 必填 `payload.planet_id`
- `CmdSetRayReceiverMode`
  - 必填 `payload.building_id`
  - 必填 `payload.mode`

这里只做“结构校验”，不做业务语义判断。业务语义继续留在 `gamecore`：

- `execSwitchActivePlanet()` 负责“已发现 + runtime 已加载 + 玩家已有 foothold”。
- `execSetRayReceiverMode()` 负责“建筑归属 + 目标类型 + `power|photon|hybrid` + `dirac_inversion` 前置”。

#### 5.1.2 验证设计

测试分三层：

1. `server/internal/gateway/server_internal_test.go`
   - 校验两条命令不再被视为未知命令。
   - 缺字段时仍返回精确的 `payload.*` 错误。
2. `server/internal/gateway` 集成测试
   - 发命令后读取 `/state/summary`，确认 `active_planet_id` 发生变化。
   - 发命令后读取 `/world/planets/{planet_id}/inspect`，确认 `ray_receiver.runtime.functions.ray_receiver.mode` 同步变化。
3. `server/internal/gamecore/t090_closure_test.go`
   - 继续保留 `photon` 模式未解锁时报错的负向断言，确保这次修的是“网关可达性”，不是把科技门禁绕过去。

CLI、shared-client、Web 不需要新增命令实现；它们现在缺的是“服务端终于承认这条命令存在”。

### 5.2 4 个建筑的收口方案

#### 5.2.1 总表

| 建筑 | 科技入口 | 是否新增模块 | 结算入口 | 玩家使用方式 |
| --- | --- | --- | --- | --- |
| `jammer_tower` | 挂到现有 `signal_tower` 科技 | 否 | 复用 `applySlowFieldEffects()` | `build`，接电后自动生效 |
| `sr_plasma_turret` | 挂到现有 `plasma_turret` 科技 | 否 | 复用 `settleTurrets()` | `build`，接电后自动攻击 |
| `planetary_shield_generator` | 新增 `planetary_shield` 科技 | 是，新增 `ShieldModule` | 新增 `settlePlanetaryShields()` + 敌袭吸伤 | `build`，接电后充能并自动吸伤 |
| `self_evolution_lab` | 新增公开科技 `self_evolution`；保留隐藏科技 `dark_fog_matrix` 作为备用解锁 | 否 | 复用生产/科研结算 | `build`，可作为高级矩阵产线或高级研究站 |

#### 5.2.2 `jammer_tower`

设计目标：让它成为一个真实的“需要供电的范围减速建筑”，而不是继续停留在类型名。

具体设计：

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 120, Energy: 60}`
- `server/internal/model/tech.go`
  - 不新增独立科技节点。
  - 直接把 `jammer_tower` 作为 `signal_tower` 科技的额外建筑解锁。
  - 理由：两者同属战术支援分支，继续拆一个独立科技只会制造树形噪音。
- `server/internal/model/building_runtime.go`
  - 新增 runtime：
    - `ConnectionPoints: power`
    - `EnergyConsume = 6`
    - `CombatModule{Attack: 0, Range: 8}`
    - `EnergyModule{ConsumePerTick: 6}`

结算设计：

- 继续复用 `server/internal/gamecore/enemy_force_settlement.go` 里的 `applySlowFieldEffects()`。
- 该函数已经按 `BuildingTypeJammerTower` 做了分支，现阶段只需让建筑真正能进入 `running`/`no_power`，并把范围从默认常量切到 runtime 的 `Combat.Range`。
- 慢化强度继续保持当前简化值 `0.5`，不为本轮新增专门的 debuff 模型。

玩家可见路径：

1. 研究或在官方 midgame 场景里直接拥有 `signal_tower` 科技。
2. `build x y jammer_tower`
3. 接入电网。
4. 有敌方势力靠近时，敌方扩散/推进速度下降。

建议测试：

- catalog/buildability/tech unlock 一致性测试。
- `jammer_tower` 在 `running` 时能降低附近 `EnemyForce.SpreadRadius` 的增长速度。
- 建筑断电后减速效果停止。

#### 5.2.3 `sr_plasma_turret`

设计目标：做成真正的高阶电浆炮塔，但不引入新的炮塔框架。

具体设计：

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 300, Energy: 150}`
- `server/internal/model/tech.go`
  - 不新增独立科技。
  - 直接把 `sr_plasma_turret` 挂到现有 `plasma_turret` 科技下。
  - 理由：DSP 语义里这两个建筑天然同属一条高阶电浆火力线，拆成两个公开科技节点并不能带来额外玩法价值。
- `server/internal/model/building_runtime.go`
  - 新增 runtime：
    - `ConnectionPoints: power`
    - `EnergyConsume = 20`
    - `CombatModule{Attack: 60, Range: 12}`
    - `EnergyModule{ConsumePerTick: 20}`
- `server/internal/model/defense.go`
  - `IsDefenseBuilding()` 增加 `BuildingTypeSRPlasmaTurret`
  - `GetDefenseType()` 增加 `BuildingTypeSRPlasmaTurret -> DefenseTypeTurret`

结算设计：

- 直接复用 `server/internal/gamecore/rules.go` 的 `settleTurrets()`。
- 不新增专用结算循环。
- 不新增弹药消耗，保持与当前高斯炮塔同一条“通电即射击”的简化规则。

玩家可见路径：

1. 研究或在官方 midgame 场景里直接拥有 `plasma_turret` 科技。
2. `build x y sr_plasma_turret`
3. 接电后自动攻击进入射程的敌对势力。

建议测试：

- catalog/buildability/tech unlock 一致性测试。
- `sr_plasma_turret` 在 `running` 时会对敌对势力造成伤害。
- `sr_plasma_turret` 在 `no_power` 时不会开火。

#### 5.2.4 `planetary_shield_generator`

设计目标：提供一个真正能观察到“先掉护盾、再掉建筑 HP”的行星级防护能力，同时把改动面控制在最小范围。

核心设计决策：**不在 `WorldState` 上增加全局护盾池，而是把护盾电量存在每个生成器自己的 runtime 模块里。**

这样有三个好处：

- 不改存档结构。
- `inspect building` 直接能看到当前护盾电量。
- 多个护盾发生器天然可以叠加，只需在敌袭时按建筑列表顺序扣减。

具体设计：

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 500, Energy: 250}`
- `server/internal/model/tech.go`
  - 新增科技 `planetary_shield`
  - 推荐前置：`plasma_turret`、`interstellar_power`、`energy_shield`
  - 解锁：`planetary_shield_generator`
- `server/internal/model/building_runtime.go`
  - 新增：

```go
type ShieldModule struct {
    Capacity      int `json:"capacity" yaml:"capacity"`
    ChargePerTick int `json:"charge_per_tick" yaml:"charge_per_tick"`
    CurrentCharge int `json:"current_charge" yaml:"current_charge"`
}
```

  - `BuildingFunctionModules` 增加 `Shield *ShieldModule`
  - `clone()` 与校验逻辑同步补齐
  - `planetary_shield_generator` 的 runtime：
    - `ConnectionPoints: power`
    - `EnergyConsume = 50`
    - `ShieldModule{Capacity: 1000, ChargePerTick: 5, CurrentCharge: 0}`
    - `EnergyModule{ConsumePerTick: 50}`

结算设计：

- 新增 `server/internal/gamecore/planetary_shield_settlement.go`
  - `settlePlanetaryShields(ws)`：
    - 只处理 `running` 的 `planetary_shield_generator`
    - 每 tick 充能，直到 `CurrentCharge == Capacity`
  - `absorbPlanetaryShieldDamage(ws, ownerID, damage)`：
    - 收集该玩家所有 `running` 的护盾发生器
    - 按稳定顺序扣减 `CurrentCharge`
    - 返回 `absorbed` 与 `remaining`
- 在 `enemy_force_settlement.go` 的 `executeEnemyAttack()` 中，在真正扣建筑 HP 之前调用 `absorbPlanetaryShieldDamage()`。
- 现有事件 `EvtDamageApplied` 的 payload 增加：
  - `shield_absorbed`
  - `shield_remaining`

本轮边界：

- 只拦截当前已存在的 `enemy_force -> building` 伤害路径。
- 不顺手扩展到未来还不存在的太空舰队轰炸体系。
- 以后如果新增太空攻击，同样复用 `absorbPlanetaryShieldDamage()` 即可。

玩家可见路径：

1. 研究或在官方 midgame 场景里直接拥有 `planetary_shield` 科技。
2. `build x y planetary_shield_generator`
3. 接电后等待充能。
4. `inspect` 可看到 `runtime.functions.shield.current_charge` 增长。
5. 敌袭发生时，先消耗护盾，再掉建筑 HP。

建议测试：

- 护盾只在 `running` 时充能。
- 有护盾电量时，敌袭优先消耗护盾。
- 护盾耗尽后，伤害重新落到建筑 HP。
- `inspect` 能看到实时 `current_charge`。

#### 5.2.5 `self_evolution_lab`

设计目标：让它成为一个真实可建造、可科研、可产矩阵的高级研究设施，而不是继续挂在一个半隐藏、半不可达的别名上。

具体设计：

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 400, Energy: 200}`
- `server/internal/model/tech.go`
  - 新增公开科技 `self_evolution`
  - 推荐前置：`gravity_matrix`、`quantum_chip`、`research_speed`
  - 解锁：`self_evolution_lab`
  - 保留现有隐藏科技 `dark_fog_matrix -> self_evolution_station -> self_evolution_lab` 这条 alias 路线，作为未来黑雾内容的备用入口，而不是当前唯一入口
- `server/internal/model/item.go`
  - 同步补入 `dark_fog_matrix` 物品定义，确保隐藏科技的成本引用不再指向一个运行时不存在的 item
  - 本轮**不**补 `dark_fog_matrix` 的生产配方或掉落链
- `server/internal/model/building_runtime.go`
  - 新增 runtime，复用 `matrix_lab` 模型但强化参数：
    - `ConnectionPoints: power`
    - `EnergyConsume = 16`
    - `StorageModule{Capacity: 72, Slots: 6, Buffer: 24, InputPriority: 2, OutputPriority: 2}`
    - `ProductionModule{Throughput: 3, RecipeSlots: 1}`
    - `ResearchModule{ResearchPerTick: 3}`
    - `EnergyModule{ConsumePerTick: 16}`
- `server/internal/model/recipe.go`
  - 将 `BuildingTypeSelfEvolutionLab` 加入以下矩阵配方的 `BuildingTypes`：
    - `electromagnetic_matrix`
    - `energy_matrix`
    - `structure_matrix`
    - `information_matrix`
    - `gravity_matrix`
    - `universe_matrix`

这样它有两种真实玩法：

1. **高级研究站**：不设置 `recipe_id`，直接作为更高吞吐的科研建筑。
2. **高级矩阵站**：建造时指定矩阵配方，作为更高吞吐的矩阵产线。

玩家可见路径：

1. 研究或在官方 midgame 场景里直接拥有 `self_evolution` 科技。
2. `build x y self_evolution_lab`
3. 若用于科研，保持 `recipe_id` 为空并向建筑内输送矩阵。
4. 若用于生产，建造时直接指定矩阵配方。

建议测试：

- `self_evolution_lab` profile 同时暴露 `Production + Research + Storage + Energy`。
- 6 种矩阵配方允许该建筑类型。
- 同等条件下，其科研吞吐高于 `matrix_lab`。
- `dark_fog_matrix` 出现在运行时 item catalog 中，隐藏科技不再引用未知物品。

### 5.3 官方 midgame 场景调整

为了让 T091 的验收能在“官方验证场景”内直接完成，建议更新 `server/config-midgame.yaml`，为两名玩家的 `completed_techs` 追加：

- `signal_tower`
- `plasma_turret`
- `planetary_shield`
- `self_evolution`

明确不追加：

- `dirac_inversion`

原因：

- `jammer_tower`、`sr_plasma_turret` 需要对应上游科技已完成，玩家才能直接 `build`。
- `planetary_shield_generator`、`self_evolution_lab` 是新增公开科技，如果不预置，midgame 验收就会退化成“先临时补科研前置”。
- `dirac_inversion` 必须保持未解锁，这样 `set_ray_receiver_mode ... photon` 的负向验收仍然成立。

## 6. 涉及文件

| 文件 | 改动内容 |
| --- | --- |
| `server/internal/gateway/server.go` | 补 `CmdSwitchActivePlanet`、`CmdSetRayReceiverMode` 的结构校验 |
| `server/internal/gateway/server_internal_test.go` | 补命令校验正向/反向测试 |
| `server/internal/gateway/server_test.go` 或同层集成测试文件 | 验证 summary/inspect 的公开可见行为 |
| `server/internal/model/building_defs.go` | 4 个建筑补 `Buildable` 与 `BuildCost` |
| `server/internal/model/building_runtime.go` | 新增 4 个建筑 runtime；新增 `ShieldModule`；扩展 clone/validate |
| `server/internal/model/defense.go` | `sr_plasma_turret` 接入 defense helpers |
| `server/internal/model/tech.go` | `signal_tower`/`plasma_turret` 补建筑解锁；新增 `planetary_shield`、`self_evolution` |
| `server/internal/model/item.go` | 补 `dark_fog_matrix` 运行时物品定义 |
| `server/internal/model/recipe.go` | 矩阵配方支持 `self_evolution_lab` |
| `server/internal/gamecore/planetary_shield_settlement.go` | 新增护盾充能与吸伤逻辑 |
| `server/internal/gamecore/enemy_force_settlement.go` | 接入护盾吸伤；`jammer_tower` 读取 runtime 射程 |
| `server/internal/gamecore/rules.go` | `sr_plasma_turret` 通过现有 `settleTurrets()` 自动进入战斗链 |
| `server/internal/gamecore/t090_closure_test.go` | 继续承接跨星球、射线接收站和中后期闭环测试 |
| `server/config-midgame.yaml` | 追加 midgame 场景预置科技 |
| `docs/player/玩法指南.md` | 把 4 个建筑从“有定义但不算主线可玩”移到可玩建筑集 |
| `docs/player/上手与验证.md` | 增加 midgame 下对 4 个建筑和 2 条命令的真实验证步骤 |
| `docs/dev/客户端CLI.md` | 确认 2 条命令为真实可用；若示例补充 4 个建筑，说明仍走通用 `build` |
| `docs/dev/服务端API.md` | 更新能力说明、示例和 `/catalog` 结果预期 |
| `docs/archive/analysis/server现状详尽分析报告.md` | 同步能力盘点结论，避免继续把 4 个建筑记为半覆盖 |

## 7. 测试与验收映射

### 7.1 自动化测试

建议最少覆盖以下断言：

1. 网关不再把两条命令当成未知命令。
2. `switch_active_planet` 后 `/state/summary.active_planet_id` 变化。
3. `set_ray_receiver_mode power|hybrid` 后 `inspect` 能看到模式变化。
4. `set_ray_receiver_mode photon` 在未解锁 `dirac_inversion` 时仍失败。
5. `/catalog` 中 4 个建筑对拥有对应科技的玩家显示为可建。
6. `jammer_tower` 通电时减速、断电时失效。
7. `sr_plasma_turret` 通电时能对敌对势力造成伤害。
8. `planetary_shield_generator` 会充能并优先吸收敌袭伤害。
9. `self_evolution_lab` 既能提供更高研究吞吐，也能生产矩阵配方。

### 7.2 对应任务验收项

| T091 验收项 | 本设计对应点 |
| --- | --- |
| `switch_active_planet` 返回 `OK` 且 summary 变化 | §5.1 |
| `set_ray_receiver_mode` 返回 `OK` 且 inspect 同步变化 | §5.1 |
| `photon` 模式保留科技前置错误 | §5.1 |
| 4 个建筑进入科技树并可建造/使用 | §5.2 |
| 若走官方 midgame 验证，场景可直接回归 | §5.3 |

## 8. 风险与边界

### 8.1 旧防御建筑仍然没有完全统一 runtime

当前 `missile_turret`、`laser_turret`、`plasma_turret`、`signal_tower` 仍存在“部分靠类型分支驱动”的历史包袱。T091 不应该把这批旧问题一起吞下，只要保证本轮新增/补齐的 4 个建筑不再继续复制这种半定义态即可。

### 8.2 `dark_fog_matrix` 本轮只做一致性修正，不做完整黑雾玩法

本方案只把隐藏科技的物品引用补到运行时 item catalog，并让 `self_evolution_lab` 获得一条公开可玩的入口。黑雾掉落、黑雾矩阵生产、自演化独有配方不属于 T091 范围。

### 8.3 行星护盾只覆盖当前已有敌袭入口

本轮护盾会拦截现在真实存在的 `enemy_force -> building` 伤害链。未来如果新增轨道轰炸或舰队打击，应复用同一吸伤 helper，而不是再造第二套护盾逻辑。

## 9. 最终建议

T091 不应再走“只修命令，建筑继续挂名”的保守收口。当前代码已经给了足够多的可复用底座，最合理的做法是：

- 把两条公开命令修到真正可用。
- 把 `jammer_tower`、`sr_plasma_turret`、`self_evolution_lab` 直接并入现有玩法主线。
- 只为 `planetary_shield_generator` 增加一个最小的 `ShieldModule` 和对应结算。
- 用官方 midgame 场景承接回归验证。

这样可以在不扩大到“重构整个战斗系统”的前提下，把 T091 需要的 6 个缺口一次收口干净。
