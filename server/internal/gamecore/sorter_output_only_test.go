package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 报告 B-2：生产建筑（熔炉 / 制造台 / 研究站 / 精炼厂……）输出端的
// 未过滤分拣器只能搬产物（输出缓冲），不能把机器正在吃的原料抽走。
// 仓储类（储物仓 / 补给站 / 物流站 / HQ）的主库存本来就是出货口，照旧可导出。

// 电弧熔炉主库存里既有铁矿（原料）又有铁块（产物）：输出侧分拣器只搬铁块，
// 铁矿留在机器里继续加工。
func TestSorterFromProductionMachineMovesOnlyProducts(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 熔炉 3×3 占 (4,5)..(6,7)；分拣器 (7,6) 朝东（背面西 = 熔炉占地），
	// 放货端东侧 (8,6) 是朝东的带子。
	smelter := newProductionTestBuilding("smelter", model.BuildingTypeArcSmelter, model.Position{X: 4, Y: 5}, "smelt_iron")
	belt := newConveyorBuilding("belt", model.Position{X: 8, Y: 6}, model.ConveyorEast)
	belt.Runtime.State = model.BuildingWorkRunning
	sorter := newSorterBuilding("sorter", model.Position{X: 7, Y: 6})
	sorter.Rotation = model.PlanRotation90
	sorter.Sorter.Range = 1
	sorter.Sorter.CycleTicks = 1
	attachBuilding(ws, smelter)
	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)

	// 原料与产物都放在主库存：settleStorage 会把产物（配方输出）搬进输出缓冲，
	// 原料留在主库存——这正是试玩里「熔炉刚到货的铁矿被输出分拣器抽走」的现场。
	smelter.Storage.Inventory = model.ItemInventory{
		model.ItemIronOre:   6,
		model.ItemIronIngot: 3,
	}
	settleStorage(ws)
	if got := smelter.Storage.OutputBuffer[model.ItemIronIngot]; got != 3 {
		t.Fatalf("fixture: expected 3 ingots in output buffer, got %d (%+v)", got, smelter.Storage)
	}
	if got := smelter.Storage.OutputBuffer[model.ItemIronOre]; got != 0 {
		t.Fatalf("fixture: ore must stay out of the output buffer, got %d", got)
	}

	for tick := int64(1); tick <= 10; tick++ {
		ws.Tick = tick
		settleSorters(ws)
	}

	if got := belt.Conveyor.TotalItems(); got != 3 {
		t.Fatalf("expected the 3 ingots on the belt, got %d (%+v)", got, belt.Conveyor.Buffer)
	}
	for _, stack := range belt.Conveyor.Buffer {
		if stack.ItemID != model.ItemIronIngot {
			t.Fatalf("product belt polluted with %s: %+v", stack.ItemID, belt.Conveyor.Buffer)
		}
	}
	if got := smelter.Storage.Inventory[model.ItemIronOre]; got != 6 {
		t.Fatalf("raw ore must stay in the smelter, got %d (%+v)", got, smelter.Storage.Inventory)
	}
	if got := smelter.Storage.OutputBuffer[model.ItemIronIngot]; got != 0 {
		t.Fatalf("all ingots should have left, got %d", got)
	}
}

