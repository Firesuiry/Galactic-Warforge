# T091 最终设计方案：戴森中后期公开命令断档与剩余 DSP 建筑补齐

## 1. 文档目标

本文综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`，输出 T091 的最终实现方案。目标不是保留两份方案的并列意见，而是给出一份可以直接进入实现阶段的单一定稿。

本轮要收口的问题仍然只有两类：

1. `switch_active_planet`、`set_ray_receiver_mode` 已在 CLI、shared-client 与文档中公开，但服务端网关仍把它们当成未知命令。
2. `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab` 仍停留在“有名词、无完整玩法闭环”的半定义态。

最终方案遵循仓库的“激进式演进”原则：

- 不保留“文档说可用、代码里却只挂名”的状态。
- 能直接并入现有玩法主链的能力，优先复用现有结算链，而不是另起大框架。
- 只有在现有结构无法承载时，才新增最小抽象。

## 2. 基于当前代码的事实判断

### 2.1 两条公开命令的真实断点

当前代码已经具备以下事实：

- `server/internal/model/command.go` 已定义
  - `CmdSwitchActivePlanet`
  - `CmdSetRayReceiverMode`
- `server/internal/gamecore/core.go` 已有命令分发。
- `server/internal/gamecore/planet_commands.go` 已有实际执行逻辑。
- `shared-client`、`client-cli` 与文档都已把这两条命令作为公开入口。

真正缺口在 `server/internal/gateway/server.go` 的 `validateCommandStructure`：没有为这两类命令补结构校验分支，最终落入 `default` 并返回 `unknown command type`。

结论：命令问题不需要改 CLI、shared-client 或 gamecore 主体，只需要补齐网关校验与对应测试。

### 2.2 4 个建筑的真实现状

| 建筑 | 现状 | 可复用基础 | 当前缺口 |
| --- | --- | --- | --- |
| `jammer_tower` | `Buildable=false`，无 runtime 定义 | `enemy_force_settlement.go` 已有 `applySlowFieldEffects()`，且直接按 `BuildingTypeJammerTower` 生效 | 需要 buildability、科技入口、runtime、测试 |
| `sr_plasma_turret` | `Buildable=false`，无 runtime 定义 | `rules.go` 的 `settleTurrets()` 已能处理任意带 `CombatModule` 的防御建筑 | 需要 buildability、科技入口、runtime、defense helpers |
| `planetary_shield_generator` | `Buildable=false`，无 runtime，无护盾结算 | 敌袭伤害入口集中在 `executeEnemyAttack()`，适合定点接入吸伤 | 需要科技、runtime、新模块、新结算、测试 |
| `self_evolution_lab` | `Buildable=false`，无 runtime | `matrix_lab` 已具备 `Production + Research + Storage + Energy`；研究系统已是真实矩阵消耗 | 需要公开科技入口、runtime、矩阵配方接线、catalog 一致性 |

### 2.3 关键分歧点的代码结论

综合代码现状，两份草案中的分歧最终收敛如下：

1. `jammer_tower` 不应再额外插入 `settleTurrets()` 特判伤害分支。
   原因：现有 `applySlowFieldEffects()` 已经是真实入口，继续在炮塔结算里新增另一套逻辑只会重复。
2. `planetary_shield_generator` 的护盾值不应挂在 `WorldState` 全局字段上。
   原因：护盾天然属于建筑实例；放在 runtime 内可直接被 `inspect` 观察，也不需要额外修改存档顶层结构。
3. `jammer_tower` 与 `sr_plasma_turret` 不建议各自再拆独立公开科技。
   原因：它们分别是 `signal_tower`、`plasma_turret` 的同分支延展，直接并入现有科技更简洁，也更符合“减少树形噪音”的目标。
4. `self_evolution_lab` 不应只做成“更快的纯研究站”。
   原因：当前 `matrix_lab` 已经是研究/矩阵双用途模型；`self_evolution_lab` 如果只保留研究，会再次落入“名词更高级、玩法却更窄”的半成品状态。

## 3. 方案对比与最终取舍

### 3.1 不采用的路线

**路线 A：只修两条公开命令，4 个建筑全部降级为未实现**

- 优点是风险最小。
- 但与 T091“补齐剩余 DSP 建筑”的目标不符。
- 也浪费了当前代码里已存在的减速场、炮塔结算、矩阵研究等底座。

结论：不采用。

**路线 B：借机重构整个防御建筑体系**

- 长期结构会更统一。
- 但范围会扩散到既有炮塔、信号塔、导弹塔、敌袭、事件乃至旧测试，不适合作为 T091 的交付边界。

结论：不采用。

### 3.2 最终采用的路线

采用“定点补齐”方案：

- 命令问题只修网关校验与测试。
- `jammer_tower` 复用现有减速场结算。
- `sr_plasma_turret` 复用现有炮塔结算。
- `self_evolution_lab` 复用 `matrix_lab` 的双用途模型并补齐矩阵配方入口。
- 仅为 `planetary_shield_generator` 新增一个最小 `ShieldModule`，并把吸伤逻辑挂到现有敌袭入口上。
- 官方 `config-midgame.yaml` 作为回归夹具，预置新能力验证所需科技，但保留 `dirac_inversion` 未完成，继续承接 `photon` 模式负向验收。

## 4. 核心设计原则

### 4.1 只新增一个新抽象：`ShieldModule`

`jammer_tower`、`sr_plasma_turret`、`self_evolution_lab` 都可以复用现有模块与结算链，不需要为了“整齐”再发明泛化的 `DefenseModule`、`AuraModule` 或 buff/debuff 总线。

本轮唯一必须新增的抽象是：

- `ShieldModule`

原因是“护盾充能 + 护盾吸伤”无法自然落入现有 `CombatModule`、`ResearchModule` 或 `EnergyStorageModule`。

### 4.2 不引入弹药系统

两份草案都提到了防御建筑的中后期语义，但当前项目真实模型是“通电即工作”。T091 不应为了 4 个建筑倒逼出一套只覆盖新建筑的半成品弹药经济。

本轮约束为：

- `jammer_tower` 和 `sr_plasma_turret` 只吃电。
- 现有炮塔结算模型继续保持不变。
- 如果以后真的要做弹药系统，应统一覆盖整个防御建筑族，而不是给本轮新建筑单独开例外。

### 4.3 官方 midgame 场景是回归夹具

`config-midgame.yaml` 的职责是快速验证中后期链路，而不是模拟一局自然打到该阶段的完整存档。

因此本轮允许：

- 为 midgame 补入验证新建筑所需的已完成科技。
- 明确不补 `dirac_inversion`，保留 `set_ray_receiver_mode ... photon` 的前置错误验证。

## 5. 详细设计

### 5.1 公开命令修复

#### 5.1.1 网关结构校验

在 `server/internal/gateway/server.go` 的 `validateCommandStructure` 中新增两个分支：

- `CmdSwitchActivePlanet`
  - 必填 `payload.planet_id`
- `CmdSetRayReceiverMode`
  - 必填 `payload.building_id`
  - 必填 `payload.mode`

这里仅补“结构校验”，不把业务语义前移到网关层。以下校验继续留在 `gamecore`：

- 行星是否已发现、是否已有据点
- 建筑归属是否合法
- 模式是否为 `power|hybrid|photon`
- `photon` 是否满足 `dirac_inversion` 前置

#### 5.1.2 命令相关测试

至少补三层测试：

1. `server/internal/gateway/server_internal_test.go`
   - 两条命令不再被视为 `unknown command type`
   - 缺字段时仍返回精确的 `payload.*` 错误
2. 网关/服务端集成测试
   - `switch_active_planet` 成功后 `/state/summary.active_planet_id` 变化
   - `set_ray_receiver_mode power|hybrid` 后 `inspect` 中模式同步变化
3. `server/internal/gamecore/t090_closure_test.go` 或同层闭环测试
   - `photon` 在未解锁 `dirac_inversion` 时仍返回科技前置错误，而不是被网关截断

### 5.2 4 个建筑的最终收口方式

| 建筑 | 科技入口 | 新增模块 | 结算入口 | 玩家使用方式 |
| --- | --- | --- | --- | --- |
| `jammer_tower` | 并入现有 `signal_tower` 科技解锁 | 否 | 复用 `applySlowFieldEffects()` | `build` 后接电自动生效 |
| `sr_plasma_turret` | 并入现有 `plasma_turret` 科技解锁 | 否 | 复用 `settleTurrets()` | `build` 后接电自动攻击 |
| `planetary_shield_generator` | 新增公开科技 `planetary_shield` | 是，新增 `ShieldModule` | 新增护盾充能/吸伤结算，并接入 `executeEnemyAttack()` | `build` 后接电充能并自动吸伤 |
| `self_evolution_lab` | 新增公开科技 `self_evolution`；保留隐藏 `dark_fog_matrix` alias 路线 | 否 | 复用生产/科研结算 | 可作为高级科研站或高级矩阵站 |

### 5.3 `jammer_tower`

设计目标：让它成为一个真实的、需要供电的范围减速建筑，不重复造另一套控制系统。

#### 5.3.1 建筑与科技

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 120, Energy: 60}`
- `server/internal/model/tech.go`
  - 不新增独立科技节点
  - 直接把 `jammer_tower` 追加到现有 `signal_tower` 科技的 `Unlocks`

