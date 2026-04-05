# T096 官方 midgame 下戴森接收站 `power` 模式实战不回灌最终电网

## 问题背景

- 2026-04-04 对当前工作区做了两套隔离实测：
  - 默认新局：`/tmp/sw-playtest-default.iQi4Eu/config.yaml`，端口 `18121`
  - 官方 midgame：`/tmp/sw-playtest-midgame.CGHJyP/config.yaml + server/map-midgame.yaml`，端口 `18122`
- 本轮只检查“当前项目宣称已覆盖的《戴森球计划》相关建筑、科技树与玩法”是否真的能玩。
- 以下明确设计差异不计入缺陷范围：
  - 上帝视角 + 执行体，而不是原版机甲直操
  - 多人 / 阵营对抗服务端
  - API 驱动、无原版渲染
  - 行星为 2D 平面网格

## 本轮已确认可用的部分

- 默认新局科研门禁正常：
  - `matrix_lab` 必须先处于 `running`
  - `start_research electromagnetism` 会在未装矩阵时返回 `missing electromagnetic_matrix in research labs`
  - `transfer b-15 electromagnetic_matrix 10` 后可正常完成 `electromagnetism`
- 官方 midgame 中，下列 DSP 建筑已经不是“只有定义，没有玩法接线”的状态：
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
- 官方 midgame 中，下列戴森玩法入口已经实际走通：
  - `switch_active_planet`
  - `build_dyson_node`
  - `transfer`
  - `launch_solar_sail`
  - `launch_rocket`
  - `set_ray_receiver_mode`
- 实测确认可运行或可恢复运行的链路：
  - `orbital_collector` 在供电恢复后库存增长到 `hydrogen = 1000`、`deuterium = 689`
  - `advanced_mining_machine` 在供电恢复后库存出现 `fire_ice = 96`
  - `planetary_shield_generator` 可充能到 `current_charge = 1000`
  - `self_evolution_lab` 空配方与 `--recipe electromagnetic_matrix` 两种形态都能进入 `running`

以上能力不要再按“未实现建筑 / 未实现科技树 / 未实现主线玩法”重复立项。

## 当前问题：`ray_receiver` 切到 `power` 后，实战里不会把戴森能量稳定写回最终电网与最终资源态

### 复现

1. 启动官方 midgame：
   - 服务端：`18122`
   - 玩家：`p1 / key_player_1`
2. 先补出一套可用电网，并在 `planet-1-2` 上建出：
   - `build 4 3 orbital_collector`
   - `build 5 4 vertical_launching_silo`
   - `build 4 5 ray_receiver`
   - `build 5 5 em_rail_ejector`
   - 以及若干用于拉通电网的 `tesla_tower / wind_turbine`
3. 执行戴森链路：
   - `build_dyson_node sys-1 0 10 20 --orbit-radius 1.2`
   - `transfer b-64 solar_sail 3`
   - `transfer b-59 small_carrier_rocket 1`
   - `launch_solar_sail b-64 --count 1`
   - `launch_rocket b-59 sys-1 --layer 0 --count 1`
4. 再执行：
   - `set_ray_receiver_mode b-63 power`
5. 为了排除“只是当前网络缺电导致看不出来”，拆掉已经验证完的高耗电建筑：
   - `demolish b-65`
   - `demolish b-64`
6. 查询：
   - `summary`
   - `stats`
   - `inspect planet-1-2 building b-63`
   - `GET /world/planets/planet-1-2/networks`
   - `GET /events/snapshot?event_types=resource_changed,command_result,rocket_launched&...`

### 实际现象

- 戴森相关前置已经成功触发：
  - `build_dyson_node` 返回 `OK`
  - `launch_solar_sail` 返回 `OK`
  - `rocket_launched` 事件存在，且 `layer_energy_output = 102`
  - `set_ray_receiver_mode b-63 power` 返回 `OK`
- `inspect planet-1-2 building b-63` 明确显示：
  - `runtime.functions.ray_receiver.mode = power`
  - `runtime.state = running`
  - 历史 `critical_photon` 库存/缓冲仍保留：
    - `inventory.critical_photon = 100`
    - `input_buffer.critical_photon = 10`
    - `output_buffer.critical_photon = 10`
- 但最终可见能源结果没有抬升：
  - `summary.players.p1.resources.energy = 9875`
  - `stats.energy_stats.generation = 148`
  - `GET /world/planets/planet-1-2/networks`：
    - 主网络 `supply = 137`
    - 孤立风机网络 `supply = 11`
    - 主网络 `demand = 130`
    - 主网络 `shortage = false`
- 也就是说，在主网络已经不缺电的前提下，`ray_receiver power` 仍没有把任何新增供给稳定写进最终 `generation / supply / energy`。
- 同时，`events/snapshot` 中会出现同一 tick 内多次 `resource_changed`，`energy` 在 `10000 -> 99xx -> 98xx` 之间来回跳变；但最终 `summary` 仍回到 `9875`。

### 影响

- “太阳帆 / 戴森结构 -> 射线接收站 `power` 模式 -> 电网收益”这条 DSP 终局核心闭环，在当前官方 midgame 实战里仍然不成立。
- 玩家会看到：
  - 命令成功
  - 接收站模式正确
  - 戴森节点与火箭事件正确
  - 但最终局势统计没有任何稳定增益
- 现有文档把这条能力写成“已闭环”，会误导后续试玩、回归和 AI 驱动验证。

### 研判

- 依据事件流，`ray_receiver` 很可能在某个结算阶段短暂写入了 `player.Resources.Energy`，但该结果又被后续结算覆盖或回写掉。
- 这是根据 `resource_changed` 在同一 tick 内反复波动，而最终 `summary/stats/networks` 不变作出的推断；需要以实际代码路径复核。

### 改动要求

- 彻查 `ray_receiver power` 的真实结算链路，至少覆盖：
  - `settleRayReceivers`
  - `player.Resources.Energy` 的最终写回顺序
  - `ws.PowerInputs` 到 `power_networks[].supply` 的聚合时序
  - `summary / stats / networks` 最终读取的是不是同一份 authoritative 状态
- 保证以下 4 个观察面在同一 tick 上一致：
  - `inspect ... building <ray_receiver_id>`
  - `summary.players[pid].resources.energy`
  - `stats.energy_stats.generation`
  - `/world/planets/{planet_id}/networks.power_networks[].supply`
- `power` 模式的最终语义必须是：
  - 保留旧的 `critical_photon` 历史库存
  - 不再新增新的 `critical_photon`
  - 把可用戴森能量稳定回灌到最终电网与最终资源态
- 补端到端回归测试，必须使用官方 midgame 风格的真实链路而不是只测内存构造态：
  - 建 `ray_receiver`
  - 发太阳帆
  - 发火箭
  - 切 `power`
  - 等待若干 tick
  - 断言最终 `generation / supply / energy` 高于纯风机基线，并且在最终查询结果中可见

## 验收标准

1. 官方 midgame 场景下，`ray_receiver` 切到 `power`，且玩家已经有太阳帆 / 戴森层能量时：
   - `summary.players[pid].resources.energy` 稳定高于切模式前
   - `stats.energy_stats.generation` 稳定高于切模式前
   - `/world/planets/{planet_id}/networks.power_networks[].supply` 稳定高于切模式前
2. 上述增益必须出现在最终 authoritative 查询结果中，而不是只在 `resource_changed` 事件里短暂闪现。
3. `power` 模式下不得新增新的 `critical_photon`；切模式前已有库存允许保留。
