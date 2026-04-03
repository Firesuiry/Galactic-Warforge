# SiliconWorld 当前版本与《戴森球计划》差异调研

更新时间：2026-04-03

## 1. 调研范围与方法

本报告用于回答两个问题：

1. 当前 SiliconWorld 服务端和《戴森球计划》相比，核心差别是什么。
2. 当前版本哪些部分还没有实现，或者虽然存在数据结构/底层逻辑，但玩家实际上还到不了。

本次结论以 `server/` 实现为准，文档仅作为辅助参考。调研中重点核对了以下部分：

- 启动与存档：`server/cmd/server/main.go`、`server/internal/startup/game.go`
- 网关与命令入口：`server/internal/gateway/server.go`、`server/internal/model/command.go`
- Tick 主循环：`server/internal/gamecore/core.go`
- 世界与查询层：`server/internal/model/world.go`、`server/internal/query/runtime.go`、`server/internal/query/networks.go`
- 研究、生产、物流、战斗、戴森系统：`server/internal/gamecore/*.go`、`server/internal/model/*.go`

另外做了两类验证：

- 测试验证：`cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./...`
- 本地服务端运行复核：启动临时服务后检查 `/health`、`/catalog`、`/state/summary`、`/world/galaxy`、`/world/planets/{planet_id}/runtime`

## 2. 总体判断

当前版本不是《戴森球计划》的原样服务端复刻。

它更接近一个：

- 多人
- 阵营对抗
- API/命令驱动
- 2D 平面地图
- 单 active planet 全量模拟
- 工业生产 + 防御/战争

的服务器化工业战争游戏。

如果按《戴森球计划》的体验结构来衡量，当前版本已经具备“单星球前中期工业链 + 收敛版物流站闭环 + 一部分戴森结构 + 更重的战争框架”，但还没有进入 DSP 式的完整后期体验。

## 3. 与《戴森球计划》的核心差异

### 3.1 不是机甲视角，而是命令驱动的多人服务器

当前系统的玩家状态核心是 `PlayerState`、`ExecutorState`、权限与队伍，而不是 DSP 那种单人机甲直接操作。

证据：

- `server/internal/model/world.go`
- `server/internal/model/command.go`
- `server/internal/gateway/server.go`

这意味着它天然偏向：

- 多人协作或对抗
- 外部客户端或 AI 发命令
- 服务器权威状态同步

而不是 DSP 原版的单机实时操作体验。

### 3.2 星球是 2D 网格，不是球面铺设

世界状态由 `PlanetID`、`MapWidth`、`MapHeight`、`Grid` 组成，本质上是平面格子地图。

证据：

- `server/internal/model/world.go`

这和《戴森球计划》最核心的建造体验差异很大。DSP 的传送带、建筑朝向、极区/经纬度布局、球面铺设约束，在当前实现里都被简化成 2D 平面规则。

### 3.3 当前完整模拟只围绕一个 active planet

查询层的 `PlanetRuntime` 和 `PlanetNetworks` 都先读取 `ws.PlanetID`，只有请求的星球等于当前 active planet 时，才返回完整运行态与网络态。

证据：

- `server/internal/query/runtime.go`
- `server/internal/query/networks.go`

本地运行复核时，`/state/summary` 也显示当前只有一个 `active_planet_id=planet-1-1`。

这说明当前更像“全宇宙可发现，但只有一个活跃经营现场”，而不是 DSP 那种多星球长期并行经营。

### 3.4 战斗和敌对势力比 DSP 更重

主循环里除了工业结算，还有敌袭、炮塔自动攻击、轨道平台结算、战斗科技与轨道战斗框架。

证据：

- `server/internal/gamecore/core.go`
- `server/internal/gamecore/combat_settlement.go`
- `server/internal/gamecore/enemy_force_settlement.go`
- `server/internal/gamecore/orbital_settlement.go`
- `server/internal/gamecore/combat_tech_settlement.go`

DSP 原版虽有黑雾版本的战斗扩展，但当前项目从服务端结构上看，战争系统的重要性已经明显高于原版工业沙盒默认权重。

### 3.5 交互方式是 HTTP + 命令，不是完整图形前端

网关暴露的是：

- 状态查询
- 场景查询
- 网络查询
- 事件流
- 命令投递

证据：

- `server/internal/gateway/server.go`

