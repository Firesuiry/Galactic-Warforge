# 查询手册与下令前自检

所有命令都用 `scripts/sw <命令>` 执行（见 SKILL.md）。不写星球时，默认用**我的机甲所在星球**。

## 1. 每轮先看什么

| 目的 | 命令 | 看什么 |
| --- | --- | --- |
| 总览 | `briefing` | 我的机甲：背包（完整）、作业、位置；已完成科技、当前研究；告警（带 alert_type 和 building_id） |
| 机甲 | `mecha list` | 每台机甲的操作者、存活、背包格数、施工 pending/active、作业；底部一行是「我的机甲」 |
| 周边 | `scene [--limit all] [--json]` | 以我的机甲为中心的 48×48：建筑（ID、类型、锚点、占地、状态）、按种类汇总的矿点（格数、范围、代表矿点 ID）、单位。指定窗口：`scene 40 130 24 16`；要原始数据加 `--json`；**文本默认只列前 20 栋建筑**，超出用 `--limit all` |
| 单个实体 | `inspect <ID>` | 状态和原因、配方与进度、库存和输出缓冲、活跃告警；机甲显示作业；分拣器显示两端连到了谁。按 ID 前缀自动判断类型 |
| 我的施工队列 | `planet_runtime --mine` | 每个任务的状态、`wait_reason`（缺料、并发满、区域满、占地上站着单位） |
| 电网 | `networks` | 每个电网的发电、用电、缺不缺电；没接上电的建筑 |
| 告警 | `alerts --active-only` | 还在发生的产线问题 |
| 命令结果 | `audit --limit 20` / `audit --request <id>` | 我最近的命令：stage、序号、结果码、消息 |
| 等一件事 | `wait job [--timeout 秒]` / `wait build` / `wait item <物品> <数量> [--in <建筑>]` / `wait running <建筑>` / `wait ticks <n>` | 条件满足就返回；缺料或卡住会提前返回并说明原因，不用空转轮询。默认超时 120 秒，大批量手搓要加 `--timeout 300` |
| 找空地 | `find_space <宽> <高> [--count N] [--near x y]` | 全空矩形，按离机甲由近到远排；已排除建筑占地、单位和施工任务 |
| 算料 | `plan build <x> <y> <类型>; build …` | 累计用料表：需要 / 背包 / 已下任务占用 / 缺口；缺料时可手搓的会给出配方 |

## 2. 目录（造价、配方、科技）

| 命令 | 用途 |
| --- | --- |
| `catalog buildings [关键词]` | 建筑 ID、占地、造价、解锁科技、我是否已解锁 |
| `catalog building <id>` | 单个建筑：造价、占地、耗电或发电、IO 口、能跑的配方、科技前置 |
| `catalog recipes --handcraft` | 能手搓的配方（开局 14 条，见下） |
| `catalog recipes --building assembling_machine_mk1` | 某个建筑能跑的配方 |
| `catalog items [关键词]` | 物品 ID、每格堆叠上限、燃料值 |
| `catalog techs --available` / `--done` | 现在能研究的科技（成本**已按本局研究节奏缩放**，不要再乘倍率）/ 已完成的科技 |
| `catalog units` | 能生产的单位：生产建筑、成本、时长 |

开局可手搓、无科技门槛的配方：

| 配方 | 输入 → 输出 | 时长 |
| --- | --- | --- |
| `smelt_iron` | 铁矿 → 铁块 | 60 |
| `smelt_copper` | 铜矿 → 铜块 | 60 |
| `smelt_magnet` | **铁矿** → 磁铁 | 60 |
| `smelt_stone` | 石矿 → 石材 | 50 |
| `gear` | 铁块 → 齿轮 | 20 |
| `circuit_board` | 铁块 + 铜块 → 电路板 | 30 |
| `magnetic_coil` | 磁铁 ×2 + 铜块 → 磁线圈 ×2 | 30 |
| `glass` | 石矿 ×2 → 玻璃 | 50 |
| `prism` | 玻璃 ×3 → 棱镜 ×2 | 40 |

