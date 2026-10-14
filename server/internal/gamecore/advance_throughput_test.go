package gamecore

import (
	"testing"
	"time"

	"siliconworld/internal/model"
)

// 中局快进吞吐：真实遭遇战预设（config-skirmish + map-skirmish，p2 是 bot）先跑一段
// 让双方发育出若干建筑与单位，再测量快进的实际 ticks_per_sec（写进验收报告）。
//
// 默认跳过（跑得慢）；单跑：
//
//	cd server && go test ./internal/gamecore/ -run TestAdvanceThroughputSkirmish -v -timeout 20m
func TestAdvanceThroughputSkirmish(t *testing.T) {
	if testing.Short() {
		t.Skip("中局吞吐基准（跑数分钟）；用 -run 单跑")
	}
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	// 沙盒规则：基准只关心吞吐，不要因某一方被淘汰提前结束。
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox

	const warmupTicks = 40000
	warmStart := time.Now()
	for i := int64(0); i < warmupTicks; i++ {
		core.processTick()
	}
	warmElapsed := time.Since(warmStart)

	ws := core.World()
	ws.RLock()
	buildings := len(ws.Buildings)
	units := len(ws.Units)
	ws.RUnlock()

	// 中局快进：停止条件全关，跑满目标，测量真实吞吐。
	const measureTicks = 2000
	start := time.Now()
	res, err := core.Advance(AdvanceSpec{Ticks: measureTicks, StopOn: AdvanceStopOn{}}, nil)
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	wall := time.Since(start)
	if res.EndTick-res.StartTick != measureTicks {
		t.Fatalf("advance ticks = %d, want %d", res.EndTick-res.StartTick, measureTicks)
	}

	t.Logf("中局快进吞吐：%d tick / %.0f ms = %.0f tick/s（建筑 %d，单位 %d，tick %d→%d）",
		measureTicks, float64(wall.Microseconds())/1000.0, res.TicksPerSec, buildings, units, res.StartTick, res.EndTick)
	t.Logf("对照：普通 tick 循环 %d tick 用时 %.0f ms（%.0f tick/s）",
		warmupTicks, float64(warmElapsed.Microseconds())/1000.0, float64(warmupTicks)/warmElapsed.Seconds())

	// 密集场景：再塞 60 个单位 + 20 座建筑（中局军团规模），测量最坏一侧吞吐。
	spawnDenseAdvanceFixture(t, core)
	ws.RLock()
	denseBuildings := len(ws.Buildings)
	denseUnits := len(ws.Units)
	ws.RUnlock()

	denseStart := time.Now()
	dense, err := core.Advance(AdvanceSpec{Ticks: measureTicks, StopOn: AdvanceStopOn{}}, nil)
	if err != nil {
		t.Fatalf("dense advance: %v", err)
	}
	denseWall := time.Since(denseStart)
	t.Logf("密集快进吞吐：%d tick / %.0f ms = %.0f tick/s（建筑 %d，单位 %d）",
		measureTicks, float64(denseWall.Microseconds())/1000.0, dense.TicksPerSec, denseBuildings, denseUnits)

	// 快进必须明显快于实时节奏（10 tick/s），否则「狂飙」没有意义。
	if res.TicksPerSec < 100 {
		t.Fatalf("mid-game fast forward = %.0f tick/s, want >= 100", res.TicksPerSec)
	}
}

// spawnDenseAdvanceFixture 在中局世界上再塞一批单位与建筑（吞吐基准用）。
func spawnDenseAdvanceFixture(t *testing.T, core *GameCore) {
	t.Helper()
	ws := core.World()
	ws.Lock()
	defer ws.Unlock()

	owners := []string{"p1", "p2"}
	for i := 0; i < 60; i++ {
		owner := owners[i%len(owners)]
		pos := model.Position{X: 10 + (i*7)%70, Y: 10 + (i*13)%40}
		if !ws.InBounds(pos.X, pos.Y) {
			continue
		}
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, owner, pos)
	}
	for i := 0; i < 20; i++ {
		owner := owners[i%len(owners)]
		pos := model.Position{X: 5 + (i*11)%70, Y: 5 + (i*17)%40}
		if !ws.InBounds(pos.X, pos.Y) {
			continue
		}
		if ws.Grid[pos.Y][pos.X].BuildingID != "" {
			continue
		}
		placeBuilding(ws, newBuilding(ws.NextEntityID("b"), model.BuildingTypeSolarPanel, owner, pos))
	}
}
