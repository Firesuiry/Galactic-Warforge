package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestStorageNetworkFor(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6, 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}

	profile := model.BuildingProfileFor(model.BuildingTypeDepotMk1, 1)

	b1 := &model.Building{
		ID:          "b1",
		Type:        model.BuildingTypeDepotMk1,
		OwnerID:     "p1",
		Position:    model.Position{X: 1, Y: 1},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b1)
	ws.Buildings[b1.ID] = b1
	ws.TileBuilding[model.TileKey(1, 1)] = b1.ID
	ws.Grid[1][1].BuildingID = b1.ID

	b2 := &model.Building{
		ID:          "b2",
		Type:        model.BuildingTypeDepotMk1,
		OwnerID:     "p1",
		Position:    model.Position{X: 2, Y: 1},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b2)
	ws.Buildings[b2.ID] = b2
	ws.TileBuilding[model.TileKey(2, 1)] = b2.ID
	ws.Grid[1][2].BuildingID = b2.ID

	b3 := &model.Building{
		ID:          "b3",
		Type:        model.BuildingTypeDepotMk1,
		OwnerID:     "p1",
		Position:    model.Position{X: 4, Y: 4},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b3)
	ws.Buildings[b3.ID] = b3
	ws.TileBuilding[model.TileKey(4, 4)] = b3.ID
	ws.Grid[4][4].BuildingID = b3.ID

	b4 := &model.Building{
		ID:          "b4",
		Type:        model.BuildingTypeDepotMk1,
		OwnerID:     "p2",
		Position:    model.Position{X: 2, Y: 2},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b4)
	ws.Buildings[b4.ID] = b4
	ws.TileBuilding[model.TileKey(2, 2)] = b4.ID
	ws.Grid[2][2].BuildingID = b4.ID

	network := storageNetworkFor(ws, b1.ID)
	if len(network.Nodes) != 2 {
		t.Fatalf("expected network size 2, got %d", len(network.Nodes))
	}
}