- 时长单位是 tick，表示每批的耗时。
- 手搓按**批**计算，同一时间一台机甲只能有一个作业。

## 3. 读数要点

- **背包**：按件计数；容量按**格**算，每格能堆 `stack_limit` 件（矿、锭 100，齿轮、电路板 200）。默认 40 格。
- **施工**：落成只要 1–2 tick，所以 `construction_active` 几乎总是 0。要看的是 `pending`，它代表在排队或缺料。
- **能量**：`briefing` 里的 `energy` 只是电网结余的展示，不是建造用的货币。这个游戏是**纯实物经济**，没有 minerals。
- **科技门槛**：建筑或配方满足**任意一个**解锁科技即可；研究科技要求前置**全部**完成。
- **矿点**：`scene` 里的矿点 ID（例如 `planet-1-1-res-1693`）就是 `mine_resource` 用的 ID，不是物品 ID。

## 4. 下令前自检

通用前置：`mecha list` 底部显示了「我的机甲」，且机甲存活。

### build
1. `catalog building <type>`：已解锁、造价、占地。
2. **先用 `plan` 算料**：`scripts/sw plan build <x> <y> <type>; craft_item <配方> <批数>`。它会把背包、已下未落成任务的占用、本批造价和手搓原料一起算，直接给出缺口，并递归提示缺口的基础原料从哪来。有缺口时退出码非 0。**有缺口先补料，不要带着缺口下单。**
3. **用 `find_space <w> <h> [--spacing n]` 找位置**，不要凭 `scene` 文本目测：`scene` 默认只列前 20 栋建筑，大基地会看不全。候选默认按离机甲由近到远排；加 `--spacing` 可要求候选之间至少相隔 n 格，避免拿到一片相邻格。
4. 在基站覆盖 72 格内；否则机甲要在 18 格内。
5. 采矿机要压到矿；生产建筑带上 `--recipe`。
6. 建好后附近有电（`networks`）。

### craft_item
1. 配方在 `catalog recipes --handcraft` 里。
2. 机甲没有在做别的作业（`mecha list` 的作业列为 `-`）。
3. 背包有 原料 × 批数。
4. 背包有空格放产出。

### transfer / transfer --take
1. 目标建筑有存储（传送带没有）。
2. 在基站覆盖内，或者机甲在 18 格内。
3. 装料：背包里有货；生产建筑每种原料只收配方用量的 2 倍。
4. 取料：建筑里确实有货（`inspect`），背包有空格。

### produce
1. 成本在**建筑库存**里，不在背包里。先用 `transfer` 装进去。
2. 建筑类型对得上（`catalog units` 的 producer 列），且建筑有电。

### start_research
1. `catalog techs --available` 里有它。
2. 研究站在运行（通电、不设配方），站内有成本里的矩阵。

## 5. HTTP 对照（脚本里直接调用时）

| CLI | HTTP |
| --- | --- |
| `briefing` | `GET /state/agent-briefing` |
| `summary` / `mecha list` | `GET /state/summary` → `players.<我>.mechas[]` |
| `scene` | `GET /world/planets/<id>/scene?x=&y=&width=&height=` |
| `inspect <id>` | `GET /world/planets/<id>/inspect?entity_kind=building&entity_id=<id>` |
| `planet_runtime` | `GET /world/planets/<id>/runtime` → `construction_tasks[]` |
| `networks` | `GET /world/planets/<id>/networks` |
| `catalog …` | `GET /catalog` |
| `alerts` | `GET /alerts/production/snapshot?active_only=true` |
| `audit` | `GET /audit?player_id=p1&issuer_id=<我>&order=desc&limit=20` |

鉴权头：`Authorization: Bearer <player_key>`。下令用 `POST /commands`，`request_id` 每次唯一；`issuer_type` 为 `agent`，`issuer_id` 填自己的名字。
