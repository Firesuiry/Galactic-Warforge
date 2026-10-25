# 客户端 CLI

`client-cli` 是交互式 REPL，覆盖服务端全部公开命令、常用查询、调试接口和 agent-gateway 管理入口。游戏命令的处理器与命令表（`GAME_COMMANDS`）在 `shared-client/src/commands/`，CLI 只在其上叠加终端专属命令（`switch`/`events`/`status`/`agent_*`/`game_*`/`clear`/`quit`）；agent-gateway 通过 `shared-client/src/command-runtime.ts` 复用同一套分发执行智能体动作，不依赖 client-cli。

- 公共命令目录的单一真相是 `shared-client/src/command-catalog.ts`（API 名 ↔ CLI 动词、权限类别、层级）；同文件的 `EXTRA_AGENT_COMMAND_CATALOG` 补 agent 可用的查询动词，CLI、网关与 Web provider 白名单共用。
- 用法与说明来自 `shared-client/src/commands/help.ts` 的 `HELP_ENTRIES`，REPL 内 `help <命令>` 可查。
- 下方“命令一览”由 `python3 scripts/gen_command_docs.py` 生成；改了命令目录或 `HELP_ENTRIES` 后重新生成。
- 坐标为立方体球面图集 x/y（`map_width=3N`、`map_height=2N`），跨面邻接以服务端为准，见 [3D与画质](../guide/3D与画质.md)。
- 玩法示例见 [玩法指南](../player/玩法指南.md)，启动方式见 [本地环境与测试](本地环境与测试.md)。

## 启动与连接

```bash
npm install            # 仓库根目录（npm workspace），首次
cd client-cli && npm run dev
```

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `SW_SERVER` | `http://localhost:18080` | 游戏服务端 |
| `SW_AGENT_GATEWAY` | `http://127.0.0.1:18180` | agent-gateway |
| `SW_SSE_VERBOSE=1` | 关 | 订阅全部 SSE 事件 |
| `SW_ISSUER` | 空 | 以代理身份发令：`issuer_type=agent`、`issuer_id=<名>`；不设时为玩家本人 |

默认值：银河 `galaxy-1`、恒星系 `sys-1`、行星 `planet-1-1`、`events` 显示 10 条。

## 登录与事件流

- 启动时检查 `/health`，再选择玩家：`p1 / key_player_1`、`p2 / key_player_2` 或自定义 ID/key。`switch [player_id] [key]` 切换玩家并重连 SSE。
- 发令者：默认由玩家本人发令（`issuer_type=player`、`issuer_id=<player_id>`）。设 `SW_ISSUER=<名>` 或 REPL 执行 `as <名>` 后改为 `issuer_type=agent`、`issuer_id=<名>`（名字只允许字母、数字、`_ . : -`，最长 64，且不能等于玩家 ID）；`as` 不带参数 = 恢复为玩家本人。启动横幅、REPL 提示符（`[p1@builder]`）与 `status` 都显示当前发令者。`switch` 切玩家时保留当前代理名。
- 自动连接 `GET /events/stream?event_types=...`。默认只订阅低噪声事件：`command_result`、`entity_created`、`entity_destroyed`、`building_state_changed`、`construction_paused`、`construction_resumed`、`research_completed`、`victory_declared`、`loot_dropped`、`rocket_launched`。
- `production_alert`、`damage_applied`、`entity_updated` 等高频事件默认不进实时流；告警用 `alert_snapshot`，其余用 `event_snapshot --types ...` 或 `--all`。
- `building_state_changed` 可能 `prev_state == next_state`，此时看 `prev_reason -> reason`（如 `power_out_of_range -> under_power` 表示已接网但当前缺电）。
- `events [count]` 只显示当前连接实际订阅到的事件。
- REPL 串行处理输入，粘贴多条命令会按顺序发送，`ACCEPTED request_id` 与后续 `command_result` 不会乱序。

## 输出与结果

- 游戏命令走 `POST /commands`，同步返回只表示入队（`ACCEPTED request_id`）；最终结果看 SSE `command_result` 或 `event_snapshot --types command_result`。
- 查询命令：`summary`/`stats`/`planet` 等为格式化摘要；`scene`、`inspect`、`catalog_commands` 输出原始 JSON；`fog` 用 `/scene` 渲染局部 ASCII 迷雾（默认窗口 `0 0 32 16`）。
- `alert_snapshot` 与 `briefing` 的告警行按 `shared-client/src/alerts.ts` 的中文口径渲染（`formatAlertText`），不再打印 `alert_type` 枚举：`belt_blocked` 写「传送带堵塞 (12, 7)：5 件货 30 秒没动」（位置/件数取自 `details`，秒数按 tick 速率换算），其余类型写中文短标签（产能下降/堆积升高/原料短缺/产物阻塞/电力不足/出厂口被占满）；已解除的历史条目在行尾标「（已解除）」。服务端快照按「仍成立在前、最近发生 tick 倒序」返回，`--active-only` 只列仍成立的告警。原始 `alert_type` 与 `message` 仍可从 `--json` 或 `GET /alerts/production/snapshot` 拿到。
- `stats.production_stats` 是所有已加载行星本 tick 的真实落库/落站产出；`by_item["minerals"]` 是直充矿物池的统计标签，不是物品。统计按玩家聚合所有已加载行星，焦点切换不改变总量。

## 行星路由（`--planet`）

- `switch_active_planet <planet_id>` 只改自己的焦点行星（每玩家独立），只能切到已发现、已加载且自己有 foothold 的行星；所有已加载行星始终结算。
- 不带 `--planet` 的 `build` 落在焦点行星；`move`/`attack`/`order`/`transfer`/`produce`/`upgrade`/`demolish`/`set_recipe` 等按目标实体所在行星结算；`mine_resource`/`craft_item`/`cancel_mecha_job`/`refuel_mecha`/`configure_mecha_logistics` 按发令者绑定的机甲所在行星结算。
- 跨行星存在同 ID 实体时用 `--planet <planet_id>` 消歧。

## 非交互模式（代理推荐）

AI 代理不用开 REPL，直接 `scripts/sw`：

```bash
scripts/sw build 60 140 wind_turbine     # 执行一条
scripts/sw - < commands.txt             # 从 stdin 逐行执行
```

- 脚本自己定位仓库根，任意目录可调用；每条命令走与 REPL 相同的 `dispatch`，不复制解析逻辑。
- **默认等执行结果**：`POST /commands` 的 `ACCEPTED` 只表示入队，`scripts/sw` 拿到 `request_id` 后轮询审计（`GET /audit?request_id=...&player_id=...` 的 `stage=execute` 记录），在回执后追加每个 command_index 一行：

  ```
  ACCEPTED  request_id=...  tick=579
    [0] accepted OK: 已受理，下一 tick 执行
    [0] ✓ OK: 施工任务已排队（位置 60,140）
  ```

  失败/超时行：

  ```
    [0] ✗ INSUFFICIENT_RESOURCE: 背包缺：铜块 1
    [0] … 未在 8s 内执行（tick 是否在走？）
  ```

- 结构校验失败（`REJECTED`，未入队）不轮询；执行失败、超时、未知命令、本地校验错误都计入退出码。
- `scripts/sw -` 空行与 `#` 开头的行跳过；某条失败不中止，最后打印「N 条：成功 a，失败 b」，有失败时退出码 1。
- 查询命令（`briefing` / `scene` / `mecha list` 等）照常输出，`--json` 等已有选项不变。
- `quit` / `exit` / `clear` 在非交互模式不可用（报错计入失败）。

### 等待条件（`wait`）

代理不必空转轮询，也不必用全局快进（多代理时 `advance` 会让所有人的时间一起跳）。`wait` 每秒查一次，默认超时 120 秒（`--timeout <秒>` 覆盖）：

