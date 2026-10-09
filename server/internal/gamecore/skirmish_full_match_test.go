package gamecore

import (
	"sort"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 遭遇战整局多 seed 回归（试玩报告 C/D/E 的验收）：p1 只放 6 个防守兵不操作，
// bot(hard) 从真实遭遇战预设（config-skirmish + map-skirmish）开局，逐 seed 跑到
// tick 30000，断言：
//   - bot 在 bot_first_attack_tick 之后发起不止一波进攻（单位多次推进到 p1 基地附近）；
//   - 不存在两个及以上地面单位同格；
//   - 除留守外，没有单位在出击状态下位置长期（≥3000 tick）不变；
//   - 双方执行体都能从当前位置走回自家基地（试玩报告 D：执行体被自家建筑围死）；
//   - 整局没有 >100ms 的 tick；
//   - bot 科技链已启动：完成 electromagnetism，并在 weapon 链上再完成至少一项。
//
// 跑得慢（3 个 seed 约 6–10 分钟）：`go test -short` 会跳过。单跑方式：
//
//	cd server && go test ./internal/gamecore/ -run TestSkirmishFullMatchRegression -v -timeout 40m
//
// 每个 seed 会 t.Logf 出进攻波次时间点、科技完成时间、p95/最坏 tick。
//
// 已知差距（2026-10-08 实测，未达 D 的节奏目标，留待下一轮）：
//   - 电磁学在 tick 8000–16000 之间才完成（目标 8000），weapon_system 更晚。
//     建议方向：提高熔炉/制造台目标数（hard 当前 smelterTarget=3/assemblerTarget=4），
//     让矩阵专机的上游（磁线圈/电路板）优先用机器而非机甲手搓补料。
//
// pt1009-g2（试玩 G2 的 seed）修复前把玩家出生点放在一座 145 格孤岛上；
// mapgen/connectivity.go 的连通性保证落地后纳入回归。
func TestSkirmishFullMatchRegression(t *testing.T) {
	if testing.Short() {
		t.Skip("整局遭遇战模拟（每个 seed 约 2–4 分钟）；用 -run 单跑")
	}
	for _, seed := range []string{"skirmish-seed-001", "pt1009-seed", "pt1009-g2"} {
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
	for i := 0; i < 6; i++ {
		pos := botTileAtDistance(t, ws, p1Home, 2+i)
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", pos)
	}
	p1Exec := executorForPlayer(t, ws, "p1")
	p2Exec := executorForPlayer(t, ws, "p2")
	p2Home := botPlayerHQ(t, ws, "p2").Position

	const (
		simTicks    = 30000
		nearBase    = 12
		stuckTicks  = 3000
		waveGapTick = 800 // 两次"推进到基地附近"至少间隔这么久才算新的一波
	)
	type snapshot struct {
		pos  model.Position
		tick int64
	}
	lastMove := map[string]snapshot{}
	lastApproach := int64(-1 << 40)
	waves := 0
	var firstApproach int64 = -1
	var waveTicks []int64
	var stuck []string
	slowTicks := 0
	var worstTick int64
	var worstDur int64
	techAt := map[string]int64{}

	for ws.Tick < simTicks {
		core.processTick()
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
				if u.Stance == model.UnitStanceAttackMove && ws.SurfaceDistance(u.Position, p2Home) > 20 {
					stuck = append(stuck, id)
				}
			}
			if ws.SurfaceDistance(u.Position, p1Home) <= nearBase && ws.Tick-lastApproach > waveGapTick {
				waves++
				waveTicks = append(waveTicks, ws.Tick)
				if firstApproach < 0 {
					firstApproach = ws.Tick
				}
				lastApproach = ws.Tick
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

	t.Logf("seed=%s waves=%d waveTicks=%v firstApproach=%d techAt=%v slowTicks=%d worstTick=%d(%dms) p95=%.1fms p99=%.1fms",
		seed, waves, waveTicks, firstApproach, techAt, slowTicks, worstTick, worstDur, core.metrics.p95(), core.metrics.p99())

	// 1) 首攻之后不止一波进攻。
	if firstApproach < 0 {
		t.Fatal("bot never pushed any ground unit near the player base")
	}
	if firstApproach < core.cfg.Battlefield.BotFirstAttackTick {
		t.Fatalf("bot attacked at tick %d before bot_first_attack_tick %d", firstApproach, core.cfg.Battlefield.BotFirstAttackTick)
	}
	if waves < 2 {
		t.Fatalf("bot launched only %d approach waves (first at tick %d), want at least 2", waves, firstApproach)
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

	// 5) 整局没有 >100ms 的 tick（告警线）。
	if slowTicks > 0 {
		t.Fatalf("%d ticks over 100ms (worst %dms at tick %d)", slowTicks, worstDur, worstTick)
	}

	// 6) 科技链：电磁学 + 链上至少再完成一项。
	tech := ws.Players["p2"].Tech
	if tech.CompletedTechs["electromagnetism"] <= 0 {
		t.Fatalf("bot never completed electromagnetism by tick %d (completed=%v current=%v)",
			ws.Tick, tech.CompletedTechs, tech.CurrentResearch)
	}
	chainDone := 0
	for _, id := range []string{"automatic_metallurgy", "weapon_system"} {
		if tech.CompletedTechs[id] > 0 {
			chainDone++
		}
	}
	if chainDone < 1 {
		t.Fatalf("bot stalled on the weapon chain after electromagnetism (completed=%v current=%v)",
			tech.CompletedTechs, tech.CurrentResearch)
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
