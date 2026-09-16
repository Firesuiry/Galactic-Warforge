package gamecore

import (
	"fmt"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	"testing"
)

func mechaChargingWorld() (*model.WorldState, *model.Building, *model.Building, *model.Unit) {
	ws := model.NewWorldState("charging", 32)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Resources: model.Resources{Energy: 20}}
	tower := addPowerTestBuilding(ws, "tower", model.BuildingTypeWirelessPowerTower, model.Position{X: 4, Y: 4})
	generator := addPowerTestBuilding(ws, "generator", model.BuildingTypeWindTurbine, model.Position{X: 5, Y: 4})
	for _, b := range []*model.Building{tower, generator} {
		b.HP = 100
		b.Runtime.State = model.BuildingWorkRunning
	}
	unit := &model.Unit{ID: "mecha", Type: model.UnitTypeExecutor, OwnerID: "p1", HP: 100, Position: model.Position{X: 4, Y: 5}, Mecha: model.NewMechaState()}
	unit.Mecha.Energy = 50
	ws.Units[unit.ID] = unit
	return ws, tower, generator, unit
}
func settleChargingPower(ws *model.WorldState) []*model.GameEvent {
	ws.Tick++
	model.RebuildPowerGrid(ws)
	settlePowerGeneration(ws, mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1})
	return finalizePowerSettlement(ws, nil)
}
func TestMechaGridChargingConservesNetworkEnergy(t *testing.T) {
	for _, start := range []int{20, 10000} {
		t.Run(fmt.Sprint(start), func(t *testing.T) {
			ws, tower, _, unit := mechaChargingWorld()
			ws.Players["p1"].Resources.Energy = start
			events := settleChargingPower(ws)
			if unit.Mecha.Energy != 59 {
				t.Fatalf("expected generation 10 minus standby 1 delivered, got %d", unit.Mecha.Energy)
			}
			if ws.Players["p1"].Resources.Energy != start {
				t.Fatal("generation credited twice or cap caused double deduction")
			}
			network := ws.PowerSnapshot.Allocations.Networks[ws.PowerSnapshot.Networks.BuildingNetwork[tower.ID]]
			if network.Supply != 10 || network.Allocated != 10 || network.Net != 0 {
				t.Fatalf("incorrect accounting: %+v", network)
			}
			if len(events) != 1 || events[0].Payload["grid_charge"] != 9 || events[0].Payload["charging_building_id"] != tower.ID {
				t.Fatalf("missing charge event: %+v", events)
			}
		})
	}
}
func TestMechaGridChargingRequiresLocalRunningGrid(t *testing.T) {
	cases := map[string]func(*model.WorldState, *model.Building, *model.Building, *model.Unit){
		"paused_tower": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			tower.Runtime.State = model.BuildingWorkPaused
		},
		"unpowered_tower": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			tower.Runtime.State = model.BuildingWorkNoPower
		},
		"paused_generator": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			generator.Runtime.State = model.BuildingWorkPaused
		},
		"remote_generation": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			generator.Position = model.Position{X: 25, Y: 25}
		},
		"out_of_range": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			u.Position = model.Position{X: 25, Y: 25}
		},
		"foreign_mecha": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			u.OwnerID = "p2"
			ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
		},
		"dead_mecha": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) { u.HP = 0 },
		"dead_player": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			ws.Players["p1"].IsAlive = false
		},
		"full_load": func(ws *model.WorldState, tower, generator *model.Building, u *model.Unit) {
			b := addPowerTestBuilding(ws, "load", model.BuildingTypeMatrixLab, model.Position{X: 4, Y: 3})
			b.Runtime.Params.EnergyConsume = 100
			b.Runtime.State = model.BuildingWorkRunning
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			ws, tower, generator, u := mechaChargingWorld()
			change(ws, tower, generator, u)
			settleChargingPower(ws)
			if u.Mecha.Energy != 50 {
				t.Fatalf("charged without spare local power: %d", u.Mecha.Energy)
			}
		})
	}
}
func TestMechaGridChargingSharesSurplusWithAccumulator(t *testing.T) {
	ws, _, _, u := mechaChargingWorld()
	acc := addPowerTestBuilding(ws, "accumulator", model.BuildingTypeAccumulator, model.Position{X: 4, Y: 3})
	model.InitBuildingEnergyStorage(acc)
	acc.Runtime.Functions.EnergyStorage.ChargeEfficiency = 1
	acc.Runtime.Functions.EnergyStorage.ChargePerTick = 100
	acc.EnergyStorage.Energy = 0
	settleChargingPower(ws)
	if acc.EnergyStorage.Energy != 9 || u.Mecha.Energy != 50 || ws.Players["p1"].Resources.Energy != 20 {
		t.Fatalf("duplicated surplus: battery=%d core=%d player=%d", acc.EnergyStorage.Energy, u.Mecha.Energy, ws.Players["p1"].Resources.Energy)
	}
}
func TestMechaGridChargingCapsRateAndCoreGap(t *testing.T) {
	ws, _, _, u := mechaChargingWorld()
	g2 := addPowerTestBuilding(ws, "second-generator", model.BuildingTypeWindTurbine, model.Position{X: 5, Y: 5})
	g2.Runtime.State = model.BuildingWorkRunning
	settleChargingPower(ws)
	if u.Mecha.Energy != 60 {
		t.Fatalf("wireless rate exceeded: %d", u.Mecha.Energy)
	}
	u.Mecha.Energy = 99
	settleChargingPower(ws)
	if u.Mecha.Energy != 100 {
		t.Fatalf("core overcharged: %d", u.Mecha.Energy)
	}
	before := ws.Players["p1"].Resources.Energy
	settleChargingPower(ws)
	if ws.Players["p1"].Resources.Energy != before+19 {
		t.Fatal("full core still consumed grid power")
	}
}
func TestMechaGridChargingDoesNotDuplicateFuelCharge(t *testing.T) {
	ws, _, _, u := mechaChargingWorld()
	u.Mecha.Energy = 95
	u.Mecha.FuelEnergy = 50
	settleMechas(ws)
	events := settleChargingPower(ws)
	if u.Mecha.Energy != 100 || u.Mecha.FuelEnergy != 45 {
		t.Fatal("fuel and grid overcharged core")
	}
	for _, e := range events {
		if e.EventType == model.EvtMechaStateChanged {
			t.Fatal("full fuel-charged core drew grid energy")
		}
	}
}
func TestTeslaTowerChargesMoreSlowly(t *testing.T) {
	ws, tower, _, u := mechaChargingWorld()
	tower.Type = model.BuildingTypeTeslaTower
	tower.Runtime = model.BuildingProfileFor(tower.Type, 1).Runtime
	tower.Runtime.State = model.BuildingWorkRunning
	settleChargingPower(ws)
	if u.Mecha.Energy != 52 || ws.Players["p1"].Resources.Energy != 28 {
		t.Fatalf("tesla accounting: core=%d player=%d", u.Mecha.Energy, ws.Players["p1"].Resources.Energy)
	}
}