| 条件 | 等到什么 |
| --- | --- |
| `wait ticks <n>` | 游戏 tick 前进 n（`/health` 的 tick，按服务端时钟算）。**n 是 tick 数，不是秒**：秒 = n ÷ tick 速率（`/games/current` 的 `max_tick_rate`，本服通常 10 tick/s，即 500 tick = 50 秒）；`help wait` 会按当前速率换算并给例子 |
| `wait job` | 我的机甲（`mechas.find(m => m.operator === issuer_id)`）的作业结束；当前没有作业立即返回 |
| `wait build` | 我的机甲施工队列清空（`planet_runtime.construction_tasks` 按 `mecha_id` 过滤）；**剩下的任务全是 `pending` + `wait_reason=insufficient_materials`，或「tick 在前进、但施工签名 10 秒没变」时提前返回**，逐条列出任务、位置和原因。tick 不前进（服务端暂停 / 没人 `advance`）时**不判卡死**，只在超时时注明「tick 未前进（服务端暂停或没有推进）」 |
| `wait item <物品ID> <数量>` | 我的机甲背包里该物品 ≥ 数量 |
| `wait item <物品ID> <数量> --in <建筑ID>` | 建筑库存（`inventory` + `output_buffer`）≥ 数量；建筑不存在立即提前返回。**计数含输出缓冲**：`inspect` 显示 `inventory 17 / output 3` 时 `wait item X 20` 已成立 |
| `wait running <建筑ID>` | 建筑 `runtime.state == running`；超时消息带当前 `state`、`state_reason`、配方与仍成立的产线告警 |

- 成功：`✓ 等到了：<描述>（用了 N tick / M 秒）`，退出码 0。
- 超时或提前返回：`✗ 超时（120s，tick 前进 N）：<当前状况>` / `✗ 提前返回（<原因>，tick 前进 N）：<任务列表>`，`scripts/sw` 退出码非 0（`once.ts` 把 `✗ ` 前缀与本地 `Error:` 一样计为失败）。
- 施工队列刚下完单时 `summary` 的 `construction_pending` 可能还是 0，`wait build` 不看它，一律以 `planet_runtime` 为准。
- 示例：`scripts/sw craft_item gear 3 && scripts/sw wait job`；`scripts/sw wait item circuit_board 4 --in b-79`；`scripts/sw wait running b-79 --timeout 60`。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `SW_SERVER` | `http://127.0.0.1:18080` | 游戏服务端 |
| `SW_PLAYER` | `p1` | 玩家 ID |
| `SW_KEY` | `key_player_1` | 玩家 key |
| `SW_ISSUER` | 空 | 以代理身份发令（`issuer_type=agent`），语义同 REPL |
| `SW_WAIT` | `1` | `0` = 只发不等执行结果 |
| `SW_WAIT_TIMEOUT` | `8` | 等执行结果的秒数 |

等待逻辑在 `shared-client`：`api.awaitExecution(requestId, expectedCount, opts)` 轮询审计并返回 `{status, outcomes}`，`api.setCommandResponseHandler(fn)` 在每次 `POST /commands` 后回传原始响应（供非交互入口拿 `request_id`）。REPL 默认行为不变。

## 命令要点

命令表里放不下的语义：

- **build**：接受任意服务端 `buildable` 建筑；`--recipe` 设初始配方，`--direction` 用于传送带（含 `auto`），`--rotation 0|90|180|270`，`--approach` 让机甲先走到建造范围再开工。采集建筑必须压在对应资源点上（矿机→矿点，`water_pump`→`water`，`oil_extractor`→`crude_oil`）。`vertical_launching_silo` 默认挂 `small_carrier_rocket` 配方。以 `/catalog` 为准，例如 `satellite_substation` 需 `satellite_power`。
  - **多层传送带（第 19 轮契约 §3）**：`--elevation <0-4>` 只对 `conveyor_belt_mk1/mk2/mk3` 有效，缺省 0 = 地面。CLI 先本地校验范围（越界回 `elevation 必须是 0-4（0 = 地面，只有传送带能架高）`，不发请求）；服务端另校验：非传送带给 >0 或越界 → `INVALID_ELEVATION`「只有传送带可以架高」/「高度只能 0–4 层」；高架带方向：`--direction` 优先，其次按 `--rotation` 推（90=east、180=south、270=west、0=north），都没给时缺省 `east`；显式 `--direction auto` 仍被拒绝（`INVALID_ELEVATION`）；同格同层已有带子/施工任务、或地面压着非低矮物流建筑/地面施工任务 → `POSITION_OCCUPIED`（提示含层号与占用者）。地面层造非低矮物流建筑时，占地内有高架带或高架施工任务 → `POSITION_OCCUPIED`「上方有高架传送带」/「该格上方第 N 层已有传送带施工任务：<建筑>」。例：`build 10 10 conveyor_belt_mk1 --direction east --elevation 1`。
- **produce**：只生产 `world_produce` 地表单位（`help produce` 会读 `/catalog.world_units`）。按 `producer` 分工：兵营（工程兵/步兵/侦察车）、战车工厂（机甲/火炮/导弹车/维修车/补给车）、机场（攻击无人机）、战场分析基站 HQ（运输机器人 `transport_robot`，造价铁块×4/齿轮×2/磁线圈×1、300 tick、每玩家上限 20 台）。造价是实物清单，从生产建筑自身库存扣（`transfer` 或皮带供料），缺料返回 `INSUFFICIENT_RESOURCE`；排队有时长，停电暂停。`inspect` 建筑可见 `unit_queue` 与 `rally_point`。
- **haul**：运输机器人专用（API 仍是 `unit_order`，`order=haul`）。`haul <unit_id[,unit_id...]> --from <building_id> --to <building_id> [--item <item_id>]` 让机器人在两座己方建筑之间往返搬运单一物品（每趟 4 件）；省略 `--item` 时自动挑「起点可取、终点能收」的第一种。起点无货在起点等、终点收不下在终点等；`order stop` 清空路线。只有 `transport_robot` 能执行，其它单位被中文拒绝。
- **蓝图单位**：`prototype`/`precision_drone`/`corvette`/`destroyer` 等先做成载荷物品进部署枢纽（默认 `battlefield_analysis_base`，需通电 `running`），再 `deploy_squad` / `commission_fleet`；玩家定型蓝图同样可部署。
- **transfer**：对应 API `transfer_item`；默认背包→建筑，`--take` 从建筑主仓/输出缓存取回（受背包容量限制）。
- **军团**：`form_squad` 可含补给车；`squad_order ... resupply` 不带坐标，自动前往最近补给站；`dissolve_squad` 后成员保留当前指令。
- **弹药**：`inspect` 单位可见 `ammo_class`/`ammo`/`ammo_capacity`/`ammo_item`，打空后 `combat_state=no_ammunition` 停火；进入 `supply_station`（半径 30 cell）或 `supply_truck`（半径 15 cell）范围自动补满。防空炮吃 `ammo_missile`、火炮吃 `shell_set`，用 `transfer` 或皮带装填。
- **研究**：至少 1 个 `running` 研究站（`matrix_lab` 不设配方即研究模式），所需矩阵须已在研究站本地库存，推进时真实消耗。`summary` 的 `tech.current_research.blocked_reason` 为 `waiting_lab`/`waiting_matrix`/`low_power`，`speed_multiplier` 与 `estimated_ticks_remaining` 反映供电降速。
- **机甲**：背包挂在机甲上，`summary` / `briefing` 显示的是**当前发令者绑定的机甲**（`mechas.find(m => m.operator === issuer_id)`）的背包；未绑定时提示「未绑定机甲：mecha list / mecha assign <id>」。
  - `mecha list`：本方全部机甲（ID、星球、操作者、存活、背包格数、施工中/排队），当前发令者那台加粗。
  - `mecha assign <mecha_id> [operator]`：把机甲绑给发令者（operator 缺省 = 自己），`--release` 解绑为空闲。同玩家任何发令者都能改绑本方机甲；**一个发令者可以绑多台机甲**，绑定不会解绑同一 operator 的其它机甲。
  - `mecha dispatch <planet_id> [mecha_id]`（等价 `dispatch_mecha <planet_id> [mecha_id]`）：把发令者的一台机甲瞬移到目标行星（本轮不做飞行时间）；绑了多台时必须点名 `mecha_id`。
  - 需要机甲的命令（`build` / `upgrade` / `demolish` / `transfer` / `mine_resource` / `craft_item` / `cancel_mecha_job` / `refuel_mecha` / `configure_mecha_logistics` / 安装物流载具 / 军工排产）一律由发令者绑定的机甲执行，不再带 `<executor_id>`；未绑定、机甲不在本星球或阵亡时返回 `EXECUTOR_UNAVAILABLE`。被别的发令者绑定的机甲不能 `move`/`attack`/`order`（该单位返回 `NOT_OPERATOR`），空闲机甲谁都能动。
  - `mine_resource` 在 6 cell 内采有限固体矿点（`resource_id` 是矿点 ID，不是物品 ID），每 10 tick 1 件；`craft_item` 只限 `handcraft_allowed=true` 且已解锁的配方，quantity 为批数。采矿每件耗 3 核心，手搓每批耗 `max(1, 时长/20)` 核心，缺能暂停。quantity 只接受正十进制安全整数。`refuel_mecha <fuel_item_id> [count]` 只接受 `items[].mecha_fuel_energy > 0` 的燃料，count 缺省 1，烧到核心满为止。靠近运行中的自有无线输电塔（18 cell）或电力感应塔（12 cell）自动充电。
  - 新机甲在战场分析基站制造：`produce <hq_id> executor`（成本：铁块 16、齿轮 8、磁线圈 8、电路板 8，从基站存储扣）。出厂时空闲、空背包，用 `mecha assign` 接管。
