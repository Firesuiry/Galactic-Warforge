package model

import (
	"reflect"
	"testing"
)

func mechaTechPlayer(levels map[string]int) *PlayerState {
	return &PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
		Tech:     &PlayerTechState{PlayerID: "p1", CompletedTechs: levels},
	}
}

func mechaExecutorUnit() *Unit {
	u := UnitStats(UnitTypeExecutor)
	u.ID = "exec"
	u.Type = UnitTypeExecutor
	u.OwnerID = "p1"
	return &u
}

func TestSyncMechaCapabilitiesDefaultsWithoutResearch(t *testing.T) {
	unit := mechaExecutorUnit()
	SyncMechaCapabilities(unit, mechaTechPlayer(nil))
	if unit.Mecha.MaxEnergy != 100 || unit.Mecha.MaxShield != 0 || unit.Mecha.InventoryCapacity != 200 {
		t.Fatalf("unexpected base mecha limits: %+v", unit.Mecha)
	}
	if unit.MaxHP != 120 || unit.MoveRange != 12 || unit.VisionRange != 6 {
		t.Fatalf("unexpected base unit stats: hp=%d move=%d vision=%d", unit.MaxHP, unit.MoveRange, unit.VisionRange)
	}
}

func TestSyncMechaCapabilitiesMechaCoreRaisesEnergyCap(t *testing.T) {
	unit := mechaExecutorUnit()
	player := mechaTechPlayer(map[string]int{"mecha_core": 3})
	SyncMechaCapabilities(unit, player)
	if unit.Mecha.MaxEnergy != 130 {
		t.Fatalf("mecha_core L3 should raise max energy to 130, got %d", unit.Mecha.MaxEnergy)
	}
	// Sync must never replenish energy on its own.
	if unit.Mecha.Energy != 100 {
		t.Fatalf("sync must not replenish energy, got %d", unit.Mecha.Energy)
	}
}

func TestSyncMechaCapabilitiesMechanicalFrameRaisesHP(t *testing.T) {
	unit := mechaExecutorUnit()
	unit.HP = 90 // damaged before research completed
	player := mechaTechPlayer(map[string]int{"mechanical_frame": 3})
	SyncMechaCapabilities(unit, player)
	if unit.MaxHP != 180 {
		t.Fatalf("mechanical_frame L3 should raise max HP to 180, got %d", unit.MaxHP)
	}
	if unit.HP != 90 {
		t.Fatalf("sync must not heal, HP changed to %d", unit.HP)
	}
}

func TestSyncMechaCapabilitiesDriveEngineStacksWithMechaEngine(t *testing.T) {
	unit := mechaExecutorUnit()
	player := mechaTechPlayer(map[string]int{"mecha_engine": 2, "drive_engine": 3})
	SyncMechaCapabilities(unit, player)
	// 12 base + 2*2 (mecha_engine move_speed) + 2*3 (drive_engine) = 22.
	if unit.MoveRange != 22 {
		t.Fatalf("expected stacked move range 22, got %d", unit.MoveRange)
	}
}

func TestSyncMechaCapabilitiesUniverseExplorationRaisesVision(t *testing.T) {
	unit := mechaExecutorUnit()
	player := mechaTechPlayer(map[string]int{"universe_exploration": 4})
	SyncMechaCapabilities(unit, player)
	if unit.VisionRange != 10 {
		t.Fatalf("universe_exploration L4 should raise vision to 10, got %d", unit.VisionRange)
	}
}

func TestSyncMechaCapabilitiesInventoryCapacityClampsLogisticsRequests(t *testing.T) {
	unit := mechaExecutorUnit()
	unit.Mecha.LogisticsRequests = map[string]MechaLogisticsRequest{
		"iron_plate": {Min: 400, Max: 500},
		"gear":       {Min: 10, Max: 50},
	}
	player := mechaTechPlayer(map[string]int{"inventory_capacity": 2})
	SyncMechaCapabilities(unit, player)
	if unit.Mecha.InventoryCapacity != 320 {
		t.Fatalf("inventory_capacity L2 should raise capacity to 320, got %d", unit.Mecha.InventoryCapacity)
	}
	clamped := unit.Mecha.LogisticsRequests["iron_plate"]
	if clamped.Max != 320 || clamped.Min != 320 {
		t.Fatalf("request above capacity must clamp to 320/320, got %+v", clamped)
	}
	untouched := unit.Mecha.LogisticsRequests["gear"]
	if untouched.Min != 10 || untouched.Max != 50 {
		t.Fatalf("request within capacity must stay, got %+v", untouched)
	}
}

func TestSyncMechaCapabilitiesIdempotentAcrossRestore(t *testing.T) {
	unit := mechaExecutorUnit()
	player := mechaTechPlayer(map[string]int{"mecha_core": 6, "drive_engine": 6, "mechanical_frame": 8})
	SyncMechaCapabilities(unit, player)
	first := *unit.Mecha.Clone()
	firstHP, firstMove, firstVision := unit.MaxHP, unit.MoveRange, unit.VisionRange
	// Simulate snapshot restore: clone then sync again — no accumulation.
	restored := unit.Clone()
	SyncMechaCapabilities(restored, player)
	if !reflect.DeepEqual(restored.Mecha, &first) {
		t.Fatalf("second sync accumulated state: %+v vs %+v", restored.Mecha, &first)
	}
	if restored.MaxHP != firstHP || restored.MoveRange != firstMove || restored.VisionRange != firstVision {
		t.Fatal("second sync changed derived unit stats")
	}
	if restored.Mecha.MaxEnergy != 160 || restored.MoveRange != 24 || restored.MaxHP != 280 {
		t.Fatalf("max-level bonuses wrong: %+v move=%d hp=%d", restored.Mecha, restored.MoveRange, restored.MaxHP)
	}
}

