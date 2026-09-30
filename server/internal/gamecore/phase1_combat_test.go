package gamecore

import (
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
	"testing"
)

func TestPhase1EmptyMagazineStopsUntilSupply(t *testing.T) {
	ws := newRTTWorld(true)
	ws.Tick = 10
	a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	b := spawnWorldTestUnit(ws, model.UnitTypeMecha, "p2", model.Position{X: 4, Y: 3})
	a.Ammo = 1
	a.AttackTarget = b.ID
	b.HP = 500
	b.MaxHP = 500
	settleOneUnitCombat(ws, a)
	hp := b.HP
	if a.Ammo != 0 || a.CombatState != "no_ammunition" || hp >= 500 {
		t.Fatal("first round was not consumed")
	}
	ws.Tick += a.AttackCooldownTick
	settleOneUnitCombat(ws, a)
	if b.HP != hp {
		t.Fatal("empty unit fired")
	}
	station := surfaceTestBuilding(ws, "supply", model.BuildingType("supply_station"), model.Position{X: 2, Y: 3})
	station.OwnerID = "p1"
	model.InitBuildingStorage(station)
	station.Storage.Inventory = model.ItemInventory{"titanium_ammo": 5, "ammo_bullet": 20}
	station.Runtime.State = model.BuildingWorkRunning
	settleAmmunitionSupply(ws)
	if a.Ammo != 5 || a.AmmoItem != "titanium_ammo" || station.Storage.Inventory["titanium_ammo"] != 0 || station.Storage.Inventory["ammo_bullet"] != 20 {
		t.Fatalf("tier priority or conservation failed: %+v %+v", a, station.Storage)
	}
	settleOneUnitCombat(ws, a)
	if b.HP >= hp {
		t.Fatal("resupplied unit did not resume firing")
	}
	delete(ws.Buildings, station.ID)
	a.Ammo = 0
	ws.Tick += a.AttackCooldownTick
	hp = b.HP
	settleOneUnitCombat(ws, a)
	if b.HP != hp {
		t.Fatal("destroyed supply station allowed shooting")
	}
}

func TestPhase1SupplyTruckLoadsAndTransfersPhysicalCargo(t *testing.T) {
	ws := newRTTWorld(false)
	ws.Tick = 3
	truck := spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p1", model.Position{X: 3, Y: 3})
	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 4, Y: 3})
	soldier.Ammo = 0
	station := surfaceTestBuilding(ws, "supply", model.BuildingType("supply_station"), model.Position{X: 2, Y: 3})
	station.OwnerID = "p1"
	model.InitBuildingStorage(station)
	station.Storage.Inventory = model.ItemInventory{"ammo_bullet": 12}
	station.Runtime.State = model.BuildingWorkRunning
	// Keep the infantry outside station range while the truck loads.
	soldier.Position = model.Position{X: 20, Y: 3}
	settleAmmunitionSupply(ws)
	if truck.Cargo["ammo_bullet"] != 6 || station.Storage.Inventory["ammo_bullet"] != 6 {
		t.Fatalf("cargo loading failed: %v", truck.Cargo)
	}
	delete(ws.Buildings, station.ID)
	soldier.Position = model.Position{X: 4, Y: 3}
	settleAmmunitionSupply(ws)
	if soldier.Ammo != 3 || truck.Cargo["ammo_bullet"] != 3 {
		t.Fatal("truck supplied without consuming cargo")
	}
	soldier.Position = model.Position{X: 20, Y: 3}
	settleAmmunitionSupply(ws)
	if soldier.Ammo != 3 {
		t.Fatal("truck supplied outside radius")
	}
}