- **分流器**：`configure_splitter` 每次完整替换端口、优先级与过滤；省略可选项即清除。方向限 `north/east/south/west`，至少一入一出、方向不重复。未过滤出口可作旁路；优先是“可用优先”。
- **分拣器**：`configure_sorter` 只配过滤——`--mode allow|deny` 配 `--items`（逗号分隔成数组）。方向由建造朝向决定（背面取货、正面放货），不再有 `--inputs`/`--outputs`；要改方向得拆除重建（客户端 R 旋转）。
- **流速监测器**：`configure_traffic_monitor` 完整替换配置，绑定相邻自有 Mk.I/II/III 传送带，`none` 清绑定；任何配置都会重置统计。告警事件为 `traffic_monitor_alert`。
- **物流站**：新站无库存、无电、无端口、无运输器。`install_logistics_vehicle` 默认扣背包成品，`--source station` 扣站内同物品成品（可经皮带入站）；调大容量不会生成载具。`configure_logistics_station --belt-ports` 完整替换全部端口（`none` 清空），端口物品须先配槽。`configure_logistics_slot ... --remove` 删除槽，有库存、端口引用或在途货物时拒绝。PLS 3 槽×200，ILS 5 槽×500。曲速需起飞站配 `space_warper` 槽并装入至少 2 份曲速器。
- **配送器**：`configure_distributor` 省略布尔开关保留原值；物品为 `none` 时须同时停用仓间与机甲配送。`uninstall_logistics_bot` 只回收空载停靠的机器人。`configure_mecha_logistics` 整体替换请求（最多 8 项，`0≤min≤max≤1000` 且 `max>0`）。
- **戴森**：`launch_solar_sail` 只接受 `em_rail_ejector`，`launch_rocket` 只接受 `vertical_launching_silo`，均需本地已装载载荷；`launch_rocket` 还需目标层已有 `build_dyson_*` 结构。`set_ray_receiver_mode photon` 需 `dirac_inversion`。
- **舰队**：`fleet_attack` 只打同星系目标；`fleet_move` 要求目标星系为直达航线、舰队 `idle` 且不在跃迁中，固定 10 tick。`blockade_planet` 最终状态看 `system_runtime` 的 `planet_blockades`。
- **scene**：`scene [planet] [x y w h] [--near_x X --near_y Y --radius R] [--json] [--limit N|all]`。
  - 省略 planet = 我的机甲（summary `mechas` 里 `operator` = 发令者）所在星球，未绑定时用焦点星球 `focus_planet_id`，再退回 `active_planet_id`；首行会打印选中原因。省略窗口 = 以我的机甲为中心 48×48（按星球图集尺寸裁剪；无机甲时从 0,0 起）。
  - 位置参数不再「第一个数字当 planet」：`scene 40 130 16 12` 就是窗口；给 planet 必须形如 `planet-1-1`。
  - 默认输出紧凑文本：建筑表（id / 类型 / 锚点 / 占地 / `runtime.state[:state_reason]`）、资源按 `kind` 汇总（格数、包围盒、代表矿点 id）、单位表（机甲标 `operator`，空闲显示 `(idle)`）；每节默认最多 20 条，超出提示 `--json` 或缩小窗口，`--limit all` 全列。`--limit` 只接受正整数或 `all`；`--limit 0`、负数、非数字或缺值都直接报错 `--limit 必须是正整数或 all`（不会静默输出 `showing 0 of N`）。
  - `--json` 输出服务端原始 JSON（`buildings`/`units` 是对象、空节是 `null`，脚本用 `(.buildings // {})`）。`--near_x/--near_y/--radius`（R ≤ 128）仍返回球面邻域补片 `surface_patches`。服务端窗口默认 160、最大 257。球面寻路没有 CLI 命令，用 `GET /world/planets/{id}/path`。
- **find_space**：`find_space <w> <h> [--count N] [--near X Y] [--radius R] [--spacing N] [--planet <id>] [--json]`。
  - 在当前星球找一个 w×h 的**全空矩形**，按与锚点（缺省 = 我的机甲，`--near` 覆盖）的距离升序输出前 N 条（默认 5）。每行同时给「距锚点」（搜索锚点）和「距机甲」两列；机甲不在该星球时两者相同：
    ```
    空地 3x3 @ (62,146)  距锚点 0  距机甲 4  地形 buildable
    ```
  - `--planet <id>`：锚点取**该星球上我的机甲**；机甲不在该星球（或没绑机甲）时回退到该星球场景中心 `(map_width/2, map_height/2)`，并在首行注明原因（`锚点回退到 …：我的机甲 u-x 在 …，不在 …` / `未绑定机甲`）。`--near` 优先于两者。
  - `--spacing <n>`：任意两个候选的锚点曼哈顿距离 ≥ n，贪心取分散候选。**想互不重叠至少取 `max(w,h)+1`**（`max(w,h)` 时锚点曼哈顿距离 3 的两个 3×3 矩形仍会相交）。**缺省 0 = 不过滤**，行为与旧版一致。结果里候选互相重叠时（且未给 `--spacing`）额外提示「用 --spacing 取分散候选，互不重叠至少 max(w,h)+1」。
  - 占用判定：地形必须是 `buildable`；建筑按**实际占地**（`runtime.params.footprint`，锚点 + 宽高）排除，不是只排锚点；地面单位占 1 格（`domain=air/orbital/space` 不占）；未落成的施工任务按 `building_type` 的占地排除（高架传送带只占 1 格，`completed`/`cancelled` 不占）。服务端 `construction_tasks` 只下发**自己的**任务。
  - 数据来源：`GET /world/planets/<id>/scene`（窗口 = 锚点周围 `2R+1` 见方，R 默认 48、最大 128；另外扩 4 格取回锚点在外、占地压进窗口的建筑）+ `GET /world/planets/<id>/runtime` 的 `construction_tasks`。二维前缀和判定，128×128 窗口也在毫秒级。
  - 只返回完整落在窗口内、且不跨立方体球面缝的矩形；跳过的跨缝候选数会单独说明。无解时输出 `✗ 没找到 …`（`scripts/sw` 退出码非 0）。
  - `--json` 输出 `{planet_id, anchor, window, size, spacing, skipped_seam, results[]}`；每个结果带 `distance`（距锚点）与 `mechaDistance`（距机甲）。
