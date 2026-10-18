package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 第 19 轮契约 §2（2026-10-18 修订）：传送带按「流水线口径」结算——一个 tick 内
// 某格推出的货腾出的空位当场可以再收，所以稳态吞吐只由 throughput 决定。
// 这里固化契约要求覆盖的边界用例，每条都断言「物品总数守恒」（不丢件、不复制件）：
//   - 侧面汇入（两条带汇一条，总量不超下游 throughput）
//   - 带尾接建筑（建筑满了带子堵住）
//   - 分流器三路输出
// 混合物品的带子与集装机压栈分别由 TestConveyorTierThroughputRatio（mixed_mk3）
// 与 piler_settlement_test.go 覆盖。

// TestConveyorSideMergeRespectsDownstreamThroughputAndConserves
// 两条支带（北、西）每 tick 塞满，侧面汇进一条吞吐 2 的主带（东向），主带下游再挂一条
// 每 tick 抽干的带子（模拟吃得下的下游）。
// 断言：主带每 tick 推出去的不超过 throughput=2（稳态恰好 2）；全程守恒。
func TestConveyorSideMergeRespectsDownstreamThroughputAndConserves(t *testing.T) {
	ws := model.NewWorldState("planet-1", 4)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	target := newConveyorBuilding("target", model.Position{X: 1, Y: 1}, model.ConveyorEast)
	target.Conveyor.Throughput = 2
	target.Conveyor.MaxStack = 3

	sink := newConveyorBuilding("sink", model.Position{X: 2, Y: 1}, model.ConveyorEast)
	sink.Conveyor.Throughput = 6
	sink.Conveyor.MaxStack = 10

	north := newConveyorBuilding("north", model.Position{X: 1, Y: 0}, model.ConveyorSouth)
	north.Conveyor.Throughput = 2
	north.Conveyor.MaxStack = 4

	west := newConveyorBuilding("west", model.Position{X: 0, Y: 1}, model.ConveyorEast)
	west.Conveyor.Throughput = 2
	west.Conveyor.MaxStack = 4

	attachBuilding(ws, target)
	attachBuilding(ws, sink)
	attachBuilding(ws, north)
	attachBuilding(ws, west)

	inserted, drained := 0, 0
	const ticks = 60
	sentPerTick := make([]int, 0, ticks)
	for tick := int64(0); tick < ticks; tick++ {
		ws.Tick = tick
		for _, belt := range []*model.Building{north, west} {
			for {
				accepted, _, err := belt.Conveyor.Insert(model.ItemIronOre, 1)
				if err != nil {
					t.Fatalf("insert into %s belt: %v", belt.ID, err)
				}
				if accepted <= 0 {
					break
				}
				inserted += accepted
			}
		}
		settleConveyors(ws)
		// 主带本 tick 实际推出去的件数（ConveyorTraffic.Departed，带子都在监测口径内）。
		sentPerTick = append(sentPerTick, ws.ConveyorTraffic.Departed[target.ID])
		// 下游每 tick 抽干。
		taken := sink.Conveyor.Take(sink.Conveyor.TotalItems())
		drained += countStacks(taken)
	}

	onBelt := target.Conveyor.TotalItems() + sink.Conveyor.TotalItems() +
		north.Conveyor.TotalItems() + west.Conveyor.TotalItems()
	if inserted != drained+onBelt {
		t.Fatalf("side merge lost items: inserted=%d drained=%d onBelt=%d", inserted, drained, onBelt)
	}
	for i, sent := range sentPerTick {
		if sent > 2 {
			t.Fatalf("tick %d: downstream belt pushed %d items, above its throughput 2", i, sent)
		}
	}
	// 稳态：两条支带都塞满时，主带每 tick 恰好推满自己的吞吐。
	for i := ticks - 20; i < ticks; i++ {
		if sentPerTick[i] != 2 {
			t.Fatalf("tick %d: downstream belt pushed %d items, want steady 2 (throughput)", i, sentPerTick[i])
		}
	}
}

