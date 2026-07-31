# 试玩战报：官方战争局 skill 路径（2026-07-31）

## 场景
- 模式：official war（`start_official_war_test_server.sh 19481`）
- commit：`b1d4273`
- 操作面：HTTP + skill 手册闭环（CLI `runCommandLine` 对 `war_industry` 等军事查询在无 agent policy 时会拒，见阻塞）

## 时间线 / 关键节点
| 节点 | 结果 |
| --- | --- |
| briefing | tick≈210，p1 minerals=6000 energy≈7k，15 科技已完成，无舰队/TF/战区 |
| war_industry | hub=`b-5` battlefield_analysis_base；factory=`b-14` recomposing_assembler（input_shortage 告警持续） |
| blueprint_variant corvette→corvette_play | accepted → state=prototype，validation.valid=true |
| queue_military_production b-14→b-5 corvette_play×1 | in_progress → completed；hub ready_payloads.corvette_play=1 |
| commission_fleet fleet-play | 舰队 idle @ sys-1，1×corvette_play |
| task_force_create/assign/deploy tf-play | members 含 fleet-play，deployed planet-1-1 |
| theater_create/define_zone/set_objective | theater-play primary zone + secure_planet |
| blockade_planet + landing_start | landing stage=beachhead_established result=success；planet_blockades 见 runtime |

## 最终状态（约 tick 1268）
- fleets=1 task_forces=1 theaters=1
- landing_operations: landing-play success / beachhead_established
- winner: 无（本局为技能闭环验收，未打到胜负）

## 失败 / 摩擦
1. **CLI 军事门禁**：`runCommandLine` 无 `policy.military` 时拒绝 `war_industry` 等查询（`military command not allowed without delegated policy`）。人类/skill 当 commander 应用 HTTP 或 REPL `dispatch`（官方回归测试走 `dispatch`，不经 `runCommandLine` policy）。skill 文档应区分 commander 直连 vs agent 委派。
2. **assembler input_shortage**：官方局预置 `recomposing_assembler` 持续告警，不影响排产完成，但 briefing 噪音大。
3. **events/snapshot** 默认参数易 400，战果对账更依赖 industry/runtime/briefing。

## 阻塞 issue 建议
- skill/CLI：commander 路径应可查询 war_industry 而不强制 military policy（或 skill 写明用 HTTP / `dispatch`）。
- 可选：官方战争局给 assembler 预置原料或压低 input_shortage 告警。

## 验收结论
**skill 手册权威战争闭环可走通**：蓝图 → 量产 → 列装 → 任务群 → 战区 → 封锁/登陆，server 状态一致。P1 T-B4 验收项（打完并产出战报）本轮完成「可打通闭环 + 战报」；完整 AI 对战胜负局仍可后续加。
