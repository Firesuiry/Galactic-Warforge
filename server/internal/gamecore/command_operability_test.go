package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestProduceQueuePausesWithoutPower(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "basic_assembling_processes")

	building := &model.Building{
		ID:       "b-prod",
		Type:     model.BuildingType("barracks"),
		OwnerID:  "p1",
		Position: model.Position{X: 8, Y: 8},
		Runtime:  model.BuildingProfileFor(model.BuildingType("barracks"), 1).Runtime,
	}
	building.Runtime.State = model.BuildingWorkNoPower
	model.InitBuildingStorage(building)
	building.HP = 100
	building.Storage.Inventory = model.ItemInventory{"iron_ingot": 2, "circuit_board": 1}
	ws.Buildings[building.ID] = building
	ws.TileBuilding[model.TileKey(building.Position.X, building.Position.Y)] = building.ID
	ws.Grid[building.Position.Y][building.Position.X].BuildingID = building.ID

	res, _ := core.execProduce(ws, "p1", model.Command{
		Type:   model.CmdProduce,
		Target: model.CommandTarget{EntityID: building.ID},
		Payload: map[string]any{
			"unit_type": "worker",
		},
	})
	if res.Code != model.CodeOK || len(building.UnitQueue) != 1 {
		t.Fatalf("expected a paid production order, got %+v", res)
	}
	remaining := building.UnitQueue[0].RemainingTicks
	for i := 0; i < remaining+1; i++ {
		settleUnitProduction(ws)
	}
	if len(building.UnitQueue) != 1 || building.UnitQueue[0].RemainingTicks != remaining {
		t.Fatal("unpowered production advanced")
	}
}