// TestConveyorBeltTailIntoBuildingConservesItems
// 带尾接建筑：一条带子把氢送进喷涂机西侧进料面。喷涂机缺增产剂时货物原样通过，
// 出口带子很快被填满 → 建筑输出/输入缓冲依次堵住 → 进料带被堵。
// 断言：全程守恒（带子 + 建筑各缓冲），且堵住后带子上还留着货（不丢件）。
func TestConveyorBeltTailIntoBuildingConservesItems(t *testing.T) {
	ws, coater, belts := sprayCoaterFixture()
	west := belts[model.ConveyorWest]
	// 出口带子收窄，让它像真实产线一样很快被填满，把压力顶回建筑和进料带。
	east := belts[model.ConveyorEast]
	east.Conveyor.MaxStack = 4
	const total = 60
	if _, _, err := west.Conveyor.Insert(model.ItemHydrogen, total); err != nil {
		t.Fatalf("insert into west belt: %v", err)
	}

	for tick := 0; tick < 200; tick++ {
		ws.Tick = int64(tick)
		settleConveyors(ws)
		settleSprayCoaters(ws)
	}

	held := stackBufferQuantity(coater.SprayCoater.InputBuffer) +
		stackBufferQuantity(coater.SprayCoater.OutputBuffer) + totalStorageItems(coater.Storage)
	for _, belt := range belts {
		held += belt.Conveyor.TotalItems()
	}
	if held != total {
		t.Fatalf("belt into blocked building lost items: %d of %d left", held, total)
	}
	// 堵住的样子：进料带被顶回来（还留着货），建筑输出缓冲满、出口带子满。
	if got := west.Conveyor.TotalItems(); got == 0 {
		t.Fatalf("blocked building should back the belt up, west belt drained empty")
	}
	if coater.SprayCoater.State != "blocked" {
		t.Fatalf("coater state = %q, want blocked", coater.SprayCoater.State)
	}
	if got := stackBufferQuantity(coater.SprayCoater.OutputBuffer); got != coater.SprayCoater.BufferCapacity {
		t.Fatalf("coater output buffer = %d, want blocked at capacity %d", got, coater.SprayCoater.BufferCapacity)
	}
	if got := east.Conveyor.TotalItems(); got != east.Conveyor.MaxStack {
		t.Fatalf("output belt = %d, want full at %d", got, east.Conveyor.MaxStack)
	}
}

// TestSplitterThreeWayOutputsConserveItems
// 分流器三路输出（东/南/北，西为入口）：入口带每 tick 塞满、三路输出每 tick 抽干。
// 断言：守恒；稳态每 tick 恰好 6 件（分流器 throughput）且三路均分；同一 tick 收到的货
// 不会再被送出去（单 tick 不跨两格）。
func TestSplitterThreeWayOutputsConserveItems(t *testing.T) {
	ws, splitter, belts := splitterFixture()
	source := belts[model.ConveyorWest]
	outputs := append([]model.ConveyorDirection(nil), splitter.Splitter.OutputDirections...)
	if len(outputs) != 3 {
		t.Fatalf("splitter fixture should have three outputs, got %v", outputs)
	}

	inserted, drained := 0, 0
	drainedByDir := make(map[model.ConveyorDirection]int, len(outputs))
	const ticks = 60
	perTick := make([]int, 0, ticks)
	for tick := int64(0); tick < ticks; tick++ {
		ws.Tick = tick
		for {
			accepted, _, err := source.Conveyor.Insert(model.ItemIronOre, 1)
			if err != nil {
				t.Fatalf("insert into splitter source: %v", err)
			}
			if accepted <= 0 {
				break
			}
			inserted += accepted
		}
		settleConveyors(ws)
		moved := 0
		for _, dir := range outputs {
			belt := belts[dir]
			taken := belt.Conveyor.Take(belt.Conveyor.TotalItems())
			count := countStacks(taken)
			drainedByDir[dir] += count
			moved += count
		}
		drained += moved
		perTick = append(perTick, moved)
	}

	held := source.Conveyor.TotalItems() + splitter.Conveyor.TotalItems()
	for _, dir := range outputs {
		held += belts[dir].Conveyor.TotalItems()
	}
	if inserted != drained+held {
		t.Fatalf("splitter line lost items: inserted=%d drained=%d held=%d", inserted, drained, held)
	}
	for i := ticks - 20; i < ticks; i++ {
		if perTick[i] != 6 {
			t.Fatalf("tick %d: splitter moved %d items, want steady 6 (cached throughput)", i, perTick[i])
		}
	}
	for _, dir := range outputs {
		if drainedByDir[dir] == 0 {
			t.Fatalf("output %s got nothing: %v", dir, drainedByDir)
		}
		if diff := drainedByDir[dir] - drained/len(outputs); diff > 2 || diff < -2 {
			t.Fatalf("output %s unbalanced: %v (total drained %d)", dir, drainedByDir, drained)
		}
	}
}

