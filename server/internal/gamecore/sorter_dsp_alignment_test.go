package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 第 19 轮契约 §1（DSP 口径）：
// - 所有档位的分拣器都能跨 1–3 格；
// - 往返周期 = cycle_ticks × max(1, 取端步数 + 放端步数 − 1)，最短布局「带|分拣器|机器」算 1；
// - 分拣器耗电，没电不搬。

// mk1 跨 3 格：取货端与放货端各距 3 格都能接上并搬运。
func TestSorterMk1ReachesThreeCellsBothSides(t *testing.T) {
	ws := model.NewWorldState("planet-1", 10)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	input := newConveyorBuilding("in", model.Position{X: 2, Y: 5}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 8, Y: 5}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 5, Y: 5})
	if got := sorter.Sorter.Range; got != 3 {
		t.Fatalf("mk1 range from catalog = %d, want 3", got)
	}
	for _, b := range []*model.Building{input, output, sorter} {
		attachBuilding(ws, b)
	}
	input.Conveyor.Insert(model.ItemIronOre, 3)

	settleSorters(ws)

	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("mk1 must reach belts 3 cells away on both sides, output=%d", got)
	}
	if got := input.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected input items 2 after one trip, got %d", got)
	}
	if sorter.Sorter.LastTransfer == nil || sorter.Sorter.LastTransfer.SourceID != input.ID || sorter.Sorter.LastTransfer.TargetID != output.ID {
		t.Fatalf("expected transfer input→output, got %+v", sorter.Sorter.LastTransfer)
	}
}

// 最短布局「带 | 分拣器 | 机器」两端各 1 步 → 往返长度 1 → mk1 周期 6 tick。
func TestSorterMk1ShortestLayoutCycle(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	input := newConveyorBuilding("in", model.Position{X: 3, Y: 4}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 5, Y: 4}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 4, Y: 4})
	for _, b := range []*model.Building{input, output, sorter} {
		attachBuilding(ws, b)
	}
	input.Conveyor.Insert(model.ItemIronOre, 3)

	ws.Tick = 50
	settleSorters(ws)
	if sorter.Sorter.NextTripTick != 56 {
		t.Fatalf("shortest layout cycle = %d ticks, want 6 (next trip %d)", sorter.Sorter.NextTripTick-ws.Tick, sorter.Sorter.NextTripTick)
	}
	ws.Tick = 55
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("sorter must wait for its cycle, output=%d", got)
	}
	ws.Tick = 56
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("sorter must trip again at tick 56, output=%d", got)
	}
}

// 跨 2+1 步（取端 2 格、放端 1 格）→ 往返长度 2 → mk1 周期 12 tick。
func TestSorterMk1TwoPlusOneStepsCycle(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	input := newConveyorBuilding("in", model.Position{X: 2, Y: 4}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 5, Y: 4}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 4, Y: 4})
	for _, b := range []*model.Building{input, output, sorter} {
		attachBuilding(ws, b)
	}
	input.Conveyor.Insert(model.ItemIronOre, 3)

	ws.Tick = 70
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("first trip must move one item, got %d", got)
	}
	if sorter.Sorter.NextTripTick != 82 {
		t.Fatalf("2+1 step cycle = %d ticks, want 12 (next trip %d)", sorter.Sorter.NextTripTick-ws.Tick, sorter.Sorter.NextTripTick)
	}
}

// 断电分拣器不搬：mk1 默认耗电 1，没有电网时 settleResources 把它打成 no_power，
// settleSorters 跳过。
func TestSorterWithoutPowerDoesNotMove(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	input := newConveyorBuilding("in", model.Position{X: 3, Y: 4}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 5, Y: 4}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 4, Y: 4})
	for _, b := range []*model.Building{input, output, sorter} {
		attachBuilding(ws, b)
	}
	if got := model.PowerDemandForBuilding(sorter); got <= 0 {
		t.Fatalf("mk1 sorter must consume power, demand=%d", got)
	}
	input.Conveyor.Insert(model.ItemIronOre, 3)

	ws.Tick = 10
	settleResources(ws)
	if sorter.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("sorter without a grid must be no_power, got %s", sorter.Runtime.State)
	}
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("unpowered sorter must not move items, output=%d", got)
	}
	if sorter.Sorter.LastTransfer != nil {
		t.Fatalf("unpowered sorter must not record a transfer: %+v", sorter.Sorter.LastTransfer)
	}
}

// 四种分拣器的目录数据：range 全 3、耗电与契约一致。
func TestSorterCatalogRangesAndPower(t *testing.T) {
	for _, tc := range []struct {
		btype   model.BuildingType
		consume int
	}{
		{model.BuildingTypeSorterMk1, 1},
		{model.BuildingTypeSorterMk2, 1},
		{model.BuildingTypeSorterMk3, 2},
		{model.BuildingTypePileSorter, 2},
	} {
		t.Run(string(tc.btype), func(t *testing.T) {
			runtime, ok := model.BuildingRuntimeDefinitionByID(tc.btype)
			if !ok || runtime.Functions.Sorter == nil {
				t.Fatalf("%s: missing sorter runtime definition", tc.btype)
			}
			if runtime.Functions.Sorter.Range != 3 {
				t.Fatalf("%s range = %d, want 3", tc.btype, runtime.Functions.Sorter.Range)
			}
			if runtime.Params.EnergyConsume != tc.consume {
				t.Fatalf("%s params.energy_consume = %d, want %d", tc.btype, runtime.Params.EnergyConsume, tc.consume)
			}
			if runtime.Functions.Energy == nil || runtime.Functions.Energy.ConsumePerTick != tc.consume {
				t.Fatalf("%s functions.energy.consume_per_tick = %+v, want %d", tc.btype, runtime.Functions.Energy, tc.consume)
			}
			hasPower := false
			for _, point := range runtime.Params.ConnectionPoints {
				if point.Kind == model.ConnectionPower {
					hasPower = true
				}
			}
			if !hasPower {
				t.Fatalf("%s must expose a power connection point", tc.btype)
			}
		})
	}
}
