# T091 戴森中后期公开命令断档与剩余 DSP 建筑补齐

## 问题背景

- 2026-04-03 对当前工作区做了 3 套隔离实测：
  - 默认开局：`config-dev` 派生配置，端口 `18111`
  - 官方 midgame：`config-midgame.yaml + map-midgame.yaml`，端口 `18112`
  - 科研专用验证局：临时 `config-research.yaml`，端口 `18113`
- 本任务只关心“当前项目宣称对标《戴森球计划》的建筑、科技树与中后期玩法”是否真正可玩。
- 以下明确设计差异不计入缺陷范围：
  - 上帝视角 + 执行体，而不是原版机甲直操
  - 多人 / 阵营对抗服务端
  - API 驱动、无渲染
  - 行星为 2D 平面网格

## 本轮已确认可用的部分

- 研究系统已经不是旧版“抽象研究点自动完成”：
  - 默认开局直接执行 `start_research electromagnetism`，返回 `at least one running research lab is required`
  - 在 `18113` 临时科研局中，建好 `matrix_lab` 后执行 `start_research basic_logistics_system`，返回 `missing electromagnetic_matrix in research labs`
- 官方 midgame 的戴森中后期主链路已经可以真实走通：
  - `orbital_collector` 在补齐电网后可进入 `running`
  - `inspect planet-1-2 building b-37` 显示其本地库存已累计：
    - `hydrogen = 1000`
    - `deuterium = 1000`
  - `transfer b-47 solar_sail 3` + `launch_solar_sail b-47 --count 1` 返回 `OK`
  - `transfer b-36 small_carrier_rocket 1` + `launch_rocket b-36 sys-1 --layer 0 --count 1` 返回 `OK`
  - SSE 已出现 `rocket_launched`
- 一批 4 月 3 日曾经“不可建造”的建筑已经进入真实科技树，不应再按旧缺陷重复记录：
  - `energy_exchanger` 已可建造，实测 `build 1 5 energy_exchanger` 成功
  - `/catalog` 中已能看到这些建筑对应的公开科技解锁：
    - `advanced_mining_machine -> photon_mining`
    - `pile_sorter -> integrated_logistics`
    - `recomposing_assembler -> annihilation`
    - `energy_exchanger -> interstellar_power`
- `accumulator_full` 本轮不计入缺陷范围：
  - 设计文档已把它定义为“满电蓄电器物流流转态”，不是正常玩家放置建筑

## 当前仍未实现 / 新发现的问题

### 问题 1：`switch_active_planet` 与 `set_ray_receiver_mode` 文档和 CLI 已公开，但实际玩家入口不可用

#### 复现

在 `18112` 官方 midgame 局执行：

- `switch_active_planet planet-1-1`
- `set_ray_receiver_mode b-51 power`

#### 实际现象

- 两条命令都被服务端直接拒绝：
  - `VALIDATION_FAILED: unknown command type: switch_active_planet`
  - `VALIDATION_FAILED: unknown command type: set_ray_receiver_mode`
- 代码层核对结果：
  - `shared-client/src/api.ts` 已发送正确命令类型：
    - `switch_active_planet`
    - `set_ray_receiver_mode`
  - `client-cli` 已有对应命令与帮助文本
  - `server/internal/model/command.go` 已定义：
    - `CmdSwitchActivePlanet`
    - `CmdSetRayReceiverMode`
  - `server/internal/gamecore/core.go` 已有执行分发：
    - `case model.CmdSwitchActivePlanet`
    - `case model.CmdSetRayReceiverMode`
  - 但 `server/internal/gateway/server.go` 的 `validateCommandStructure` 没有为这两类命令补校验分支，最终落入默认分支并报 `unknown command type`

