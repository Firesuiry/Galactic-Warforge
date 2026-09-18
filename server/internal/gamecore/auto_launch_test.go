package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// nextAutoLaunchTick returns the first tick > fromTick on which the building's
// automatic launch cadence fires.
func nextAutoLaunchTick(buildingID string, interval int, fromTick int64) int64 {
	offset := launchPhaseOffset(buildingID, interval)
	for t := fromTick + 1; ; t++ {
		if (t+offset)%int64(interval) == 0 {
			return t
		}
	}
}

func makeLaunchBuildingReady(b *model.Building) {
	b.Runtime.Params.EnergyConsume = 0
	if b.Runtime.Functions.Energy != nil {
		b.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	b.Runtime.State = model.BuildingWorkRunning
}

// G2: em_rail_ejector 装料后按 LaunchInterval 自动连续发射太阳帆并扣能。
func TestAutoLaunchSolarSailFiresOnCadence(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	ejector := newEMRailEjectorBuilding("ejector-auto", model.Position{X: 6, Y: 6}, "p1")
	makeLaunchBuildingReady(ejector)
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 3
	attachBuilding(ws, ejector)

	ws.Players["p1"].Resources.Energy = 1000

	lm := ejector.Runtime.Functions.Launch
	fireTick := nextAutoLaunchTick(ejector.ID, lm.LaunchInterval, ws.Tick)
	ws.Tick = fireTick - 1
	core.processTick()

	orbit := GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1")
	if orbit == nil || len(orbit.Sails) != 1 {
		t.Fatalf("expected 1 auto-launched sail, got %+v", orbit)
	}
	if got := ejector.Storage.OutputQuantity(model.ItemSolarSail); got != 2 {
		t.Fatalf("expected 2 sails left, got %d", got)
	}
	if got := ws.Players["p1"].Resources.Energy; got != 1000-lm.EnergyPerLaunch {
		t.Fatalf("expected energy %d after launch, got %d", 1000-lm.EnergyPerLaunch, got)
	}

	// 非节拍 tick 不发射。
	core.processTick()
	orbit = GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1")
	if orbit == nil || len(orbit.Sails) != 1 {
		t.Fatalf("expected no launch off cadence, got %+v", orbit)
	}

	// 下一个节拍继续自动发射（连续）。
	nextFire := fireTick + int64(lm.LaunchInterval)
	ws.Tick = nextFire - 1
	core.processTick()
	orbit = GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1")
	if orbit == nil || len(orbit.Sails) != 2 {
		t.Fatalf("expected 2 sails after second cadence, got %+v", orbit)
	}
	if got := ws.Players["p1"].Resources.Energy; got != 1000-2*lm.EnergyPerLaunch {
		t.Fatalf("expected energy %d after two launches, got %d", 1000-2*lm.EnergyPerLaunch, got)
	}
}

// G2 边界：断电（未接电网）时不自动发射。
func TestAutoLaunchSkipsWhenUnpowered(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	ejector := newEMRailEjectorBuilding("ejector-unpowered", model.Position{X: 6, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 1
	attachBuilding(ws, ejector)

	ws.Players["p1"].Resources.Energy = 1000

	lm := ejector.Runtime.Functions.Launch
	fireTick := nextAutoLaunchTick(ejector.ID, lm.LaunchInterval, ws.Tick)
	ws.Tick = fireTick - 1
	core.processTick()

	if ejector.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("expected ejector to be marked no-power, got %s", ejector.Runtime.State)
	}
	if orbit := GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1"); orbit != nil && len(orbit.Sails) != 0 {
		t.Fatalf("expected no sail launch while unpowered, got %+v", orbit)
	}
	if got := ejector.Storage.OutputQuantity(model.ItemSolarSail); got != 1 {
		t.Fatalf("expected sail retained while unpowered, got %d", got)
	}
	if got := ws.Players["p1"].Resources.Energy; got != 1000 {
		t.Fatalf("expected energy unchanged while unpowered, got %d", got)
	}
}

// G2 边界：能量储备不足一次发射时不发射。
func TestAutoLaunchSkipsWithoutEnoughEnergy(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	ejector := newEMRailEjectorBuilding("ejector-poor", model.Position{X: 6, Y: 6}, "p1")
	makeLaunchBuildingReady(ejector)
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 1
	attachBuilding(ws, ejector)

	lm := ejector.Runtime.Functions.Launch
	ws.Players["p1"].Resources.Energy = lm.EnergyPerLaunch - 1

	fireTick := nextAutoLaunchTick(ejector.ID, lm.LaunchInterval, ws.Tick)
	ws.Tick = fireTick - 1
	core.processTick()

	if orbit := GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1"); orbit != nil && len(orbit.Sails) != 0 {
		t.Fatalf("expected no sail launch without energy, got %+v", orbit)
	}
	if got := ejector.Storage.OutputQuantity(model.ItemSolarSail); got != 1 {
		t.Fatalf("expected sail retained without energy, got %d", got)
	}
}

