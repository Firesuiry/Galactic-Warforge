# 错误码 → 修法

消息原文都是实测得到的。命令失败后**先读消息再改**，不要原样重发。

## 0. 先分清三种回执

| 你看到的 | 含义 | 怎么办 |
| --- | --- | --- |
| `ACCEPTED` 下面一行 `✓ OK: …` | 已经执行成功（`scripts/sw` 会等到执行完） | 继续 |
| `ACCEPTED` 下面一行 `✗ CODE: …` | 已入队，但执行失败 | 按下表修 |
| `REJECTED … VALIDATION_FAILED` 带 `issues`（字段名） | 结构不对，**整批都没有入队** | 补字段后整批重发 |
| `… 未在 8s 内执行` | tick 没在走，或者服务端卡住 | `health` 看 tick 有没有变 |

- 成功也要看清回执里的后缀。例如 `施工任务已排队…；背包料已被前面的施工任务占用，本任务将等料（缺：铁块 2）` 表示任务排上了，但要等你补料。
- 事后对账：`audit --request <request_id>`，或 `audit --limit 20` 看自己最近的命令（每条带 stage、command_index、code）。

## 1. 最常见的四种

### `INSUFFICIENT_RESOURCE`（缺料）

| 消息 | 原因 | 修法 |
| --- | --- | --- |
| `背包缺：电路板 4、齿轮 2` | build / upgrade / craft_item：**我的机甲**背包不够。消息会一次列全缺口 | 按缺口一次补齐：`transfer <仓库> <物品> N --take` 取，或 `craft_item` 搓，或 `mine_resource` 采 |
| `机甲背包需有 N 个「X」，当前 M 个` | transfer 装料（背包 → 建筑） | 先取料或手搓 |
| `<建筑>里没有可取出的「X」` | `transfer --take`，建筑里没有这种货 | `inspect <建筑>` 看库存；生产建筑的产出可能还没出炉 |
| `背包已满（已用 N/M 格）…` | 背包格数满了 | 先把不用的货装进仓库；每格能堆的件数见 `catalog items` |
| `生产建筑缺少 N 个「X」` | `produce` 扣的是**建筑自己的库存**，不是背包 | 先 `transfer <建筑> <物品> N` 装进去 |
| `资源节点剩余量少于请求数量` | mine_resource | 减少数量，或者换个矿点 |
| `机甲核心能量不足…` | 机甲移动或攻击时能量不够 | `refuel_mecha coal 4`，或者靠近电力感应塔充电 |

### `POSITION_OCCUPIED`（占位）

| 消息 | 原因 | 修法 |
| --- | --- | --- |
| `该格已有你的建筑：电弧熔炉` | 新建筑占地里**任意一格**已有建筑。注意 `x y` 是左上角 | 用 `catalog building <id>` 查占地，重算位置，见 [logistics.md](logistics.md) 第 1 节 |
| `该格已有你的施工任务：X（排队中）` | 那里已经有你下过的施工单 | 等它落成，或者 `cancel_construction <task_id>` |
| `上方有高架传送带` / `第 N 层…` | 和架高的传送带冲突 | 换层，或者换格子 |

### `INVALID_TARGET`（目标不合法，分几类）

| 消息 | 原因 | 修法 |
| --- | --- | --- |
| `机甲已有作业，请先取消` | 机甲正在手搓或采矿，又发了 craft_item / mine_resource | `mecha list` 看作业列，等它结束。要么一次把批次发够；要么 `cancel_mecha_job`，未完成批次的原料会退回。build、transfer 不受这个限制 |
| `会把…四周完全堵死` / `…切断通路（最后通道 x,y）` / `…封死基地通路` | 围死判定 | 往远离消息里那个坐标的方向挪 1–2 格 |
| `mining_machine 占地及外圈没有可开采的资源节点` | 采矿机没压到矿 | 用 `scene` 找矿点，让矿点落在 3×3 占地或外 1 圈里 |
| `生产设施未运行：under_power` 等 | 目标建筑没电或暂停 | `inspect <建筑>` 看原因，`networks` 看电网 |
| `该配方不可手工制造` | 配方不能手搓，或者配方 ID 写错了（磁铁是 `smelt_magnet`，不是 `magnet`） | `catalog recipes --handcraft` |
| `X需由Y生产` | produce 用错了建筑 | `catalog units` 看 producer 列 |
| `只能从存储建筑取出物品` | `--take` 的目标没有存储 | 换一个仓库或生产建筑 |
| `矩阵研究站处于研究模式，只接受矩阵…` | 往研究站里装了别的东西 | 改送到制造台或仓库 |
| `建筑须处于 idle 状态才能升级` / `…才能拆除` | 建筑正在运行 | 等它空闲 |

### `VALIDATION_FAILED`（参数、未知 ID、科技未解锁）