- **plan**：`plan <build x y type | upgrade <building_id> | craft_item <配方> <批数>>... [--planet <id>] [--json]`，或用 `;`/换行分隔，或 `plan -` 从 stdin 每行一条。同一条里也可以直接连写多个计划项（`plan build 98 146 matrix_lab craft_item circuit_board 4`），遇到下一个 `build`/`upgrade`/`craft_item` 自动切开。切分按**语法位置**：当前项的位置参数吃满（build 3 个、upgrade 1 个、craft_item 2 个）后才认下一个动词，所以建筑/配方 id 恰好叫 `upgrade`、`build` 也不会切错（`plan build 1 1 upgrade` 就是一个 build）。
  - `craft_item <配方> <批数>`：把配方 `inputs × 批数` 计入「需要」（可和 build / upgrade 混排，同种原料合并）。产物本身不进表；配方必须存在且 `handcraft_allowed=true`，否则报错。
  - 输出累计用料表：`物品 / 需要 / 背包 / 占用 / 缺口`。
    ```
    计划 2 项（matrix_lab, wind_turbine）
    物品    需要  背包  占用  缺口
    ---  --  --  ---------  --
    ...
    结论：料齐了
    ```
  - 「占用」= `planet_runtime.construction_tasks` 里**本机甲**（`mecha_id`）`pending/in_progress/paused` 且 `materials_deducted=false` 的 `cost` 之和；缺口 = 需要 + 占用 − 背包。占用**只算施工任务**：进行中的手搓作业已预留的原料不算占用（缺口提示里注明）。
  - 造价来自 `/catalog` 的 `buildings[].build_cost`；未知建筑类型、不可建造类型、找不到的 upgrade 目标直接报错。`upgrade` 按服务端 `BuildingUpgradeCost` 口径 = `ceil(基础造价 × 当前等级)`（数据里 `cost_multiplier` 缺省 1）。
  - 缺口物品若有 `handcraft_allowed` 配方，结论下逐条给配方 id、输入→输出和「需 N 批 = 原料×数量」，并**递归展开**中间产物（最多 3 层，配方环停止展开）：背包或本方建筑里已有足够库存的直接写来源，否则继续沿手搓链展开，不可手搓的写「不可手搓，从 <建筑> 取」或「需要生产建筑」。
    ```
    - 电路板 11（可手搓：circuit_board，铁块×1+铜块×1 → 电路板×1；需 11 批 = 铁块×11+铜块×11）
        ↳ 铁块 11：不可手搓，从 b-105 补给站(53) 取   [够]
        ↳ 铜块 11：b-97 补给站(56)、b-55 电弧熔炉(2) 等 3 处   [够]
    ```
    取料来源 = 机甲周围 48×48 场景里本方建筑 `storage.inventory + storage.output_buffer` 里该物品的**当前数量**，只列数量 > 0 的建筑（按数量降序取前 2 个，更多时补「等 N 处」）。行尾标 `[够]` 或 `[不够，还差 N]`：**够不够按全部来源合计**与缺口比较，所以来源列只是「现在能取到多少」，不是保证有货。
  - `--json` 的 `sources` 每项为 `{buildings: [{id,type,quantity}], available, gap, enough}`（`available` 是全部来源合计）。
  - 有缺口时结论行以 `✗ ` 开头，`scripts/sw` 退出码非 0。
  - `--json` 输出 `{planet_id, mecha_id, items[], need, inventory, occupied, gaps, sources}`；每项带 `kind` / `label` 与各自的明细：build 有 `building_type`、`position`；upgrade 有 `building_id`、`building_type`；craft_item 有 `recipe_id`、`batches`。
  - `plan need <物品ID> <数量> [--from <配方ID>]`：按配方递归反推到基础原料，回答「造 N 个要备多少料」（分轮喂料的总量核算）。
    ```
    需要 电磁矩阵 20
      电磁矩阵 20 ← electromagnetic_matrix（制造台 Mk.I）
        磁线圈 20 ← magnetic_coil（制造台）
          磁铁 20 ← smelt_magnet（制造台）
            铁矿 20（基础）
          铜块 10 ← smelt_copper（制造台）
            铜矿 10（基础）
        电路板 20 ← circuit_board（制造台）
          铁块 20 ← smelt_iron（制造台）
            铁矿 20（基础）
          铜块 20 ← smelt_copper（制造台）
            铜矿 20（基础）
    汇总（基础原料）：
    物品  需要  现有  缺口
    ...
    结论：还缺 铁矿 10
    ```
    - 配方选择：`--from` 显式指定；否则取 `outputs` 含该物品、**科技已满足**的配方里单批产出该物品数量最大的一条（同产量按 id 排序）。科技门槛 = 配方自己的 `tech_unlock` ∪ `/catalog` 里 `techs[].unlocks` 中 `type=recipe` 指向它的科技，完成任一即可；没有配方（基础矿石/原料）就是叶子。
    - 批数 = `ceil(数量 / 每批产量)`，原料 = `ceil(批数 × inputs)`（与服务端批处理同口径）。
    - 最多展开 6 层，链上重复出现同一物品判配方环停止；层数上限 / 环 / 基础原料都会在行里注明。
    - 「现有」= 机甲背包 + 机甲周围 48×48 场景里本方建筑的 `inventory + output_buffer`（与 plan 取料来源同口径）；缺口 = `max(0, 需要 − 现有)`。汇总只列基础原料（中间产物都要现做）。
    - `--json` 输出 `{planet_id, mecha_id, item_id, quantity, tree, summary, gap_total}`；`tree` 每节点带 `item_id` / `quantity` / `stock` / `gap` / `recipe_id?` / `leaf_reason?` / `children`。
    - 有缺口时结论行以 `✗ ` 开头（退出码非 0）。
- **inspect**：`inspect [planet] [building|unit|resource|sector] <entity_id> [--json]`。
  - 省略 planet 同 `scene`；省略 kind 按 id 前缀推断：`b-` 建筑、`u-` 单位、`res-` 或含 `-res-` 的资源点、`x:y` 扇区。旧写法 `inspect <planet> <kind> <id>` 仍可用。
  - 默认输出人话摘要：`state[:state_reason]`、坐标/占地、HP、配方与剩余 tick、主库存/输出缓冲、`production_monitor.active_alerts`（如 `input_shortage,throughput_drop`）；单位给操作者、能量/护盾、`mecha.job`（空闲为 `idle`）、弹药；资源给矿种/剩余量/产率。
  - **不显示库存容量 / 占用格数**：判断「快满」要用 `catalog building <建筑类型>` 的容量（`storage.capacity` / `slots` / `buffer_capacity`）对照 `inspect` 的数量。
  - 分拣器另加一行 `sorter`：两端连到了谁 + 最近一次搬运，例 `取←西 b-55 电弧熔炉(1格) | 放→东 未连上：被分拣器 b-181 挡住   last=t1234 iron_ore b-55→b-105`。没连上的原因：`3格内没有建筑` / `不是你的` / `被分拣器 … 挡住` / `被分流器 … 挡住` / `传送带 … 未运行` / `传送带 … 不接受这一侧插入` / `没有输出口|输入口` / `没有存储`。
  - `--json` 输出原始响应。