// G2 边界：未装料时不发射。
func TestAutoLaunchSkipsWithoutLoadedSails(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	ejector := newEMRailEjectorBuilding("ejector-empty", model.Position{X: 6, Y: 6}, "p1")
	makeLaunchBuildingReady(ejector)
	attachBuilding(ws, ejector)

	ws.Players["p1"].Resources.Energy = 1000

	lm := ejector.Runtime.Functions.Launch
	fireTick := nextAutoLaunchTick(ejector.ID, lm.LaunchInterval, ws.Tick)
	ws.Tick = fireTick - 1
	core.processTick()

	if orbit := GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1"); orbit != nil && len(orbit.Sails) != 0 {
		t.Fatalf("expected no sail launch without loaded sails, got %+v", orbit)
	}
	if got := ws.Players["p1"].Resources.Energy; got != 1000 {
		t.Fatalf("expected energy unchanged without loaded sails, got %d", got)
	}
}

// G2: vertical_launching_silo 装料后自动向戴森层发射火箭并扣能。
func TestAutoLaunchRocketIntoDysonLayer(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "lightweight_structure")

	nodeCmd := model.Command{
		Type: model.CmdBuildDysonNode,
		Payload: map[string]any{
			"system_id":   "sys-1",
			"layer_index": 0,
			"latitude":    5.0,
			"longitude":   10.0,
		},
	}
	if res, _ := core.execBuildDysonNode(ws, "p1", nodeCmd); res.Code != model.CodeOK {
		t.Fatalf("build dyson node failed: %s (%s)", res.Code, res.Message)
	}

	silo := newVerticalLaunchingSiloBuilding("silo-auto", model.Position{X: 8, Y: 8}, "p1")
	makeLaunchBuildingReady(silo)
	silo.Storage.EnsureInventory()[model.ItemSmallCarrierRocket] = 2
	attachBuilding(ws, silo)

	ws.Players["p1"].Resources.Energy = 1000

	lm := silo.Runtime.Functions.Launch
	fireTick := nextAutoLaunchTick(silo.ID, lm.LaunchInterval, ws.Tick)
	ws.Tick = fireTick - 1
	core.processTick()

	state := GetDysonSphereState(core.spaceRuntime, "p1", "sys-1")
	if state == nil || len(state.Layers) == 0 {
		t.Fatal("expected dyson layer state")
	}
	if got := state.Layers[0].RocketLaunches; got != 1 {
		t.Fatalf("expected 1 auto rocket launch, got %d", got)
	}
	if got := silo.Storage.OutputQuantity(model.ItemSmallCarrierRocket); got != 1 {
		t.Fatalf("expected 1 rocket left, got %d", got)
	}
	if got := ws.Players["p1"].Resources.Energy; got != 1000-lm.EnergyPerLaunch {
		t.Fatalf("expected energy %d after rocket launch, got %d", 1000-lm.EnergyPerLaunch, got)
	}
}

// G2 边界：没有任何带脚手架的戴森层时火箭不发射。
func TestAutoLaunchRocketSkipsWithoutDysonScaffold(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()

	silo := newVerticalLaunchingSiloBuilding("silo-no-target", model.Position{X: 8, Y: 8}, "p1")
	makeLaunchBuildingReady(silo)
	silo.Storage.EnsureInventory()[model.ItemSmallCarrierRocket] = 1
	attachBuilding(ws, silo)

	ws.Players["p1"].Resources.Energy = 1000

	lm := silo.Runtime.Functions.Launch
	fireTick := nextAutoLaunchTick(silo.ID, lm.LaunchInterval, ws.Tick)
	ws.Tick = fireTick - 1
	core.processTick()

	if got := silo.Storage.OutputQuantity(model.ItemSmallCarrierRocket); got != 1 {
		t.Fatalf("expected rocket retained without dyson scaffold, got %d", got)
	}
	if got := ws.Players["p1"].Resources.Energy; got != 1000 {
		t.Fatalf("expected energy unchanged without dyson scaffold, got %d", got)
	}
}
