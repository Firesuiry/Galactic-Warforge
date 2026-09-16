package gamecore

import (
	"encoding/json"
	"reflect"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

func personalJobTestWorld() (*model.WorldState, *model.Unit) {
	ws, unit := mechaTestWorld()
	ws.Players["p1"].Tech = model.NewPlayerTechState("p1")
	return ws, unit
}

func handcraftCommand(id string, quantity any) model.Command {
	return model.Command{Target: model.CommandTarget{EntityID: "executor"}, Payload: map[string]any{"recipe_id": id, "quantity": quantity}}
}
func manualMineCommand(quantity any) model.Command {
	return model.Command{Target: model.CommandTarget{EntityID: "executor"}, Payload: map[string]any{"resource_id": "coal", "quantity": quantity}}
}
func addManualCoal(ws *model.WorldState, amount int) *model.ResourceNodeState {
	node := &model.ResourceNodeState{ID: "coal", PlanetID: ws.PlanetID, Kind: model.ItemCoal, Behavior: "finite", Position: model.Position{X: 2, Y: 1}, MaxAmount: amount, Remaining: amount}
	ws.Resources[node.ID] = node
	return node
}
func advancePersonalTicks(ws *model.WorldState, n int) {
	for i := 0; i < n; i++ {
		ws.Tick++
		settleMechas(ws)
	}
}

func TestManualMiningConsumesRealNodeTimeEnergyAndCanRefuel(t *testing.T) {
	ws, unit := personalJobTestWorld()
	node := addManualCoal(ws, 2)
	core := &GameCore{}
	if result, _ := core.execMineResource(ws, "p1", manualMineCommand(2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	if node.Remaining != 2 || ws.Players["p1"].Inventory[model.ItemCoal] != 0 {
		t.Fatal("mining completed instantly")
	}
	advancePersonalTicks(ws, 9)
	if node.Remaining != 2 || unit.Mecha.Energy != 91 {
		t.Fatal("mining ignored tick cost")
	}
	advancePersonalTicks(ws, 1)
	if node.Remaining != 1 || unit.Mecha.Job.CompletedBatches != 1 || ws.Players["p1"].Inventory[model.ItemCoal] != 1 {
		t.Fatal("first mining batch incorrect")
	}
	advancePersonalTicks(ws, 10)
	if node.Remaining != 0 || !node.Depleted || unit.Mecha.Job != nil || unit.Mecha.Energy != 80 {
		t.Fatal("mining did not stop at requested/depleted amount")
	}
	result, _ := core.execRefuelMecha(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": model.ItemCoal, "quantity": 1}})
	if result.Code != model.CodeOK || unit.Mecha.Energy != 100 || ws.Players["p1"].Inventory[model.ItemCoal] != 1 {
		t.Fatalf("mined coal could not fuel executor: %+v", result)
	}
}

func TestManualMiningPausesOnDistanceEnergyAndConcurrentExhaustion(t *testing.T) {
	ws, unit := personalJobTestWorld()
	node := addManualCoal(ws, 3)
	core := &GameCore{}
	if result, _ := core.execMineResource(ws, "p1", manualMineCommand(2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	unit.Position = model.Position{X: 7, Y: 7}
	advancePersonalTicks(ws, 5)
	if unit.Mecha.Job.State != "out_of_range" || unit.Mecha.Job.RemainingTicks != 10 || unit.Mecha.Energy != 100 {
		t.Fatal("out-of-range mining progressed")
	}
	unit.Position = model.Position{X: 1, Y: 1}
	unit.Mecha.Energy = 0
	advancePersonalTicks(ws, 5)
	if unit.Mecha.Job.State != "no_energy" || node.Remaining != 3 {
		t.Fatal("empty core mined")
	}
	unit.Mecha.Energy = 10
	advancePersonalTicks(ws, 10)
	if node.Remaining != 2 || ws.Players["p1"].Inventory[model.ItemCoal] != 1 {
		t.Fatal("mining failed to resume")
	}
	node.Remaining = 0
	unit.Mecha.Energy = 5
	advancePersonalTicks(ws, 1)
	if unit.Mecha.Job != nil || unit.Mecha.Energy != 5 || ws.Players["p1"].Inventory[model.ItemCoal] != 1 {
		t.Fatal("exhausted shared node consumed energy or duplicated resources")
	}
}

func TestHandcraftReservesMaterialsAndRefundsOnlyUncompletedBatches(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 3}
	result, initialEvents := core.execCraftItem(ws, "p1", handcraftCommand("gear", 3))
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	if player.Inventory[model.ItemIronIngot] != 0 || player.Inventory[model.ItemGear] != 0 {
		t.Fatal("craft did not reserve exactly three inputs")
	}
	advancePersonalTicks(ws, 20)
	if player.Inventory[model.ItemGear] != 1 || unit.Mecha.Energy != 80 || unit.Mecha.Job.ReservedInputs[0].Quantity != 2 {
		t.Fatal("craft batch accounting incorrect")
	}
	advancePersonalTicks(ws, 5)
	initial := initialEvents[0].Payload["mecha"].(model.MechaState)
	if initial.Job.RemainingTicks != 20 || initial.Job.ReservedInputs[0].Quantity != 3 {
		t.Fatal("event history aliases live job")
	}
	result, _ = core.execCancelMechaJob(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}})
	if result.Code != model.CodeOK || unit.Mecha.Job != nil || player.Inventory[model.ItemIronIngot] != 2 || player.Inventory[model.ItemGear] != 1 || unit.Mecha.Energy != 75 {
		t.Fatal("cancel duplicated or lost items / refunded consumed energy")
	}
	refundMechaJob(ws, unit)
	if player.Inventory[model.ItemIronIngot] != 2 {
		t.Fatal("refund not idempotent")
	}
}

func TestHandcraftNoEnergyResumesFromRefuelWithoutConsumingInputsTwice(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 1, model.ItemCoal: 2}
	unit.Mecha.Energy = 5
	if result, _ := core.execCraftItem(ws, "p1", handcraftCommand("gear", 1)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 10)
	if unit.Mecha.Job.State != "no_energy" || unit.Mecha.Job.RemainingTicks != 15 || player.Inventory[model.ItemGear] != 0 {
		t.Fatal("unpowered crafting advanced")
	}
	result, _ := core.execRefuelMecha(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": model.ItemCoal, "quantity": 1}})
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 15)
	if unit.Mecha.Job != nil || player.Inventory[model.ItemIronIngot] != 0 || player.Inventory[model.ItemGear] != 1 || player.Inventory[model.ItemCoal] != 1 {
		t.Fatal("resume changed material accounting")
	}
}

func TestMechaJobValidationIsAtomic(t *testing.T) {
	for _, tc := range []struct {
		name     string
		recipe   string
		quantity any
		owner    string
		code     model.ResultCode
	}{
		{"zero", "gear", 0, "p1", model.CodeValidationFailed},
		{"fraction", "gear", 1.5, "p1", model.CodeValidationFailed},
		{"negative", "gear", -1, "p1", model.CodeValidationFailed},
		{"owner", "gear", 1, "p2", model.CodeNotOwner},
		{"advanced", "quantum_chip", 1, "p1", model.CodeInvalidTarget},
		{"chemistry", "oil_fractionation", 1, "p1", model.CodeInvalidTarget},
		{"matrix", "electromagnetic_matrix", 1, "p1", model.CodeInvalidTarget},
		{"missing", "not-a-recipe", 1, "p1", model.CodeInvalidTarget},
		{"materials", "gear", 10, "p1", model.CodeInsufficientResource},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ws, unit := personalJobTestWorld()
			ws.Players["p1"].Inventory = model.ItemInventory{model.ItemIronIngot: 2}
			result, _ := (&GameCore{}).execCraftItem(ws, tc.owner, handcraftCommand(tc.recipe, tc.quantity))
			if result.Code != tc.code || unit.Mecha.Job != nil || unit.Mecha.Energy != 100 || ws.Players["p1"].Inventory[model.ItemIronIngot] != 2 {
				t.Fatalf("rejected job mutated state: %+v", result)
			}
		})
	}
	ws, unit := personalJobTestWorld()
	node := addManualCoal(ws, 2)
	core := &GameCore{}
	node.Kind = model.ItemCrudeOil
	if result, _ := core.execMineResource(ws, "p1", manualMineCommand(1)); result.Code != model.CodeInvalidTarget {
		t.Fatal(result)
	}
	node.Kind = model.ItemCoal
	if result, _ := core.execMineResource(ws, "p1", manualMineCommand(3)); result.Code != model.CodeInsufficientResource {
		t.Fatal(result)
	}
	if result, _ := core.execMineResource(ws, "p1", manualMineCommand(1)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	job := unit.Mecha.Job.Clone()
	if result, _ := core.execCraftItem(ws, "p1", handcraftCommand("gear", 1)); result.Code != model.CodeInvalidTarget || !reflect.DeepEqual(job, unit.Mecha.Job) {
		t.Fatal("busy mecha replaced its job")
	}
}

func TestMechaCraftJobSnapshotCloneRestoreAndDeathRefund(t *testing.T) {
	ws, unit := personalJobTestWorld()
	core := &GameCore{}
	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 2}
	if result, _ := core.execCraftItem(ws, "p1", handcraftCommand("gear", 2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 23)
	saved := snapshot.CaptureWorld(ws)
	saved.Units[unit.ID].Mecha.Job.ReservedInputs[0].Quantity = 9
	if unit.Mecha.Job.ReservedInputs[0].Quantity != 1 {
		t.Fatal("snapshot aliases reserved ingredients")
	}
	saved = snapshot.CaptureWorld(ws)
	restored, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	advancePersonalTicks(restored, 17)
	if restored.Players["p1"].Inventory[model.ItemGear] != 2 || restored.Units[unit.ID].Mecha.Job != nil {
		t.Fatal("restored job failed to complete exactly once")
	}
	if saved.Units[unit.ID].Mecha.Job.RemainingTicks != 17 || unit.Mecha.Job.RemainingTicks != 17 {
		t.Fatal("restore aliases snapshot or live job")
	}
	data, err := json.Marshal(unit)
	if err != nil {
		t.Fatal(err)
	}
	var decoded model.Unit
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded.Mecha, unit.Mecha) {
		t.Fatal("JSON omitted active job")
	}
	unit.HP = 0
	advancePersonalTicks(ws, 1)
	if unit.Mecha.Job != nil || player.Inventory[model.ItemIronIngot] != 1 || player.Inventory[model.ItemGear] != 1 {
		t.Fatal("death refund lost or duplicated materials")
	}
}

