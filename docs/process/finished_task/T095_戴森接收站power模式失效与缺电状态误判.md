# T095 戴森接收站 `power` 模式失效与缺电状态误判（已完成）

## 完成结论（2026-04-04）

- `ray_receiver power` 模式在官方 midgame 真实回放里已能同步抬高：
  - `summary.players[].resources.energy`
  - `stats.energy_stats.generation`
  - `/world/planets/{planet_id}/networks.power_networks[].supply`
- `power` 模式现在只禁止新的 `critical_photon` 增量；切换前已经存在的历史库存/缓冲不会被自动清空
- 缺电口径已经在 `inspect / scene / building_state_changed / networks` 间收口：
  - 已接入电网但当前 tick 因短缺拿不到电时，统一显示 `under_power`
  - 同状态下的病因变化也会继续发 `building_state_changed`，并附带 `prev_reason`
- `power_coverage` 已识别 `ws.PowerInputs` 中的动态电源，例如 `ray_receiver` 与储能放电
- 主要回归测试：
  - `TestPowerShortageRefreshesNoPowerReasonWhenCoverageBecomesUnderPower`
  - `TestPowerCoverageTreatsDynamicPowerInputsAsProvider`
  - `TestSettleRayReceiversRespectModesAndKeepExistingPhotonStock`
  - `TestT095OfficialMidgameRayReceiverPowerModeStopsPhotonGrowthAndBackfeedsGrid`

## 试玩环境

- 日期：2026-04-04
- 默认新局：
  - 服务端配置：基于 `server/config-dev.yaml` 派生
  - 端口：`18111`
  - 数据目录：`/tmp/sw-playtest-default.R25kEn/data`
  - 地图：`server/map.yaml`
- 官方 midgame：
  - 服务端配置：基于 `server/config-midgame.yaml` 派生
  - 端口：`18112`
  - 数据目录：`/tmp/sw-playtest-midgame.Qphsbf/data`
  - 地图：`server/map-midgame.yaml`
- 玩家：`p1 / key_player_1`
- 客户端入口：`client-cli`

## 本轮已确认可用的部分

- 默认新局的科研门禁已经是真实矩阵驱动：
  - `build 3 2 matrix_lab`
  - `start_research electromagnetism`
  - 返回 `VALIDATION_FAILED: missing electromagnetic_matrix in research labs`
  - `transfer b-28 electromagnetic_matrix 10`
  - 再执行 `start_research electromagnetism`
  - `research_completed` 正常解锁 `wind_turbine`、`tesla_tower`、`mining_machine`
- 官方 midgame 下，以下 DSP 建筑已经能实际建造成功：
  - `orbital_collector`
  - `vertical_launching_silo`
  - `em_rail_ejector`
  - `ray_receiver`
  - `jammer_tower`
  - `sr_plasma_turret`
  - `planetary_shield_generator`
  - `self_evolution_lab`
  - `recomposing_assembler`
  - `pile_sorter`
  - `advanced_mining_machine`
  - `energy_exchanger`
- 官方 midgame 下，以下戴森玩法入口已经实际走通：
  - `build_dyson_node`
  - `build_dyson_frame`
  - `build_dyson_shell`
  - `transfer`
  - `launch_solar_sail`
  - `launch_rocket`
  - `set_ray_receiver_mode`
- `orbital_collector` 与 `advanced_mining_machine` 在供电恢复后都能进入 `running` 并累积库存：
  - `b-52 (orbital_collector)` 最终库存达到 `hydrogen=1000`、`deuterium=1000`
  - `b-93 (advanced_mining_machine)` 最终库存出现 `fire_ice`

这些能力不要再按“完全未实现”重复记录。

## 当前问题 1：`ray_receiver` 处于 `power` 模式时，仍不把戴森能量转成电网收益，且还在产出 `critical_photon`

### 复现

1. 启动官方 midgame 场景，先补基础供电并建出：
   - `vertical_launching_silo (b-53)`
   - `em_rail_ejector (b-55)`
   - `ray_receiver (b-56)`
2. 执行：
   - `transfer b-55 solar_sail 2`
   - `transfer b-53 small_carrier_rocket 1`
   - `build_dyson_node sys-1 0 10 20 --orbit-radius 1.2`
   - `build_dyson_node sys-1 0 -10 -20 --orbit-radius 1.2`
   - `build_dyson_frame sys-1 0 p1-node-l0-latp1000-lonp2000 p1-node-l0-latm1000-lonm2000`
   - `build_dyson_shell sys-1 0 -15 15 0.4`
   - `set_ray_receiver_mode b-56 power`
   - `launch_solar_sail b-55 --count 1`
   - `launch_rocket b-53 sys-1 --layer 0 --count 1`
3. 等待数秒后查询：
   - `summary`
   - `stats`
   - `inspect planet-1-2 building b-56`
   - `GET /events/snapshot?event_types=rocket_launched,entity_updated&limit=200`
   - `GET /world/planets/planet-1-2/networks`

### 实际现象

- `rocket_launched` 事件已经确认火箭进入戴森层，返回的 `layer_energy_output = 612`
- `entity_updated` 事件持续出现：
  - `entity_type = dyson_sphere`
  - `total_energy = 612`
- `inspect planet-1-2 building b-56` 显示：
  - `runtime.functions.ray_receiver.mode = power`
  - `runtime.state = running`
  - `storage.output_buffer.critical_photon = 2`