理由：

- 两者同属战术支援分支。
- 单独再拆一个公开科技只会增加树复杂度，不会增加真实玩法层次。

#### 5.3.2 runtime

在 `server/internal/model/building_runtime.go` 新增 runtime 定义：

- `ConnectionPoints: power`
- `EnergyConsume = 6`
- `CombatModule{Attack: 0, Range: 8}`
- `EnergyModule{ConsumePerTick: 6}`

这里保留 `Combat.Range`，不是为了让它走炮塔伤害，而是为了让减速结算能够读取统一的范围配置。

#### 5.3.3 结算

继续复用 `server/internal/gamecore/enemy_force_settlement.go` 的 `applySlowFieldEffects()`：

- 仅对 `running` 的 `jammer_tower` 生效
- 范围读取 `runtime.functions.combat.range`
- 维持当前简化减速值 `0.5`
- 断电或损坏时失效

不做以下事情：

- 不在 `settleTurrets()` 中再加一个 `jammer_tower` 特判分支
- 不引入新的 `AuraModule`
- 不新增独立 debuff 总线

### 5.4 `sr_plasma_turret`

设计目标：作为 `plasma_turret` 的高阶延展，直接并入现有炮塔攻击链。

#### 5.4.1 建筑与科技

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 300, Energy: 150}`
- `server/internal/model/tech.go`
  - 不新增独立公开科技
  - 直接把 `sr_plasma_turret` 追加到现有 `plasma_turret` 科技的 `Unlocks`

理由：

- 这是同一火力线的高阶建筑，而不是新的玩法分支。
- 直接挂到现有科技上，玩家认知更简单，实现面也更小。

#### 5.4.2 runtime 与 defense helpers

新增 runtime：

- `ConnectionPoints: power`
- `EnergyConsume = 20`
- `CombatModule{Attack: 60, Range: 12}`
- `EnergyModule{ConsumePerTick: 20}`

同时修改 `server/internal/model/defense.go`：

- `IsDefenseBuilding()` 增加 `BuildingTypeSRPlasmaTurret`
- `GetDefenseType()` 增加 `BuildingTypeSRPlasmaTurret -> DefenseTypeTurret`

#### 5.4.3 结算

直接复用 `server/internal/gamecore/rules.go` 的 `settleTurrets()`：

- 通电即自动攻击
- 断电不攻击
- 不引入弹药消耗
- 不新增专用战斗循环

### 5.5 `planetary_shield_generator`

设计目标：提供一个可观察、可测试、改动面最小的行星护盾能力。

#### 5.5.1 建筑与科技

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 500, Energy: 250}`
- `server/internal/model/tech.go`
  - 新增公开科技 `planetary_shield`
  - 推荐前置：`plasma_turret`、`interstellar_power`、`energy_shield`
  - 解锁：`planetary_shield_generator`

