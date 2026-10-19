# 战争局与 midgame

起服：
- 战争局：`bash server/scripts/start_official_war_test_server.sh 19481`
- midgame：`cd server && go run ./cmd/server -config config-midgame.yaml -map-config map-midgame.yaml`

然后 `export SW_SERVER=http://localhost:<端口>`，再用 `scripts/sw` 发命令。

注意：
- **军工订单（`queue_military_production` / `refit_unit`）从你自己机甲的背包扣料**，机甲必须和工厂在同一颗星球，且已绑定给你（多代理规则见 [multi-agent.md](multi-agent.md)）。
- 开局头几个 tick 电网还没结算，工厂可能报 `生产设施未运行：under_power`。等 `health` 显示 tick ≥ 10 再下军工单。

## 1. 官方战争局

启动：`bash server/scripts/start_official_war_test_server.sh 19481`  
`export SW_SERVER=http://localhost:19481`。

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
system_runtime sys-1   # 确认 blockades；theaters 确认区域敌情 hostile_count/alerted
```

注意：

- 官方战争局预置科技与军工底座，**不会**自动建舰队/任务群/战区。
- `blockade_planet` 的同步返回只代表入队；以 `system_runtime` 为准。
- 详细：`docs/player/试玩验收清单.md`；GUI 对照 `/war`。

## 2. 官方 midgame（戴森 / 轨道）

- 确认 `active_planet_id=planet-1-2`（气态行星）。
- 先堆电：`tesla_tower` + 多台 `wind_turbine` 至 generation 够用。
- `orbital_collector` / `vertical_launching_silo` / `em_rail_ejector` → `transfer` 装填 → `launch_solar_sail` / `launch_rocket`。
- 防御与射线：`jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`set_ray_receiver_mode`。

详见 `docs/player/试玩验收清单.md`。

## 3. 决策启发式（战争）

| 观察 | 动作 |
| --- | --- |
| `ready_payloads` 有货未部署 | `commission_fleet` / `deploy_squad` |
| 有舰队无任务群 | `task_force_create` → `assign` → `deploy` |
| 有任务群无战区 | `theater_*` 后把 TF deploy 进 theater |
| alerts 刷生产 | `alert_snapshot` / 修配方或缺料，勿盲目扩建 |
| threat / enemy_forces | 优先姿态、封锁、滩头，再扩张工业 |

