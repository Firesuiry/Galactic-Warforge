package gamecore

import (
	"siliconworld/internal/model"
	"testing"
)

func TestPhase1BotIndustrialCycle(t *testing.T) {
	core := newBotTestCore(t, "hard")
	ws := core.World()
	produced, supplied := false, false
	for i := 0; i < 30000; i++ {
		core.processTick()
		for _, u := range ws.Units {
			if u.OwnerID == "p2" && u.Type == model.UnitTypeSoldier {
				produced = true
			}
		}
		for _, b := range ws.Buildings {
			if b.OwnerID == "p2" && b.Type == "supply_station" && b.Storage.ItemQuantity("ammo_bullet") > 0 {
				supplied = true
			}
		}
		if produced && supplied {
			return
		}
	}
	ctx := core.surveyBotWorld(ws, "p2")
	for _, b := range ctx.buildings {
		t.Logf("building %s %s state=%s reason=%s production=%+v storage=%+v", b.ID, b.Type, b.Runtime.State, b.Runtime.StateReason, b.Production, b.Storage)
	}
	t.Logf("mecha=%+v", ctx.executor.Mecha)
	t.Logf("player=%+v executor=%+v units=%+v", ws.Players["p2"], ctx.executor, ws.Units)
	t.Fatalf("industrial loop incomplete: produced=%v supplied=%v inventory=%v next=%+v", produced, supplied, ws.Players["p2"].Inventory, core.planBotCommands(ws, "p2", botTuningFor("hard")))
}

func TestPhase1ExecutorManualFireHonorsCooldown(t *testing.T) {
	ws, unit := mechaTestWorld()
	ws.Tick = 10
	target := spawnWorldTestUnit(ws, model.UnitTypeMecha, "p2", model.Position{X: 2, Y: 1})
	gc := &GameCore{}
	cmd := model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"target_entity_id": target.ID}}
	res, _ := execCommand(gc, model.CmdAttack, ws, unit.OwnerID, cmd)
	if res.Code != model.CodeOK {
		t.Fatal(res)
	}
	hp, ammo, energy := target.HP, unit.Ammo, unit.Mecha.Energy
	for i := 0; i < 3; i++ {
		execCommand(gc, model.CmdAttack, ws, unit.OwnerID, cmd)
	}
	if target.HP != hp || unit.Ammo != ammo || unit.Mecha.Energy != energy {
		t.Fatal("clicking bypassed cooldown or consumed extra ammo/energy")
	}
	ws.Tick += unit.AttackCooldownTick
	execCommand(gc, model.CmdAttack, ws, unit.OwnerID, cmd)
	if target.HP >= hp || unit.Ammo != ammo-1 {
		t.Fatal("ready weapon did not fire")
	}
}

func TestPhase1CollectStorageOutputConservesInventory(t *testing.T) {
	ws, unit := mechaTestWorld()
	gc := &GameCore{}
	b := newBuilding("storage", model.BuildingTypeDepotMk1, unit.OwnerID, model.Position{X: 3, Y: 1})
	placeBuilding(ws, b)
	b.Storage.Inventory = model.ItemInventory{"ammo_bullet": 7}
	player := ws.Players[unit.OwnerID]
	player.Inventory = model.ItemInventory{}
	player.SetPlanetExecutor(ws.PlanetID, &model.ExecutorState{UnitID: unit.ID})
	cmd := model.Command{Payload: map[string]any{"building_id": b.ID, "item_id": "ammo_bullet", "quantity": 5, "direction": "to_player"}}
	if r, _ := execCommand(gc, model.CmdTransferItem, ws, unit.OwnerID, cmd); r.Code != model.CodeOK {
		t.Fatal(r)
	}
	if player.Inventory["ammo_bullet"] != 5 || b.Storage.ItemQuantity("ammo_bullet") != 2 {
		t.Fatal("collection failed conservation")
	}
	cmd.Payload["direction"] = "invalid"
	if r, _ := execCommand(gc, model.CmdTransferItem, ws, unit.OwnerID, cmd); r.Code != model.CodeValidationFailed {
		t.Fatal(r)
	}
	if player.Inventory["ammo_bullet"] != 5 || b.Storage.ItemQuantity("ammo_bullet") != 2 {
		t.Fatal("invalid direction mutated inventory")
	}
}