这条科技设计成独立节点，而不是塞进现有科技，原因是它确实引入了新的防护机制，已经不是单纯的同型升级。

#### 5.5.2 新增 `ShieldModule`

在 `server/internal/model/building_runtime.go` 新增：

```go
type ShieldModule struct {
    Capacity      int `json:"capacity" yaml:"capacity"`
    ChargePerTick int `json:"charge_per_tick" yaml:"charge_per_tick"`
    CurrentCharge int `json:"current_charge" yaml:"current_charge"`
}
```

并在 `BuildingFunctionModules` 中增加：

```go
Shield *ShieldModule `json:"shield,omitempty" yaml:"shield,omitempty"`
```

同时补齐：

- runtime 校验逻辑
- `clone()` 深拷贝

`planetary_shield_generator` 的 runtime 定义为：

- `ConnectionPoints: power`
- `EnergyConsume = 50`
- `ShieldModule{Capacity: 1000, ChargePerTick: 5, CurrentCharge: 0}`
- `EnergyModule{ConsumePerTick: 50}`

#### 5.5.3 结算与可观测性

新增 `server/internal/gamecore/planetary_shield_settlement.go`，提供两个函数：

1. `settlePlanetaryShields(ws)`
   - 只处理 `running` 的护盾发生器
   - 每 tick 为该建筑自己的 `CurrentCharge` 充能，直到达到 `Capacity`
