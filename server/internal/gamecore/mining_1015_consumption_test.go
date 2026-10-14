package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1015 回归 2：采矿机 → 传送带 → 熔炉 全链跑几千 tick，矿脉消耗必须
// 恒等于实际产出（矿石在途 + 已炼成锭的量）。
//
// 旧实现每 tick 无条件按全速扣矿脉，缓冲满后矿石从未落地：试玩里 8 个节点
// 到 tick 8000 被抽干到 0，而矿机存储、皮带、熔炉里一块矿石都没有。
func TestMinerBeltSmelterKeepsVeinConsumptionEqualToOutput(t *testing.T) {
	ws := newMiningTestWorld(12)
	// 采矿机 3×3（x6..8,y6..8）覆盖 5×5 框（含外扩 1 圈）：外圈 16 条铁矿脉。
	miner := newMiningTestBuilding("miner", model.BuildingTypeMiningMachine, model.Position{X: 6, Y: 6}, 8)
	smelter := newProductionTestBuilding("smelter", model.BuildingTypeArcSmelter, model.Position{X: 0, Y: 5}, "smelt_iron")
	// 输出带从矿机西侧外圈 (5,7) 一路向西到熔炉东侧外圈 (3,7)：
	// (3,7) 朝西指向熔炉占地内的 (2,7)，即熔炉输入口。
	belts := []*model.Building{
		newConveyorBuilding("belt-5", model.Position{X: 5, Y: 7}, model.ConveyorWest),
		newConveyorBuilding("belt-4", model.Position{X: 4, Y: 7}, model.ConveyorWest),
		newConveyorBuilding("belt-3", model.Position{X: 3, Y: 7}, model.ConveyorWest),
	}
	attachBuilding(ws, miner)
	attachBuilding(ws, smelter)
	for _, b := range belts {
		attachBuilding(ws, b)
	}

	veinRemaining := func() int {
		total := 0
		for id := range ws.Resources {
			total += ws.Resources[id].Remaining
		}
		return total
	}
	// 覆盖框内 8 条脉：x5..9, y5..9 里除采矿机占地外都铺上矿。
	nodeCount := 0
	for y := 5; y <= 9; y++ {
		for x := 5; x <= 9; x++ {
			if x >= 6 && x <= 8 && y >= 6 && y <= 8 {
				continue
			}
			addFiniteVein(ws, veinID(x, y), model.ItemIronOre, "c1", x, y, 8, 20000)
			nodeCount++
		}
	}
	if nodeCount != 16 {
		t.Fatalf("expected 16 ring veins around a 3x3 miner, got %d", nodeCount)
	}
	startRemaining := veinRemaining()

	// 前置检查：矿机确实覆盖了这些脉。
	if got := len(coveredResourceNodeIDs(ws, miner)); got != nodeCount {
		t.Fatalf("expected miner to cover %d veins, got %d", nodeCount, got)
	}

	const ticks = 4000
	for tick := 0; tick < ticks; tick++ {
		ws.Tick++
		settleResources(ws)
		settleConveyors(ws)
		settleBuildingIO(ws)
		settleProduction(ws)
		settleStorage(ws)
	}

	consumed := startRemaining - veinRemaining()
	// 实际产出 = 矿机本地存储 + 三条皮带在途 + 熔炉存储（矿石已被炼成锭，按锭计）
	// + 熔炉当前这一批已经吃进去、还没变成锭的 1 个铁矿。
	inSystem := totalStorageItems(miner.Storage) + totalStorageItems(smelter.Storage)
	for _, b := range belts {
		inSystem += b.Conveyor.TotalItems()
	}
	// 熔炉内部还有「已消耗但尚未落地」的料：正在加工的那一批（1 个铁矿）
	// 与已经结算、还压在 pending_outputs 里等落点的成品。
	if smelter.Production != nil {
		if smelter.Production.RemainingTicks > 0 {
			inSystem++ // 在制的那 1 个铁矿（smelt_iron 每批吃 1 个）
		}
		for _, out := range append(append([]model.ItemAmount(nil), smelter.Production.PendingOutputs...), smelter.Production.PendingByproducts...) {
			inSystem += out.Quantity
		}
	}
	if consumed != inSystem {
		beltsIn := 0
		for _, b := range belts {
			beltsIn += b.Conveyor.TotalItems()
		}
		t.Fatalf("矿脉消耗与实际产出不一致：消耗 %d，系统内实物 %d（矿机 %d / 皮带 %d / 熔炉 %d 含 %v，在制 %d tick）",
			consumed, inSystem, totalStorageItems(miner.Storage), beltsIn, totalStorageItems(smelter.Storage),
			smelter.Storage.Inventory, smelter.Production.RemainingTicks)
	}
	if consumed == 0 {
		t.Fatal("expected the miner to extract ore through the belt into the smelter")
	}
	// 熔炉真的吃到了矿并炼出铁块（整条链路通）。
	ingots := smelter.ExportableItemQuantity(model.ItemIronIngot)
	if ingots == 0 {
		t.Fatalf("expected the smelter to smelt iron ingots from belt-delivered ore, storage=%+v", smelter.Storage)
	}
}

func veinID(x, y int) string {
	return fmt.Sprintf("v-%d-%d", x, y)
}

// countStacks 把 Take 返回的物品栈折算成件数。
func countStacks(stacks []model.ItemStack) int {
	total := 0
	for _, stack := range stacks {
		total += stack.Quantity
	}
	return total
}
