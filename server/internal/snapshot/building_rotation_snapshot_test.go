package snapshot

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
)

// 分拣器的取/放端由建造朝向派生（背面取货、正面放货，见 model.SorterFacingAxis），
// 矿机定下的开采矿种也按朝向算。朝向漏进快照会让读档后的分拣器退化成 rotation=0：
// cp-base 读档即复现——两条「矿机→带→分拣器→熔炉」的线全部停摆，熔炉空转、带子堆料。
func TestBuildingRotationSurvivesSnapshotRoundTrip(t *testing.T) {
	original := &model.Building{
		ID: "sorter-1", Type: model.BuildingTypeSorterMk1, OwnerID: "p1",
		Position: model.Position{X: 3, Y: 4}, HP: 120, MaxHP: 120, Level: 1,
		Rotation: model.PlanRotation270,
	}
	model.InitBuildingSorter(original)
	encoded, err := json.Marshal(cloneBuilding(original))
	if err != nil {
		t.Fatal(err)
	}
	var decoded BuildingSnapshot
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	restored, err := restoreBuilding("sorter-1", &decoded)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Rotation != model.PlanRotation270 {
		t.Fatalf("rotation lost in snapshot round trip: got %q want %q", restored.Rotation, model.PlanRotation270)
	}
	back, front := model.SorterFacingAxis(restored.Rotation)
	if back != model.ConveyorEast || front != model.ConveyorWest {
		t.Fatalf("取货/放货端应随朝向还原（back=%s front=%s）", back, front)
	}
}
