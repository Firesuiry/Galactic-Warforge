# tc07-calmed（未建成：tc07-hostile 的局面撑不到冷静期，改由 Go 测试覆盖）

第 19 轮尝试把 TC-07 的「激怒 → 报复 → 恢复中立」后半段做成可执行层
`tc07-calmed`（parent=`tc07-hostile`，等 `hostile_until_tick` 到期后断言
`dark_fog_hostile=false` + `dark_fog_calmed` 事件）。**实跑证明从 tc07-hostile
出发做不到**，因此没有 JSON、不参与重建。

## 实测证据（`checkpointbuild` 读 tc07-hostile 档，纯快进，不下命令）

| tick | 局面 |
|---|---|
| 64800 | 落档：3 个步兵（37/37/75 HP）、机甲 u-40、HQ b-39@54,144，`hostile_until_tick=70211` |
| 65105 | 3 个步兵被追上来的黑雾守卫杀光 |
| 65546/65552 | 机甲自动索敌开火（打的是尚未锁定玩家的黑雾单位 df-195），按「主动挑衅」口径把 `hostile_until_tick` 顺延到 **71552** |
| ~67400 | 黑雾波次拆掉 HQ b-39（其间机甲阵亡、100 tick 后在 HQ 复活，来回多次） |
| ~67500 | HQ 已毁、机甲恰在阵亡窗口 → p1 无在场实体，**对局宣判淘汰结束**（p2 胜） |
| 71552 | `dark_fog_calmed` 仍然发出（`settleDarkFogCalm` 不因终局停止），但此时 `game_not_finished` / `player_alive` 都已不成立 |

其它试过的变体（都失败，都在 ~67400–68000 之间被淘汰）：

- 3 个幸存步兵移回基地坚守：HQ 仍被拆，机甲阵亡后淘汰。
- 机甲在 64810 单独撤退到 (54,60)：黑雾单位一路追，机甲阵亡、HQ 被拆。
- 机甲撤到更远、或补产 12 个步兵：前者机甲核心能量不够（单次 move 要 385 能量、
  上限 100），后者产不出来——b-105 铁料补给站在 tc07-hostile 落档前就已被黑雾拆掉，
  铁矿线没熔炉，背包只有 4 铁块。

## 结论与替代

- **tc07-hostile 是个必败局面**：只有 3 个低血步兵 + 机甲、没有炮塔、没有铁料产线，
  黑雾敌对期 6000 tick（还会被自动还手顺延）足够拆平基地。想做成可执行层，
  前提是先有一层「在家攒起能扛住 6000 tick 波次的防御」，那要改上游
  （`cp-army` / `tc07-hostile` 的兵力与防御配置），不是加一层空等能解决的。
- 冷静期机制本身由 Go 测试覆盖（不需要存档点）：
  `server/internal/gamecore/dark_fog_passive_test.go`
  （`TestDarkFogProvokedRetaliatesThenCalms`：到期 `dark_fog_calmed` + 关系清空 + 奔袭撤销）、
  `dark_fog_retaliation_test.go`（自动还手不顺延）、
  `checkpoint_persistence_test.go`（读档后敌对关系与冷静 tick 都能恢复）。
- 契约谓词 `dark_fog_calmed`（自 tick 起该玩家出现过冷静期到期事件）已加进
  `internal/gamecore/contract.go`，配了单元测试；等哪天有能扛住的
  「激怒 → 等冷静」局面（例如新增一层带炮塔防御的挑衅层），直接用它写契约即可。
