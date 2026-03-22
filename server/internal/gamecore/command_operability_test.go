package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func TestProduceBlockedWhenBuildingHasNoPower(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "basic_assembling_processes")

	building := &model.Building{
		ID:       "b-prod",
		Type:     model.BuildingTypeAssemblingMachineMk1,
		OwnerID:  "p1",
		Position: model.Position{X: 8, Y: 8},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeAssemblingMachineMk1, 1).Runtime,
	}
	building.Runtime.State = model.BuildingWorkNoPower
	model.InitBuildingStorage(building)
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
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected invalid target when building has no power, got %s", res.Code)
	}
	if !strings.Contains(res.Message, "power") {
		t.Fatalf("expected no-power message, got %q", res.Message)
	}
}