2. `absorbPlanetaryShieldDamage(ws, ownerID, damage)`
   - 收集该玩家所有 `running` 的护盾发生器
   - 按稳定顺序扣减 `CurrentCharge`
   - 返回 `absorbed` 与 `remaining`

在 `executeEnemyAttack()` 中，真正扣建筑 HP 前先调用 `absorbPlanetaryShieldDamage()`。

事件层建议补充：

- 在 `EvtDamageApplied` payload 中增加
  - `shield_absorbed`
  - `shield_remaining`

最终不采用“`WorldState.PlanetShield` 全局池”方案，原因是：

- 多个护盾发生器的状态不应被压扁成一个总值
- `inspect building` 需要能直接看到单个建筑的护盾电量
- 放在 building runtime 内可自然进入现有序列化与 inspect 结果

### 5.6 `self_evolution_lab`

设计目标：把它补成一个真实可玩的高级矩阵/科研建筑，而不是继续挂在隐藏科技别名下。

#### 5.6.1 建筑、科技与隐藏链一致性

- `server/internal/model/building_defs.go`
  - `Buildable = true`
  - `BuildCost = {Minerals: 400, Energy: 200}`
- `server/internal/model/tech.go`
  - 新增公开科技 `self_evolution`
  - 推荐前置：`gravity_matrix`、`quantum_chip`、`research_speed`
  - 解锁：`self_evolution_lab`
  - 保留现有隐藏科技 `dark_fog_matrix -> self_evolution_station -> self_evolution_lab` 的 alias 路线
- `server/internal/model/item.go`
  - 补入 `dark_fog_matrix` 物品定义，修复隐藏科技当前引用未知 item 的不一致问题
  - 本轮不补黑雾矩阵的生产链、掉落链或独占配方

#### 5.6.2 runtime

在 `server/internal/model/building_runtime.go` 中新增 runtime，直接复用 `matrix_lab` 的双用途模型并强化参数：

- `ConnectionPoints: power`
- `IOPorts: in-0 / out-0`
- `EnergyConsume = 16`
- `StorageModule{Capacity: 72, Slots: 6, Buffer: 24, InputPriority: 2, OutputPriority: 2}`
- `ProductionModule{Throughput: 3, RecipeSlots: 1}`
- `ResearchModule{ResearchPerTick: 3}`
- `EnergyModule{ConsumePerTick: 16}`

这样它同时具备两种玩家用法：

1. `recipe_id` 为空时，作为高级研究站
2. 指定矩阵配方时，作为高级矩阵产线

#### 5.6.3 配方接线

在 `server/internal/model/recipe.go` 中，把 `BuildingTypeSelfEvolutionLab` 加入以下矩阵配方的 `BuildingTypes`：

- `electromagnetic_matrix`
- `energy_matrix`
- `structure_matrix`
- `information_matrix`
- `gravity_matrix`
- `universe_matrix`

这样可以确保它不是“只能研究、不能参与矩阵工业链”的功能阉割版。

### 5.7 官方 midgame 场景调整

为了让 T091 的验收可以在官方回归夹具内直接完成，建议更新 `server/config-midgame.yaml`，为双方玩家追加以下 `completed_techs`：

- `signal_tower`
- `plasma_turret`
- `gravity_matrix`
- `planetary_shield`
- `self_evolution`

明确不追加：

- `dirac_inversion`

原因：

- `jammer_tower` 与 `sr_plasma_turret` 需要其上游科技已经完成，才能直接验证 buildability。
- `self_evolution` 以前置 `gravity_matrix` 设计更自洽，因此一并预置 `gravity_matrix`。
- 保留 `dirac_inversion` 未完成，才能继续验证 `photon` 模式的负向科技门禁。

## 6. 涉及文件

