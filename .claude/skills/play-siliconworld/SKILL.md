---
name: play-siliconworld
description: Play SiliconWorld as a player via CLI/HTTP. Start local or official-war servers, authenticate, run briefing→decide→command loops, and follow newgame/midgame/war tactics. Use when asked to play, trial, fight a war, or drive the game as Claude Code.
---

# Play SiliconWorld

用 **CLI 或 HTTP** 当玩家打完一局。优先 CLI（有命令校验与统一格式化）；CLI 不便时用 `curl` 直打 server。

## 0. 先读

| 场景 | 文档 |
| --- | --- |
| 启动 | `docs/dev/本地试玩环境启动.md`、`scripts/start-local-playtest.sh` |
| 上手路径 | `docs/player/上手与验证.md` |
| 玩法总纲 | `docs/player/玩法指南.md` |
| 验收勾选 | `docs/player/试玩验收清单.md` |
| CLI 命令 | `docs/dev/客户端CLI.md` |
| HTTP API | `docs/dev/服务端API.md` |
| 已知问题 | `docs/player/issue/`、`docs/player/已知问题与回归.md` |

Go 路径：`PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH`。

## 1. 起服

工作目录始终是仓库根（本 skill 所在 repo）。**不要占用主仓正在用的端口**；试玩用独立 `data_dir`。

### 1.1 一键本地试玩（server + web + agent-gateway）

```bash
bash scripts/start-local-playtest.sh          # start
bash scripts/start-local-playtest.sh stop     # stop
```

默认：`server=18080`、`gateway=18180`、`web=5173`。可用 `SERVER_PORT` / `GATEWAY_PORT` / `WEB_PORT` 覆盖。

### 1.2 普通新局（只起 server）

```bash
cd server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-dev.yaml -map-config map.yaml
```

### 1.3 官方战争局（推荐 skill 对战验收）

```bash
# 默认端口 19481；脚本用临时 data_dir，退出即清理
bash server/scripts/start_official_war_test_server.sh 19481
```

等价手写：

```bash
cd server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-war.yaml -map-config map-war.yaml
```

### 1.4 官方 midgame

```bash
cd server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-midgame.yaml -map-config map-midgame.yaml
```

### 1.5 就绪检查

```bash
curl -fsS http://localhost:<port>/health
# 期望 {"status":"ok", ... tick 前进}
```

## 2. 账号与鉴权

默认配置玩家：

| player_id | player_key |
| --- | --- |
| `p1` | `key_player_1` |
| `p2` | `key_player_2` |

HTTP 一律：

```http
Authorization: Bearer <player_key>
```

`POST /commands` 还要：`issuer_type=player` 且 `issuer_id` = 该 key 对应的 `player_id`。

## 3. 操作入口（优先 CLI）

### 3.1 交互 REPL（人类）

```bash
cd client-cli
npm install   # 首次
SW_SERVER=http://localhost:18080 npm run dev
# 选 [1] p1
```

### 3.2 非交互单条命令（Claude 推荐）

`client-cli` 的 `runCommandLine` 可程序化调用，复用命令解析与越界/军事 policy 校验：

```bash
cd client-cli
SW_SERVER=http://localhost:18080 npx tsx -e '
import { runCommandLine } from "./src/runtime.ts";
const ctx = {
  currentPlayer: "p1",
  playerKey: "key_player_1",
  serverUrl: process.env.SW_SERVER || "http://localhost:18080",
};
const line = process.argv[1] || "briefing";
const out = await runCommandLine(line, ctx);
console.log(out);
' -- "briefing"
```

多条时循环调用；**每条命令等返回后再发下一条**（异步施工/战斗靠下一轮查询对账，不要连发盲猜）。

### 3.3 直接 HTTP（CLI 不可用时）

