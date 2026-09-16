package snapshot

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
)

func TestSorterTransferCloneIsolationAndJSON(t *testing.T) {
	original := &model.SorterState{
		InputDirections: []model.ConveyorDirection{model.ConveyorWest},
		Filter:          model.SorterFilter{Items: []string{model.ItemIronOre}},
		LastTransfer: &model.SorterTransfer{
			Tick: 10, Sequence: 2, SourceID: "source", TargetID: "target",
			SourcePosition: model.Position{X: 1, Y: 2},
			TargetPosition: model.Position{X: 3, Y: 2}, ItemID: model.ItemIronOre, Quantity: 1,
		},
	}
	for name, cloned := range map[string]*model.SorterState{"model": original.Clone(), "snapshot": cloneBuilding(&model.Building{Sorter: original}).Sorter} {
		t.Run(name, func(t *testing.T) {
			encoded, err := json.Marshal(cloned)
			if err != nil {
				t.Fatal(err)
			}
			var decoded model.SorterState
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				t.Fatal(err)
			}
			if decoded.LastTransfer == nil || *decoded.LastTransfer != *original.LastTransfer {
				t.Fatalf("transfer lost during JSON round trip: %s", encoded)
			}
			cloned.LastTransfer.Quantity = 9
			cloned.LastTransfer.SourcePosition.X = 9
			cloned.InputDirections[0] = model.ConveyorNorth
			cloned.Filter.Items[0] = model.ItemCopperOre
			if original.LastTransfer.Quantity != 1 || original.LastTransfer.SourcePosition.X != 1 || original.InputDirections[0] != model.ConveyorWest || original.Filter.Items[0] != model.ItemIronOre {
				t.Fatal("modifying a sorter snapshot mutated live world state")
			}
		})
	}
}
