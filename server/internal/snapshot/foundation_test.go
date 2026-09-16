package snapshot

import (
	"encoding/json"
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
	"testing"
)

func TestFoundationSnapshotPreservesTerrainLayerAndFactoryOccupancy(t *testing.T) {
	ws := model.NewWorldState("planet", 4)
	pos := model.Position{X: 1, Y: 1}
	ws.Grid[1][1].Terrain = terrain.TileBuildable
	foundation := &model.Building{ID: "ground", Type: model.BuildingTypeFoundation, Position: pos, FoundationTerrain: []string{"water"}, Runtime: model.BuildingProfileFor(model.BuildingTypeFoundation, 1).Runtime}
	factory := &model.Building{ID: "factory", Type: model.BuildingTypeWindTurbine, Position: pos, Runtime: model.BuildingProfileFor(model.BuildingTypeWindTurbine, 1).Runtime}
	ws.Buildings[foundation.ID] = foundation
	ws.Buildings[factory.ID] = factory
	if err := ws.IndexBuilding(factory); err != nil {
		t.Fatal(err)
	}
	snapshot := CaptureWorld(ws)
	snapshot.Buildings[foundation.ID].FoundationTerrain[0] = "lava"
	if foundation.FoundationTerrain[0] != "water" {
		t.Fatal("snapshot changed live provenance")
	}
	snapshot.Buildings[foundation.ID].FoundationTerrain[0] = "water"
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var decoded WorldSnapshot
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	restored, err := decoded.Restore()
	if err != nil {
		t.Fatal(err)
	}
	if restored.FoundationAt(pos).FoundationTerrain[0] != "water" {
		t.Fatal("lost original terrain")
	}
	if restored.Grid[1][1].Terrain != terrain.TileBuildable || restored.TileBuilding[model.TileKey(1, 1)] != factory.ID {
		t.Fatal("terrain/factory occupancy lost")
	}
	restored.FoundationAt(pos).FoundationTerrain[0] = "blocked"
	if decoded.Buildings[foundation.ID].FoundationTerrain[0] != "water" {
		t.Fatal("restore shares provenance")
	}
}