- **catalog**：`catalog <buildings [关键词]|building <id>|recipes [--handcraft] [--building <type>] [关键词]|items [关键词]|techs [--available|--done]|units>`，一次读 `GET /catalog`。
  - `buildings`：id / 名称 / 占地 / 造价 / `unlock_tech` / 是否已解锁（对照 `summary` 已完成科技；`unlock_tech` 是「任一完成即可」，空 = 无门槛）。
  - `building <id>`：造价、占地、1 级耗电/发电、IO 口与连接点（来自 `runtime_params`）、可跑配方、科技前置、可产单位。
  - `recipes`：输入 → 输出、时长（tick）、能否手搓、科技门控；`--handcraft` 只列可手搓。
  - `techs --available` 只列「前置全部完成且自身未完成」的科技，`--done` 只列已完成；`cost` 已按本局 `research_pace` 缩放。
  - `items`：堆叠上限与机甲燃料值；`units`：可生产单位、生产建筑、成本、时长。
- **networks**：`networks [planet] [--json]` 读 `GET /world/planets/<id>/networks`：每个电网的发电/用电/净额/建筑数/是否缺电，另列未接网与欠电建筑（`connected`/`ratio`/`reason`）；有管网时给节点/管段/流体种类计数。省略 planet 同 `scene`。
- **alerts**：`alert_snapshot` 的别名，参数相同；每行额外打印 `alert_type=<枚举>` 与 `building_id`，便于脚本定位。
  - `--active-only` **只过滤已恢复的告警，不按时间过滤**：一直没解决的产线问题（如某台机器从早期就 `output_blocked`）会一直挂着，标题里的条数不代表「刚发生」。要看最近新出的告警用 `--since-tick <n>` 或看行内 tick。

## 调试与管理选项

```bash
audit --player <id> --issuer-type <type> --issuer-id <id> --action <action> --request-id <rid> \
      --permission <permission> --granted <true|false> --from-tick <n> --to-tick <n> \
      --from-time <rfc3339> --to-time <rfc3339> --limit <n> --order <asc|desc>
event_snapshot --types <a,b,c> --all --after-id <id> --since-tick <n> --limit <n>
alert_snapshot --after-id <id> --since-tick <n> --active-only --limit <n>
save [--reason <text>]                       # 刷新 server.data_dir 下的 save.json，不建多槽位
checkpoint list                              # 列出命名存档点（任意登录玩家）
checkpoint save <name> [--note <text>] [--contract <file.json>] [--replace]
checkpoint load <name>                       # 热加载存档点
replay --from <tick> --to <tick> --step --speed <n> --verify <true|false>
rollback --to <tick>
raw <json>                                   # 直接发送完整 /commands 请求体
```

`event_snapshot` 不传 `--types` 时使用与默认 SSE 相同的低噪声集合。

### 新局热重置

```bash
game_status
game_new --seed seed-42 --difficulty off --victory sandbox \
  --players '[{"player_id":"p1","key":"k1","role":"admin"},{"player_id":"p2","key":"k2","bot":"normal"}]'
game_new --players-file ./players.json
```

- `game_new` 调 `POST /games/new`，仅 `role=admin` 可用（否则 403）。`--seed` 缺省随机；地图拓扑沿用服务端启动时的 map 配置。
- `--difficulty off|easy|normal|hard`（默认 `normal`）；`--victory elimination|mission_complete|hybrid|sandbox`（默认 `elimination`，`sandbox` 永不判胜）。
- `--players`（或 `--players-file`）必填；`player_id`/`key` 必填且唯一，`role`/`team_id`/`bot`/`bootstrap` 语义同 `config.yaml`。
- 成功后旧 key 全部失效，CLI 自动切到新局第一个 admin 并重连 SSE。
- `game_status` 调 `GET /games/current`，打印 status/seed/tick/难度/胜利模式/玩家；`finished` 时打印胜者、原因、时长与战损。

## 命名存档点（checkpoint）

试玩加速：从某个存档点读档跑一段，行为符合预期就存成新存档点，下次继续。

```bash
checkpoint list
checkpoint save base-ok --note "开局 20 分钟后" --contract ./contract.json
checkpoint save bug-lost-miner --note "采矿机丢失"          # bug- 前缀：契约只记录不拦截
checkpoint save base-ok --replace                           # 覆盖同名
checkpoint load base-ok
```

- `checkpoint list` 调 `GET /checkpoints`，任意登录玩家可用；打印存档点目录、当前对局来源与每个存档点的 kind/tick/seed/parent/note 及 `stale` 标记。
- `checkpoint save` 调 `POST /checkpoints`，**仅 `role=admin`**；名字须匹配 `[a-z0-9][a-z0-9-]{0,63}`，同名默认 409，`--replace` 覆盖。
- `--contract <file.json>` 传状态契约（`{"checks":[{"kind":"tick_gte","tick":1000}]}`）：**regression 存档点契约未全过时服务端 400 拒绝创建**并返回逐条结果，**`bug-` 前缀的 bug 存档点只记录结果照存**。谓词词表见 [服务端 API](服务端API.md) 6.9。
- `checkpoint load` 调 `POST /checkpoints/{name}/load`，**仅 `role=admin`**：按存档内配置与地图拓扑重建对局并原子替换；`stale` 只警告不阻止。与 `game_new` 不同，**玩家 key 不变**，CLI 的鉴权无需切换；SSE 会被服务端断开，重新订阅即可。

## Agent 相关

`agent_list` / `agent_create` / `agent_update` / `agent_message` / `agent_thread` 调 agent-gateway（详见 [agent-gateway](agent-gateway.md)）。

`agent_create` / `agent_update` 除命令表列出的参数外，还支持战争委派参数：

- `--theater-ids` / `--task-force-ids`：显式委派战区、任务群。
- `--military-command-ids`：战争命令白名单（如 `system_runtime`、`war_industry`、`task_forces`、`theaters`、`queue_military_production`、`task_force_set_stance`、`task_force_deploy`、`blockade_planet`）。只给 `--command-categories combat` 不够，战争命令还必须命中此白名单。
- `--allow-blockade`、`--allow-military-production`：高风险动作开关；`--military-production-limit`：单次排产上限。
- 运行时用 authoritative `theaters` / `task_forces` 校验 `system_id` / `planet_id` / `task_force_id` / `theater_id`，越界直接拒绝。

```bash
agent_update agent-war-director \
  --command-categories observe,combat,management \
  --theater-ids theater-front --task-force-ids tf-front \
  --military-command-ids system_runtime,task_force_set_stance,task_force_deploy \
  --allow-blockade false --allow-military-production false --military-production-limit 0
agent_message agent-war-director 接管 theater-front，并让 tf-front 在战区内维持巡逻，汇报当前局势。
agent_thread agent-war-director
```

`shared-client` 目录中声明的公共 CLI 动词会自动进入 agent runtime 白名单。

## 多代理同阵营

同一个玩家可以同时跑多个 CLI / agent-gateway 智能体：每个代理设自己的 `SW_ISSUER=<名>`，各绑一台机甲，施工额度与背包互不影响。

```bash
SW_ISSUER=builder npm run dev          # 代理 builder
mecha list                             # 看本方机甲与操作者
mecha assign u-7                       # 接管空闲机甲 u-7（operator 缺省 = 自己）
as                                     # 临时恢复为玩家本人发令
```

代理没有可用机甲时，需要机甲的命令返回 `EXECUTOR_UNAVAILABLE`；先在基站 `produce <hq_id> executor` 造一台再 `mecha assign`。

## 命令一览

<!-- BEGIN GENERATED COMMANDS -->
<!-- 由 scripts/gen_command_docs.py 生成，勿手改；数据源 GAME_COMMANDS/COMMANDS/HELP_ENTRIES 与 shared-client 命令目录 -->

