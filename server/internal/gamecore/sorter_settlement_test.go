package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestSorterTakesFromAnyPassingBeltCell(t *testing.T) {
	// 取货端不要求带尾正对分拣器：只要扫到一条运行中的带子就能从它上面取货。
	ws := model.NewWorldState("planet-1", 5)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 输入带朝东（背对分拣器），输出带在东侧朝东。
	input := newConveyorBuilding("in", model.Position{X: 1, Y: 2}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 3, Y: 2}, model.ConveyorEast)
	sorter := newSorterBuilding("s1", model.Position{X: 2, Y: 2}) // 朝向 90°：背面西、正面东
	sorter.Sorter.Range = 1

	attachBuilding(ws, input)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)

	if _, _, err := input.Conveyor.Insert(model.ItemIronOre, 3); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleSorters(ws)

	if got := input.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected input items 2 after one trip, got %d", got)
	}
	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected output items 1, got %d", got)
	}
}

// 第 16 轮契约 §2（DSP 口径）+ 试玩 1016 报告 B1：分拣器从带子上取货时**扫描
// 整段带子**，跳过被过滤掉的队首物品，取它认的那一栈。旧实现只看队首，队首是
// 铜矿时整条带子（连同后面的铁矿）都取不动。
func TestSorterFilterSkipsFrontStackAndTakesBehind(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	input := newConveyorBuilding("in", model.Position{X: 0, Y: 1}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 2, Y: 1}, model.ConveyorEast)
	sorter := newSorterBuilding("s1", model.Position{X: 1, Y: 1})
	sorter.Sorter.Range = 1
	sorter.Sorter.Filter = model.SorterFilter{
		Mode:  model.SorterFilterAllow,
		Items: []string{model.ItemIronOre},
	}

	attachBuilding(ws, input)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)

	if _, _, err := input.Conveyor.Insert(model.ItemCopperOre, 2); err != nil {
		t.Fatalf("insert copper: %v", err)
	}
	if _, _, err := input.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert iron: %v", err)
	}

	settleSorters(ws)

	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("后面的铁矿应被取走，got %d", got)
	}
	if got := output.Conveyor.Buffer[0].ItemID; got != model.ItemIronOre {
		t.Fatalf("取走的应是铁矿，got %s", got)
	}
	if got := input.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("被过滤掉的铜矿应留在带上，got %d", got)
	}
	if got := input.Conveyor.Buffer[0].ItemID; got != model.ItemCopperOre {
		t.Fatalf("带子顺序应保持（铜矿仍在队首），got %+v", input.Conveyor.Buffer)
	}
}

func TestSorterReachFollowsRange(t *testing.T) {
	// Range 决定沿朝向轴扫几格（第 19 轮起所有档位都是 3，但选路仍按状态里的 range
	// 走，所以这里直接改状态验证扫描边界）。
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 分拣器朝向 90°（背面西、正面东）：背面 2 格是 farInput，正面 1 格是 output。
	farInput := newConveyorBuilding("in", model.Position{X: 0, Y: 3}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 3, Y: 3}, model.ConveyorEast)
	sorter := newSorterBuilding("s1", model.Position{X: 2, Y: 3})
	attachBuilding(ws, farInput)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)
	farInput.Conveyor.Insert(model.ItemIronOre, 1)

	sorter.Sorter.Range = 1
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("range 1 must not reach a belt 2 cells away, moved %d", got)
	}

	sorter.Sorter.Range = 2
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("range 2 must reach the belt, moved %d", got)
	}
}

func TestSorterFacingFollowsRotation(t *testing.T) {
	for _, tc := range []struct {
		rotation model.PlanRotation
		back     model.ConveyorDirection
		front    model.ConveyorDirection
	}{
		{model.PlanRotation0, model.ConveyorSouth, model.ConveyorNorth},
		{model.PlanRotation90, model.ConveyorWest, model.ConveyorEast},
		{model.PlanRotation180, model.ConveyorNorth, model.ConveyorSouth},
		{model.PlanRotation270, model.ConveyorEast, model.ConveyorWest},
	} {
		t.Run(string(tc.rotation), func(t *testing.T) {
			ws := model.NewWorldState("planet-1", 8)
			ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
			sorter := newSorterBuilding("sorter", model.Position{X: 4, Y: 4})
			sorter.Rotation = tc.rotation
			back, front := model.SorterFacingAxis(sorter.Rotation)
			if back != tc.back || front != tc.front {
				t.Fatalf("rotation %s: axis = %s→%s, want %s→%s", tc.rotation, back, front, tc.back, tc.front)
			}
			backPos, _ := ws.SurfaceStep(sorter.Position, back)
			frontPos, _ := ws.SurfaceStep(sorter.Position, front)
			input := newConveyorBuilding("in", backPos, tc.front)
			output := newConveyorBuilding("out", frontPos, tc.front)
			attachBuilding(ws, input)
			attachBuilding(ws, output)
			attachBuilding(ws, sorter)
			input.Conveyor.Insert(model.ItemIronOre, 1)

			settleSorters(ws)

			if got := output.Conveyor.TotalItems(); got != 1 {
				t.Fatalf("rotation %s: item did not travel back→front, output=%d", tc.rotation, got)
			}
			if got := input.Conveyor.TotalItems(); got != 0 {
				t.Fatalf("rotation %s: source kept %d items", tc.rotation, got)
			}
		})
	}
}

