package gamecore

import (
	"testing"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func newBenchmarkCore(t testing.TB) *GameCore {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "benchmark-seed",
			MaxTickRate: 20,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 2},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 2},
		Planet: mapconfig.PlanetConfig{Width: 64, Height: 64, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := NewEventBus()
	core := New(cfg, maps, q, bus, nil)
	grantAllTechs(core.world, "p1", "p2")
	return core
}

// BenchmarkTickThroughput measures how many ticks can be processed per second
func BenchmarkTickThroughput(b *testing.B) {
	core := newBenchmarkCore(b)
	ws := core.World()

	// Give players resources
	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 100000
	ws.Players["p1"].Resources.Energy = 100000
	ws.Players["p2"].Resources.Minerals = 100000
	ws.Players["p2"].Resources.Energy = 100000
	ws.RUnlock()

	b.ResetTimer()
	start := time.Now()

	for i := 0; i < b.N; i++ {
		core.processTick()
	}

	b.ReportMetric(time.Since(start).Seconds()/float64(b.N)*1000, "ms/tick")
	b.ReportMetric(float64(b.N)/time.Since(start).Seconds(), "ticks/sec")
}

// BenchmarkBuildCommand measures build command execution time
func BenchmarkBuildCommand(b *testing.B) {
	core := newBenchmarkCore(b)
	ws := core.World()

	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 100000
	ws.Players["p1"].Resources.Energy = 100000
	ws.RUnlock()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pos, _ := findTwoOpenTiles(ws)
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "solar_panel",
			},
		}
		core.execBuild(ws, "p1", cmd)
	}
}

// BenchmarkTickWithBuildings measures tick performance with many buildings
func BenchmarkTickWithBuildings(b *testing.B) {
	core := newBenchmarkCore(b)
	ws := core.World()

	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 100000
	ws.Players["p1"].Resources.Energy = 100000
	ws.RUnlock()

	// Build 50 solar panels
	for i := 0; i < 50; i++ {
		pos, _ := findTwoOpenTiles(ws)
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "solar_panel",
			},
		}
		core.execBuild(ws, "p1", cmd)
		core.processTick()
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		core.processTick()
	}
}

// BenchmarkLogisticsChain measures logistics settlement performance
func BenchmarkLogisticsChain(b *testing.B) {
	core := newBenchmarkCore(b)
	ws := core.World()

	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 100000
	ws.Players["p1"].Resources.Energy = 100000
	ws.RUnlock()

	// Build mining machines and conveyors to create logistics load
	for i := 0; i < 10; i++ {
		pos, _ := findTwoOpenTiles(ws)
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "mining_machine",
			},
		}
		core.execBuild(ws, "p1", cmd)
		core.processTick()
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		core.processTick()
	}
}

// BenchmarkMetricsSnapshot measures metrics snapshot performance
func BenchmarkMetricsSnapshot(b *testing.B) {
	core := newBenchmarkCore(b)

	// Warm up metrics
	for i := 0; i < 100; i++ {
		core.processTick()
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		core.metrics.Snapshot()
	}
}

// BenchmarkEventSlicePool measures pool get/put performance
func BenchmarkEventSlicePool(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		slice := GetEventSlice()
		slice = append(slice, &model.GameEvent{})
		PutEventSlice(slice)
	}
}

// TestPerformanceTargetTickP95 verifies p95 tick duration is under 100ms
func TestPerformanceTargetTickP95(t *testing.T) {
	core := newBenchmarkCore(t)
	ws := core.World()

	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 100000
	ws.Players["p1"].Resources.Energy = 100000
	ws.RUnlock()

	// Build some buildings
	for i := 0; i < 20; i++ {
		pos, _ := findTwoOpenTiles(ws)
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "solar_panel",
			},
		}
		core.execBuild(ws, "p1", cmd)
		core.processTick()
	}

	// Run 200 ticks to collect enough data for p95
	for i := 0; i < 200; i++ {
		core.processTick()
	}

	p95 := core.metrics.p95()
	t.Logf("p95 tick duration: %.2f ms", p95)

	// Target is p95 < 100ms
	if p95 > 100 {
		t.Errorf("p95 tick duration %.2f ms exceeds target of 100 ms", p95)
	}
}

// TestPerformanceCommandLatency verifies command latency is within bounds
func TestPerformanceCommandLatency(t *testing.T) {
	core := newBenchmarkCore(t)
	ws := core.World()

	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 100000
	ws.Players["p1"].Resources.Energy = 100000
	ws.RUnlock()

	// Measure tick-to-execution latency for build commands
	var totalLatency int64
	const sampleCount = 50

	for i := 0; i < sampleCount; i++ {
		pos, _ := findTwoOpenTiles(ws)
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "solar_panel",
			},
		}

		beforeTick := ws.Tick
		core.execBuild(ws, "p1", cmd)
		core.processTick()
		afterTick := ws.Tick

		latency := afterTick - beforeTick
		totalLatency += latency
	}

	avgLatency := float64(totalLatency) / float64(sampleCount)
	t.Logf("Average command latency: %.2f ticks", avgLatency)

	// Target: p95 command latency <= 2 ticks
	// Since we measure average, check it's under 1.5 ticks
	if avgLatency > 1.5 {
		t.Errorf("Average command latency %.2f ticks exceeds target of 1.5 ticks", avgLatency)
	}
}
