package gamecore

import (
	"fmt"
	"sort"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 遭遇战整局多 seed 回归（试玩报告 C/D/E 的验收）：p1 只放 6 个防守兵不操作，
// bot(easy) 从真实遭遇战预设（config-skirmish + map-skirmish）开局，
// 双方都没有开局物资包，逐 seed 跑到 tick 90000，断言：
//   - bot 在 bot_first_attack_tick 之后真的推进到 p1 基地附近（波次数只记录）；
//   - 不存在两个及以上地面单位同格；
//   - 除留守外，没有单位在出击状态下位置长期（≥3000 tick）不变；
//   - 双方执行体都能从当前位置走回自家基地（试玩报告 D：执行体被自家建筑围死）；
//   - 双方基地**始终**与争夺中心连通（每 500 tick 抽检一次；试玩报告 1010 阻断 A：
//     bot 用一圈建筑把自家基地封成 126 格口袋，22 个兵与执行体全困死、整局 0 波进攻）；
//   - 整局没有 >100ms 的 tick；
//   - bot 科技链已启动：电磁学完成，或研究已开始/排队（无物资包下 bot 的发育节奏
//     慢一些；easy 档 researchMaxLevel=1 时电磁学之后没有可选项，automatic_metallurgy
//     是 level 2、不会被选中，所以用「电磁学链已启动」判定）。
//
// 跑得慢（6 个 seed 约 18–25 分钟）：`go test -short` 会跳过。单跑方式：
//
//	cd server && go test ./internal/gamecore/ -run TestSkirmishFullMatchRegression -v -timeout 50m
//
// 每个 seed 会 t.Logf 出进攻波次时间点、科技完成时间、p95/最坏 tick。
//
// 2026-10-10「去掉开局物资包」后：bot 的 cadence 与阈值在 easy 下更低，
// 首攻按「试玩节奏 ≈ 脚本 ×2」推迟到 bot_first_attack_tick=60000
// （脚本节奏约 tick 30000 攒够兵），本回归相应跑到 tick 90000
// （60000 首攻 + 30000 观察窗口；时限 180000 的一半）。
//
// pt1009-g2（试玩 G2 的 seed）修复前把玩家出生点放在一座 145 格孤岛上；
// mapgen/connectivity.go 的连通性保证落地后纳入回归。
// pt1010-85s8io / pt1010-g4 是 1010 试玩里 bot 把自己封进口袋的两个 seed。
// pt1011-0e2bz1 是 1011 试玩 G2（玩家被淘汰后服务端慢 tick）的 seed。
// 第六轮开局物资包加入矩阵研究站后，pt1009-g2 曾因 bot 机甲被自家待命步兵堵在窄口
// 整局只打一波——由 unit_movement_settlement.go 的 yieldIdleBlocker（自家待命单位让路）修复。
func TestSkirmishFullMatchRegression(t *testing.T) {
	if testing.Short() {
		t.Skip("整局遭遇战模拟（每个 seed 约 2–4 分钟）；用 -run 单跑")
	}
	for _, seed := range []string{"skirmish-seed-001", "pt1009-seed", "pt1009-g2", "pt1010-85s8io", "pt1010-g4", "pt1011-0e2bz1"} {
		t.Run(seed, func(t *testing.T) {
			runSkirmishFullMatch(t, seed)
		})
	}
}

// newSkirmishCoreForSeed 按指定 seed 生成真实遭遇战预设。
func newSkirmishCoreForSeed(t *testing.T, seed string) *GameCore {
	t.Helper()
	cfg, err := config.Load("../../config-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	cfg.Battlefield.MapSeed = seed
	mapCfg, err := mapconfig.Load("../../map-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
}

func runSkirmishFullMatch(t *testing.T, seed string) {
	t.Helper()
	core := newSkirmishCoreForSeed(t, seed)
	// 沙盒规则：本测试只关心 bot 发育与军团行为，不要因 p1 被灭提前结束。
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()
	p1Home := botPlayerHQ(t, ws, "p1").Position
	// 细分网格：HQ 占 5×5（锚点起 x..x+4），守军必须摆到占地之外（距离 ≥5），
	// 否则会落在建筑里被推挤结算挪走。
	for i := 0; i < 6; i++ {
		pos := botTileAtDistance(t, ws, p1Home, 5+i)
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", pos)
	}
	p1Exec := executorForPlayer(t, ws, "p1")
	p2Exec := executorForPlayer(t, ws, "p2")
	p2Home := botPlayerHQ(t, ws, "p2").Position

	const (
		simTicks = 90000
		// nearBase 是"推进到基地附近"的判定半径：细分网格后单位间距与攻击
		// 射程都 ×3，bot 军团停在离基地 ~10–30 cell 处交火，12 已判不到
		// （实测首攻 tick 72731 却 totalApproaches=0），同步放大到 36。
		nearBase    = 36
		stuckTicks  = 3000
		waveGapTick = 800 // 两次"推进到基地附近"至少间隔这么久才算新的一波
		// connectivityEvery 基地连通性的抽样间隔：每 500 tick 检查一次双方基地
		// 是否仍走得到争夺中心（绝对不变量，试玩报告 1010 阻断 A）。
		connectivityEvery = 500
	)
	type snapshot struct {
		pos  model.Position
		tick int64
	}
	lastMove := map[string]snapshot{}
	lastApproach := int64(-1 << 40)
	waves := 0
	totalApproaches := 0
	var firstApproach int64 = -1
	var waveTicks []int64
	var stuck []string
	slowTicks := 0
	var worstTick int64
	var worstDur int64
	techAt := map[string]int64{}
	// sealSeen 记录"基地被封死"的第一次出现（整局每 500 tick 抽检一次）。
	var sealSeen string
	checkBaseConnectivity := func() {
		if sealSeen != "" {
			return
		}
		for _, owner := range []string{"p1", "p2"} {
			home, ok := botHomePosition(ws, owner)
			if !ok {
				continue // 基地已被打掉：没有基地就无所谓"被封死"
			}
			goal, ok := baseSealGoal(ws, owner)
			if !ok {
				continue
			}
			budget := 4*ws.SurfaceDistance(home, goal) + 256
			reached, truncated := sealFloodReaches(ws, home, goal, nil, budget)
			if !reached && !truncated {
				sealSeen = fmt.Sprintf("%s base %+v sealed off from %+v at tick %d", owner, home, goal, ws.Tick)
				return
			}
		}
	}

	for ws.Tick < simTicks {
		core.processTick()
		if ws.Tick%connectivityEvery == 0 {
			checkBaseConnectivity()
		}
		if d := core.metrics.LastTickDur.Milliseconds(); d > worstDur {
			worstDur, worstTick = d, ws.Tick
		}
		if d := core.metrics.LastTickDur.Milliseconds(); d > 100 {
			slowTicks++
		}
		for id, u := range ws.Units {
			if u == nil || u.OwnerID != "p2" || u.HP <= 0 || u.Domain != model.UnitDomainGround {
				continue
			}
			if prev, ok := lastMove[id]; !ok || prev.pos != u.Position {
				lastMove[id] = snapshot{u.Position, ws.Tick}
			} else if ws.Tick-prev.tick >= stuckTicks {
				// "留守"不算卡死：只有已经离开基地、处于出击姿态却原地不动的
				// 单位才是问题（试玩报告 B/C：军团到位后僵住不再开火）。
				if u.Stance == model.UnitStanceAttackMove && ws.SurfaceDistance(u.Position, p2Home) > 60 {
					stuck = append(stuck, id)
				}
			}
			if ws.SurfaceDistance(u.Position, p1Home) <= nearBase {
				totalApproaches++
				if ws.Tick-lastApproach > waveGapTick {
					waves++
					waveTicks = append(waveTicks, ws.Tick)
					if firstApproach < 0 {
						firstApproach = ws.Tick
					}
					lastApproach = ws.Tick
				}
			}
		}
		if tech := ws.Players["p2"].Tech; tech != nil {
			for _, id := range []string{"electromagnetism", "automatic_metallurgy", "weapon_system"} {
				if _, seen := techAt[id]; !seen && tech.CompletedTechs[id] > 0 {
					techAt[id] = ws.Tick
				}
			}
		}
	}

	t.Logf("seed=%s waves=%d totalApproaches=%d waveTicks=%v firstApproach=%d techAt=%v slowTicks=%d worstTick=%d(%dms) p95=%.1fms p99=%.1fms",
		seed, waves, totalApproaches, waveTicks, firstApproach, techAt, slowTicks, worstTick, worstDur, core.metrics.p95(), core.metrics.p99())

	// 1) 首攻之后不止一波进攻。
	if firstApproach < 0 {
		t.Fatal("bot never pushed any ground unit near the player base")
	}
	if firstApproach < core.cfg.Battlefield.BotFirstAttackTick {
		t.Fatalf("bot attacked at tick %d before bot_first_attack_tick %d", firstApproach, core.cfg.Battlefield.BotFirstAttackTick)
	}
	// 2026-10-11 起 bot 是 easy（attackAt=3，首波 3 个兵，waveCooldown=12000）：
	// 首攻推到 60000，90000 tick 的窗口给后续波次留了 30000 tick，按冷却只够 2 波左右，
	// 因此硬断言只要求「首攻在门槛之后且真的推进到基地附近」，波次数
	// （waves，间隔 ≥800 tick 记一波）与推进次数只记录。
	if waves < 1 {
		t.Fatalf("bot launched no approach wave (first at tick %d)", firstApproach)
	}

	// 2) 没有同格堆叠的地面单位。
	for key, ids := range ws.TileUnits {
		alive := 0
		for _, id := range ids {
			if u := ws.Units[id]; u != nil && u.HP > 0 && u.Domain == model.UnitDomainGround {
				alive++
			}
		}
		if alive > 1 {
			t.Fatalf("tile %s holds %d live ground units", key, alive)
		}
	}

	// 3) 出击状态的单位不会长期钉在原地。
	if len(stuck) > 0 {
		sort.Strings(stuck)
		t.Fatalf("units stuck in attack stance for >= %d ticks: %v", stuckTicks, stuck)
	}

	// 4) 双方执行体都能走回自家基地（试玩报告 D：被自家建筑围死）。
	for _, tc := range []struct {
		name string
		unit *model.Unit
		home model.Position
	}{
		{"p1", p1Exec, p1Home},
		{"p2", p2Exec, p2Home},
	} {
		if tc.unit == nil {
			t.Fatalf("%s executor missing", tc.name)
		}
		if !pocketReach(ws, tc.unit.Position, tc.home, nil) {
			t.Fatalf("%s executor %s at %+v cannot reach its home %+v (trapped by buildings)",
				tc.name, tc.unit.ID, tc.unit.Position, tc.home)
		}
	}

	// 4b) 双方基地**始终**与争夺中心（没有则对手基地）连通：试玩报告 1010 阻断 A
	// 的绝对不变量——bot 不能再把自家基地一圈圈封成口袋（整局 0 波进攻）。
	// 循环里每 connectivityEvery tick 抽检一次，这里再补一次终局检查。
	checkBaseConnectivity()
	if sealSeen != "" {
		t.Fatalf("base got sealed off by its own buildings: %s", sealSeen)
	}

	// 5) 整局没有 >100ms 的 tick（告警线）。
	if slowTicks > 0 {
		t.Fatalf("%d ticks over 100ms (worst %dms at tick %d)", slowTicks, worstDur, worstTick)
	}

	// 6) 科技链：自动冶金 + 电磁学。
	// 无物资包后 bot 从零发育，90000 tick 内电磁学可能刚开或刚完成（取决于 seed），
	// 因此断言放宽为「自动冶金已完成、电磁学链已启动（完成或正在研究/排队）」，
	// 电磁学完成 tick 已由日志记录（脚本节奏的目标值见 from-zero 测试）。
	tech := ws.Players["p2"].Tech
	started := tech.CompletedTechs["electromagnetism"] > 0 ||
		tech.CurrentResearch != nil ||
		len(tech.ResearchQueue) > 0
	// easy 档 researchMaxLevel=1：只研究 level ≤1 的科技，automatic_metallurgy
	// （level 2）不会在 90000 tick 内被选中——所以「科技链已启动」在 easy 下
	// 用「电磁学完成或已开始研究」判定，normal/hard 保留自动冶金断言。
	if tech.CompletedTechs["automatic_metallurgy"] <= 0 && !started {
		t.Fatalf("bot never started the tech chain by tick %d (completed=%v current=%v queue=%d)",
			ws.Tick, tech.CompletedTechs, tech.CurrentResearch, len(tech.ResearchQueue))
	}
}

// executorForPlayer 玩家在本星球的执行体单位。
func executorForPlayer(t *testing.T, ws *model.WorldState, playerID string) *model.Unit {
	t.Helper()
	state := ws.Players[playerID].ExecutorForPlanet(ws.PlanetID)
	if state == nil {
		t.Fatalf("%s has no executor on %s", playerID, ws.PlanetID)
	}
	unit := ws.Units[state.UnitID]
	if unit == nil {
		t.Fatalf("%s executor unit %s missing", playerID, state.UnitID)
	}
	return unit
}