func TestNormalNewGameMinesCoalAndRefuelsWithoutBootstrapInventory(t *testing.T) {
	cfg, err := config.Load("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	mapCfg, err := mapconfig.Load("../../map.yaml")
	if err != nil {
		t.Fatal(err)
	}
	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	ws := core.World()
	player := ws.Players["p1"]
	unit := ws.Units[player.ExecutorForPlanet(ws.PlanetID).UnitID]
	if player.Inventory[model.ItemCoal] != 0 {
		t.Fatal("test unexpectedly has bootstrap coal")
	}
	var coal *model.ResourceNodeState
	for _, node := range ws.Resources {
		if node.Kind == model.ItemCoal && node.Remaining > 0 && (coal == nil || ws.SurfaceDistance(unit.Position, node.Position) < ws.SurfaceDistance(unit.Position, coal.Position)) {
			coal = node
		}
	}
	if coal == nil {
		t.Fatal("ordinary start lacks coal")
	}
	// Use the real movement command to a reachable tile within mining distance.
	moved := ws.SurfaceDistance(unit.Position, coal.Position) <= 2
	if !moved {
		for _, tile := range ws.SurfaceDisc(coal.Position, 2) {
			result, _ := core.execMove(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID, Position: &tile}})
			if result.Code == model.CodeOK {
				moved = true
				break
			}
		}
	}
	if !moved {
		t.Fatalf("cannot reach starting coal: executor=%+v coal=%+v", unit.Position, coal.Position)
	}
	before := coal.Remaining
	result, _ := core.execMineResource(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"resource_id": coal.ID, "quantity": 1}})
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 10)
	if player.Inventory[model.ItemCoal] != 1 || coal.Remaining != before-1 {
		t.Fatal("ordinary new game did not mine real coal")
	}
	energy := unit.Mecha.Energy
	result, _ = core.execRefuelMecha(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": model.ItemCoal, "quantity": 1}})
	if result.Code != model.CodeOK || unit.Mecha.Energy <= energy || player.Inventory[model.ItemCoal] != 0 {
		t.Fatalf("ordinary start cannot refuel with mined coal: %+v", result)
	}
	t.Logf("new game coal %s at %+v: remaining %d->%d; energy %d->%d", coal.ID, coal.Position, before, coal.Remaining, energy, unit.Mecha.Energy)
}