| 文件 | 改动内容 |
| --- | --- |
| `server/internal/gateway/server.go` | 补 `CmdSwitchActivePlanet`、`CmdSetRayReceiverMode` 的结构校验 |
| `server/internal/gateway/server_internal_test.go` | 补命令校验正向/反向测试 |
| 网关或服务端集成测试文件 | 验证 `summary.active_planet_id` 与 `ray_receiver.mode` 的公开可见变化 |
| `server/internal/model/building_defs.go` | 4 个建筑补 `Buildable` 与 `BuildCost` |
| `server/internal/model/building_runtime.go` | 新增 4 个建筑 runtime；新增 `ShieldModule`；补 `clone()` 与校验 |
| `server/internal/model/defense.go` | `sr_plasma_turret` 接入 defense helpers |
| `server/internal/model/tech.go` | `signal_tower`/`plasma_turret` 追加建筑解锁；新增 `planetary_shield`、`self_evolution` |
| `server/internal/model/item.go` | 补 `dark_fog_matrix` 运行时物品定义 |
| `server/internal/model/recipe.go` | 矩阵配方支持 `self_evolution_lab` |
| `server/internal/gamecore/enemy_force_settlement.go` | `jammer_tower` 读取 runtime 范围；敌袭前接入护盾吸伤 |
| `server/internal/gamecore/planetary_shield_settlement.go` | 新增护盾充能与吸伤逻辑 |
| `server/internal/gamecore/rules.go` | `sr_plasma_turret` 通过现有 `settleTurrets()` 自动进入战斗链 |
| `server/internal/gamecore/t090_closure_test.go` 或同层闭环测试 | 承接公开命令与中后期建筑闭环验收 |
| `server/config-midgame.yaml` | 追加 midgame 预置科技 |
| `docs/player/玩法指南.md` | 同步 4 个建筑与 2 条命令的真实可玩状态 |
| `docs/player/上手与验证.md` | 增加 midgame 下的验证步骤 |
| `docs/dev/客户端CLI.md` | 确认两条命令为真实可用；若补示例，建筑仍走通用 `build` |
| `docs/dev/服务端API.md` | 更新能力说明、示例与事件字段变化 |
| `docs/archive/analysis/server现状详尽分析报告.md` | 同步能力盘点结论，避免继续把 4 个建筑记为半覆盖 |

## 7. 测试与验收映射

### 7.1 自动化测试最小覆盖集

1. 网关不再把两条命令识别为未知命令。
2. `switch_active_planet` 成功后 `/state/summary.active_planet_id` 变化。
3. `set_ray_receiver_mode power|hybrid` 成功后 `inspect` 能看到模式变化。
4. `set_ray_receiver_mode photon` 在未解锁 `dirac_inversion` 时仍失败。
5. `/catalog` 中 4 个建筑会在拥有对应科技后显示为可建造。
6. `jammer_tower` 通电时减速，断电时失效。
7. `sr_plasma_turret` 通电时会对敌对势力造成伤害。
8. `planetary_shield_generator` 会充能，并在敌袭时优先吸收伤害。
9. `self_evolution_lab` 同时具备更高科研吞吐与矩阵配方生产能力。
10. `dark_fog_matrix` 出现在运行时 item catalog 中，隐藏科技不再引用未知物品。

### 7.2 与 T091 验收标准对照

| T091 验收项 | 本方案对应点 |
| --- | --- |
| `switch_active_planet` 返回 `OK` 且 summary 变化 | §5.1 |
| `set_ray_receiver_mode` 返回 `OK` 且 inspect 同步变化 | §5.1 |
| `photon` 模式保留科技前置错误 | §5.1、§5.7 |
| 4 个建筑进入科技树并能建造/使用 | §5.2-§5.6 |
| 官方 midgame 场景可直接回归 | §5.7 |
| 本轮已确认可用链路不回退 | 通过回归测试统一覆盖 |

## 8. 风险、边界与明确不做的事

### 8.1 不顺手重构旧防御体系

当前旧防御建筑仍有历史包袱，但 T091 只需保证本轮补齐的 4 个建筑不再继续保持半定义态，不应把整套旧体系一起拖入。

### 8.2 `dark_fog_matrix` 只做一致性修正

本轮只修：

- 隐藏科技引用的物品目录一致性
- `self_evolution_lab` 的公开入口

本轮不做：

- 黑雾矩阵生产链
- 黑雾掉落链
- 自演化研究站专属黑雾配方

### 8.3 行星护盾只覆盖当前真实存在的敌袭入口

护盾本轮只拦截现有 `enemy_force -> building` 伤害路径。以后若新增轨道轰炸、舰队打击等新伤害源，应复用同一护盾吸伤 helper，而不是重新造第二套护盾系统。

## 9. 最终建议

T091 不应再停留在“命令修一下，建筑继续挂名”的保守收口。当前代码已经给出了足够多的可复用底座，最合理的定稿是：

- 两条公开命令直接修到真实可用。
- `jammer_tower`、`sr_plasma_turret` 直接并入现有科技与结算主线。
- `planetary_shield_generator` 通过最小 `ShieldModule` 实现真正可观测的护盾玩法。
- `self_evolution_lab` 补成高级矩阵/科研双用途建筑，而不是研究阉割版。
- 通过官方 midgame 场景承接稳定回归。

这份方案在改动面、玩法闭环与代码纯净度之间取得了最好平衡，可以作为 T091 的最终实现基线。