因此当前项目更像一个“可由 CLI、Web 或 AI 驱动的 headless game server”。

## 4. 当前已经实现到什么程度

虽然它和 DSP 差异明显，但并不是空框架。当前版本已经打通了一个可运行的工业主循环。

### 4.1 Tick 主循环已经形成完整工业结算链

主循环中已经串起以下阶段：

- 施工队列
- 建筑作业
- 科研推进
- 发电与电网
- 射线接收站
- 太阳帆结算
- 戴森球结算
- 采矿/资源结算
- 轨道采集器
- 传送带
- 分拣器
- 建筑 IO
- 管线流动
- 生产周期
- 仓储
- 物流调度
- 物流无人机/货船移动
- 炮塔与敌袭

证据：

- `server/internal/gamecore/core.go`

### 4.2 命令链路已经打通

当前命令枚举包含：

- `build`
- `move`
- `attack`
- `produce`
- `upgrade`
- `demolish`
- `configure_logistics_station`
- `configure_logistics_slot`
- `scan_galaxy`
- `scan_system`
- `scan_planet`
- `cancel_construction`
- `restore_construction`
- `start_research`
- `cancel_research`
- `launch_solar_sail`
- `build_dyson_node`
- `build_dyson_frame`
- `build_dyson_shell`
- `demolish_dyson`

证据：

- `server/internal/model/command.go`

### 4.3 内容表已经铺开

本地服务端运行复核时，`/catalog` 返回的统计为：

- 建筑：62
- 物品：55
- 配方：34
- 科技：105

这说明系统已经覆盖了较多中后期名词和定义，但“有定义”不等于“玩家能完整玩到”。

## 5. 当前最关键的未实现或未闭环部分

本节是本次调研的核心。

这里要严格区分四种状态：

- 仅有名词或数据定义
- 模型层存在
- 主循环已接线
- 玩家可在正常游玩中触达

当前最大的问题不是“完全没有写”，而是“很多内容停留在定义层或局部结算层，没有形成玩家闭环”。

### 5.1 多星球完整经营没有打通

当前有银河、恒星系、行星扫描命令，也能查询星图信息：

- `scan_galaxy`
- `scan_system`
- `scan_planet`

证据：

- `server/internal/model/command.go`
- `server/internal/gamecore/scan.go`

但是：

- 没有看到玩家切换 active planet 的公开命令
- 没有看到跨星球迁移与长期经营闭环
- 查询层对非 active planet 只返回有限视图，不返回完整 runtime/network

证据：

- `server/internal/query/runtime.go`
- `server/internal/query/networks.go`

因此当前和 DSP 最大的缺口之一，就是“多星球同时发展”还没有真的成立。

### 5.2 单星球内的物流玩家闭环已经打通，但多星球物流仍未成立

这部分已经不再是“只停留在模型层”。当前版本里，玩家已经可以在 active planet 内完成一套收敛版的 DSP 式物流闭环。

当前已经可达的能力包括：

- 命令枚举与网关预校验里，已经公开 `configure_logistics_station` 和 `configure_logistics_slot`
- `configure_logistics_station` 可调整无人机容量、输入优先级、输出优先级；星际物流站还可调整 `interstellar.enabled`、`interstellar.warp_enabled`、`interstellar.ship_slots`
- `configure_logistics_slot` 可按 `planetary` 或 `interstellar` 作用域，为某个 `item_id` 设置 `none|supply|demand|both` 与 `local_storage`
- 行星物流站与星际物流站完工时，会自动补齐默认容量对应的无人机；星际物流站还会自动补齐默认货船；拆站时也会同步清理这些物流单位
- e2e 已覆盖“源站 supply + 目标站 demand 后，下一 tick 自动派出 carrier 并完成投递”的路径，行星物流与同 active planet 内的星际站调度都已可触达

证据：

- `server/internal/model/command.go`
- `server/internal/gateway/server.go`
- `server/internal/gamecore/rules.go`
- `server/internal/gamecore/construction.go`
- `server/internal/gamecore/building_jobs.go`
- `server/internal/gamecore/logistics_dispatch.go`
- `server/internal/gamecore/logistics_interstellar_dispatch.go`
- `server/internal/gamecore/e2e_test.go`

因此，至少对“单星球内的物流相关内容”来说，当前版本已经不是“玩家几乎碰不到”，而是已经可以完成：

