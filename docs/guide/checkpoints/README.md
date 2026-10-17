# 存档点构建记录（docs/guide/checkpoints）

本目录的 `<名字>.json` 是存档点的**构建记录**：`steps` 是「只用玩家命令 + 快进」的有序步骤，
`contract` 是该层必须成立的断言。重建：

```bash
cd server
GOCACHE=/tmp/gw-go-cache GOTOOLCHAIN=local /home/firesuiry/sdk/go1.25.0/bin/go \
  run ./cmd/checkpointbuild -root .. -list            # 看树与状态
  run ./cmd/checkpointbuild -root .. -from cp-root     # 整树重建
  run ./cmd/checkpointbuild -root .. -layer cp-army    # 单层（含父链）
```

存档点本体写到 `.run/checkpoints/`（不进 git）。背景与规则见
[存档点回归测试](../存档点回归测试.md)，工具用法见 [试玩速查](../试玩速查.md)。

**第 16 轮（实物经济 + DSP 分拣器）之后**：所有构建记录只用玩家命令挣材料
（采矿 / 手搓 / 产线），禁止管理员发料；存档格式 v4，旧存档点一律读不进来。

## 层表（2026-10-17，第 19 轮重建）

| 层 | 父层 | 状态 | 用途 | 结束 tick |
|---|---|---|---|---|
| `cp-root` | — | executable | 大厅开新局 | 27 |
| `cp-power` | cp-root | executable | 第一座风机 + 电塔 | 33 |
| `cp-mining` | cp-power | executable | 铁矿机 + 带子 + 分拣器 + 铁熔炉 | 45 |
| `cp-base-a` | cp-mining | executable | 第二电塔 + 铜矿线 + 第二风机 | 135 |
| `cp-base` | cp-base-a | executable | 两台熔炉 + 制造台出货（含 item_growth） | 6282 |
| `cp-lab` | cp-base | executable | 矩阵研究站 running（空配方） | 8643 |
| `cp-matrix-line` | cp-lab | executable | 电磁矩阵产线 → 研究站 20 个矩阵 | 13280 |
| `cp-research-start` | cp-matrix-line | executable | 启动并完成电磁学研究 | 13320 |
| `cp-barracks` | cp-research-start | executable | 兵营 + 子弹产线（补风机保电） | 13700 |
| `cp-squad` | cp-barracks | executable | 兵营出 6 个步兵 | 14140 |
| `cp-pre-attack` | cp-squad | executable | 补给站 + 子弹入站（首攻前备战） | 14350 |
| `cp-pre-attack-late` | cp-pre-attack | executable | 空等层：快进到首攻前 | 59000 |
| `cp-post-attack` | cp-pre-attack-late | executable | 观战 bot 首攻（enemy_attack_seen） | 62000 |
| `cp-army` | cp-post-attack | executable | 扩到 10 步兵 + 补弹 | 63200 |
| `cp-near-hive` | cp-army | executable | 军团开到最近巢穴外（黑雾中立） | 64200 |
| `tc07-hostile` | cp-near-hive | executable | 激怒黑雾后停火（hostile=true） | 64800 |
| `cp-logistics` | cp-base | executable（分支） | 混合带 + 三熔炉 + 出料全链 + 运输机器人 | 23906 |
| `cp-haul-unreachable` | cp-base | executable（分支） | 围死熔炉触发 haul_unreachable | 12000 |
| `cp-base-ui16` | cp-root | retired（见 `cp-base-ui16.md`） | 审计被裁的纯 UI 导出，不能重建 | — |
| `cp-base-b` | cp-base-a | retired（见 `cp-base-b.md`） | 已并入 cp-base | — |
| `bug-1013-1/3/4/5` | cp-base / cp-lab | retired（见 `bug-1013.md`） | 问题已修复并有 Go/前端回归测试 | — |

## 军事链（第 19 轮改写）

`cp-barracks → cp-squad → cp-pre-attack → cp-pre-attack-late → cp-post-attack → cp-army → cp-near-hive → tc07-hostile`

- 料全部来自自家产线：从出货补给站 b-105（铁）/ b-97（铜）取锭，手搓电路板；
  兵营与补给站造价是「铁块 + 电路板」，子弹是 b-79 制造台 1 铁块 → 5 发 / 20 tick。
- `cp-barracks` 额外补一台风机：兵营 +2 用电后西侧电网 20/21 → 铜矿机 b-59 会
  `no_power`，契约要求两台矿机 running，所以先补电。
- 首攻段（`cp-pre-attack-late` → `cp-post-attack`）是纯快进层，不走墙钟：
  14350 → 59000 约 2 分钟，59000 → 62000 约 11 秒（bot 首攻在 60403 抵达）。
- 黑雾段（`cp-near-hive` → `tc07-hostile`）：最近巢穴是 `enemy-161@(303,435)`
  （cube-sphere 图距 318 格），10 兵行军约 425 tick。激怒后守卫成批扑上来，
  停火撤退后实测剩 3 个步兵（契约按 3 写）；`hostile_until_tick=70211`。

## 已知边界

- `tc07-hostile` 只覆盖「激怒 → 停火」；「6000 tick 后恢复中立」仍需主代理用高 tick
  速率空跑到 70211 之后验证（`dark_fog_calmed` 事件与 `dark_fog.hostile=false`）。
- `cp-post-attack` 停在 62000，bot 后续波次可能已在路上；这是首攻后的真实状态，
  下游 `cp-army` 从这一局面扩军。
- `cp-pre-attack-late` 是整树最慢的一层（约 2 分钟）；要更快可以把它拆成两段
  （例如 14350 → 30000 → 59000），但收益有限。
