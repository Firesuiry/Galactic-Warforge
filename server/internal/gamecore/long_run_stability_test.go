package gamecore

import (
	"runtime"
	"testing"
	"time"

	"siliconworld/internal/model"
)

// TestLongRunStability is the T-D4 regression gate:
// build a mid-sized industrial base, then hang idle for many thousands of
// ticks and assert the world keeps advancing without panic, unbounded
// event drops, or tick-duration blow-up.
//
// Not a micro-benchmark — this is a CI-friendly soak that should stay
// under a few seconds on a laptop.
func TestLongRunStability(t *testing.T) {
	core := newBenchmarkCore(t)
	ws := core.World()

	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 1_000_000
	ws.Players["p1"].Resources.Energy = 1_000_000
	ws.RUnlock()

	// Seed a denser base than the short p95 check so settlement work is real.
	const seedBuildings = 40
	built := 0
	for i := 0; i < seedBuildings; i++ {
		pos, err := findOpenTile(ws, 1)
		if err != nil {
			break
		}
		buildingType := "solar_panel"
		if i%4 == 0 {
			buildingType = "mining_machine"
		} else if i%4 == 1 {
			buildingType = "wind_turbine"
		} else if i%4 == 2 {
			buildingType = "tesla_tower"
		}
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: pos},
			Payload: map[string]any{
				"building_type": buildingType,
			},
		}
		res, _ := core.execBuild(ws, "p1", cmd)
		if res.Status == model.StatusExecuted {
			built++
		}
		core.processTick()
	}
	if built < 10 {
		t.Fatalf("seeded only %d buildings, need a real industrial base", built)
	}

	// Drain a lagging subscriber so Publish can exercise the drop path without
	// polluting the soak baseline: we only assert dropped does not grow
	// during the hang when nobody is subscribed.
	droppedBefore := core.bus.DroppedCount()
	startTick := ws.Tick
	startMetricsTick := core.GetMetrics().TickCount

	var memBefore runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&memBefore)

	const soakTicks = 5_000
	started := time.Now()
	for i := 0; i < soakTicks; i++ {
		core.processTick()
	}
	elapsed := time.Since(started)

	endTick := ws.Tick
	if endTick-startTick != soakTicks {
		t.Fatalf("tick advanced by %d, want %d", endTick-startTick, soakTicks)
	}

	metrics := core.GetMetrics()
	if metrics.TickCount-startMetricsTick < int64(soakTicks) {
		t.Fatalf("metrics TickCount advanced by %d, want >= %d",
			metrics.TickCount-startMetricsTick, soakTicks)
	}

	p95 := metrics.p95()
	p99 := metrics.p99()
	lastMs := float64(metrics.LastTickDur.Milliseconds())
	t.Logf("soak %d ticks in %s (%.2f ticks/s); buildings=%d; p95=%.2fms p99=%.2fms last=%.2fms",
		soakTicks, elapsed.Round(time.Millisecond),
		float64(soakTicks)/elapsed.Seconds(),
		built, p95, p99, lastMs)

	// Soft ceiling: 100ms matches TestPerformanceTargetTickP95. On a loaded
	// CI host a single spike may push lastMs, so gate on the window percentiles.
	if p95 > 100 {
		t.Errorf("p95 tick duration %.2f ms exceeds 100 ms ceiling", p95)
	}
	if p99 > 200 {
		t.Errorf("p99 tick duration %.2f ms exceeds 200 ms ceiling", p99)
	}

	droppedAfter := core.bus.DroppedCount()
	if droppedAfter < droppedBefore {
		t.Fatalf("dropped_events went backwards: %d -> %d", droppedBefore, droppedAfter)
	}
	if droppedAfter-droppedBefore != 0 {
		t.Errorf("event bus dropped %d events during idle soak (no subscribers expected)",
			droppedAfter-droppedBefore)
	}

	// Memory: allow growth but fail hard on multi-GB leaks during 5k ticks.
	var memAfter runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&memAfter)
	var heapDelta int64
	if memAfter.HeapAlloc >= memBefore.HeapAlloc {
		heapDelta = int64(memAfter.HeapAlloc - memBefore.HeapAlloc)
	} else {
		heapDelta = -int64(memBefore.HeapAlloc - memAfter.HeapAlloc)
	}
	t.Logf("heap alloc delta after GC: %+d bytes (before=%d after=%d)",
		heapDelta, memBefore.HeapAlloc, memAfter.HeapAlloc)
	const maxHeapGrowth = 256 << 20 // 256 MiB
	if heapDelta > maxHeapGrowth {
		t.Errorf("heap grew by %d bytes over soak, exceeds %d", heapDelta, maxHeapGrowth)
	}

	// World still coherent after hang.
	ws.RLock()
	buildingCount := len(ws.Buildings)
	playerAlive := ws.Players["p1"] != nil && ws.Players["p1"].IsAlive
	ws.RUnlock()
	if buildingCount < built {
		t.Errorf("buildings disappeared during soak: have %d, seeded %d", buildingCount, built)
	}
	if !playerAlive {
		t.Error("p1 is no longer alive after soak")
	}
}

// TestLongRunStabilityWithSubscriber ensures a live SSE-style consumer that
// keeps up does not accumulate drops across a long hang, and that the core
// still settles while events are being published.
func TestLongRunStabilityWithSubscriber(t *testing.T) {
	core := newBenchmarkCore(t)
	ws := core.World()

	ws.RLock()
	ws.Players["p1"].Resources.Minerals = 500_000
	ws.Players["p1"].Resources.Energy = 500_000
	ws.RUnlock()

	for i := 0; i < 15; i++ {
		pos, err := findOpenTile(ws, 1)
		if err != nil {
			break
		}
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: pos},
			Payload: map[string]any{"building_type": "wind_turbine"},
		}
		core.execBuild(ws, "p1", cmd)
		core.processTick()
	}

	ch := core.bus.Subscribe("soak-sub", nil)
	defer core.bus.Unsubscribe("soak-sub")

	// Drain in background so the 256-buffer never fills under normal load.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range ch {
		}
	}()

	droppedBefore := core.bus.DroppedCount()
	startTick := ws.Tick
	const soakTicks = 2_000
	for i := 0; i < soakTicks; i++ {
		core.processTick()
	}
	if got := ws.Tick - startTick; got != soakTicks {
		t.Fatalf("tick advanced by %d, want %d", got, soakTicks)
	}

	// Give the drain goroutine a moment to catch any residual publishes.
	time.Sleep(20 * time.Millisecond)
	droppedAfter := core.bus.DroppedCount()
	if droppedAfter != droppedBefore {
		t.Errorf("subscriber fell behind: dropped %d -> %d (delta %d)",
			droppedBefore, droppedAfter, droppedAfter-droppedBefore)
	}

	core.bus.Unsubscribe("soak-sub")
	<-done
}