- 造物流站
- 配物流站参数
- 配具体物品的供给/需求槽位
- 等自动配送自己跑起来

但它仍然不是 DSP 完整版物流体验，剩余边界主要在这里：

- 这套闭环最完整的范围仍是当前 active planet；非 active planet 仍然不返回完整 runtime/network，也没有同等级持续经营
- 尚无公开的 active planet 切换与多星球长期经营路径，所以“星际物流”目前更接近当前 active planet 内可操作的星际站调度能力，而不是多基地常驻物流网络
- 向玩家开放的物流参数仍是收敛版，不是 DSP 那套完整的每槽位/每载具全参数面板

本地运行复核里的默认新档仍可能看到：

- `logistics_stations=0`
- `logistics_drones=0`
- `logistics_ships=0`

但这只说明玩家还没有造站或配置，不再能据此推出“物流玩家闭环未打通”。

### 5.3 科研不是 DSP 式矩阵实物消耗，而是抽象研究点

`calculateTechCost()` 的实现只是把科技成本中的数量相加，然后乘固定倍率，作为研究总点数。

证据：

- `server/internal/gamecore/research.go`

代码注释里也明确说明：

- 科技成本原本是矩阵物品
- 但当前系统把它们简化为 `research points`

这和 DSP 的关键体验差异非常明显。

在《戴森球计划》里，研究中心会真实消耗矩阵物品；而当前版本更像“研究配方名义上存在，实际只做点数累计”。

### 5.4 矩阵体系不完整，晚期科研链不自洽

当前物品表里只有：

- `matrix_blue`
- `matrix_red`
- `matrix_yellow`
- `matrix_universe`

证据：

- `server/internal/model/item.go`

当前配方表里也只有这四类矩阵配方：

- 蓝矩阵
- 红矩阵
- 黄矩阵
- 白矩阵

证据：

- `server/internal/model/recipe.go`

但科技树大量晚期科技成本里使用了：

- `information_matrix`
- `gravity_matrix`

证据：

- `server/internal/model/tech.go`

例如：

- `corvette`
- `destroyer`
- `artificial_star`
- `universe_matrix`

这些科技都在成本或前置中直接引用了 `information_matrix` 或 `gravity_matrix`。

这就导致当前科技体系存在明显断裂：

- 科技表假设紫矩阵、绿矩阵已经存在
- 但物品表和配方表里没有对应实物与生产链

因此很多后期科技从系统一致性上看，是不可正常完成的。

### 5.5 白矩阵实现也不是 DSP 原版逻辑

当前 `matrix_universe` 配方需要：

- 蓝矩阵
- 红矩阵
- 黄矩阵
- 奇异物质
- 反物质

证据：

- `server/internal/model/recipe.go`

这不是 DSP 原版完整矩阵链。原版白矩阵建立在前五色矩阵体系上，而这里是简化版后期配方。

说明当前版本对后期科研线做了较强抽象和裁剪。

### 5.6 高级战斗单位没有生产闭环

科技树里已经有：

- `corvette`
- `destroyer`

而且这些科技会解锁单位。

证据：

- `server/internal/model/tech.go`

但 `produce` 命令当前只允许生产：

- `worker`
- `soldier`

证据：

- `server/internal/gamecore/rules.go`

因此现状是：

- 高级战斗单位在科技树里“存在”
- 但玩家没有生产这些单位的实际命令链路

这类内容属于典型的“定义存在，但玩法闭环未接通”。

### 5.7 战斗科技系统存在，但没有接入玩家主流程

`CombatTechManager` 已经支持：

- 开始研究
- 推进研究
- 完成后给单位套效果

证据：

- `server/internal/gamecore/combat_tech_settlement.go`

但当前命令枚举中没有对应的战斗科技研究命令，主流程也没有完整暴露给玩家。

证据：

- `server/internal/model/command.go`

因此战斗科技更像“服务端内部预备系统”，还不是当前玩家稳定可用的一条科技线。

### 5.8 轨道平台、编队、无人机控制仍有明显预留痕迹

轨道平台本身已经能参与轨道战斗结算，但同文件中还有明显“未来实现”的占位段落：

- 编队移动与协同暂时预留
- 无人机控制暂时预留

证据：

