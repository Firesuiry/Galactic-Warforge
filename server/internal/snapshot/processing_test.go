package snapshot

import (
	"encoding/json"
	"reflect"
	"siliconworld/internal/model"
	"testing"
)

func TestProcessingSnapshotPreservesRealSprayAndRandomState(t *testing.T) {
	ws := model.NewWorldState("processing", 8)
	for _, kind := range []model.BuildingType{model.BuildingTypeFractionator, model.BuildingTypeSprayCoater} {
		profile := model.BuildingProfileFor(kind, 1)
		b := &model.Building{ID: string(kind), Type: kind, OwnerID: "p1", Position: model.Position{X: 3, Y: 3}, Level: 1, Runtime: profile.Runtime}
		model.InitBuildingStorage(b)
		model.InitBuildingFractionation(b)
		model.InitBuildingSprayCoater(b)
		if b.Fractionation != nil {
			b.Fractionation.InputBuffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 2, Spray: &model.SprayState{Level: 2, RemainingUses: 3}}}
			b.Fractionation.Attempts = 11
			b.Fractionation.Converted = 1
			b.Fractionation.ReturnedHydrogen = 10
			b.Fractionation.DeuteriumBuffer = 1
			b.Fractionation.RNGState = 12345
		}
		if b.SprayCoater != nil {
			b.Position.X = 5
			b.SprayCoater.SprayItemID = model.ItemProliferatorMk3
			b.SprayCoater.SprayUnits = 57
			b.SprayCoater.SprayEffect = &model.SprayState{Level: 3, RemainingUses: 8}
			b.SprayCoater.ConsumedProliferator = 1
			b.SprayCoater.CoatedItems = 3
			b.SprayCoater.OutputBuffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 3, Spray: &model.SprayState{Level: 3, RemainingUses: 8}}}
		}
		ws.Buildings[b.ID] = b
		if err := ws.IndexBuilding(b); err != nil {
			t.Fatal(err)
		}
	}
	captured := CaptureWorld(ws)
	encoded, err := json.Marshal(captured)
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
	for id, b := range ws.Buildings {
		got := restored.Buildings[id]
		if !reflect.DeepEqual(b.Fractionation, got.Fractionation) || !reflect.DeepEqual(b.SprayCoater, got.SprayCoater) {
			t.Fatalf("snapshot lost processing state %s", id)
		}
	}
	restored.Buildings["fractionator"].Fractionation.InputBuffer[0].Spray.RemainingUses = 0
	restored.Buildings["spray_coater"].SprayCoater.SprayEffect.RemainingUses = 0
	if ws.Buildings["fractionator"].Fractionation.InputBuffer[0].Spray.RemainingUses != 3 || decoded.Buildings["fractionator"].Fractionation.InputBuffer[0].Spray.RemainingUses != 3 || ws.Buildings["spray_coater"].SprayCoater.SprayEffect.RemainingUses != 8 {
		t.Fatal("snapshot restore aliases live spray")
	}
	decoded.Buildings["fractionator"].Fractionation.RNGState = 0
	if _, err := decoded.Restore(); err == nil {
		t.Fatal("invalid random state accepted")
	}
	decoded.Buildings["fractionator"].Fractionation.RNGState = 12345
	decoded.Buildings["spray_coater"].SprayCoater.SprayUnits = 61
	if _, err := decoded.Restore(); err == nil {
		t.Fatal("unbacked spray units accepted")
	}
}
