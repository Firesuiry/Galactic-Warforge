package snapshot

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
)

// 读旧档时物流建筑必须按当前定义刷新 runtime：
// 本分支把传送带 stack_limit 改回物理值 2/3/6、分拣器 range 改回 3 并加耗电，
// 旧存档里冻结的是旧参数（mk2 带 stack_limit=5、分拣器 range=1 且无 energy 模块）。
// 读档后必须用新定义结算，但带上的存货、分拣器实例状态不能丢。
func TestRestoreRefreshesLogisticsRuntimeFromDefinition(t *testing.T) {
	t.Run("belt_reflows_stack_limit_without_losing_buffer", func(t *testing.T) {
		original := &model.Building{
			ID: "belt-1", Type: model.BuildingTypeConveyorBeltMk2, OwnerID: "p1",
			Position: model.Position{X: 2, Y: 2}, HP: 100, MaxHP: 100, Level: 1,
			Runtime: model.BuildingRuntime{
				// 旧档参数：MaxStack 5（旧定义），Throughput 2（与当前一致）。
				Functions: model.BuildingFunctionModules{
					Transport: &model.TransportModule{Throughput: 2, StackLimit: 5},
				},
			},
			Conveyor: &model.ConveyorState{
				Input: model.ConveyorWest, Output: model.ConveyorEast,
				MaxStack: 5, Throughput: 2,
				Buffer: []model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 5}},
			},
		}
		restored := roundTripBuilding(t, original)

		if got := restored.Runtime.Functions.Transport.StackLimit; got != 3 {
			t.Fatalf("runtime stack_limit 未刷新：got %d want 3", got)
		}
		if got := restored.Runtime.Functions.Transport.Throughput; got != 2 {
			t.Fatalf("runtime throughput 应保持 2：got %d", got)
		}
		if got := restored.Conveyor.MaxStack; got != 3 {
			t.Fatalf("Conveyor.MaxStack 未按新定义刷新：got %d want 3", got)
		}
		if got := restored.Conveyor.Throughput; got != 2 {
			t.Fatalf("Conveyor.Throughput 应保持 2：got %d", got)
		}
		if got := restored.Conveyor.TotalItems(); got != 5 {
			t.Fatalf("带上存货丢失：got %d want 5", got)
		}
		// 超量期间只出不进：AvailableCapacity=0，Insert 不接受，件数不丢。
		if got := restored.Conveyor.AvailableCapacity(); got != 0 {
			t.Fatalf("超量时 AvailableCapacity 应为 0：got %d", got)
		}
		taken, left, err := restored.Conveyor.Insert(model.ItemCopperOre, 1)
		if err != nil {
			t.Fatal(err)
		}
		if taken != 0 || left != 1 {
			t.Fatalf("超量时不应进货：taken=%d left=%d", taken, left)
		}
		if got := restored.Conveyor.TotalItems(); got != 5 {
			t.Fatalf("进货拒绝后件数应仍为 5：got %d", got)
		}
		// 出库仍可，出到低于上限后才恢复进货。
		restored.Conveyor.Take(3)
		if got := restored.Conveyor.TotalItems(); got != 2 {
			t.Fatalf("出库后应剩 2 件：got %d", got)
		}
		taken, left, err = restored.Conveyor.Insert(model.ItemCopperOre, 2)
		if err != nil {
			t.Fatal(err)
		}
		if taken != 1 || left != 1 {
			t.Fatalf("腾出空间后应只接受到上限：taken=%d left=%d", taken, left)
		}
	})

	t.Run("sorter_refreshes_range_and_energy", func(t *testing.T) {
		original := &model.Building{
			ID: "sorter-1", Type: model.BuildingTypeSorterMk1, OwnerID: "p1",
			Position: model.Position{X: 5, Y: 5}, HP: 100, MaxHP: 100, Level: 1,
			Runtime: model.BuildingRuntime{
				// 旧档参数：range=1、没有 energy 模块、EnergyConsume=0。
				Functions: model.BuildingFunctionModules{
					Sorter: &model.SorterModule{CycleTicks: 6, Range: 1},
				},
				Params: model.BuildingRuntimeParams{EnergyConsume: 0},
			},
			Sorter: &model.SorterState{
				CycleTicks: 6,
				Range:      1,
				Filter:     model.SorterFilter{Mode: model.SorterFilterAllow},
			},
		}
		restored := roundTripBuilding(t, original)

		if got := restored.Runtime.Functions.Sorter.Range; got != 3 {
			t.Fatalf("runtime sorter range 未刷新：got %d want 3", got)
		}
		if got := restored.Sorter.Range; got != 3 {
			t.Fatalf("分拣器实例 Range 未刷新：got %d want 3", got)
		}
		if restored.Runtime.Functions.Energy == nil {
			t.Fatal("分拣器应补上 energy 模块")
		}
		if got := restored.Runtime.Functions.Energy.ConsumePerTick; got != 1 {
			t.Fatalf("energy.consume_per_tick 应为 1：got %d", got)
		}
		if got := restored.Runtime.Params.EnergyConsume; got != 1 {
			t.Fatalf("Params.EnergyConsume 应为 1：got %d", got)
		}
		if len(restored.Runtime.Params.ConnectionPoints) == 0 {
			t.Fatal("分拣器应带 power 连接点")
		}
	})

	t.Run("definition_modules_are_not_shared_pointers", func(t *testing.T) {
		original := &model.Building{
			ID: "sorter-2", Type: model.BuildingTypeSorterMk3, OwnerID: "p1",
			Position: model.Position{X: 7, Y: 7}, HP: 100, MaxHP: 100, Level: 1,
			Runtime: model.BuildingRuntime{
				Functions: model.BuildingFunctionModules{
					Sorter: &model.SorterModule{CycleTicks: 2, Range: 1},
				},
			},
			Sorter: &model.SorterState{CycleTicks: 2, Range: 1, Filter: model.SorterFilter{Mode: model.SorterFilterAllow}},
		}
		restored := roundTripBuilding(t, original)
		// 改实例不得污染 catalog 定义。
		restored.Runtime.Functions.Sorter.Range = 99
		def, ok := model.BuildingRuntimeDefinitionByID(model.BuildingTypeSorterMk3)
		if !ok {
			t.Fatal("definition missing")
		}
		if def.Functions.Sorter.Range != 3 {
			t.Fatalf("catalog 定义被实例修改污染：got %d", def.Functions.Sorter.Range)
		}
	})
}

func roundTripBuilding(t *testing.T, original *model.Building) *model.Building {
	t.Helper()
	encoded, err := json.Marshal(cloneBuilding(original))
	if err != nil {
		t.Fatal(err)
	}
	var decoded BuildingSnapshot
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	restored, err := restoreBuilding(original.ID, &decoded)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	return restored
}
