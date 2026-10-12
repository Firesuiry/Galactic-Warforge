package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestZZDbgIO2(t *testing.T) {
	for _, n := range []int{2, 6} {
		ws := model.NewWorldState("planet-1", n)
		ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

		depot := newDepotBuilding("depot", model.Position{X: 1, Y: 0})
		belt := newConveyorBuilding("belt", model.Position{X: 0, Y: 0}, model.ConveyorEast)

		attachBuilding(ws, belt)
		attachBuilding(ws, depot)
		belt.Conveyor.Insert(model.ItemIronOre, 3)

		t.Logf("--- faceSize=%d", n)
		ring, err := ws.BuildingRingCells(depot)
		t.Logf("ring=%v err=%v", ring, err)
		ioring := buildingIORing(ws, depot)
		for _, c := range ioring {
			t.Logf("  cell %v facing=%v tb=%q", c.pos, c.facing, ws.TileBuilding[model.TileKey(c.pos.X, c.pos.Y)])
		}
		conveyors := map[string]*model.Building{}
		for id, b := range ws.Buildings {
			if conveyorActive(b) && b.Splitter == nil {
				conveyors[id] = b
			}
		}
		port := depot.Runtime.Params.IOPorts[0]
		cand, ok := selectInputCandidate(ws, conveyors, depot, port, ioring)
		t.Logf("cand=%+v ok=%v", cand, ok)
		t.Logf("beltBuf=%+v allow=%v needs=%v", belt.Conveyor.Buffer, ioPortAllowsItem(port, model.ItemIronOre), buildingRecipeInputNeeds(depot))
		t.Logf("conveyors=%v", len(conveyors))
	}
}
