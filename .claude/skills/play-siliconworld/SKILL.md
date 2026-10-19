---
name: play-siliconworld
description: Play SiliconWorld as an AI agent via the non-interactive CLI (scripts/sw). Start a local server or load a checkpoint, then run an observe → check → act → verify loop to build mining/smelting/assembly lines, research tech, fight wars, or cooperate with other agents on the same side (one mecha per agent). Use when asked to play, trial, playtest, build production lines, fight a war, or drive the game as Claude Code.
---

# Play SiliconWorld（面向 AI 代理）

## 0. 这是什么游戏

- 类《戴森球计划》的工业游戏，地图是一颗立方体球面行星。
- **纯实物经济，没有金钱或 minerals**：每座建筑的造价都是实物，从**你的机甲背包**里扣。
- 典型产线：采矿机 → 传送带 → 分拣器 → 熔炉 → 制造台 → 研究站（消耗矩阵研究科技）。
- 对手是 bot 和黑雾。
- 你操作一台**机甲**：建造、手搓、取放物品都由它执行。多个代理可以在同一方，各操作一台机甲。

## 1. 起服与连接

```bash
# 推荐：带存档点的本地环境（N 选一个没人用的编号，端口 = N*100）
bash scripts/playtest-up.sh 230 --tick-rate 10 --checkpoint cp-root   # 新局起点
bash scripts/playtest-up.sh 230 --tick-rate 10 --checkpoint cp-base   # 已有铁铜冶炼线的基地
bash scripts/playtest-down.sh 230                                      # 用完关掉
export SW_SERVER=http://127.0.0.1:23000
```

- 存档点缺失或版本不对时，脚本会自动重建。
- 常用存档点：`cp-root`（新局）、`cp-base`（铁铜冶炼 + 齿轮）、`cp-lab`（有研究站）、`cp-matrix-line`（电磁矩阵线）、`cp-mecha-pair`（3 台机甲，练习多代理）。
- 账号：`p1` / `key_player_1`（admin，可以用 `advance` 快进），`p2` / `key_player_2`。默认就是 p1。
- 其它场景（战争局、midgame）见 [reference/war.md](reference/war.md)。

## 2. 发命令：`scripts/sw`

```bash
scripts/sw briefing                         # 单条
scripts/sw - <<'EOF'                        # 批量：逐行执行，# 开头是注释，失败不中止
build 60 135 wind_turbine
build 63 136 tesla_tower
EOF
SW_ISSUER=builder-a scripts/sw mecha list   # 以代理身份发令（多代理时必设）
```

- **下令命令会等到真正执行完**，再打印 `✓ OK: …` 或 `✗ CODE: …`。`ACCEPTED` 只表示入队，**以 ✓/✗ 为准**。
- 有失败时退出码非 0，批量模式最后打印汇总。
- 环境变量：`SW_SERVER`、`SW_PLAYER`、`SW_KEY`、`SW_ISSUER`、`SW_WAIT=0`（不等结果）。
- 不知道参数时：`scripts/sw help <命令>`。完整命令表见 `docs/dev/客户端CLI.md`。

## 3. 决策循环

```text
1. 看    briefing（我的背包/作业/科技/告警） · mecha list · scene（周边建筑和矿）
2. 查    catalog building <type>（解锁？造价？占地？） · 背包够不够 · 占地空不空
3. 做    一小批命令（3–8 条），用 scripts/sw - 批量发
4. 验    每条看 ✓/✗；然后 planet_runtime --mine（施工有没有卡住）、inspect <建筑>（running？库存在涨吗？）
5. 等    wait job / wait build / wait item … / wait ticks N（不要空转轮询）
```

- 每一步要看的字段和下令前的自检清单：[reference/queries.md](reference/queries.md)。
- 失败了先查 [reference/errors.md](reference/errors.md)，按消息修，**同一条命令不要原样重发**。

## 4. 十条铁律

1. **造价在自己的机甲背包里**。连续下几个建造单时，造价要累加；回执里出现「本任务将等料」就要补料。
2. **`build x y` 的 x、y 是占地左上角**，占地向东、向南展开。下单前用 `catalog building <type>` 查占地大小。
3. **传送带不给建筑喂料**。熔炉、制造台、研究站、补给站的进料和出料都靠**分拣器**。
4. **分拣器的 `--rotation` 就是放货方向**（0 北、90 东、180 南、270 西），背面取货，沿轴扫描 3 格内的第一个建筑。建完用 `inspect <分拣器>` 确认两端都连上了。
5. **采矿机必须有出口**：在它的边上放一段出货方向背离矿机的传送带。否则几 tick 就会堵死。
6. **机甲同一时间只有一个手搓作业**：批次一次发够，再 `wait job`；不要在作业进行中追加 `craft_item`。
7. **新建筑要通电**：风机发电 10，电力感应塔的覆盖半径是 12。建完用 `networks` 或 `inspect` 看是否 `no_power`。
8. **有科技门槛**：`depot_mk1`、钢材等需要先研究。用 `catalog techs --available` 看现在能研究什么。
9. **每建完一段就验证一段**，确认上游在出货、下游在增长，再往下建。不要一口气建完整条线再排查。
10. **多代理时只动自己的东西**：只用自己的机甲，只在自己的区域建，不 `advance`，共用仓库只取当下要用的量。详见 [reference/multi-agent.md](reference/multi-agent.md)。

## 5. 开局路线

从 `cp-root` 到第一条自动产线、完成第一项研究的实测命令序列，见 [reference/opening.md](reference/opening.md)。
摆放规则和产线模板（矿 → 熔炉 → 补给站、制造台 → 研究站）见 [reference/logistics.md](reference/logistics.md)。

## 6. 参考索引

| 文件 | 内容 |
| --- | --- |
| [reference/opening.md](reference/opening.md) | 开局到第一项研究的分阶段路线（实测命令） |
| [reference/logistics.md](reference/logistics.md) | 坐标、分拣器方向、传送带、采矿机、产线模板、供电 |
| [reference/queries.md](reference/queries.md) | 每个查询怎么读；build / craft / transfer / produce / research 的下令前自检 |
| [reference/errors.md](reference/errors.md) | 结果码 → 修法；隐蔽失败（回执 OK 但事没办成） |
| [reference/multi-agent.md](reference/multi-agent.md) | 多代理身份、机甲接管与制造、互不干扰的约定 |
| [reference/war.md](reference/war.md) | 战争局与 midgame 流程 |
| `docs/guide/科技树与建造前置.md` | 全部科技、建筑解锁与造价（自动生成） |
| `docs/dev/客户端CLI.md` / `docs/dev/服务端API.md` | 命令与 API 全表 |

## 7. 收尾：写战报

结束或中止时写一份简短战报（markdown）：
1. 场景、端口、起始存档点、用时、最终 tick；
2. 建了什么，各产线现在是否在运行（附 `inspect` 数字）；
3. 命令总数和失败数，以及失败原因分布（`audit --limit 200`）；
4. 卡住的地方，以及文档或 CLI 里缺了什么。

## 8. 红线

- 不杀不是自己起的进程。关环境用 `playtest-down.sh <N>`。
- 不提交 `node_modules`、临时数据目录、`.run/`。
- 命令失败先读 ✗ 后面的消息再改，禁止没有依据地连发。
- 和别的代理同局时，不用 `advance`、不读档、不开新局。