```bash
# 一眼局势
curl -fsS -H "Authorization: Bearer key_player_1" \
  "http://localhost:18080/state/agent-briefing"

# 下命令（request_id 必须唯一）
curl -fsS -X POST -H "Authorization: Bearer key_player_1" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "req-'"$(date +%s%N)"'",
    "issuer_type": "player",
    "issuer_id": "p1",
    "commands": [{
      "type": "build",
      "target": {"layer":"planet","planet_id":"planet-1-1","position":{"x":10,"y":12}},
      "payload": {"building_type":"wind_turbine"}
    }]
  }' \
  "http://localhost:18080/commands"
```

- HTTP `202` + `results[].status=accepted` **只表示入队**，不是最终成功。
- 最终结果看 `command_result` 事件，或下一轮 `briefing` / `summary` / `inspect` / `war_industry` 对账。
- 结构失败时看 `results[].code` + `results[].message`；结构化 `issues[]`（字段级）随 T-B2 提供时优先用 `issues` repair。

## 4. 决策循环（核心）

每一轮固定四步，**不要跳过 briefing**：

```
1. OBSERVE  briefing [20]
            必要时再拉：summary / scene / war_industry / task_forces / theaters /
                        system_runtime / planet_runtime / fleet_status / inspect
2. DECIDE   根据 self.resources、tech、alerts、fleets/task_forces/theaters/enemy_forces
            选 1～N 条可执行命令（优先闭环最短路径）
3. ACT      经 CLI 或 POST /commands 发出
4. VERIFY   再 briefing / 专项查询；失败则读 code/message/issues 修正后重试
```

节奏：

- 工业建设：每 2～5 秒一轮，等矿机/产线 running、minerals 上涨。
- 战争：每轮先 `war_industry` + `task_forces` + `system_runtime`，再部署/封锁/登陆。
- 胜利：`briefing` 出现 `winner` / `victory_reason` 即停，写战报。

## 5. 战术手册（按场景）

坐标**禁止硬编码**——用 `scene` / Web / `inspect` 找 base 与矿点。出生保证铁铜在操作距离内。

### 5.1 新局 30 分钟（`config-dev` + `map.yaml`）

目标：采矿闭环 → 矩阵产线 → 第一门研究。

```text
briefing / summary
scene <planet> <x> <y> <w> <h>     # 找 base、iron_ore、copper_ore
build <邻格x> <邻格y> wind_turbine
build <...> tesla_tower             # 电网接到矿
build <ore_x> <ore_y> mining_machine
# 等 minerals 上涨
build ... arc_smelter / assembling_machine_mk1   # 铁铜→磁线圈/电路板→电磁矩阵
build ... matrix_lab                # 不要带 --recipe（研究站模式）
start_research electromagnetism     # 缺矩阵应失败
transfer <lab_id> electromagnetic_matrix 10
start_research electromagnetism     # 成功 → 解锁 depot_mk1
```

开局资源：`minerals=240`、`energy=100`，**不预置矩阵**。矿机满仓仍 kickback minerals。

详细勾选：`docs/player/试玩验收清单.md` §A；步骤说明：`docs/player/上手与验证.md` §4.1。

### 5.2 官方 midgame（戴森/轨道）

- 确认 `active_planet_id=planet-1-2`（气态行星）。
- 先堆电：`tesla_tower` + 多台 `wind_turbine` 至 generation 够用。
- `orbital_collector` / `vertical_launching_silo` / `em_rail_ejector` → `transfer` 装填 → `launch_solar_sail` / `launch_rocket`。
- 防御与射线：`jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`set_ray_receiver_mode`。

详见 `docs/player/上手与验证.md` §4.2。

### 5.3 官方战争局（skill 验收主路径）

启动：`bash server/scripts/start_official_war_test_server.sh 19481`  
`SW_SERVER=http://localhost:19481`。

最小权威闭环（ID 用查询结果替换）：

