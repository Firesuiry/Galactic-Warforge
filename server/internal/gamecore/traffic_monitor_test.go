package gamecore

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func trafficFixture() (*model.WorldState, *model.Building, *model.Building, *model.Building) {
	ws := model.NewWorldState("traffic", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	monitor := surfaceTestBuilding(ws, "monitor", model.BuildingTypeTrafficMonitor, model.Position{X: 3, Y: 2})
	model.InitBuildingTrafficMonitor(monitor)
	source := newConveyorBuilding("source", model.Position{X: 3, Y: 3}, model.ConveyorEast)
	source.Conveyor.Throughput = 2
	attachBuilding(ws, source)
	sink := newConveyorBuilding("sink", model.Position{X: 4, Y: 3}, model.ConveyorEast)
	attachBuilding(ws, sink)
	monitor.TrafficMonitor = newTrafficMonitorConfig(source.ID, 3, 1, true)
	return ws, monitor, source, sink
}

func TestTrafficMonitorCountsSuccessfulDeparturesRatherThanInventoryDelta(t *testing.T) {
	ws, m, source, sink := trafficFixture()
	source.Conveyor.Insert(model.ItemIronOre, 5)
	for tick := 0; tick < 6; tick++ {
		ws.Tick = int64(tick)
		source.Conveyor.Insert(model.ItemIronOre, 2)
		sink.Conveyor.Take(99)
		settleConveyors(ws)
		events := settleTrafficMonitors(ws)
		if len(events) != 0 || source.Conveyor.TotalItems() != 5 || sink.Conveyor.TotalItems() != 2 {
			t.Fatal("monitor changed logistics or false alert")
		}
		s := m.TrafficMonitor
		if s.TotalItems != int64((tick+1)*2) || s.ItemsPerTick != 2 || s.WindowItems != min(tick+1, 3)*2 {
			t.Fatalf("wrong flow measurement: %+v", s)
		}
		if tick < 2 && s.State != "sampling" || tick >= 2 && s.State != "flowing" {
			t.Fatalf("wrong warmup state %s", s.State)
		}
		settleTrafficMonitors(ws)
		if s.TotalItems != int64((tick+1)*2) {
			t.Fatal("same tick sampled twice")
		}
		if err := s.Validate(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTrafficMonitorBlockedAlertOnlyOnTransitionsAndRecovery(t *testing.T) {
	ws, m, source, sink := trafficFixture()
	source.Conveyor.Insert(model.ItemIronOre, 4)
	sink.Conveyor.Insert(model.ItemCopperOre, 10)
	for tick := 0; tick < 5; tick++ {
		ws.Tick = int64(tick)
		settleConveyors(ws)
		events := settleTrafficMonitors(ws)
		if tick == 2 {
			if len(events) != 1 || events[0].EventType != model.EvtTrafficMonitorAlert || events[0].VisibilityScope != "p1" || events[0].Payload["alert_active"] != true || events[0].Payload["state"] != "blocked" || events[0].Payload["planet_id"] != "traffic" {
				t.Fatalf("missing alert edge: %+v", events)
			}
		} else if len(events) != 0 {
			t.Fatal("repeated alert or premature warmup alert")
		}
	}
	if !m.TrafficMonitor.AlertActive || m.TrafficMonitor.State != "blocked" || m.TrafficMonitor.TotalItems != 0 {
		t.Fatal("blocked monitoring not based on real success")
	}
	ws.Tick++
	sink.Conveyor.Take(99)
	settleConveyors(ws)
	events := settleTrafficMonitors(ws)
	if len(events) != 1 || m.TrafficMonitor.State != "low_flow" || !m.TrafficMonitor.AlertActive {
		t.Fatal("blocked→low flow severity transition missing")
	}
	ws.Tick++
	sink.Conveyor.Take(99)
	settleConveyors(ws)
	events = settleTrafficMonitors(ws)
	if len(events) != 1 || m.TrafficMonitor.AlertActive || events[0].Payload["alert_active"] != false || m.TrafficMonitor.State != "flowing" {
		t.Fatal("recovery did not clear alert")
	}
}

func TestTrafficMonitorEmptyBeltThresholdAndDisabledAlerts(t *testing.T) {
	for _, threshold := range []float64{0, 0.5} {
		ws, m, _, _ := trafficFixture()
		m.TrafficMonitor.MinimumItemsPerTick = threshold
		m.TrafficMonitor.AlertsEnabled = false
		for tick := 0; tick < 4; tick++ {
			ws.Tick = int64(tick)
			if events := settleTrafficMonitors(ws); len(events) != 0 {
				t.Fatal("disabled monitor emitted alert")
			}
		}
		want := "idle"
		if threshold > 0 {
			want = "low_flow"
		}
		if m.TrafficMonitor.State != want || m.TrafficMonitor.AlertActive {
			t.Fatalf("empty belt misreported blocked: %+v", m.TrafficMonitor)
		}
	}
}

func TestTrafficMonitorNoPowerInactiveAndMissingResetOnlyWindow(t *testing.T) {
	ws, m, source, _ := trafficFixture()
	source.Conveyor.Insert(model.ItemIronOre, 4)
	settleConveyors(ws)
	settleTrafficMonitors(ws)
	total := m.TrafficMonitor.TotalItems
	ws.Tick++
	settleResources(ws)
	if m.Runtime.State != model.BuildingWorkNoPower {
		t.Fatal("monitor did not require electricity")
	}
	settleTrafficMonitors(ws)
	if m.TrafficMonitor.State != "no_power" || m.TrafficMonitor.SampleCount != 0 || m.TrafficMonitor.TotalItems != total {
		t.Fatal("power loss forged zero samples or reset total")
	}
	m.Runtime.State = model.BuildingWorkRunning
	ws.Tick++
	settleTrafficMonitors(ws)
	if m.TrafficMonitor.State != "sampling" || m.TrafficMonitor.SampleCount != 1 {
		t.Fatal("resume reused stale window")
	}
	source.Runtime.State = model.BuildingWorkPaused
	ws.Tick++
	settleTrafficMonitors(ws)
	if m.TrafficMonitor.State != "target_inactive" || m.TrafficMonitor.SampleCount != 0 {
		t.Fatal("paused belt marked blocked")
	}
	delete(ws.Buildings, source.ID)
	ws.Tick++
	settleTrafficMonitors(ws)
	if m.TrafficMonitor.State != "target_missing" || m.TrafficMonitor.TotalItems != total {
		t.Fatal("missing target retained stale samples or lost total")
	}
	if err := m.TrafficMonitor.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestConfigureTrafficMonitorAtomicValidationAndClearing(t *testing.T) {
	ws, m, source, _ := trafficFixture()
	gc := &GameCore{}
	valid := map[string]any{"target_belt_id": source.ID, "window_ticks": 3, "minimum_items_per_tick": .5, "alerts_enabled": true}
	original := m.TrafficMonitor.Clone()
	cases := []struct {
		field string
		value any
	}{{"target_belt_id", "missing"}, {"target_belt_id", 5}, {"window_ticks", 0}, {"window_ticks", 601}, {"window_ticks", 1.5}, {"window_ticks", "3"}, {"minimum_items_per_tick", -1}, {"minimum_items_per_tick", 61}, {"minimum_items_per_tick", math.NaN()}, {"minimum_items_per_tick", math.Inf(1)}, {"minimum_items_per_tick", "1"}, {"alerts_enabled", "true"}}
	for _, tc := range cases {
		payload := map[string]any{}
		for key, value := range valid {
			payload[key] = value
		}
		payload[tc.field] = tc.value
		result, events := gc.execConfigureTrafficMonitor(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: m.ID}, Payload: payload})
		if result.Status != model.StatusFailed || len(events) != 0 || !reflect.DeepEqual(original, m.TrafficMonitor) {
			t.Fatalf("invalid config mutated state %s=%v: %+v", tc.field, tc.value, result)
		}
	}
	for missing := range valid {
		payload := map[string]any{}
		for key, value := range valid {
			if key != missing {
				payload[key] = value
			}
		}
		result, _ := gc.execConfigureTrafficMonitor(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: m.ID}, Payload: payload})
		if result.Status != model.StatusFailed {
			t.Fatalf("accepted missing %s", missing)
		}
	}
	command := model.Command{Target: model.CommandTarget{EntityID: m.ID}, Payload: valid}
	source.OwnerID = "enemy"
	if result, _ := gc.execConfigureTrafficMonitor(ws, "p1", command); result.Status != model.StatusFailed {
		t.Fatal("bound foreign belt")
	}
	source.OwnerID = "p1"
	source.Position = model.Position{X: 7, Y: 7}
	if result, _ := gc.execConfigureTrafficMonitor(ws, "p1", command); result.Status != model.StatusFailed {
		t.Fatal("bound remote belt")
	}
	source.Position = model.Position{X: 3, Y: 3}
	if result, _ := gc.execConfigureTrafficMonitor(ws, "enemy", command); result.Code != model.CodeNotOwner {
		t.Fatal("configured foreign monitor")
	}
	result, events := gc.execConfigureTrafficMonitor(ws, "p1", command)
	if result.Status != model.StatusExecuted || len(events) != 1 {
		t.Fatalf("valid config failed: %+v", result)
	}
	events[0].Payload["traffic_monitor"].(*model.TrafficMonitorState).WindowTicks = 999
	if m.TrafficMonitor.WindowTicks != 3 {
		t.Fatal("configuration event aliases state")
	}
	m.TrafficMonitor.AlertActive = true
	m.TrafficMonitor.State = "low_flow"
	valid["alerts_enabled"] = false
	result, events = gc.execConfigureTrafficMonitor(ws, "p1", command)
	if result.Status != model.StatusExecuted || len(events) != 2 || events[1].Payload["alert_active"] != false || m.TrafficMonitor.AlertActive {
		t.Fatal("disabling did not clear active alert")
	}
	valid["target_belt_id"] = ""
	result, _ = gc.execConfigureTrafficMonitor(ws, "p1", command)
	if result.Status != model.StatusExecuted || m.TrafficMonitor.State != "unconfigured" || m.TrafficMonitor.TotalItems != 0 {
		t.Fatal("unbind failed")
	}
}

func TestTrafficMonitorCrossSurfaceBindingAndRealConstruction(t *testing.T) {
	ws, m, source, _ := trafficFixture()
	m.Position = model.Position{X: 0, Y: 4}
	source.Position, _ = ws.SurfaceStep(m.Position, model.ConveyorWest)
	if trafficMonitorTarget(ws, m, source.ID) != source {
		t.Fatal("cross-face adjacent belt rejected")
	}
	core := newConstructionTestCore(t, 2, 2)
	pos, _ := findTwoOpenTiles(core.world)
	result, _ := core.execBuild(core.world, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": "traffic_monitor"}})
	if result.Status != model.StatusExecuted {
		t.Fatalf("build failed: %+v", result)
	}
	for _, task := range core.world.Construction.Tasks {
		if _, err := core.completeConstructionTask(core.world, task); err != nil {
			t.Fatal(err)
		}
	}
	for _, b := range core.world.Buildings {
		if b.Type == model.BuildingTypeTrafficMonitor {
			if b.TrafficMonitor == nil || b.TrafficMonitor.State != "unconfigured" || b.Conveyor != nil || model.PowerDemandForBuilding(b) != 1 {
				t.Fatal("wrong monitor construction profile")
			}
			return
		}
	}
	t.Fatal("monitor not constructed")
}

func TestTrafficMonitorSnapshotResumesPartialWindowDeterministically(t *testing.T) {
	ws, m, source, sink := trafficFixture()
	source.Conveyor.Insert(model.ItemIronOre, 8)
	for tick := 0; tick < 2; tick++ {
		ws.Tick = int64(tick)
		settleConveyors(ws)
		settleTrafficMonitors(ws)
		sink.Conveyor.Take(99)
	}
	encoded, err := json.Marshal(snapshot.CaptureWorld(ws))
	if err != nil {
		t.Fatal(err)
	}
	var saved snapshot.WorldSnapshot
	if err := json.Unmarshal(encoded, &saved); err != nil {
		t.Fatal(err)
	}
	replay, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	if replay.ConveyorTraffic != nil {
		t.Fatal("restored transient tick traffic")
	}
	for id, b := range replay.Buildings {
		if b.Conveyor != nil {
			b.Conveyor.MaxStack = ws.Buildings[id].Conveyor.MaxStack
			b.Conveyor.Throughput = ws.Buildings[id].Conveyor.Throughput
		}
	}
	for tick := 2; tick < 8; tick++ {
		ws.Tick = int64(tick)
		replay.Tick = int64(tick)
		sink.Conveyor.Take(99)
		replay.Buildings[sink.ID].Conveyor.Take(99)
		settleConveyors(ws)
		settleConveyors(replay)
		a, c := settleTrafficMonitors(ws), settleTrafficMonitors(replay)
		if !reflect.DeepEqual(a, c) || !reflect.DeepEqual(m.TrafficMonitor, replay.Buildings[m.ID].TrafficMonitor) {
			t.Fatalf("monitor window/alerts diverged after restore tick%d", tick)
		}
	}
	replay.Buildings[m.ID].TrafficMonitor.Samples[0].Items = 999
	if m.TrafficMonitor.Samples[0].Items == 999 {
		t.Fatal("restored monitor aliases live samples")
	}
	saved.Buildings[m.ID].TrafficMonitor.ItemsPerTick = math.NaN()
	if _, err := saved.Restore(); err == nil {
		t.Fatal("invalid monitoring snapshot accepted")
	}
}

func TestTrafficMonitorCapturesEveryRealBeltExitPath(t *testing.T) {
	count := func(ws *model.WorldState, id string) int {
		if ws.ConveyorTraffic == nil {
			return 0
		}
		return ws.ConveyorTraffic.Departed[id]
	}
	t.Run("ordinary machine input", func(t *testing.T) {
		ws := model.NewWorldState("io", 8)
		source := newConveyorBuilding("source", model.Position{X: 1, Y: 1}, model.ConveyorEast)
		depot := newDepotBuilding("depot", model.Position{X: 2, Y: 1})
		attachBuilding(ws, source)
		attachBuilding(ws, depot)
		source.Conveyor.Insert(model.ItemIronOre, 3)
		settleBuildingIO(ws)
		if count(ws, source.ID) != 2 || source.Conveyor.TotalItems() != 1 {
			t.Fatal("successful machine intake not measured")
		}
	})
	t.Run("sorter", func(t *testing.T) {
		ws := model.NewWorldState("sorter", 8)
		source := newConveyorBuilding("source", model.Position{X: 1, Y: 1}, model.ConveyorEast)
		sink := newConveyorBuilding("sink", model.Position{X: 3, Y: 1}, model.ConveyorEast)
		sorter := newSorterBuilding("arm", model.Position{X: 2, Y: 1})
		sorter.Sorter.InputDirections = []model.ConveyorDirection{model.ConveyorWest}
		sorter.Sorter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
		sorter.Sorter.Speed = 2
		attachBuilding(ws, source)
		attachBuilding(ws, sink)
		attachBuilding(ws, sorter)
		source.Conveyor.Insert(model.ItemIronOre, 3)
		settleSorters(ws)
		if count(ws, source.ID) != 2 || sink.Conveyor.TotalItems() != 2 {
			t.Fatal("sorter departure not measured")
		}
	})
	t.Run("fractionator", func(t *testing.T) {
		ws, _, belts := fractionationFixture()
		source := belts[model.ConveyorWest]
		source.Conveyor.Insert(model.ItemHydrogen, 6)
		settleFractionation(ws)
		if count(ws, source.ID) != 6 {
			t.Fatal("fractionator input not measured")
		}
	})
	t.Run("sprayer material and reagent", func(t *testing.T) {
		ws, _, belts := sprayCoaterFixture()
		belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 6)
		belts[model.ConveyorNorth].Conveyor.Insert(model.ItemProliferatorMk3, 1)
		settleSprayCoaters(ws)
		if count(ws, belts[model.ConveyorWest].ID) != 6 || count(ws, belts[model.ConveyorNorth].ID) != 1 {
			t.Fatal("sprayer material/reagent departure not measured")
		}
	})
	t.Run("rejected full machine input", func(t *testing.T) {
		ws := model.NewWorldState("full", 8)
		source := newConveyorBuilding("source", model.Position{X: 1, Y: 1}, model.ConveyorEast)
		depot := newDepotBuilding("depot", model.Position{X: 2, Y: 1})
		depot.Storage = model.NewStorageState(model.StorageModule{Capacity: 1, Slots: 1})
		depot.Storage.Load(model.ItemIronOre, 1)
		attachBuilding(ws, source)
		attachBuilding(ws, depot)
		source.Conveyor.Insert(model.ItemIronOre, 3)
		settleBuildingIO(ws)
		if count(ws, source.ID) != 0 || source.Conveyor.TotalItems() != 3 {
			t.Fatal("failed transfer counted as traffic")
		}
	})
}

func TestTrafficMonitorPowerLossClearsActiveAlert(t *testing.T) {
	ws, m, source, sink := trafficFixture()
	m.TrafficMonitor.WindowTicks = 1
	source.Conveyor.Insert(model.ItemIronOre, 2)
	sink.Conveyor.Insert(model.ItemIronOre, 10)
	settleConveyors(ws)
	settleTrafficMonitors(ws)
	if !m.TrafficMonitor.AlertActive {
		t.Fatal("fixture never blocked")
	}
	ws.Tick++
	m.Runtime.State = model.BuildingWorkNoPower
	events := settleTrafficMonitors(ws)
	if len(events) != 1 || events[0].Payload["state"] != "no_power" || events[0].Payload["alert_active"] != false || m.TrafficMonitor.SampleCount != 0 {
		t.Fatal("power loss retained stale traffic alert")
	}
	if len(settleTrafficMonitors(ws)) != 0 {
		t.Fatal("power loss resolution repeated")
	}
}

func TestTrafficMonitorDoesNotCallNewArrivalBlocked(t *testing.T) {
	ws, m, source, sink := trafficFixture()
	m.TrafficMonitor = newTrafficMonitorConfig(sink.ID, 1, 0, true)
	m.Position = model.Position{X: 4, Y: 2}
	source.Conveyor.Insert(model.ItemIronOre, 2)
	settleConveyors(ws)
	settleTrafficMonitors(ws)
	if sink.Conveyor.TotalItems() != 2 || m.TrafficMonitor.State == "blocked" || m.TrafficMonitor.Samples[0].QueuedItems != 0 {
		t.Fatal("new receipt mislabeled as stalled preexisting cargo")
	}
	ws.Tick++
	settleConveyors(ws)
	settleTrafficMonitors(ws)
	if m.TrafficMonitor.State != "blocked" {
		t.Fatal("existing cargo with no output failed to report blockage")
	}
}