#### 影响

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`

以上文档都把这两条命令写成“当前可用”，但真实试玩中玩家根本无法使用。

- `switch_active_planet` 不可用，意味着官方 midgame 虽然已经同时加载 `planet-1-1` 与 `planet-1-2`，但玩家仍不能通过公开命令切换经营焦点，多星球玩法没有真正开放给玩家
- `set_ray_receiver_mode` 不可用，意味着 `ray_receiver` 仍只能停留在默认模式，玩家无法按文档切换 `power / hybrid / photon`

### 问题 2：4 个 DSP 建筑仍停留在“只有名词定义，没有真实玩法接线”状态

#### 当前仍未实现的建筑

- `jammer_tower`
- `sr_plasma_turret`
- `planetary_shield_generator`
- `self_evolution_lab`

#### 复现

在 `18112` 官方 midgame 局执行：

- `build 1 4 jammer_tower`
- `build 2 3 sr_plasma_turret`
- `build 3 5 planetary_shield_generator`
- `build 2 5 self_evolution_lab`

#### 实际现象

- 返回：
  - `VALIDATION_FAILED: building type not buildable: jammer_tower`
  - `VALIDATION_FAILED: building type not buildable: sr_plasma_turret`
  - `VALIDATION_FAILED: building type not buildable: planetary_shield_generator`
  - `VALIDATION_FAILED: building type not buildable: self_evolution_lab`
- `/catalog` 当前仍显示它们 `buildable = false`
- 科技树核对结果：
  - `jammer_tower` 没有公开科技解锁
  - `sr_plasma_turret` 没有公开科技解锁
  - `planetary_shield_generator` 没有公开科技解锁
  - `self_evolution_lab` 只挂在隐藏科技 `dark_fog_matrix` 下，但建筑本体仍然 `buildable = false`
- 代码搜索结果：
  - 这几个建筑在 `server/internal/model` / `server/internal/gamecore` 中基本只剩 `building_defs.go` 里的类型定义
  - 没有对应的运行时模块接线、主循环结算或玩家可达玩法闭环

#### 影响

- 当前 DSP 中后期 / 黑雾相关建筑集合仍不完整
- 这些建筑继续停留在“文档里提过、代码里有名词、玩家却碰不到”的尴尬状态
- 如果项目仍把它们算作“已经覆盖的 DSP 建筑范围”，会持续误导后续玩法验证与文档结论

## 改动要求

### 1. 补齐网关命令校验，恢复两条公开命令的真实可用性

- 在 `server/internal/gateway/server.go` 的 `validateCommandStructure` 中补上：
  - `CmdSwitchActivePlanet`
  - `CmdSetRayReceiverMode`
- 需要补自动化测试，至少覆盖：
  - 这两条命令不再被网关按 `unknown command type` 拒绝
  - `switch_active_planet` 成功后 `summary.active_planet_id` 会变化
  - `set_ray_receiver_mode` 成功后 `ray_receiver` 运行时模式会变化
  - `photon` 模式仍保留正确的科技前置校验，而不是一律放行

### 2. 对剩余 4 个 DSP 建筑做明确收口，不能继续保持“半定义态”

- 目标建筑：
  - `jammer_tower`
  - `sr_plasma_turret`
  - `planetary_shield_generator`
  - `self_evolution_lab`
- 每个建筑至少要明确到以下层级：
  - 对应科技或隐藏内容入口
  - 是否允许玩家建造
  - 运行时模块
  - 是否进入主循环结算
  - 玩家实际能通过什么命令/流程使用
- 若决定真正实现：
  - 必须补齐科技解锁、`/catalog`、buildability、runtime、结算逻辑和玩家入口
- 若短期不实现：
  - 必须把所有玩家侧文档和能力盘点明确改成“未实现”，不能继续使用“有定义但不算主线可玩”这种模糊表述充当已覆盖

## 需要同步更新的文档

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`
- 若能力盘点结论变更，也应同步：
  - `docs/archive/analysis/server现状详尽分析报告.md`

## 验收标准

1. 使用仓库内官方 `config-midgame.yaml + map-midgame.yaml` 启动新局，只通过公开命令推进。
2. `switch_active_planet planet-1-1` 与切回 `planet-1-2` 都返回 `OK`，且 `summary` 中 `active_planet_id` 真实变化。
3. `set_ray_receiver_mode <receiver_id> power` 与 `hybrid` 返回 `OK`，`inspect` 中运行时模式同步变化。
4. `set_ray_receiver_mode <receiver_id> photon` 在未解锁科技时返回明确的科技前置错误，而不是 `unknown command type`。
5. 对 `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab`：
   - 要么已经进入科技树并能按公开玩法建造/使用
   - 要么所有玩家侧文档明确标记为未实现，且不再被统计为“已覆盖的 DSP 建筑”
6. 本轮已确认可用的链路不能回退：
   - `orbital_collector` 仍可运行采集
   - `launch_solar_sail` 仍返回 `OK`
   - `launch_rocket` 仍返回 `OK`
   - 研究仍要求研究站与真实矩阵库存