| 消息 | 修法 |
| --- | --- |
| `未知建筑类型：storage` | ID 以 `catalog buildings` 为准，例如小型储物仓是 `depot_mk1` |
| `未知配方` / `配方「X」不适用于Y` | `catalog recipes --building <type>` |
| `小型储物仓需先研究解锁` / `配方需先研究解锁` / `该单位需先研究解锁` | 用 `catalog building <id>` 看解锁科技（满足任意一个即可），再研究 |
| `前置科技未满足` | `catalog techs --available` 列出当前能研究的科技 |
| `需要至少一台运行中的研究站…` / `研究站中缺少「电磁矩阵」` | 研究站要通电、不设配方（`set_recipe <lab>`）、站内有矩阵（`transfer <lab> electromagnetic_matrix N`） |
| `payload.quantity 必须为正整数` | craft_item 的数量是**批数**，要大于 0 |
| `目标建筑没有存储` | 传送带不能 transfer，见 [logistics.md](logistics.md) 第 3 节 |
| `该物品不能作为机甲燃料` | 燃料：煤 25、木头 15、高能石墨 50、氢 30……（`catalog items` 看燃料值） |

## 2. 机甲与发令者

| 码 | 消息 | 修法 |
| --- | --- | --- |
| `EXECUTOR_UNAVAILABLE` | `<你> 还没有绑定机甲：先用 assign_mecha 接管一台` | `mecha list` 找空闲机甲，`mecha assign <id>`。没有空闲的，就到基站造：见 [multi-agent.md](multi-agent.md) |
| `EXECUTOR_UNAVAILABLE` | `你的机甲 u-x 在 planet-y，不在本星球` | 命令加 `--planet <机甲所在星球>`，或者不写星球（默认落在机甲所在星球） |
| `EXECUTOR_UNAVAILABLE` | `机甲 u-x 已阵亡，tick N 复活` | 等它复活（背包会保留），或者先接管另一台空闲机甲 |
| `NOT_OPERATOR` | `N 台机甲由其他发令者操作，已跳过` | 只指挥自己的机甲。别人的机甲不要动；确实要用，就和对方协调后用 `mecha assign` |
| `OUT_OF_RANGE` | `超出机甲作业范围：85 > 18` | 目标在基站覆盖（72）外，而机甲离它超过 18 格：先 `move <我的机甲> x y` 开过去 |
| `OUT_OF_RANGE` | `资源须在 6 格地表范围内` | mine_resource 前，先把机甲开到矿点 6 格内 |
| `EXECUTOR_BUSY` | `机甲正忙` | upgrade、demolish 并发已满（每台机甲 2 个），等一下再发 |

需要机甲才能执行的命令：build、upgrade、demolish、transfer、mine_resource、craft_item、cancel_mecha_job、refuel_mecha、configure_mecha_logistics、install_logistics_*（从背包装）、queue_military_production、refit_unit。
不需要机甲的命令：produce、start_research、move、attack、order、查询。

## 3. 其它码

| 码 | 含义 |
| --- | --- |
| `DUPLICATE` | request_id 重复（`scripts/sw` 每次自动生成新的），或者科技已经在研究、建筑已有进行中的作业 |
| `ENTITY_NOT_FOUND` | ID 不存在或已被拆掉。重新 `scene` 取 ID，不要用记在缓存里的旧 ID |
| `NOT_OWNER` | 那是别的玩家的东西 |
| `INVALID_ELEVATION` | 只有传送带能架高，高度 0–4，架高必须写 `--direction` |
| `GAME_FINISHED` | 胜负已定，停止下令，写战报 |

## 4. 隐蔽失败（回执是 OK，但事没办成）

1. **连发建造等料**：回执带「本任务将等料」时，任务停在 `pending / insufficient_materials`。用 `planet_runtime --mine` 看自己的施工队列和 `wait_reason`。
2. **分拣器没连上**：建成了，但两端没有都连上，就一件货都不搬，也**不报警**（端点缺失不计数）。建完等 20 tick，`inspect <分拣器>` 确认有搬运记录。
   - 反过来，两端都连上了却连续 300 tick 没搬成，会发 `sorter_stalled`（见下一条）。
3. **采矿机没出口**：几 tick 就被自己的产出堵死，告警是 `output_blocked`。
4. **带子对着熔炉**：传送带不给建筑喂料，货会堵在带上。
5. **建筑没电**：`inspect` 显示 `no_power`，原因写在后面。
6. **分拣器告警 `sorter_stalled`**：两端都已连上，但连续 300 tick 没搬成。**先查断电 / 堵塞 / 下游满，不要先怀疑摆位**：`inspect <分拣器>` 看 `state`（`no_power` 就是断电）与 `alerts` 行，`alerts --active-only` 看 `reason`——`no_power` 接电网，`drop_blocked` 清下游库存，`pick_empty` 查上游带子是否断料或过滤把货全挡了。摆位问题不会报这条（端点缺失时压根不计数）。