func TestCompletedTechLevelClampsToCatalogMaxLevel(t *testing.T) {
	player := mechaTechPlayer(map[string]int{"drive_engine": 99})
	if level := CompletedTechLevel(player, "drive_engine"); level != 6 {
		t.Fatalf("drive_engine level must clamp to MaxLevel 6, got %d", level)
	}
	if level := CompletedTechLevel(player, "mecha_core"); level != 0 {
		t.Fatalf("unresearched tech must be level 0, got %d", level)
	}
	if level := CompletedTechLevel(nil, "drive_engine"); level != 0 {
		t.Fatal("nil player must be level 0")
	}
}

func TestMechaChargeRateEnergyCircuitBonus(t *testing.T) {
	if rate := MechaChargeRate(10, mechaTechPlayer(nil)); rate != 10 {
		t.Fatalf("no research must keep base rate, got %d", rate)
	}
	if rate := MechaChargeRate(10, mechaTechPlayer(map[string]int{"energy_circuit": 3})); rate != 16 {
		t.Fatalf("energy_circuit L3 should give +60%% rate 16, got %d", rate)
	}
	if rate := MechaChargeRate(10, mechaTechPlayer(map[string]int{"energy_circuit": 6})); rate != 22 {
		t.Fatalf("energy_circuit L6 should give +120%% rate 22, got %d", rate)
	}
	if rate := MechaChargeRate(0, mechaTechPlayer(map[string]int{"energy_circuit": 6})); rate != 0 {
		t.Fatal("zero base rate must stay zero")
	}
}

func TestSyncLogisticsDroneStatsDroneEngineSpeed(t *testing.T) {
	ws := NewWorldState("planet-drones", 16)
	ws.Players["p1"] = mechaTechPlayer(map[string]int{"drone_engine": 2})
	ws.Players["p2"] = mechaTechPlayer(nil)
	boosted := NewLogisticsDroneState("d1", "st1", Position{X: 1, Y: 1})
	boosted.OwnerID = "p1"
	plain := NewLogisticsDroneState("d2", "st1", Position{X: 2, Y: 2})
	plain.OwnerID = "p2"
	ws.LogisticsDrones["d1"] = boosted
	ws.LogisticsDrones["d2"] = plain

	SyncLogisticsDroneStats(ws)

	if boosted.Speed != DefaultLogisticsDroneSpeed+6 {
		t.Fatalf("drone_engine L2 should raise speed to 10, got %d", boosted.Speed)
	}
	if plain.Speed != DefaultLogisticsDroneSpeed {
		t.Fatalf("unresearched owner keeps base speed, got %d", plain.Speed)
	}
	// Settlement consumption: faster speed shortens real flight time.
	baseTicks := LogisticsDroneTravelTicks(20, DefaultLogisticsDroneSpeed)
	boostedTicks := LogisticsDroneTravelTicks(20, boosted.Speed)
	if baseTicks != 5 || boostedTicks != 2 {
		t.Fatalf("travel ticks should drop 5 -> 2, got %d -> %d", baseTicks, boostedTicks)
	}
	if err := boosted.BeginTrip("st2", Position{X: 21, Y: 1}, 20); err != nil {
		t.Fatal(err)
	}
	if boosted.TravelTicks != 2 {
		t.Fatalf("BeginTrip must consume synced speed, travel ticks %d", boosted.TravelTicks)
	}
}

func TestSyncSolarSailLifetimesResearchBonus(t *testing.T) {
	rt := NewSpaceRuntimeState()
	system := rt.EnsurePlayerSystem("p1", "sys-1")
	system.SolarSailOrbit = &SolarSailOrbitState{
		PlayerID: "p1",
		SystemID: "sys-1",
		Sails: []SolarSail{
			{ID: "s1", LaunchTick: 0, LifetimeTicks: 36000, EnergyPerTick: 10},
			{ID: "s2", LaunchTick: 100, LifetimeTicks: 36000, EnergyPerTick: 10},
		},
	}
	players := map[string]*PlayerState{"p1": mechaTechPlayer(map[string]int{"solar_sail_life": 2})}

	SyncSolarSailLifetimes(rt, players)

	for _, sail := range system.SolarSailOrbit.Sails {
		if sail.LifetimeTicks != 36600 {
			t.Fatalf("solar_sail_life L2 should extend lifetime to 36600, got %d", sail.LifetimeTicks)
		}
	}
	// Idempotent re-sync keeps the same value.
	SyncSolarSailLifetimes(rt, players)
	if system.SolarSailOrbit.Sails[0].LifetimeTicks != 36600 {
		t.Fatal("re-sync changed lifetime")
	}
	// Players without research keep the default lifetime.
	SyncSolarSailLifetimes(rt, map[string]*PlayerState{"p1": mechaTechPlayer(nil)})
	if system.SolarSailOrbit.Sails[0].LifetimeTicks != 36000 {
		t.Fatal("lifetime must fall back to default without research")
	}
	SyncSolarSailLifetimes(nil, players) // must not panic
}

func TestSolarSailLifetimeTicksFloor(t *testing.T) {
	params := DefaultSolarSailOrbitParams()
	params.DefaultLifetime = 0
	if got := SolarSailLifetimeTicks(params, nil); got != 1 {
		t.Fatalf("lifetime must be at least 1 tick, got %d", got)
	}
}