func TestPhase1ProductionConsumesMaterialsAndWaits(t *testing.T) {
	ws := newRTTWorld(false)
	gc := &GameCore{}
	b := surfaceTestBuilding(ws, "barracks", model.BuildingType("barracks"), model.Position{X: 3, Y: 3})
	b.OwnerID = "p1"
	model.InitBuildingStorage(b)
	b.Runtime.State = model.BuildingWorkRunning
	b.Runtime.Params.EnergyConsume = 0
	b.Runtime.Functions.Energy.ConsumePerTick = 0
	cmd := model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"unit_type": "soldier"}}
	ws.Players["p1"].Resources.Minerals = 99999
	if res, _ := gc.execProduce(ws, "p1", cmd); res.Code != model.CodeInsufficientResource {
		t.Fatalf("abstract currency bought a unit: %+v", res)
	}
	b.Storage.Inventory = model.ItemInventory{"iron_ingot": 2, "circuit_board": 1}
	if res, _ := gc.execProduce(ws, "p1", cmd); res.Code != model.CodeOK {
		t.Fatalf("produce: %+v", res)
	}
	if len(ws.Units) != 0 || len(b.UnitQueue) != 1 || availableStorageItem(b.Storage, "iron_ingot") != 0 {
		t.Fatal("unit spawned instantly or cost not deducted")
	}
	def, _ := model.UnitDefinitionByID(model.UnitTypeSoldier)
	for i := 0; i < def.ProductionTicks-1; i++ {
		ws.Tick++
		settleUnitProduction(ws)
	}
	if len(ws.Units) != 0 {
		t.Fatal("production finished early")
	}
	ws.Tick++
	settleUnitProduction(ws)
	if len(ws.Units) != 1 || len(b.UnitQueue) != 0 {
		t.Fatal("production did not complete")
	}
	for _, u := range ws.Units {
		if u.Ammo != u.AmmoCapacity || u.Ammo == 0 {
			t.Fatal("new unit not loaded")
		}
	}
	cmd.Payload["unit_type"] = "mecha"
	if res, _ := gc.execProduce(ws, "p1", cmd); res.Code != model.CodeInvalidTarget {
		t.Fatal("barracks produced vehicle")
	}
}

func TestPhase1AirTargetingAndMinimumArtilleryRange(t *testing.T) {
	ws := newRTTWorld(true)
	ws.Tick = 20
	gun := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	drone := spawnWorldTestUnit(ws, model.UnitTypeAttackDrone, "p2", model.Position{X: 4, Y: 3})
	gun.AttackTarget = drone.ID
	settleOneUnitCombat(ws, gun)
	if drone.HP != drone.MaxHP || gun.Ammo != gun.AmmoCapacity {
		t.Fatal("rifle hit aircraft")
	}
	missile := spawnWorldTestUnit(ws, model.UnitTypeMissileVehicle, "p1", model.Position{X: 5, Y: 3})
	missile.AttackTarget = drone.ID
	settleOneUnitCombat(ws, missile)
	if drone.HP == drone.MaxHP {
		t.Fatal("missile failed to hit aircraft")
	}
	cannon := spawnWorldTestUnit(ws, model.UnitTypeArtillery, "p1", model.Position{X: 6, Y: 6})
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 7, Y: 6})
	cannon.AttackTarget = enemy.ID
	settleOneUnitCombat(ws, cannon)
	if enemy.HP != enemy.MaxHP || cannon.Ammo != cannon.AmmoCapacity {
		t.Fatal("artillery ignored minimum range")
	}
	ws.Grid[3][5].Terrain = terrain.TileWater
	if !tileWalkableForUnit(ws, model.Position{X: 5, Y: 3}, drone.ID) {
		t.Fatal("air unit blocked by ground terrain/unit")
	}
}

func TestPhase1CombatTechNeverRefillsAmmunition(t *testing.T) {
	ws := newRTTWorld(false)
	u := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	u.Ammo = 0
	u.CombatState = "no_ammunition"
	for i := 0; i < 5; i++ {
		settleCombatTech(ws, nil)
	}
	if u.Ammo != 0 {
		t.Fatal("combat technology restored consumed ammunition")
	}
}
