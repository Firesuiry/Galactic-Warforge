package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 复审：车上有货、全场无处可送时，派单不能再给机器人派普通单。
// 普通单会去起点装另一种物品：旧实现先 Storage.Provide 扣源、再 Load，
// 货种不符时 Load 返回 0，扣掉的货凭空消失（实测 40 铜矿几趟后剩 36）。

// 1) 车上有铜矿、全场只有熔炉缺铁矿：机器人带着货待命，铜矿不丢、仓库铁矿不动。
func TestAutoHaulWithUndeliverableCargoDoesNotTakeNormalTask(t *testing.T) {
	f := newAutoHaulFixture(t)
	haulFill(f.depot, model.ItemIronOre, 60)
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	robot.Haul.Load(model.ItemCopperOre, 4)

	advanceAutoTicks(f.core, f.ws, 800)

	if robot.Haul.CargoQuantity() != 4 || robot.Haul.Cargo.ItemID != model.ItemCopperOre {
		t.Fatalf("车上的铜矿丢了: %+v", robot.Haul.Cargo)
	}
	if robot.Haul.ToBuildingID != "" {
		t.Fatalf("无处可送的货却被派了普通单: %+v", robot.Haul)
	}
	if got := f.depot.Storage.Inventory[model.ItemIronOre]; got != 60 {
		t.Fatalf("仓库铁矿被扣走: %d, want 60（货种不符的装货不得先扣源）", got)
	}
	if got := haulStored(f.smelter, model.ItemIronOre); got != 0 {
		t.Fatalf("熔炉不该收到任何料: %d", got)
	}
}

// 2) 直接回归装货入口：车上是铜矿、任务要装铁矿时，Provide 不得发生。
func TestHaulLoadAtSourceRejectsMismatchedCargoBeforeProvide(t *testing.T) {
	f := newAutoHaulFixture(t)
	haulFill(f.depot, model.ItemIronOre, 20)
	robot := autoRobot(t, f.ws, f.depot.Position)
	robot.Haul.Load(model.ItemCopperOre, 2)
	robot.Haul.FromBuildingID = f.depot.ID
	robot.Haul.ToBuildingID = f.smelter.ID
	robot.Haul.ItemID = model.ItemIronOre
	robot.Haul.Phase = model.HaulPhaseLoading

	haulLoadAtSource(f.ws, robot)

	if got := f.depot.Storage.Inventory[model.ItemIronOre]; got != 20 {
		t.Fatalf("货种不符时仍从源扣了货: %d, want 20", got)
	}
	if robot.Haul.CargoQuantity() != 2 || robot.Haul.Cargo.ItemID != model.ItemCopperOre {
		t.Fatalf("车上货物被改动: %+v", robot.Haul.Cargo)
	}
	if robot.Haul.Phase != model.HaulPhaseIdle {
		t.Fatalf("自动模式货种不符应清空任务回到待命: %+v", robot.Haul)
	}
}