- `server/internal/gamecore/orbital_settlement.go`
- `server/internal/gamecore/combat_tech_settlement.go`

这说明战斗系统虽然比 DSP 更重，但它自己也还没有完全成型。

### 5.9 垂直发射井没有火箭入轨的玩家闭环

运行时定义里，`LaunchModule` 已经同时服务于：

- 电磁轨道弹射器
- 垂直发射井

而且发射井配置中已经预留：

- `RocketItemID`
- `ProductionSpeed`

证据：

- `server/internal/model/building_runtime.go`

但当前唯一公开的发射命令是 `launch_solar_sail`，而它在执行时又明确限制：

- 只有 `EM Rail Ejector` 可以发射太阳帆
- `Vertical Launching Silo` 预留给火箭

证据：

- `server/internal/gamecore/rules.go`

与此同时，命令枚举中并没有独立的“发射火箭/投送戴森组件”命令。

证据：

- `server/internal/model/command.go`

虽然戴森节点、框架、壳的建造命令已经存在，但这些命令本质上是直接操作戴森结构状态：

- `build_dyson_node`
- `build_dyson_frame`
- `build_dyson_shell`

证据：

- `server/internal/gamecore/dyson_commands.go`

因此当前的戴森建设并不是 DSP 原版那种：

- 生产火箭
- 送入发射井
- 火箭入轨投送组件

的完整物理链条。

### 5.10 蓝图能力停留在模型层，没有 API/命令入口

当前 `model` 层已经实现了：

- `CaptureBlueprint`
- `PlaceBlueprint`

证据：

- `server/internal/model/blueprint_ops.go`

但网关、命令枚举、核心执行层里没有蓝图入口。

证据：

- `server/internal/gateway/server.go`
- `server/internal/model/command.go`

因此蓝图目前属于“底层能力已准备，但玩家不可用”。

## 6. 当前版本更像什么

如果一定要用一句话概括：

当前 SiliconWorld 更像一个“受《戴森球计划》启发的多人工业战争服务端”，而不是“DSP 完整玩法的服务端复刻”。

它已经具备这些特征：

- 单星球工业主循环
- 研究、建造、发电、采集、生产、输送的基础闭环
- 太阳帆与戴森结构的部分后期目标
- 比 DSP 更强的战争、敌袭、阵营对抗倾向

但它距离 DSP 经典完整体验仍差以下几块核心拼图：

1. 多星球长期并行经营
2. DSP 式更完整的物流参数面板与真实跨星球基地调度
3. 真实矩阵物品消耗科研
4. 完整紫矩阵/绿矩阵及其后期科技链
5. 火箭驱动的戴森结构建设链
6. 护卫舰/驱逐舰等高级单位生产闭环
7. 蓝图、编队、无人机控制等高级玩法入口

## 7. 建议的后续补齐顺序

如果后续目标是向《戴森球计划》体验靠近，建议优先顺序如下：

1. 先修科研闭环：把矩阵从“研究点名称”恢复成真实物品消耗，并补齐紫矩阵、绿矩阵物品与配方。
2. 然后修多星球经营：补 active planet 切换、非活跃星球的持续经营策略，以及真正的跨星球基地管理。
3. 再扩物流系统：把当前 active planet 内可玩的收敛版物流，扩成更完整的 DSP 参数面板和真实跨星球长期调度。
4. 再补戴森火箭链：让发射井、火箭、戴森组件形成真实生产-运输-发射路径。
5. 最后补高级战争玩法：把护卫舰、驱逐舰、编队、轨道平台控制等连成玩家可操作闭环。

当前最不建议的做法，是继续只往科技表或建筑表里追加名词，而不先修闭环。否则“有定义、不可玩”的内容只会越来越多。

## 8. 本次调研的验证结论

本次调研结束时，已确认：

- `server` 全量 Go 测试通过
- 本地服务端可以正常启动
- 当前运行实例显示只有一个 active planet 进入完整模拟
- 默认新档的物流运行态通常仍为空，但代码与 e2e 已确认：一旦玩家造站并配置供需，同一 active planet 内的自动配送会启动

因此，本报告的核心结论是：

当前版本已经有一个可运行的工业战争基础盘。和《戴森球计划》相比，最大的差别仍然在多星球持续经营、真实矩阵科研与后期链路，而不再是“单星球内物流玩家完全不可达”。
