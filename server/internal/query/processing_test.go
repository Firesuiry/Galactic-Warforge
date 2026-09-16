package query

import (
	"encoding/json"
	"siliconworld/internal/model"
	"testing"
)

func TestPlanetSceneShowsFractionationAndSprayState(t *testing.T) {
	ql, ws, id := newPlanetQueryFixture(t, 16, 16)
	for i, kind := range []model.BuildingType{model.BuildingTypeFractionator, model.BuildingTypeSprayCoater} {
		b := &model.Building{ID: string(kind), Type: kind, OwnerID: "p1", Position: model.Position{X: 3 + i, Y: 3}, VisionRange: 4, Runtime: model.BuildingProfileFor(kind, 1).Runtime}
		model.InitBuildingFractionation(b)
		model.InitBuildingSprayCoater(b)
		model.InitBuildingStorage(b)
		if b.Fractionation != nil {
			b.Fractionation.InputBuffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 2, Spray: &model.SprayState{Level: 3, RemainingUses: 7}}}
			b.Fractionation.LastProbability = .02
		}
		if b.SprayCoater != nil {
			b.SprayCoater.SprayUnits = 57
			b.SprayCoater.SprayItemID = model.ItemProliferatorMk3
		}
		ws.Buildings[b.ID] = b
	}
	view, ok := ql.PlanetScene(ws, "p1", id, PlanetSceneRequest{X: 0, Y: 0, Width: 8, Height: 8})
	if !ok {
		t.Fatal("scene unavailable")
	}
	encoded, err := json.Marshal(view.Buildings)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]*model.Building
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	f, s := decoded["fractionator"].Fractionation, decoded["spray_coater"].SprayCoater
	if f == nil || s == nil || f.LastProbability != .02 || f.InputBuffer[0].Spray.RemainingUses != 7 || s.SprayUnits != 57 || s.SprayItemID != model.ItemProliferatorMk3 {
		t.Fatalf("incomplete processing JSON: %s", encoded)
	}
}