func TestSorterTripCycleMatchesCycleTicksAndDistance(t *testing.T) {
	// 往返周期 = cycle_ticks × max(1, 取端步数 + 放端步数 − 1)（mk1 的 cycle_ticks = 6）。
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	input := newConveyorBuilding("in", model.Position{X: 1, Y: 2}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 3, Y: 2}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 2})
	attachBuilding(ws, input)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)
	if sorter.Sorter.CycleTicks != 6 {
		t.Fatalf("mk1 cycle_ticks = %d, want 6", sorter.Sorter.CycleTicks)
	}
	// 两端点各距 1 格 → 往返长度 max(1, 1+1−1) = 1 → 周期 6 tick。
	input.Conveyor.MaxStack = 100
	input.Conveyor.Insert(model.ItemIronOre, 40)

	ws.Tick = 100
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("first trip must move exactly one item, got %d", got)
	}
	if sorter.Sorter.NextTripTick != 106 {
		t.Fatalf("next trip tick = %d, want 106", sorter.Sorter.NextTripTick)
	}
	for tick := int64(101); tick < 106; tick++ {
		ws.Tick = tick
		settleSorters(ws)
	}
	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("sorter tripped before its cycle elapsed, output=%d", got)
	}
	ws.Tick = 106
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("sorter must trip again at tick 106, output=%d", got)
	}

	// 周期 6：60 tick 内最多 11 次往返（t=100/106/…/160）。
	ws.Tick = 0
	sorter.Sorter.NextTripTick = 0
	output.Conveyor.Take(output.Conveyor.TotalItems())
	// 输出带默认容量 10：先清空，保证 11 趟都有地方落货（不是节拍问题）。
	output.Conveyor.MaxStack = 100
	ws.Tick = 100
	for tick := int64(100); tick <= 160; tick++ {
		ws.Tick = tick
		settleSorters(ws)
	}
	if got := output.Conveyor.TotalItems(); got != 11 {
		t.Fatalf("mk1 throughput over 60 ticks = %d items, want 11 (cycle 6)", got)
	}
}

func TestSorterTransferReflectsActualMovement(t *testing.T) {
	ws := model.NewWorldState("planet-1", 5)
	ws.Tick = 12
	input := newConveyorBuilding("in", model.Position{X: 1, Y: 2}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 3, Y: 2}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 2})
	output.Conveyor.MaxStack = 1
	for _, b := range []*model.Building{input, output, sorter} {
		attachBuilding(ws, b)
	}
	// 目标带已满：搬不动，就不该记 transfer，也不该推进往返周期。
	output.Conveyor.Insert(model.ItemCopperOre, 1)
	input.Conveyor.Insert(model.ItemIronOre, 3)
	settleSorters(ws)
	if sorter.Sorter.LastTransfer != nil {
		t.Fatalf("blocked sorter must not record a transfer: %+v", sorter.Sorter.LastTransfer)
	}
	if sorter.Sorter.NextTripTick != 0 {
		t.Fatalf("blocked sorter must not consume its cycle: %d", sorter.Sorter.NextTripTick)
	}

	output.Conveyor.Take(1)
	settleSorters(ws)
	transfer := sorter.Sorter.LastTransfer
	if transfer == nil || transfer.Tick != 12 || transfer.Sequence != 1 || transfer.Quantity != 1 || transfer.ItemID != model.ItemIronOre {
		t.Fatalf("expected record of one actual item, got %+v", transfer)
	}
	if transfer.SourceID != input.ID || transfer.TargetID != output.ID || transfer.SourcePosition != input.Position || transfer.TargetPosition != output.Position {
		t.Fatalf("expected actual source and destination, got %+v", transfer)
	}
	if input.Conveyor.TotalItems() != 2 || output.Conveyor.TotalItems() != 1 {
		t.Fatal("transfer record must correspond to inventory movement")
	}
	// 两端点各距 1 格 → 往返长度 1 → mk1 周期 6 tick。
	if sorter.Sorter.NextTripTick != 18 {
		t.Fatalf("next trip tick = %d, want 24", sorter.Sorter.NextTripTick)
	}

	ws.Tick = 13
	output.Conveyor.Take(1)
	settleSorters(ws)
	if sorter.Sorter.LastTransfer != transfer {
		t.Fatal("trip inside the cycle must not refresh the transfer record")
	}

	ws.Tick = 18
	settleSorters(ws)
	if got := sorter.Sorter.LastTransfer; got == transfer || got.Tick != 18 || got.Sequence != 2 || got.Quantity != 1 {
		t.Fatalf("expected next trip after the cycle to advance sequence, got %+v", got)
	}
}