func TestMechaGridChargingCompetingUnitsCannotDoubleSpend(t *testing.T) {
	ws, _, _, first := mechaChargingWorld()
	first.Mecha.Energy = 99
	second := &model.Unit{ID: "second-mecha", Type: model.UnitTypeExecutor, OwnerID: "p1", HP: 100, Position: first.Position, Mecha: model.NewMechaState()}
	second.Mecha.Energy = 50
	ws.Units[second.ID] = second
	settleChargingPower(ws)
	if first.Mecha.Energy != 100 || second.Mecha.Energy != 58 || ws.Players["p1"].Resources.Energy != 20 {
		t.Fatalf("competing cores consumed wrong surplus: first=%d second=%d player=%d", first.Mecha.Energy, second.Mecha.Energy, ws.Players["p1"].Resources.Energy)
	}
}

func TestMechaGridChargingCrossesSurfaceSeam(t *testing.T) {
	ws, tower, generator, u := mechaChargingWorld()
	tower.Position = model.Position{X: 0, Y: 16}
	generator.Position = model.Position{X: 1, Y: 16}
	u.Position, _ = ws.SurfaceStep(tower.Position, model.ConveyorWest)
	settleChargingPower(ws)
	if u.Mecha.Energy != 59 {
		t.Fatalf("adjacent unit across cube seam did not charge: %d", u.Mecha.Energy)
	}
}
