package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

// chargingWorldWithTech builds a wireless-tower charging world whose network
// has real surplus, with the given completed techs for the owner.
func chargingWorldWithTech(t *testing.T, generators int, techs map[string]int, mechaEnergy int) (*model.WorldState, *model.Unit) {
	t.Helper()
	ws := model.NewWorldState("charging-tech", 32)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID:  "p1",
		IsAlive:   true,
		Resources: model.Resources{Energy: 0},
		Tech:      &model.PlayerTechState{PlayerID: "p1", CompletedTechs: techs},
	}
	tower := addPowerTestBuilding(ws, "tower", model.BuildingTypeWirelessPowerTower, model.Position{X: 4, Y: 4})
	tower.HP = 100
	tower.Runtime.State = model.BuildingWorkRunning
	for i := 0; i < generators; i++ {
		gen := addPowerTestBuilding(ws, "gen"+string(rune('a'+i)), model.BuildingTypeWindTurbine, model.Position{X: 5 + i, Y: 4})
		gen.HP = 100
		gen.Runtime.State = model.BuildingWorkRunning
	}
	unit := &model.Unit{ID: "mecha", Type: model.UnitTypeExecutor, OwnerID: "p1", HP: 100, Position: model.Position{X: 4, Y: 5}, Mecha: model.NewMechaState()}
	unit.Mecha.Energy = mechaEnergy
	ws.Units[unit.ID] = unit
	// The tick loop syncs derived caps in settleMechas before power settlement;
	// mirror that here so MaxEnergy reflects the completed research.
	model.SyncMechaCapabilities(unit, ws.Players["p1"])
	unit.Mecha.Energy = mechaEnergy
	return ws, unit
}

func settleChargingTick(ws *model.WorldState) {
	ws.Tick++
	model.RebuildPowerGrid(ws)
	settlePowerGeneration(ws, mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1})
	finalizePowerSettlement(ws, nil)
}

func TestMechaGridChargingEnergyCircuitBoostsRate(t *testing.T) {
	// Two wind turbines: supply 20, tower self-demand 1 -> surplus 19, so the
	// charge rate (not the surplus) is the binding constraint.
	ws, unit := chargingWorldWithTech(t, 2, map[string]int{"energy_circuit": 3}, 0)
	settleChargingTick(ws)
	// wireless base rate 10, +60% from energy_circuit L3 -> 16 delivered.
	if unit.Mecha.Energy != 16 {
		t.Fatalf("energy_circuit L3 should deliver 16 energy, got %d", unit.Mecha.Energy)
	}

	ws, unit = chargingWorldWithTech(t, 2, nil, 0)
	settleChargingTick(ws)
	if unit.Mecha.Energy != 10 {
		t.Fatalf("without research the base rate 10 should apply, got %d", unit.Mecha.Energy)
	}
}

func TestMechaGridChargingRespectsTechRaisedCapacity(t *testing.T) {
	// mecha_core L5 raises the core cap to 150; charging must stop at the cap.
	ws, unit := chargingWorldWithTech(t, 2, map[string]int{"mecha_core": 5}, 0)
	for i := 0; i < 20; i++ {
		settleChargingTick(ws)
	}
	if unit.Mecha.Energy != 150 {
		t.Fatalf("charging must fill up to the tech-raised cap 150, got %d", unit.Mecha.Energy)
	}

	// One tick before the cap: only the missing 1 energy is delivered.
	ws, unit = chargingWorldWithTech(t, 2, map[string]int{"mecha_core": 5}, 149)
	settleChargingTick(ws)
	if unit.Mecha.Energy != 150 {
		t.Fatalf("charging must clamp to capacity headroom, got %d", unit.Mecha.Energy)
	}

	// Without research the cap stays 100 and a full core draws nothing.
	ws, unit = chargingWorldWithTech(t, 2, nil, 100)
	settleChargingTick(ws)
	if unit.Mecha.Energy != 100 {
		t.Fatalf("full core must not charge, got %d", unit.Mecha.Energy)
	}
}

func TestSettleTechAssetSyncDroneSpeedAndSailLifetime(t *testing.T) {
	ws := model.NewWorldState("planet-assets", 16)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
		Tech:     &model.PlayerTechState{PlayerID: "p1", CompletedTechs: map[string]int{"drone_engine": 2, "solar_sail_life": 2}},
	}
	drone := model.NewLogisticsDroneState("d1", "st1", model.Position{X: 1, Y: 1})
	drone.OwnerID = "p1"
	ws.LogisticsDrones["d1"] = drone

	gc := &GameCore{spaceRuntime: model.NewSpaceRuntimeState()}
	sail := LaunchSolarSail(gc.spaceRuntime, "p1", "sys-1", 1.0, 0, 0)
	if sail == nil {
		t.Fatal("sail launch failed")
	}
	frame := &settlementFrame{currentTick: ws.Tick, currentWorld: ws, worlds: []*model.WorldState{ws}}

	settleTechAssetSync(gc, frame)

	if drone.Speed != model.DefaultLogisticsDroneSpeed+6 {
		t.Fatalf("drone_engine L2 should sync drone speed to 10, got %d", drone.Speed)
	}
	orbit := GetSolarSailOrbit(gc.spaceRuntime, "p1", "sys-1")
	if orbit.Sails[0].LifetimeTicks != 36600 {
		t.Fatalf("solar_sail_life L2 should sync lifetime to 36600, got %d", orbit.Sails[0].LifetimeTicks)
	}

	// Decay settlement consumes the synced lifetime: the sail outlives the
	// default 36000 ticks and expires exactly at the extended lifetime.
	events := settleSolarSails(gc.spaceRuntime, 36000)
	if len(events) != 0 || len(GetSolarSailOrbit(gc.spaceRuntime, "p1", "sys-1").Sails) != 1 {
		t.Fatal("sail must survive past the default lifetime with research")
	}
	events = settleSolarSails(gc.spaceRuntime, 36600)
	if len(events) != 1 || len(GetSolarSailOrbit(gc.spaceRuntime, "p1", "sys-1").Sails) != 0 {
		t.Fatalf("sail must decay at the extended lifetime, events=%v", events)
	}
}
