package snapshot_test

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

// 回归：分拣器朝向与矿机的开采矿种必须在快照往返中保留。
// 分拣器的取/放端完全由 Building.Rotation 派生（model.SorterFacingAxis），
// 采集机的覆盖框也按 Rotation 算；第 16 轮起生产建筑只能经分拣器进出货，
// 漏掉这两个字段会让读档后的产线静默停摆（存档点重建实测：分拣器全部朝北）。
func TestSnapshotPreservesBuildingRotationAndMiningItem(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	sorterProfile := model.BuildingProfileFor(model.BuildingTypeSorterMk1, 1)
	sorter := &model.Building{
		ID: "s-1", Type: model.BuildingTypeSorterMk1, OwnerID: "p1",
		Position: model.Position{X: 4, Y: 3}, Runtime: sorterProfile.Runtime,
	}
	model.InitBuildingSorter(sorter)
	model.ApplyBuildingRotation(sorter, model.PlanRotation90)
	ws.Buildings[sorter.ID] = sorter
	if err := ws.IndexBuilding(sorter); err != nil {
		t.Fatal(err)
	}

	minerProfile := model.BuildingProfileFor(model.BuildingTypeMiningMachine, 1)
	miner := &model.Building{
		ID: "m-1", Type: model.BuildingTypeMiningMachine, OwnerID: "p1",
		Position: model.Position{X: 6, Y: 5}, Runtime: minerProfile.Runtime,
		MiningItem: model.ItemIronOre,
	}
	model.InitBuildingStorage(miner)
	model.InitBuildingProduction(miner)
	ws.Buildings[miner.ID] = miner
	if err := ws.IndexBuilding(miner); err != nil {
		t.Fatal(err)
	}

	saved := snapshot.CaptureRuntime(map[string]*model.WorldState{ws.PlanetID: ws}, ws.PlanetID, nil, nil)
	worlds, _, _, err := saved.RestoreRuntime()
	if err != nil {
		t.Fatal(err)
	}
	restored := worlds[ws.PlanetID]
	gotSorter := restored.Buildings[sorter.ID]
	if gotSorter == nil {
		t.Fatal("sorter lost")
	}
	if gotSorter.Rotation != model.PlanRotation90 {
		t.Fatalf("分拣器朝向丢失：got %q，want 90", gotSorter.Rotation)
	}
	if front := model.SorterFacing(gotSorter.Rotation); front != model.ConveyorEast {
		t.Fatalf("分拣器正面应朝东（90°），got %s", front)
	}
	gotMiner := restored.Buildings[miner.ID]
	if gotMiner == nil {
		t.Fatal("miner lost")
	}
	if gotMiner.MiningItem != model.ItemIronOre {
		t.Fatalf("矿机开采矿种丢失：got %q，want %q", gotMiner.MiningItem, model.ItemIronOre)
	}
}
