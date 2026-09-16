package gamecore

import (
	"encoding/json"
	"reflect"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func mechaTestWorld() (*model.WorldState, *model.Unit) {
	ws := newPowerTestWorld()
	ws.Tick = 20
	unit := model.UnitStats(model.UnitTypeExecutor)
	unit.ID, unit.OwnerID, unit.Type = "executor", "p1", model.UnitTypeExecutor
	unit.Position = model.Position{X: 1, Y: 1}
	ws.Units[unit.ID] = &unit
	ws.TileUnits[model.TileKey(1, 1)] = []string{unit.ID}
	return ws, &unit
}

func mechaAttackCommand(id string) model.Command {
	return model.Command{Type: model.CmdAttack, Target: model.CommandTarget{EntityID: "executor"}, Payload: map[string]any{"target_entity_id": id}}
}

func TestPlayerMechaAttackConsumesEnergyAndRejectsAtomically(t *testing.T) {
	ws, unit := mechaTestWorld()
	enemy := model.UnitStats(model.UnitTypeSoldier)
	enemy.ID, enemy.OwnerID = "enemy", "p2"
	enemy.Position = model.Position{X: 2, Y: 1}
	ws.Units[enemy.ID] = &enemy
	core := &GameCore{}
	res, _ := core.execAttack(ws, "p1", mechaAttackCommand(enemy.ID))
	if res.Code != model.CodeOK || enemy.HP != 85 || unit.Mecha.Energy != 92 {
		t.Fatalf("attack=%+v target=%+v mecha=%+v", res, enemy, unit.Mecha)
	}
	unit.Mecha.Energy = 7
	res, events := core.execAttack(ws, "p1", mechaAttackCommand(enemy.ID))
	if res.Code != model.CodeInsufficientResource || enemy.HP != 85 || unit.Mecha.Energy != 7 || len(events) != 0 {
		t.Fatalf("failed attack mutated state: %+v", res)
	}
	unit.Mecha.Energy = 50
	enemy.Position = model.Position{X: 7, Y: 7}
	res, _ = core.execAttack(ws, "p1", mechaAttackCommand(enemy.ID))
	if res.Code != model.CodeOutOfRange || unit.Mecha.Energy != 50 {
		t.Fatalf("invalid attack spent energy: %+v", res)
	}
}

func TestPlayerMechaMovementConsumesPathEnergyAndRejectsAtomically(t *testing.T) {
	ws, unit := mechaTestWorld()
	core := &GameCore{}
	dest := model.Position{X: 4, Y: 1}
	unit.Mecha.Energy = 2
	cmd := model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: unit.ID, Position: &dest}}
	res, _ := core.execMove(ws, "p1", cmd)
	if res.Code != model.CodeInsufficientResource || unit.Position.X != 1 || unit.Mecha.Energy != 2 {
		t.Fatalf("invalid movement mutated state: %+v", res)
	}
	unit.Mecha.Energy = 3
	res, _ = core.execMove(ws, "p1", cmd)
	if res.Code != model.CodeOK || unit.Position != dest || unit.Mecha.Energy != 0 {
		t.Fatalf("movement not metered: %+v, %+v", res, unit)
	}
}