func TestSorterDoesNotReportOrMoveWhenInactive(t *testing.T) {
	for _, scenario := range []string{"paused", "no_power", "idle", "error", "empty", "filtered"} {
		t.Run(scenario, func(t *testing.T) {
			ws := model.NewWorldState("planet-1", 5)
			ws.Tick = 20
			input := newConveyorBuilding("in", model.Position{X: 1, Y: 2}, model.ConveyorEast)
			output := newConveyorBuilding("out", model.Position{X: 3, Y: 2}, model.ConveyorEast)
			sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 2})
			for _, b := range []*model.Building{input, output, sorter} {
				attachBuilding(ws, b)
			}
			input.Conveyor.Insert(model.ItemIronOre, 2)
			switch scenario {
			case "paused", "no_power", "idle", "error":
				sorter.Runtime.State = model.BuildingWorkState(scenario)
			case "empty":
				input.Conveyor.Take(2)
			case "filtered":
				sorter.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: []string{model.ItemCopperOre}}
			}
			initialItems := input.Conveyor.TotalItems()
			settleSorters(ws)
			if input.Conveyor.TotalItems() != initialItems || output.Conveyor.TotalItems() != 0 || sorter.Sorter.LastTransfer != nil {
				t.Fatalf("inactive sorter moved or recorded items: %+v", sorter.Sorter.LastTransfer)
			}
			oldTransfer := &model.SorterTransfer{Tick: 3, Sequence: 1, Quantity: 1}
			sorter.Sorter.LastTransfer = oldTransfer
			settleSorters(ws)
			if sorter.Sorter.LastTransfer != oldTransfer {
				t.Fatal("inactive sorter must not refresh historical transfer")
			}
		})
	}
}

func newConveyorBuilding(id string, pos model.Position, output model.ConveyorDirection) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeConveyorBeltMk1, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeConveyorBeltMk1,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b)
	b.Conveyor.Output = output
	b.Conveyor.Input = output.Opposite()
	b.Conveyor.Throughput = 6
	b.Conveyor.MaxStack = 10
	return b
}

// newSorterBuilding 造一台朝向 90°（正面=东、背面=西）的 Mk.I 分拣器：
// 与「西边来货、东边出货」的既有夹具一致。其它朝向直接改 Rotation。
func newSorterBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeSorterMk1, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeSorterMk1,
		OwnerID:     "p1",
		Position:    pos,
		Rotation:    model.PlanRotation90,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingSorter(b)
	b.Runtime.State = model.BuildingWorkRunning
	return b
}

// attachBuilding 把建筑直接放进世界（测试夹具）。
// 细分网格：占地是多格的，登记必须走 IndexBuilding——只写锚点格会让 2×2/3×3
// 建筑的其余 cell 看起来是空地（IO 外圈、单位通行、其它建筑落位都会判错）。
func attachBuilding(ws *model.WorldState, b *model.Building) {
	ws.Buildings[b.ID] = b
	model.RegisterPowerGridBuilding(ws, b)
	model.RegisterLogisticsStation(ws, b)
	if err := ws.IndexBuilding(b); err != nil {
		// 夹具里手工摆放的建筑可能整块放不下（老测试按 1×1 的紧邻位置摆的）：
		// 退回只登记锚点格，保持这些夹具的原有语义；生产路径一律走 IndexBuilding。
		key := model.TileKey(b.Position.X, b.Position.Y)
		ws.TileBuilding[key] = b.ID
		ws.Grid[b.Position.Y][b.Position.X].BuildingID = b.ID
	}
}