### 游戏命令（66 条，对应 `POST /commands`）

| 动词 | 用法 | API 命令 | 权限类别 | 说明 |
|---|---|---|---|---|
| `attack` | `attack <entity_id> <target_id>` | `attack` | combat | Attack target entity |
| `blockade_planet` | `blockade_planet <task_force_id> <planet_id>` | `blockade_planet` | combat | Issue a blockade intent against one planet |
| `blueprint_create` | `blueprint_create <blueprint_id> <ground\|space> [--name <name>] (--base-frame <base_frame_id> \| --base-hull <base_hull_id>)` | `blueprint_create` | management | Create a draft warfare blueprint |
| `blueprint_finalize` | `blueprint_finalize <blueprint_id> [--target-state <state>]` | `blueprint_finalize` | management | Advance a warfare blueprint to the next or chosen lifecycle state |
| `blueprint_set_component` | `blueprint_set_component <blueprint_id> <slot_id> <component_id>` | `blueprint_set_component` | management | Set one component on a draft or validated warfare blueprint |
| `blueprint_validate` | `blueprint_validate <blueprint_id>` | `blueprint_validate` | management | Validate a warfare blueprint and receive structured legality issues |
| `blueprint_variant` | `blueprint_variant <parent_blueprint_id> <blueprint_id> <allowed_slot_ids_csv> [--name <name>]` | `blueprint_variant` | management | Create a controlled variant from a preset or player blueprint |
| `build` | `build <x> <y> <type> [--z <z>] [--direction <dir>] [--recipe <id>] [--rotation 0\|90\|180\|270] [--elevation 0-4] [--approach]` | `build` | build | Build any server-side buildable structure。x,y 是**占地左上角**（不是中心）：占地大小查 catalog.buildings[].footprint，rotation 90/270 时宽高互换；传送带可用 --elevation 架高（0-4，缺省 0） |
| `build_dyson_frame` | `build_dyson_frame <system_id> <layer_index> <node_a_id> <node_b_id>` | `build_dyson_frame` | build | Build a Dyson sphere frame |
| `build_dyson_node` | `build_dyson_node <system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]` | `build_dyson_node` | build | Build a Dyson sphere node |
| `build_dyson_shell` | `build_dyson_shell <system_id> <layer_index> <latitude_min> <latitude_max> <coverage>` | `build_dyson_shell` | build | Build a Dyson sphere shell |
| `cancel_construction` | `cancel_construction <task_id>` | `cancel_construction` | build | Cancel queued or running construction task |
| `cancel_mecha_job` | `cancel_mecha_job [--planet <planet_id>]` | `cancel_mecha_job` | management | 取消我的机甲的作业并返还未完成批次原料 |
| `cancel_research` | `cancel_research <tech_id>` | `cancel_research` | research | Cancel a technology in progress or queue |
| `commission_fleet` | `commission_fleet <building_id> <blueprint_id> <system_id> [--count <n>] [--fleet-id <fleet_id>]` | `commission_fleet` | combat | Consume a fleet payload from a hub and create or reinforce a fleet |
| `configure_distributor` | `configure_distributor <id> <item_id\|none> <none\|supply\|demand> <local_storage> [--delivery true\|false] [--collection true\|false]` | `configure_distributor` | management | 配置仓库配送器；省略开关保留原值 |
| `configure_logistics_slot` | `configure_logistics_slot <building_id> <planetary\|interstellar> <item_id> [<none\|supply\|demand\|both> <local_storage> \| --remove]` | `configure_logistics_slot` | management | 配置物流物品槽；remove移除无库存、无端口或在途引用的空槽 |
| `configure_logistics_station` | `configure_logistics_station <building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true\|false>] [--warp-enabled <true\|false>] [--ship-slots <n>] [--belt-ports direction:input\|output:item_id,...\|none]` | `configure_logistics_station` | management | Configure logistics station capacity, priority and interstellar switches |
| `configure_mecha_logistics` | `configure_mecha_logistics <item:min:max,...\|none>` | `configure_mecha_logistics` | management | 替换本发令者机甲（我的机甲）的配送请求，最多 8 项，none 清空 |
| `configure_sorter` | `configure_sorter <building_id> [--mode allow\|deny] [--items iron_ore] [--planet <id>]` | `configure_sorter` | management | 配置分拣器物品过滤（方向由建造朝向决定） |
| `configure_splitter` | `configure_splitter <building_id> --inputs west --outputs east,south,north [--input-priority west] [--output-priority east] [--filters east:iron_ore,south:copper_ore]` | `configure_splitter` | management | 完整替换分流器端口、优先级和物品过滤；省略可选项即清除 |
| `configure_traffic_monitor` | `configure_traffic_monitor <building_id> <belt_id\|none> --window <1..600> --minimum <0..60> --alerts <on\|off>` | `configure_traffic_monitor` | management | 监测相邻皮带真实流出量；none 清绑定，配置重置采样 |
| `craft_item` | `craft_item <recipe_id> <quantity> [--planet <planet_id>]` | `craft_item` | management | 用我的机甲背包原料进行个人制造，quantity为批数（按发令者机甲所在行星结算）；可用配方见 help craft_item（读 /catalog 的 handcraft_allowed） |
| `demolish` | `demolish <entity_id> [--planet <planet_id>]` | `demolish` | build | Demolish building（按建筑所在行星结算） |
| `demolish_dyson` | `demolish_dyson <system_id> <node\|frame\|shell> <component_id>` | `demolish_dyson` | build | Demolish a Dyson sphere component |
| `deploy_squad` | `deploy_squad <building_id> <blueprint_id> [--count <n>] [--planet <planet_id>]` | `deploy_squad` | combat | Consume a squad payload from a hub and create a combat squad |
| `dispatch_mecha` | `dispatch_mecha <planet_id> [mecha_id]` | `dispatch_mecha` | management | 把发令者的一台机甲瞬移到目标行星（本轮不做飞行时间）；一个发令者绑了多台机甲时必须点名 mecha_id |
| `dissolve_squad` | `dissolve_squad <squad_id> [--planet <id>]` | `dissolve_squad` | combat | 解散军团，单位保留当前指令 |
| `fleet_assign` | `fleet_assign <fleet_id> <line\|vee\|circle\|wedge>` | `fleet_assign` | combat | Change a fleet formation |
| `fleet_attack` | `fleet_attack <fleet_id> <planet_id> <target_id>` | `fleet_attack` | combat | Order a fleet to attack a target in the same system |
| `fleet_disband` | `fleet_disband <fleet_id>` | `fleet_disband` | combat | Disband a fleet and remove it from runtime |
| `fleet_move` | `fleet_move <fleet_id> <target_system_id>` | `fleet_move` | combat | Order a fleet to transit to a connected star system |
| `form_squad` | `form_squad <entity_id...> [--name <name>] [--planet <id>]` | `form_squad` | combat | 选中单位编成军团（可含补给车） |
| `install_logistics_bot` | `install_logistics_bot <id> <quantity> [--source player\|storage]` | `install_logistics_bot` | management | 消耗背包或绑定仓库的机器人安装至配送器 |
| `install_logistics_vehicle` | `install_logistics_vehicle <station_id> <logistics_drone\|logistics_vessel> <quantity> [--source player\|station]` | `install_logistics_vehicle` | management | 消耗背包或站内成品安装运输器，受站点槽位上限限制 |
| `launch_rocket` | `launch_rocket <building_id> <system_id> [--layer <n>] [--count <n>] [--planet <planet_id>]` | `launch_rocket` | management | Launch loaded rockets from a Vertical Launching Silo into a Dyson layer |
| `launch_solar_sail` | `launch_solar_sail <building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>] [--planet <planet_id>]` | `launch_solar_sail` | management | Launch loaded solar sails from an EM Rail Ejector |
| `mecha` | `mecha <list\|assign <mecha_id> [operator]\|assign <mecha_id> --release\|dispatch <planet_id> [mecha_id]>` | `assign_mecha` | management | 列出本方机甲（含当前作业；Construction 列 active/pending 中 pending 才是排队/缺料）/ 把机甲绑给发令者（operator 缺省 = 自己；--release 解绑；一个发令者可以绑多台）/ dispatch 把机甲投送到另一颗行星 |
| `mine_resource` | `mine_resource <resource_id> <quantity> [--planet <planet_id>]` | `mine_resource` | management | 用我的机甲手动采集固体资源到机甲背包（按发令者机甲所在行星结算）。resource_id 取自 scene 的 resources[].id（资源节点 id，如 r-12），不是物品 id；矿点须在机甲 6 格内 |
| `move` | `move <entity_id> <x> <y> [--z <z>]` | `move` | combat | Move entity to position |
| `order` | `order <entity_id[,entity_id...]> <attack_move\|patrol\|guard\|hold\|follow\|retreat\|stop> [x y] [--target <entity_id>] [--planet <planet_id>]` | `unit_order` | combat | R5 部队指令：攻击移动/巡逻/守卫/坚守/跟随/撤退/停止（支持逗号分隔批量；--planet 跨行星同 ID 消歧） |
| `produce` | `produce <entity_id> <unit_type> [--planet <planet_id>]` | `produce` | build | Produce a server-public world unit（按建筑所在行星结算） |
| `queue_military_production` | `queue_military_production <building_id> <deployment_hub_id> <blueprint_id> [--count <n>]` | `queue_military_production` | management | Queue military production and deliver ready payloads into a deployment hub |
| `refit_unit` | `refit_unit <building_id> <unit_id> <target_blueprint_id>` | `refit_unit` | management | Send a squad or fleet into authoritative refit |
| `refuel_mecha` | `refuel_mecha <fuel_item_id> [count] [--planet <planet_id>]` | `refuel_mecha` | management | 给我的机甲补能：烧最多 count 块燃料（缺省 1）直到核心充满 |
| `restore_construction` | `restore_construction <task_id>` | `restore_construction` | build | Restore a cancelled construction task |
| `scan_galaxy` | `scan_galaxy [galaxy_id]` | `scan_galaxy` | observe | 登记星系到星图（不改地表迷雾） |
| `scan_planet` | `scan_planet <planet_id>` | `scan_planet` | observe | 登记星球到星图（不改地表迷雾） |
| `scan_system` | `scan_system <system_id>` | `scan_system` | observe | 登记恒星系到星图（不改地表迷雾） |
| `set_energy_exchanger_mode` | `set_energy_exchanger_mode <building_id> <charge\|discharge\|standby> [--planet <planet_id>]` | `set_energy_exchanger_mode` | management | 切换蓄电器能量枢纽模式：charge 电网盈余充蓄电池，discharge 放电回电网，standby 不转换 |
| `set_rally_point` | `set_rally_point <building_id> <x> <y> [--planet <id>]` | `set_rally_point` | management | 设置出厂单位集结点 |
| `set_ray_receiver_mode` | `set_ray_receiver_mode <building_id> <power\|photon\|hybrid> [--planet <planet_id>]` | `set_ray_receiver_mode` | management | Switch ray receiver mode（按建筑所在行星结算） |
| `set_recipe` | `set_recipe <entity_id> [recipe_id] [--planet <planet_id>]` | `set_recipe` | management | 原地切换生产建筑/研究站配方；省略 recipe_id 时研究站回研究模式、生产建筑转空闲，切换后进度清零、库存保留 |
| `squad_order` | `squad_order <squad_id> <attack\|defend\|retreat\|resupply> [<x> <y>] [--planet <id>]` | `squad_order` | combat | 军团指令；resupply 自动前往最近补给站 |
| `start_research` | `start_research <tech_id>` | `start_research` | research | Start researching a technology |
| `switch_active_planet` | `switch_active_planet <planet_id>` | `switch_active_planet` | management | 切换自己的视图焦点/默认落点行星（不影响其他玩家；所有已加载行星始终结算） |
| `task_force_assign` | `task_force_assign <task_force_id> <squad\|fleet> <member_ids_csv> [--system <system_id>] [--planet <planet_id>]` | `task_force_assign` | combat | Assign one or more squads or fleets into a task force |
| `task_force_create` | `task_force_create <task_force_id> [--name <name>] [--stance <stance>]` | `task_force_create` | combat | Create a task force shell for squads and fleets |
| `task_force_deploy` | `task_force_deploy <task_force_id> [--theater <theater_id>] [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--frontline <frontline_id>] [--ground-order <order>] [--support-mode <mode>]` | `task_force_deploy` | combat | Set task force deployment intent, frontline order and orbital support mode |
| `task_force_set_stance` | `task_force_set_stance <task_force_id> <stance>` | `task_force_set_stance` | combat | Change task force doctrine and engagement posture |
| `theater_create` | `theater_create <theater_id> [--name <name>]` | `theater_create` | combat | Create a theater container for war zoning and objectives |
| `theater_define_zone` | `theater_define_zone <theater_id> <zone_type> [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--radius <n>]` | `theater_define_zone` | combat | Define or update one theater zone |
| `theater_set_objective` | `theater_set_objective <theater_id> <objective_type> [--system <system_id>] [--planet <planet_id>] [--entity <entity_id>] [--description <text>]` | `theater_set_objective` | combat | Set a theater objective anchor and description |
| `transfer` | `transfer <building_id> <item_id> <quantity> [--take] [--planet <planet_id>]` | `transfer_item` | management | 装料：默认把机甲背包物品装进建筑本地存储；加 --take 从建筑取进背包（受背包容量限制，按建筑所在行星结算） |
| `uninstall_logistics_bot` | `uninstall_logistics_bot <id> <quantity>` | `uninstall_logistics_bot` | management | 回收空载停靠的配送机器人至背包 |
| `upgrade` | `upgrade <entity_id> [--planet <planet_id>]` | `upgrade` | build | Upgrade building（按建筑所在行星结算） |

