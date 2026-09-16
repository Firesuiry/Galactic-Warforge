package query

import (
	"encoding/json"
	"siliconworld/internal/model"
	"testing"
)

func TestPlanetSceneIncludesSplitterStateJSON(t *testing.T) {
	ql, ws, id := newPlanetQueryFixture(t, 16, 16)
	b := &model.Building{ID: "splitter", OwnerID: "p1", Type: model.BuildingTypeSplitter, Position: model.Position{X: 3, Y: 3}, VisionRange: 4, Runtime: model.BuildingProfileFor(model.BuildingTypeSplitter, 1).Runtime}
	model.InitBuildingConveyor(b)
	b.Splitter.OutputFilters = map[model.ConveyorDirection]string{model.ConveyorEast: model.ItemIronOre}
	b.Splitter.TransferredItems = 12
	b.Conveyor.Insert(model.ItemIronOre, 4)
	ws.Buildings[b.ID] = b
	view, ok := ql.PlanetScene(ws, "p1", id, PlanetSceneRequest{X: 0, Y: 0, Width: 8, Height: 8, NearX: 3, NearY: 3, Radius: 4})
	if !ok || view.Buildings[b.ID] == nil {
		t.Fatal("missing own splitter in scene")
	}
	encoded, err := json.Marshal(view.Buildings[b.ID])
	if err != nil {
		t.Fatal(err)
	}
	var decoded model.Building
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Splitter == nil || decoded.Splitter.TransferredItems != 12 || decoded.Conveyor.TotalItems() != 4 || decoded.Splitter.OutputFilters[model.ConveyorEast] != model.ItemIronOre {
		t.Fatalf("incomplete scene state: %s", encoded)
	}
}
