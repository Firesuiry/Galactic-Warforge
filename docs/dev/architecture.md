# 架构

项目定位见根目录 [README](../../README.md)。本文描述系统边界、模块划分、数据流和当前能力边界。

## 1. 设计原则

- **服务端权威**：世界状态只能由服务端 Tick 结算改变；客户端只提交意图。
- **命令驱动**：所有操作统一走 `POST /commands`，服务端做鉴权、结构校验、入队和结算，不区分人类命令与 AI 命令。
- **逻辑与表现解耦**：服务端不绑定渲染；Web / CLI / agent 是同一命令面的不同前端。
- **可回放、可审计**：命令日志、快照、审计、回放、回滚都在服务端。
- **AI 职责外置**：提示词、记忆、模型调用、多轮规划放在客户端侧（`agent-gateway`）；服务端内置的只有确定性遭遇战 bot。
- **数据驱动**：物品、配方、科技、建筑、单位、战斗系数、战争蓝图都在 `server/data/*.yaml`，见 [数据配置文件](数据配置文件.md)。
- **激进演进**：不保证版本兼容，不写兼容层（见 AGENTS.md）。

## 2. 仓库结构

| 目录 | 语言 | 职责 |
| --- | --- | --- |
| `server/` | Go | 权威游戏服务端：规则、结算、HTTP/SSE 网关、存档 |
| `shared-client/` | TS | Web 与 CLI 共用的类型、HTTP/SSE API 层、公开命令目录 `command-catalog.ts` |
| `client-web/` | TS / React | 可视化客户端，见 [client-web](client-web.md) |
| `client-cli/` | TS | 命令行客户端与 REPL，也是 agent 执行游戏命令的受控运行时，见 [客户端CLI](客户端CLI.md) |
| `agent-gateway/` | TS | 本地 AI 运行时：Provider、智能体、会话、定时任务，见 [agent-gateway](agent-gateway.md) |
| `scripts/` | Py / JS | 本地试玩启动、命令覆盖率与文档生成、浏览器回放脚本 |
| `develop_tools/` | 多种 | DSP 目录对齐工具、试玩视频工具等 |
| `docs/` | — | 文档（索引见 [docs/README](../README.md)） |

## 3. 服务端

### 3.1 包划分（`server/internal/`）

| 包 | 职责 |
| --- | --- |
| `startup` | 加载配置，决定新建或续档，组装可热重置的运行时（`POST /games/new`） |
| `config` / `mapconfig` | 服务端配置（`config*.yaml`）与地图配置（`map*.yaml`） |
| `gateway` | HTTP 路由、鉴权、限流、SSE、命令结构预检（`server.go`） |
| `queue` | 命令队列 |
| `gamecore` | Tick 循环、命令执行（`core.go` 分发）、结算管线（`settlement_pipeline.go`）、bot、审计、回放、回滚 |
| `model` | 世界状态与领域类型；YAML 数据注册表（`gamedata.go`）；公开命令目录（`command_catalog.go`） |
| `query` | 只读投影：summary、briefing、catalog、scene、inspect、networks、path、runtime 视图 |
| `mapgen` / `mapmodel` / `mapstate` | 星系/恒星/行星/资源生成、宇宙模型、探索状态；配了 `spawn_points` 的地图还会做可玩性连通性保证（`connectivity.go`：出生点/争夺中心通路、就近开局原矿、封死 <200 格孤立陆地） |
| `surface` / `terrain` | 六面立方体球面网格（面序、跨面邻接、坐标转换）与地形 |
| `visibility` | 战争迷雾 |
| `snapshot` / `persistence` / `gamedir` | 快照克隆、存档（gzip `save.json` + `meta.json`）、游戏目录读写 |

入口：`server/cmd/server`（服务端）、`server/cmd/catalogdump`（导出权威目录 / 公开命令目录为 JSON）。

### 3.2 Tick 与结算

- 每 tick 先执行队列中的命令，再按结算管线依次跑各阶段：
  1. `construction`：施工队列、建筑任务；
  2. `research_and_dyson`：研究、军工、太阳帆、戴森结构；
  3. `planetary_runtime`（所有已加载行星）：机甲、发电、射线接收、护盾、资源、物流充电、轨道采集、传送带、分拣器、建筑 IO、管线、生产、喷涂、分馏、物流站、仓储、单位生产、弹药补给、炮塔、单位移动、单位交战等；
  4. `bots`：遭遇战 bot 决策（与玩家走同一命令队列）；
  5. `interstellar_runtime`：星际物流、舰队；
  6. `active_world_runtime`：焦点行星相关的剩余结算。
- 命令生命周期：`POST /commands` 同步返回 `accepted`（只表示入队）→ tick 内执行 → SSE `command_result` 给出最终结果。
- 行星路由：命令按 `target.planet_id` → 实体所在行星 → 玩家焦点行星（`switch_active_planet`）解析；所有已加载行星都结算。