### 查询命令（26 条，agent 可用）

| 动词 | 用法 | 说明 |
|---|---|---|
| `health` | — | Server status and current tick |
| `metrics` | — | Runtime metrics |
| `summary` | — | Game summary (resources, players, map) |
| `stats` | — | Current player statistics |
| `briefing` | `briefing [alert_limit]` | One-shot agent briefing：我的机甲背包（完整）/ 作业、已完成科技与当前研究、告警（带 alert_type 与 building_id）、fleet/war/commands |
| `wait` | `wait <ticks <n>\|job\|build\|item <物品ID> <数量> [--in <建筑ID>]\|running <建筑ID>> [--timeout <秒>]` | 等到条件成立（轮询，默认 120s）：ticks=tick 前进 n（n 是 tick 数不是秒，秒 = n ÷ tick 速率；10 tick/s 时 wait ticks 500 = 50 秒）；job=我的机甲作业结束；build=我的机甲施工队列清空（缺料/无进展提前返回）；item=背包，或 --in 建筑的主库存 + 输出缓冲（inventory + output_buffer）合计达到数量（所以 inspect 里 inventory 17 + output 3 时 wait 20 已成立）；running=建筑进入 running |
| `catalog` | `catalog <buildings [关键词]\|building <id>\|recipes [--handcraft] [--building <type>] [关键词]\|items [关键词]\|techs [--available\|--done]\|units>` | 紧凑目录表：建筑造价/占地/解锁科技、配方、物品堆叠、科技成本、可生产单位（GET /catalog） |
| `galaxy` | — | Galaxy list |
| `system` | `system [system_id]` | System details (default: sys-1) |
| `system_runtime` | `system_runtime [system_id]` | System runtime state including fleets, contacts, blockades and battle reports |
| `planet` | `planet [planet_id]` | Planet summary (default: planet-1-1) |
| `planet_runtime` | `planet_runtime [planet_id] [--mine]` | Planet runtime: 施工队列（state/wait_reason/剩余 tick）、物流摘要、contacts / frontlines / ground task forces；--mine 只看自己机甲的施工任务 |
| `blueprints` | `blueprints [blueprint_id]` | List player warfare blueprints or inspect one blueprint in detail |
| `war_industry` | — | Military production, refit, deployment hub and supply node status |
| `task_forces` | — | Player-owned task force list with supply and command capacity |
| `theaters` | — | Player-owned theater zones and objectives |
| `scene` | `scene [planet] [x y width height] [--near_x X --near_y Y --radius R] [--json] [--limit N\|all]` | 局部场景紧凑文本（建筑/资源汇总/单位）；省略 planet = 我的机甲所在星球，省略窗口 = 机甲居中 48×48；--json 输出原始 JSON |
| `find_space` | `find_space <w> <h> [--count N] [--near X Y] [--radius R] [--spacing N] [--planet <id>] [--json]` | 找 w×h 全空矩形（按实际占地排除建筑、地面单位、未落成施工任务，地形须 buildable），按距锚点升序，每行同时给「距锚点」「距机甲」；省略 --near = 我的机甲，半径默认 48 最大 128；--spacing N 让任意两个候选的锚点曼哈顿距离 ≥ N（缺省不过滤，互不重叠至少 max(w,h)+1）；只返回不跨球面缝的矩形 |
| `plan` | `plan <build x y type \| upgrade building_id \| craft_item recipe batches>... [--planet <id>] [--json]  \|  plan -  \|  plan need <物品ID> <数量> [--from <配方ID>]` | 累计用料表：需要 / 背包 / 占用 / 缺口；craft_item <配方> <批数> 把 inputs×批数 计入需要（不算占用）；plan - 从 stdin 每行一条，; 也分隔；缺口沿可手搓配方递归展开到不可手搓/已有库存（最多 3 层），并给本方建筑取料来源（当前数量 + [够]/[不够，还差 N]）；plan need 按配方递归反推到基础原料（最多 6 层、配方环停止），给现有量与缺口，回答「造 N 个要备多少料」；有缺口时退出码非 0 |
| `inspect` | `inspect [planet] [building\|unit\|resource\|sector] <entity_id> [--json]` | 单个实体人话摘要（状态+原因、库存/缓冲、活跃告警）；省略 planet 同 scene，省略 kind 按 id 前缀推断；--json 输出原始 JSON。不显示库存容量/占用格数，容量查 catalog building <type> |
| `networks` | `networks [planet] [--json]` | 电网：每个网络的发电/用电/建筑数/缺电，以及未接网与欠电建筑；有管网时列出节点数（GET /world/planets/<id>/networks） |
| `fleet_status` | `fleet_status [fleet_id]` | Fleet list or one fleet detail |
| `fog` | `fog [planet_id] [x y width height]` | ASCII fog slice via /scene (default: 0 0 32 16) |
| `alerts` | `alerts [--after-id <id>] [--since-tick <n>] [--active-only] [--limit <n>]` | alert_snapshot 的别名：产线告警快照，每行带 alert_type 与 building_id；--active-only 只过滤已恢复的，老告警会一直挂着 |
| `save` | `save [--reason <text>]` | Trigger manual save |
| `checkpoint` | `checkpoint <list\|save <name>\|load <name>> [--note <text>] [--contract <file.json>] [--replace]` | 命名存档点：list 列出（登录即可），save 存当前对局（admin，regression 契约须全过；bug- 前缀只记录），load 热加载（admin） |