func TestMechaJobDeathThroughAttackRefundsRemainingReservation(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 2}
	if result, _ := core.execCraftItem(ws, "p1", handcraftCommand("gear", 2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 22)
	unit.HP = 1
	attacker := model.UnitStats(model.UnitTypeSoldier)
	attacker.ID, attacker.OwnerID, attacker.Type = "enemy", "p2", model.UnitTypeSoldier
	attacker.Position = model.Position{X: 2, Y: 1}
	ws.Units[attacker.ID] = &attacker
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	result, _ := core.execAttack(ws, "p2", model.Command{Target: model.CommandTarget{EntityID: attacker.ID}, Payload: map[string]any{"target_entity_id": unit.ID}})
	if result.Code != model.CodeOK || ws.Units[unit.ID] != nil || player.Inventory[model.ItemIronIngot] != 1 || player.Inventory[model.ItemGear] != 1 {
		t.Fatalf("combat deletion lost/duplicated reservation: %+v inventory=%v unit=%+v", result, player.Inventory, ws.Units[unit.ID])
	}
}

func TestHandcraftRequiresRecipeResearchAndDoesNotReserveOnFailure(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	player.Inventory = model.ItemInventory{model.ItemCoal: 2}
	result, _ := core.execCraftItem(ws, "p1", handcraftCommand("coal_to_graphite", 1))
	if result.Code != model.CodeValidationFailed || unit.Mecha.Job != nil || player.Inventory[model.ItemCoal] != 2 {
		t.Fatalf("locked recipe bypass: %+v", result)
	}
	player.Tech.CompletedTechs["smelting_purification"] = 1
	result, _ = core.execCraftItem(ws, "p1", handcraftCommand("coal_to_graphite", 1))
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 30)
	if player.Inventory[model.ItemEnergeticGraphite] != 1 || player.Inventory[model.ItemCoal] != 0 {
		t.Fatal("unlocked handcraft fuel recipe failed")
	}
}