```text
briefing
war_industry
# 蓝图
blueprint_variant corvette corvette_play utility --name play-corvette
blueprint_validate corvette_play
blueprint_finalize corvette_play --target-state prototype
# 排产 → 部署枢纽 ready_payloads
queue_military_production <recomposing_assembler_id> <base_id> corvette_play --count 1
war_industry
# 舰队 + 任务群 + 战区
commission_fleet <base_id> corvette_play sys-1 --fleet-id fleet-play
task_force_create tf-play --name play --stance escort
task_force_assign tf-play fleet fleet-play --system sys-1 --planet planet-1-1
task_force_deploy tf-play --system sys-1 --planet planet-1-1
theater_create theater-play --name play
theater_define_zone theater-play primary --system sys-1 --planet planet-1-1 --radius 8
theater_set_objective theater-play secure_planet --system sys-1 --planet planet-1-1 --description hold
# 对账
fleet_status / task_forces / theaters / system_runtime sys-1 / planet_runtime planet-1-1
# 升级动作
blockade_planet tf-play planet-1-1
landing_start tf-play planet-1-1 --operation-id landing-play
system_runtime sys-1   # 确认 blockades / landing_operations
```

注意：

- 官方战争局预置科技与军工底座，**不会**自动建舰队/任务群/战区。
- `blockade_planet` / `landing_start` 的同步返回只代表入队；以 `system_runtime` 为准。
- 详细：`docs/player/上手与验证.md` §4.4；GUI 对照 `/war`。

### 5.4 决策启发式

| 观察 | 动作 |
| --- | --- |
| energy 紧 / generation 低 | 先 `wind_turbine` / `tesla_tower` / 太阳能 |
| minerals 不涨 | 查矿机是否在资源格、是否通电、`inspect` 状态 |
| 研究失败 | 空 `matrix_lab` + 本地有足够矩阵再 `start_research` |
| `ready_payloads` 有货未部署 | `commission_fleet` / `deploy_squad` |
| 有舰队无任务群 | `task_force_create` → `assign` → `deploy` |
| 有任务群无战区 | `theater_*` 后把 TF deploy 进 theater |
| alerts 刷生产 | `alert_snapshot` / 修配方或缺料，勿盲目扩建 |
| threat / enemy_forces | 优先姿态、封锁、滩头，再扩张工业 |

## 6. 常用 CLI 速查

```text
# 观察
health | summary | stats | briefing [n]
galaxy | system [id] | planet [id]
scene [planet] x y w h | inspect <planet> building|unit|resource|sector <id>
war_industry | blueprints [id] | task_forces | theaters
fleet_status [id] | system_runtime [id] | planet_runtime [id]
fog | alert_snapshot | event_snapshot

# 工业
build x y <type> [--recipe id] [--direction d]
transfer <building_id> <item_id> <qty>
start_research <tech_id> | cancel_research <tech_id>
switch_active_planet <planet_id>

# 战争
blueprint_create|set_component|validate|finalize|variant ...
queue_military_production <factory> <hub> <bp> [--count n]
commission_fleet | deploy_squad | refit_unit ...
task_force_create|assign|set_stance|deploy ...
theater_create|define_zone|set_objective ...
blockade_planet | landing_start ...
```

完整参数表：`docs/dev/客户端CLI.md`。`help` 在 REPL 内可用。

## 7. 战报输出（验收收尾）

打完或中止时写简短战报（markdown）：

1. 场景：newgame / midgame / war，端口与 commit
2. 用时与最终 tick / winner
3. 关键节点（首矿、首研究、首舰队、封锁/登陆…）
4. 失败命令与 `code`/`issues`（若有）
5. 阻塞 issue 是否需记入 `docs/player/issue/`

## 8. 红线

- 不杀不属于本仓库的端口进程；脚本已做「本仓库 cmdline」判断。
- 不提交 `node_modules`、临时 `data_dir`、`.run/` 试玩产物。
- 不把主仓正在跑的 record/play 环境当试玩服混用。
- 命令失败先读结构化错误再改，禁止无依据连发。
- 改 server API / CLI 行为后更新 `docs/dev/服务端API.md` / `docs/dev/客户端CLI.md`；测试绿才算完成。