### 管理、调试与工具（28 条）

| 动词 | 用法 | 说明 |
|---|---|---|
| `catalog_commands` | — | Public command structure catalog (GET /catalog/commands) |
| `haul` | `haul <unit_id[,unit_id...]> --from <building_id> --to <building_id> [--item <item_id>] [--planet <planet_id>]` | 运输机器人往返搬运：起点建筑 → 终点建筑，--item 锁定单一物品（缺省自动选终点能收的第一种） |
| `auto_haul` | `auto_haul <unit_id[,unit_id...]> [--planet <planet_id>]` | 运输机器人切回全局自动搬运（出厂默认）：每 10 tick 按本行星缺料建筑派单，无需求时原地待命 |
| `feed` | `feed <建筑ID> <物品ID>[:数量][,物品ID[:数量]…] [--wait] [--fill] [--timeout <秒>] [--planet <行星ID>]` | 批量装料：把机甲背包里的多种物品累计装入建筑（数量按**本次命令累计装入量**算，不是建筑里的最终数量）。每轮对每项试一次，装入量以背包减少量为准；省略数量或 --fill = 一次装到当前输入窗口上限；--wait = 窗口满了等建筑消耗（默认 120s 超时），要求每项都写数量；STORAGE_FULL（装不下）才等，参数错误立即失败 |
| `drain` | `drain <建筑ID> [物品ID[:数量][,物品ID[:数量]…]] [--to <目标建筑ID>] [--timeout <秒>] [--planet <行星ID>]` | 批量取货/转运：不带物品列表 = 取空建筑 inventory + output_buffer 里所有物品（每轮重读，兼容持续产出）；不带 --to 取进机甲背包（背包满即失败并报已取出/源剩余）；--to = 经背包中转装进目标建筑，目标满（STORAGE_FULL）等消耗后重试，默认 120s 超时 |
| `raw` | `raw <json>` | Send raw /commands request JSON |
| `audit` | `audit [options]` | Query audit log |
| `event_snapshot` | `event_snapshot [options]` | Query event snapshot |
| `alert_snapshot` | `alert_snapshot [--after-id <id>] [--since-tick <n>] [--active-only] [--limit <n>]` | Query production alert snapshot（仍成立在前、最新在前；--active-only 只过滤已恢复的告警，不按时间过滤——一直没解决的产线问题会一直挂着，看发生时间用 --since-tick 或行内 tick） |
| `replay` | `replay [options]` | Replay tick range |
| `rollback` | `rollback [options]` | Rollback to tick |
| `advance` | `advance <ticks> [--to <tick>] [--no-stop-attack] [--no-stop-alert] [--no-stop-gameover] [--json]` | 狂飙模式：快进到目标 tick（admin）；默认在我方受袭/新出现的关键警报（缺电、缺料停工）/对局结束时提前停下 |
| `advance_cancel` | — | 取消进行中的快进（admin） |
| `help` | `help [command]` | Show help |
| `agent_list` | — | List agent-gateway agent profiles |
| `agent_create` | `agent_create <name> --provider <provider_id> [--role <worker\|manager\|director>] [--can-create-agents <true\|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]` | Create an agent-gateway agent profile bound to the current player key |
| `agent_update` | `agent_update <agent_id> [--role <worker\|manager\|director>] [--can-create-agents <true\|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]` | Patch agent-gateway agent policy or role |
| `agent_message` | `agent_message <agent_id> <content>` | Send one direct task message to an agent thread |
| `agent_thread` | `agent_thread <agent_id>` | Inspect one agent thread including messages, tool calls and logs |
| `switch` | `switch [player_id] [key]` | Switch player |
| `as` | — | — |
| `events` | `events [count]` | Show recent SSE events (default: 10) |
| `status` | — | Current player and connection status |
| `game_new` | — | — |
| `game_status` | — | — |
| `clear` | — | Clear screen |
| `quit` | — | Exit |
| `exit` | — | — |
<!-- END GENERATED COMMANDS -->