- 但玩家可见供电收益没有同步出现：
  - `summary.players.p1.resources.energy = 9857`
  - `stats.energy_stats.generation = 148`
  - `GET /world/planets/planet-1-2/networks` 中 `power_networks[0].supply = 148`
- 也就是说，戴森能量已经存在，但 `power` 模式既没有抬升电网供给，也没有阻止 `critical_photon` 继续产出。

### 影响

- “太阳帆 / 戴森结构 -> 射线接收站 `power` 模式 -> 电网收益” 这条 DSP 核心终局闭环仍然没有真正落地。
- 当前玩家会被误导为：
  - 接收站已经在 `power` 模式工作
  - 但能源统计和局势读数没有任何变化
- `power` 与 `photon` 两种模式的玩家语义被混淆，无法可靠验证终局能源玩法。

### 改动要求

- 修正 `ray_receiver` 的模式结算：
  - `power` 模式只能回灌电网，不应继续产出 `critical_photon`
  - `photon` / `hybrid` 模式的物品产出也要与模式定义保持一致
- 至少统一以下观察面：
  - `inspect ... building b-56`
  - `state/stats.energy_stats.generation`
  - `world/planets/{planet_id}/networks.power_networks[].supply`
- 如果 `summary.players[].resources.energy` 被设计成玩家可见总能源，也必须与接收站收益同步；如果不是，就需要同步修正文档，避免继续把它当作接收站收益判断面。
- 增加端到端验证，覆盖：
  - 已有 `dyson_sphere total_energy > 0`
  - `ray_receiver mode = power`
  - 若等待若干 tick，`generation` / `supply` 明显高于纯风机供电时的值
  - `power` 模式下 `critical_photon` 不再增长

## 当前问题 2：缺电时部分 DSP 建筑在 `inspect` 中误报 `power_out_of_range`，实际是已接入电网但因优先级分配拿不到电

### 复现

1. 在同一套官方 midgame 局中，补出一张共享电网，并建造：
   - `orbital_collector (b-52)`
   - `self_evolution_lab (b-60 / b-61)`
   - `recomposing_assembler (b-62)`
   - `advanced_mining_machine (b-93)`
   - 同时保留高耗电的 `vertical_launching_silo`、`em_rail_ejector`、`planetary_shield_generator`、`sr_plasma_turret`
2. 在供电总量不足时查询：
   - `inspect planet-1-2 building b-52`
   - `inspect planet-1-2 building b-60`
   - `inspect planet-1-2 building b-62`
   - `inspect planet-1-2 building b-93`
   - `GET /world/planets/planet-1-2/networks`
3. 随后执行：
   - `demolish b-59`
   - `demolish b-57`
4. 再观察 SSE 中的 `building_state_changed` 与对应 `inspect`

### 实际现象

- 在缺电阶段：
  - `inspect b-52` 返回 `state = no_power`、`state_reason = power_out_of_range`
  - `inspect b-60` 返回 `state = no_power`、`state_reason = power_out_of_range`
  - `inspect b-62` 返回 `state = no_power`、`state_reason = power_out_of_range`
  - 只有 `b-93` 返回的是更合理的 `state_reason = under_power`
- 但同一时刻 `GET /world/planets/planet-1-2/networks` 已明确显示：
  - 所有这些建筑都在同一个 `power_networks[0]`
  - `power_coverage` 中它们的 `connected = true`
  - `b-52`、`b-60`、`b-62`、`b-93` 都已经拿到了 `network_id = b-1`
  - 整个网络是 `supply = 148`、`demand = 210`、`shortage = true`
- 当拆掉 `b-59` 与 `b-57` 释放 70 点负载后，同一批建筑立刻收到：
  - `building_state_changed ... reason = power_restored`
  - `b-52`、`b-60`、`b-62`、`b-93` 全部转为 `running`
- 这证明此前的问题并不是“超出电网覆盖”，而是“已经连上电网，但在缺电分配中拿不到电”。

### 影响

- 玩家和测试者会被错误引导去继续补塔、挪位置，误判成铺线问题。
- `orbital_collector`、`self_evolution_lab`、`recomposing_assembler` 这类建筑在缺电时会呈现错误病因，显著增加回归排查成本。
- `inspect` / `scene` / `networks` 三个观察面的语义不一致，影响自动化验证和 AI 驱动试玩。

### 改动要求

- 把“已接入电网但因供电不足未分配到电”统一归类为 `under_power` 或等价语义，不要继续报 `power_out_of_range`
- `inspect`、`scene`、`building_state_changed` 事件里的状态原因要与 `/world/planets/{planet_id}/networks` 的覆盖/分配结果保持一致
- 增加回归测试，覆盖：
  - 建筑 `connected = true`
  - 网络 `shortage = true`
  - 低优先级建筑未获分配时，状态原因应为“缺电”，而不是“超出覆盖”

## 验收标准

1. 官方 midgame 场景下，戴森结构存在能量输出时，`ray_receiver power` 模式必须能真实提高电网收益，并停止产出 `critical_photon`
2. 缺电场景下，`inspect` 与事件流对建筑状态原因的描述必须和 `networks` 的覆盖/分配结果一致
3. `orbital_collector`、`advanced_mining_machine`、`recomposing_assembler`、`self_evolution_lab` 不应再被误报为“未实现”或“未接电网”；当前残留问题应明确收敛为上述两类 Bug