func TestPlayerMechaRefuelingUsesRealInventoryAndRetainsFuelRemainder(t *testing.T) {
	ws, unit := mechaTestWorld()
	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{model.ItemCoal: 8, model.ItemAntimatterFuelRod: 1}
	unit.Mecha.Energy = 50
	core := &GameCore{}
	refuel := func(item string, n int) model.CommandResult {
		res, _ := core.execRefuelMecha(ws, "p1", model.Command{Type: model.CmdRefuelMecha, Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": item, "quantity": n}})
		return res
	}
	if res := refuel(model.ItemCoal, 8); res.Code != model.CodeOK {
		t.Fatal(res)
	}
	if unit.Mecha.Energy != 100 || player.Inventory[model.ItemCoal] != 6 {
		t.Fatal("refueling should only consume two coal")
	}
	if res := refuel(model.ItemCoal, 1); res.Code != model.CodeInvalidTarget || player.Inventory[model.ItemCoal] != 6 {
		t.Fatal("full core consumed fuel")
	}
	unit.Mecha.Energy = 0
	if res := refuel(model.ItemAntimatterFuelRod, 1); res.Code != model.CodeOK {
		t.Fatal(res)
	}
	if unit.Mecha.Energy != 100 || unit.Mecha.FuelEnergy != 900 || player.Inventory[model.ItemAntimatterFuelRod] != 0 {
		t.Fatalf("lost fuel energy: %+v", unit.Mecha)
	}
	unit.Mecha.Energy = 80
	if res := refuel(model.ItemCoal, 1); res.Code != model.CodeInvalidTarget {
		t.Fatal("allowed refuel with stored fuel")
	}
	settleMechas(ws)
	if unit.Mecha.Energy != 90 || unit.Mecha.FuelEnergy != 890 {
		t.Fatalf("fuel did not replenish core: %+v", unit.Mecha)
	}
}

func TestPlayerMechaRefuelValidationDoesNotConsumeInventory(t *testing.T) {
	ws, unit := mechaTestWorld()
	unit.Mecha.Energy = 0
	ws.Players["p1"].Inventory = model.ItemInventory{model.ItemIronOre: 5, model.ItemCoal: 1}
	core := &GameCore{}
	for _, tc := range []struct {
		owner, item string
		quantity    any
		code        model.ResultCode
	}{
		{"p2", model.ItemCoal, 1, model.CodeNotOwner},
		{"p1", model.ItemIronOre, 1, model.CodeInvalidTarget},
		{"p1", model.ItemCoal, 0, model.CodeValidationFailed},
		{"p1", model.ItemCoal, 1.5, model.CodeValidationFailed},
		{"p1", model.ItemCoal, 4, model.CodeInsufficientResource},
	} {
		res, _ := core.execRefuelMecha(ws, tc.owner, model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": tc.item, "quantity": tc.quantity}})
		if res.Code != tc.code || unit.Mecha.Energy != 0 || ws.Players["p1"].Inventory[model.ItemCoal] != 1 {
			t.Fatalf("case=%+v result=%+v", tc, res)
		}
	}
}

func TestPlayerMechaShieldAbsorbsAttackThenRechargesUsingEnergy(t *testing.T) {
	ws, unit := mechaTestWorld()
	ws.Players["p1"].Tech = model.NewPlayerTechState("p1")
	ws.Players["p1"].Tech.CompletedTechs["energy_shield"] = 1
	model.SyncMechaCapabilities(unit, ws.Players["p1"])
	unit.Mecha.Shield = 20
	enemy := model.UnitStats(model.UnitTypeSoldier)
	enemy.ID, enemy.OwnerID = "enemy", "p2"
	enemy.Position = model.Position{X: 2, Y: 1}
	ws.Units[enemy.ID] = &enemy
	core := &GameCore{}
	res, _ := core.execAttack(ws, "p2", model.Command{Target: model.CommandTarget{EntityID: enemy.ID}, Payload: map[string]any{"target_entity_id": unit.ID}})
	if res.Code != model.CodeOK || unit.HP != unit.MaxHP || unit.Mecha.Shield != 13 || unit.Mecha.LastHitTick != 20 {
		t.Fatalf("shield failed: %+v %+v", res, unit)
	}
	ws.Tick = 29
	settleMechas(ws)
	if unit.Mecha.Shield != 13 || unit.Mecha.Energy != 100 {
		t.Fatal("shield regenerated before delay")
	}
	ws.Tick = 30
	settleMechas(ws)
	if unit.Mecha.Shield != 15 || unit.Mecha.Energy != 99 {
		t.Fatal("shield recharge did not use energy")
	}
	unit.Mecha.Energy = 0
	ws.Tick++
	settleMechas(ws)
	if unit.Mecha.Shield != 15 {
		t.Fatal("shield regenerated without energy")
	}
	damage, absorbed := model.ApplyUnitDamage(unit, 20, ws.Tick)
	if damage != 5 || absorbed != 15 || unit.HP != unit.MaxHP-5 || unit.Mecha.Shield != 0 {
		t.Fatal("shield overflow wrong")
	}
}

func TestPlayerMechaCompletedResearchChangesLiveCapabilitiesWithoutFreeEnergy(t *testing.T) {
	ws, unit := mechaTestWorld()
	player := ws.Players["p1"]
	player.Tech = model.NewPlayerTechState("p1")
	unit.Mecha.Energy = 23
	for _, id := range []string{"mecha_core", "mecha_engine", "energy_shield"} {
		def, _ := model.TechDefinitionByID(id)
		research := &model.PlayerResearch{TechID: id}
		var events []*model.GameEvent
		completeResearch(player, research, def, ws.Tick, &events)
	}
	settleMechas(ws)
	if unit.Mecha.MaxEnergy != 110 || unit.MoveRange != 14 || unit.Mecha.MaxShield != 20 || unit.Mecha.Energy != 22 || unit.Mecha.Shield != 2 {
		t.Fatalf("research not effective: %+v %+v", unit, unit.Mecha)
	}
	for range 3 {
		model.SyncMechaCapabilities(unit, player)
	}
	if unit.Mecha.MaxEnergy != 110 || unit.MoveRange != 14 || unit.Mecha.Energy != 22 {
		t.Fatal("repeated sync stacks bonuses or adds energy")
	}
}

func TestPlayerMechaSnapshotPreservesIndependentEnergyAndShield(t *testing.T) {
	ws, unit := mechaTestWorld()
	unit.Mecha.Energy, unit.Mecha.FuelEnergy, unit.Mecha.Shield, unit.Mecha.LastHitTick = 17, 83, 9, 23
	saved := snapshot.CaptureWorld(ws)
	saved.Units[unit.ID].Mecha.Energy = 1
	if unit.Mecha.Energy != 17 {
		t.Fatal("snapshot aliases live mecha")
	}
	restoredWorld, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	restoredWorld.Units[unit.ID].Mecha.FuelEnergy = 0
	if saved.Units[unit.ID].Mecha.FuelEnergy != 83 {
		t.Fatal("restored world aliases snapshot")
	}
	data, err := json.Marshal(unit)
	if err != nil {
		t.Fatal(err)
	}
	var restored model.Unit
	if err = json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored.Mecha, unit.Mecha) {
		t.Fatalf("restore lost core state: %+v", restored.Mecha)
	}
}

func TestPlayerMechaCoreResearchConsumesLabMatricesBeforeIncreasingCapacity(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	unit := ws.Units[player.ExecutorForPlanet(ws.PlanetID).UnitID]
	unit.Mecha.Energy = 23
	lab := newBuilding("mecha-research-lab", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	lab.Runtime.Functions.Research = &model.ResearchModule{ResearchPerTick: 10}
	placeBuilding(ws, lab)
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil {
		t.Fatal(err)
	}
	setResearchLabPowerRatio(ws, lab, 4, 4, 1)
	result, _ := core.execStartResearch(ws, "p1", model.Command{Type: model.CmdStartResearch, Payload: map[string]any{"tech_id": "mecha_core"}})
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	settleResearch(core.worlds)
	if player.Tech.CompletedTechs["mecha_core"] != 0 || player.Tech.CurrentResearch.Progress != 10 {
		t.Fatal("research completed without consuming required matrices")
	}
	for range 9 {
		if accepted, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil || accepted != 10 {
			t.Fatalf("matrix replenishment failed: %d %v", accepted, err)
		}
		settleResearch(core.worlds)
	}
	settleMechas(ws)
	if player.Tech.CompletedTechs["mecha_core"] != 1 || lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix) != 0 || unit.Mecha.MaxEnergy != 110 || unit.Mecha.Energy != 23 {
		t.Fatalf("core research not backed by consumed matrices: %+v", unit.Mecha)
	}
}

func TestMechaResearchSpeedBonusAffectsRealMatrixConsumption(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	lab := newBuilding("mecha-speed-lab", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	lab.Runtime.Functions.Research = &model.ResearchModule{ResearchPerTick: 10}
	placeBuilding(ws, lab)
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 30); err != nil {
		t.Fatal(err)
	}
	setResearchLabPowerRatio(ws, lab, 4, 4, 1)
	player.Tech.CompletedTechs["research_speed"] = 1
	result, _ := core.execStartResearch(ws, "p1", model.Command{Type: model.CmdStartResearch, Payload: map[string]any{"tech_id": "mecha_core"}})
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	settleResearch(core.worlds)
	if player.Tech.CurrentResearch.Progress != 11 || lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix) != 19 {
		t.Fatalf("research speed did not consume 11 matrices: %+v", player.Tech.CurrentResearch)
	}
}

func TestPlayerMechaShieldAlsoAbsorbsAutomaticTurretFire(t *testing.T) {
	ws, unit := mechaTestWorld()
	player := ws.Players["p1"]
	player.Tech = model.NewPlayerTechState("p1")
	player.Tech.CompletedTechs["energy_shield"] = 1
	model.SyncMechaCapabilities(unit, player)
	unit.Mecha.Shield = 20
	turret := newBuilding("hostile-turret", model.BuildingTypeGaussTurret, "p2", model.Position{X: 2, Y: 1})
	turret.Runtime.State = model.BuildingWorkRunning
	turret.Runtime.Functions.Combat = &model.CombatModule{Attack: 18, Range: 4}
	placeBuilding(ws, turret)
	events := settleTurrets(ws)
	if unit.HP != unit.MaxHP || unit.Mecha.Shield != 10 || unit.Mecha.LastHitTick != ws.Tick {
		t.Fatalf("turret bypassed shield: %+v", unit.Mecha)
	}
	found := false
	for _, event := range events {
		if event.EventType == model.EvtDamageApplied && event.Payload["target_id"] == unit.ID {
			found = event.Payload["damage"] == 0 && event.Payload["shield_absorbed"] == 10
		}
	}
	if !found {
		t.Fatal("turret damage event did not report shield absorption")
	}
}

func TestPlayerMechaTechSyncEmitsDerivedCapabilityChange(t *testing.T) {
	ws, unit := mechaTestWorld()
	player := ws.Players["p1"]
	player.Tech = model.NewPlayerTechState("p1")
	player.Tech.CompletedTechs["mecha_core"] = 1
	events := settleMechas(ws)
	if unit.Mecha.MaxEnergy != 110 || len(events) != 1 || events[0].EventType != model.EvtMechaStateChanged {
		t.Fatalf("expected capability sync event, unit=%+v events=%v", unit.Mecha, events)
	}
	payload := events[0].Payload
	if payload["move_range"] != 12 || payload["attack"] != 20 {
		t.Fatalf("missing derived fields: %#v", payload)
	}
	if events := settleMechas(ws); len(events) != 0 {
		t.Fatalf("idempotent sync emitted duplicate event: %v", events)
	}
}
