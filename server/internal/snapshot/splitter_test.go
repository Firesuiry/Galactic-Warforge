package snapshot

import (
	"encoding/json"
	"reflect"
	"siliconworld/internal/model"
	"testing"
)

func TestSplitterSnapshotRoundTripAndIsolation(t *testing.T) {
	ws := model.NewWorldState("splitter", 8)
	profile := model.BuildingProfileFor(model.BuildingTypeSplitter, 1)
	b := &model.Building{ID: "splitter", Type: model.BuildingTypeSplitter, OwnerID: "p1", Position: model.Position{X: 3, Y: 3}, Level: 1, Runtime: profile.Runtime, HP: profile.MaxHP, MaxHP: profile.MaxHP}
	model.InitBuildingConveyor(b)
	b.Splitter.InputDirections = []model.ConveyorDirection{model.ConveyorWest, model.ConveyorNorth}
	b.Splitter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast, model.ConveyorSouth}
	b.Splitter.InputPriority = model.ConveyorWest
	b.Splitter.OutputPriority = model.ConveyorSouth
	b.Splitter.OutputFilters = map[model.ConveyorDirection]string{model.ConveyorEast: model.ItemCopperOre}
	b.Splitter.InputCursor = 1
	b.Splitter.OutputCursor = 1
	b.Splitter.TransferredItems = 33
	b.Splitter.LastTransferTick = 71
	b.Conveyor.Buffer = []model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 2, Spray: &model.SprayState{Level: 2, RemainingUses: 3}}}
	ws.Buildings[b.ID] = b
	if err := ws.IndexBuilding(b); err != nil {
		t.Fatal(err)
	}
	snap := CaptureWorld(ws)
	encoded, err := json.Marshal(snap)
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
	got := restored.Buildings[b.ID]
	if !reflect.DeepEqual(got.Splitter, b.Splitter) || !reflect.DeepEqual(got.Conveyor, b.Conveyor) {
		t.Fatalf("lost state: %+v %+v", got.Splitter, got.Conveyor)
	}
	for name, clone := range map[string]*model.Building{"model": b.Clone(), "restored": got} {
		t.Run(name, func(t *testing.T) {
			clone.Splitter.InputDirections[0] = model.ConveyorSouth
			clone.Splitter.OutputFilters[model.ConveyorEast] = model.ItemIronOre
			clone.Conveyor.Buffer[0].Spray.RemainingUses = 0
			if b.Splitter.InputDirections[0] != model.ConveyorWest || b.Splitter.OutputFilters[model.ConveyorEast] != model.ItemCopperOre || b.Conveyor.Buffer[0].Spray.RemainingUses != 3 {
				t.Fatal("clone aliases live world")
			}
			if decoded.Buildings[b.ID].Splitter.InputDirections[0] != model.ConveyorWest || decoded.Buildings[b.ID].Conveyor.Buffer[0].Spray.RemainingUses != 3 {
				t.Fatal("restore aliases snapshot")
			}
		})
	}
	snap.Buildings[b.ID].Splitter.OutputFilters[model.ConveyorEast] = model.ItemIronOre
	if b.Splitter.OutputFilters[model.ConveyorEast] != model.ItemCopperOre {
		t.Fatal("capture aliases live filters")
	}
	decoded.Buildings[b.ID].Splitter.OutputCursor = -1
	if _, err := decoded.Restore(); err == nil {
		t.Fatal("invalid cursor restored")
	}
	decoded.Buildings[b.ID].Splitter = nil
	if _, err := decoded.Restore(); err == nil {
		t.Fatal("uninitialized splitter restored")
	}
}