### 3.3 对外接口

- HTTP 查询：`/state/*`、`/world/*`、`/catalog*`、`/events/*`、`/alerts/*`、审计/回放/存档等。
- SSE：`/events/stream` 推送游戏事件。
- 详见 [服务端API](服务端API.md)；命令一览由 `scripts/gen_command_docs.py` 从 `GET /catalog/commands` 同源数据生成。

## 4. 客户端侧

- **命令目录单一真相**：服务端 `command_catalog.go`（结构）+ `shared-client/src/command-catalog.ts`（API 名 → CLI 动词、分类、层级、Web 暴露要求）。`python3 scripts/command_coverage.py --check` 校验 server / shared / CLI / agent / GUI 覆盖，并检查生成文档是否过期。
- **client-web**：通过 Vite 代理按路径前缀（`/state`、`/world`、`/catalog`、`/events`、`/commands` 等）访问服务端，`/agent-api` 转发到 agent-gateway。
- **client-cli**：REPL + 一次性命令；agent-gateway 在进程内调用 CLI 的命令分发器执行游戏动作（P2 计划解耦到 shared-client）。
- **agent-gateway**：不属于服务端；按 `policy` 对 agent 做命令类别、星球范围、军事战区/任务群的运行时硬限制。

## 5. 世界与交互模型

- 三层地图：银河 → 恒星系 → 行星。行星是封闭的六面立方体球面网格（`surface.topology = cube_sphere`，`map_width=3N`、`map_height=2N` 为存储图集尺寸），跨面邻接与寻路由 `surface` 包定义，细节见 [3D与画质](../guide/3D与画质.md)。
- 玩家是“上帝视角指挥者”，机甲（执行体）是英雄单位：采集、手搓、战斗、在 HQ 复活；建造按建造中心半径判定，机甲操作范围仅作兜底。
- 经济：实物物品是 DSP 工业链与军事单位造价的唯一形态；`minerals`/`energy` 为指挥资源。
- 对手：黑雾（常驻 PvE）、遭遇战 bot（`players[].bot`）、PvP，三者可并存。设计拍板见 [对局设计决策](../guide/对局设计决策.md)。

## 6. 战争系统概览

战争是工业的延伸：`产线 → 单位/弹药 → 补给 → 交战`，战斗力 = 产能 × 补给。

- **主线**：世界单位（`model.Unit`，兵营/战车工厂/机场生产），随身三类弹药（子弹/炮弹/导弹），补给站与补给车补弹，军团作为命令容器。
- **后期**：战争蓝图（底盘/船体 + 组件，七类预算校验，`draft → … → adopted` 生命周期）→ 军工量产 → 部署为小队或舰队；任务群、战区、轨道封锁、传感器情报分级。
- 运行态：行星 `WorldState`（单位、建筑、小队、前线）；恒星系 `SpaceRuntime`（舰队、封锁、战报）。

完整说明见 [战争系统设计](战争系统设计.md)。

## 7. 与《戴森球计划》的关键差异

- 多人、命令驱动的服务器，而非单机机甲视角。
- 行星是封闭球面六面网格，不是无限平面。
- 战斗和敌对势力权重更高，工业与战争深度耦合（单位实物造价、弹药补给）。
- 交互面向 API / CLI / Web / AI，而非单一图形前端。
- DSP 行星内内容（物品、配方、科技、建筑）以官方目录为对齐目标，范围与验收见 [星球玩法覆盖与验收](../guide/星球玩法覆盖与验收.md)。

## 8. 能力边界

已形成的闭环：

- 研究 → 解锁 → 建造；发电 → 电网 → 运行；采矿 → 传送带/分拣器/物流 → 冶炼/生产；仓储、管线、喷涂、分馏、物流站与配送器。
- 弹药补给与多兵种地面战、军团、防御与防空、黑雾、遭遇战 bot、大厅与新局热重置、结算页。
- 官方中后期场景（`config-midgame.yaml + map-midgame.yaml`）：轨道采集 → 太阳帆/戴森脚手架 → 火箭发射 → 射线接收。
- 官方战争场景（`config-war.yaml + map-war.yaml`）：蓝图 → 量产 → 部署 → 任务群/战区 → 封锁。
- 已加载多行星并行结算 + 同星系星际物流最小闭环。

主要缺口（条目化见 [缺失内容清单](../guide/缺失内容清单.md)）：

- 多星球殖民、跨星远征、玩家对玩家太空战尚未形成（第二阶段）。
- `build_dyson_*` / `demolish_dyson` 仍是不扣材料的脚手架，戴森球未材料化、未作为胜利条件（第三阶段）。
- 中后期与战争闭环主要依赖官方场景验证，普通新局自然推进到这里仍需打磨。
- 结构性重构（命令注册表统一、`rules.go` 拆分、model 拆包、bot 子包化等）见 [重构方案](../guide/重构方案.md)。