// TestConveyorOversizedLegacyCellDrainsToMaxStack 回归 A1：旧存档里带格件数
// 可能超过新 stack_limit（第 19 轮把 mk2 从 5 改回 3、mk3 从 11 改回 6）。
// 上游满料、下游畅通时，超量格必须「只出不进」直到回落到 MaxStack 以内，
// 不能因为「送出即腾位」而送多少补多少、永远停在超量值上。
// 同时断言全程件数守恒（不丢件、不复制件）。
func TestConveyorOversizedLegacyCellDrainsToMaxStack(t *testing.T) {
	ws := model.NewWorldState("planet-1", 4)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	source := newConveyorBuildingOfType("source", model.BuildingTypeConveyorBeltMk3, model.Position{X: 0, Y: 0}, model.ConveyorEast)
	source.Conveyor.MaxStack = 64
	source.Conveyor.Throughput = 8
	// 旧档超量格：mk2 新 MaxStack=3，存档里 5 件。
	over := newConveyorBuildingOfType("over", model.BuildingTypeConveyorBeltMk2, model.Position{X: 1, Y: 0}, model.ConveyorEast)
	if over.Conveyor.MaxStack != 3 {
		t.Fatalf("mk2 MaxStack = %d, want 3", over.Conveyor.MaxStack)
	}
	over.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 5}})
	sink := newConveyorBuildingOfType("sink", model.BuildingTypeConveyorBeltMk3, model.Position{X: 2, Y: 0}, model.ConveyorEast)
	sink.Conveyor.MaxStack = 64
	sink.Conveyor.Throughput = 8

	attachBuilding(ws, source)
	attachBuilding(ws, over)
	attachBuilding(ws, sink)

	inserted := 5 // 预置的 5 件也算进账。
	drained := 0
	settled := false
	const ticks = 60
	for tick := int64(0); tick < ticks; tick++ {
		ws.Tick = tick
		for {
			accepted, _, err := source.Conveyor.Insert(model.ItemIronOre, 1)
			if err != nil {
				t.Fatalf("insert into source: %v", err)
			}
			if accepted <= 0 {
				break
			}
			inserted += accepted
		}
		settleConveyors(ws)
		if held := over.Conveyor.TotalItems(); held > 5 {
			t.Fatalf("tick %d: oversized cell grew to %d items (duplication)", tick, held)
		}
		if tick >= 30 {
			if held := over.Conveyor.TotalItems(); held > over.Conveyor.MaxStack {
				t.Fatalf("tick %d: oversized cell still holds %d > MaxStack %d", tick, held, over.Conveyor.MaxStack)
			}
			settled = true
		}
		drained += countStacks(sink.Conveyor.Take(sink.Conveyor.TotalItems()))
	}
	if !settled {
		t.Fatal("test did not reach the settled window")
	}
	onBelt := source.Conveyor.TotalItems() + over.Conveyor.TotalItems() + sink.Conveyor.TotalItems()
	if inserted != drained+onBelt {
		t.Fatalf("oversized cell lost/duplicated items: inserted=%d drained=%d onBelt=%d", inserted, drained, onBelt)
	}
	if held := over.Conveyor.TotalItems(); held > over.Conveyor.MaxStack {
		t.Fatalf("final oversized cell holds %d > MaxStack %d", held, over.Conveyor.MaxStack)
	}
}

// TestConveyorSettlementCapacityKeepsNegativeHeadroom 直接守住 A1 的修法：
// 结算容量允许为负（超量格），插入容量（分拣器/建筑 IO 用）仍然钳 0。
func TestConveyorSettlementCapacityKeepsNegativeHeadroom(t *testing.T) {
	ws := model.NewWorldState("planet-1", 4)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	belt := newConveyorBuildingOfType("over", model.BuildingTypeConveyorBeltMk2, model.Position{X: 1, Y: 0}, model.ConveyorEast)
	belt.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 5}})
	attachBuilding(ws, belt)

	if got := conveyorSettlementCapacity(ws, belt); got != -2 {
		t.Fatalf("settlement capacity for 5 items on MaxStack 3 = %d, want -2", got)
	}
	if got := conveyorInsertCapacity(ws, belt); got != 0 {
		t.Fatalf("insert capacity must stay clamped at 0, got %d", got)
	}
	// 分流器配额取 min(容量, throughput)，负容量保持负值 → canAccept 继续拒收。
	splitter := newConveyorBuildingOfType("splitter", model.BuildingTypeSplitter, model.Position{X: 2, Y: 0}, model.ConveyorAuto)
	splitter.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: splitter.Conveyor.MaxStack + 4}})
	attachBuilding(ws, splitter)
	if got := conveyorSettlementCapacity(ws, splitter); got != -4 {
		t.Fatalf("splitter settlement capacity = %d, want -4", got)
	}
}