// 装配机同样只出产物：输出缓冲里的成品被搬走，主库存里的原料不动。
func TestSorterFromAssemblerKeepsInputs(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	assembler := newProductionTestBuilding("assembler", model.BuildingTypeAssemblingMachineMk1, model.Position{X: 4, Y: 5}, "gear")
	belt := newConveyorBuilding("belt", model.Position{X: 8, Y: 6}, model.ConveyorEast)
	belt.Runtime.State = model.BuildingWorkRunning
	sorter := newSorterBuilding("sorter", model.Position{X: 7, Y: 6})
	sorter.Rotation = model.PlanRotation90
	sorter.Sorter.Range = 1
	sorter.Sorter.CycleTicks = 1
	attachBuilding(ws, assembler)
	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)

	assembler.Storage.Inventory = model.ItemInventory{
		model.ItemIronIngot: 4,
		model.ItemGear:      2,
	}
	settleStorage(ws)

	for tick := int64(1); tick <= 10; tick++ {
		ws.Tick = tick
		settleSorters(ws)
	}

	if got := belt.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected 2 gears on the belt, got %d (%+v)", got, belt.Conveyor.Buffer)
	}
	for _, stack := range belt.Conveyor.Buffer {
		if stack.ItemID != model.ItemGear {
			t.Fatalf("product belt polluted with %s: %+v", stack.ItemID, belt.Conveyor.Buffer)
		}
	}
	if got := assembler.Storage.Inventory[model.ItemIronIngot]; got != 4 {
		t.Fatalf("raw ingots must stay in the assembler, got %d", got)
	}
}

// 仓储类建筑不受「只出产物」约束：储物仓、补给站的主库存整仓可导出。
func TestSorterFromStorageBuildingsStillMovesInventory(t *testing.T) {
	for _, btype := range []model.BuildingType{
		model.BuildingTypeDepotMk1,
		model.BuildingTypeSupplyStation,
		model.BuildingTypeBattlefieldAnalysisBase,
	} {
		t.Run(string(btype), func(t *testing.T) {
			ws := model.NewWorldState("planet-1", 16)
			ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

			storage := newBuilding("store", btype, "p1", model.Position{X: 4, Y: 5})
			storage.Runtime.State = model.BuildingWorkRunning
			belt := newConveyorBuilding("belt", model.Position{X: 8, Y: 6}, model.ConveyorEast)
			belt.Runtime.State = model.BuildingWorkRunning
			sorter := newSorterBuilding("sorter", model.Position{X: 7, Y: 6})
			sorter.Rotation = model.PlanRotation90
			sorter.Sorter.Range = 1
			sorter.Sorter.CycleTicks = 1
			attachBuilding(ws, storage)
			attachBuilding(ws, belt)
			attachBuilding(ws, sorter)

			storage.Storage.Inventory = model.ItemInventory{model.ItemIronIngot: 5}

			for tick := int64(1); tick <= 10; tick++ {
				ws.Tick = tick
				settleSorters(ws)
			}

			if got := belt.Conveyor.TotalItems(); got != 5 {
				t.Fatalf("%s inventory must still be exportable, belt got %d (%+v)", btype, got, belt.Conveyor.Buffer)
			}
			if got := storage.Storage.Inventory[model.ItemIronIngot]; got != 0 {
				t.Fatalf("%s inventory should be drained, got %d", btype, got)
			}
		})
	}
}

// transfer_item to_player 是玩家手工取货：生产建筑里尚未加工的原料也能取出
// （B-2 的修复只收紧分拣器/物流的自动导出，不改变玩家主动取货）。
func TestTransferItemToPlayerStillWithdrawsMachineInputs(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	smelter := newProductionTestBuilding("smelter", model.BuildingTypeArcSmelter, model.Position{X: 6, Y: 6}, "smelt_iron")
	attachBuilding(ws, smelter)
	smelter.Storage.Inventory = model.ItemInventory{model.ItemIronOre: 4}
	smelter.Runtime.State = model.BuildingWorkRunning

	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": smelter.ID,
			"item_id":     model.ItemIronOre,
			"quantity":    float64(3),
			"direction":   "to_player",
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("transfer_item to_player should still withdraw raw inputs: %s (%s)", res.Code, res.Message)
	}
	if got := starterMecha(ws, "p1").Inventory[model.ItemIronOre]; got != 3 {
		t.Fatalf("expected 3 ore in player inventory, got %d", got)
	}
	if got := smelter.Storage.Inventory[model.ItemIronOre]; got != 1 {
		t.Fatalf("expected 1 ore left in the smelter, got %d", got)
	}
}
