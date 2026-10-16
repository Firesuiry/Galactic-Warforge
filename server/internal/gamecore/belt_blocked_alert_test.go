package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 报告 B1 的服务端回归：
//  1) 分拣器从带子上取货时跳过「队首被过滤掉的物品」，后面的货仍能取到；
//  2) 带尾对着空地（下游不收）时给出一条指向**带格**的 belt_blocked 告警，
//     而不是只让上游矿机报「产物阻塞」。

// 混合带：队首是铜矿、后面是铁矿，过滤 iron_ore 的分拣器仍要把铁矿喂进熔炉。
func TestSorterSkipsFilteredFrontStackOnMixedBelt(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 熔炉 3×3 占 (4,5)..(6,7)；分拣器 (3,6) 朝 90°（背面西=带子、正面东=熔炉）；
	// 带子在 (2,6)，输出朝东（东邻是分拣器，不是带子 → 自己推不出去，只能靠分拣器取）。
	smelter := newProductionTestBuilding("smelter", model.BuildingTypeArcSmelter, model.Position{X: 4, Y: 5}, "smelt_iron")
	belt := newConveyorBuilding("belt", model.Position{X: 2, Y: 6}, model.ConveyorEast)
	belt.Runtime.State = model.BuildingWorkRunning
	sorter := newSorterBuilding("sorter", model.Position{X: 3, Y: 6})
	sorter.Rotation = model.PlanRotation90
	sorter.Sorter.Range = 1
	sorter.Sorter.CycleTicks = 1
	sorter.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: []string{model.ItemIronOre}}
	attachBuilding(ws, smelter)
	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)

	// 队首铜矿 2 件、后面铁矿 2 件（appendStack 按物品分栈，顺序即入带顺序）。
	belt.Conveyor.Insert(model.ItemCopperOre, 2)
	belt.Conveyor.Insert(model.ItemIronOre, 2)

	for tick := int64(1); tick <= 10; tick++ {
		ws.Tick = tick
		settleSorters(ws)
	}

	if got := smelter.Storage.InputBuffer[model.ItemIronOre]; got != 2 {
		t.Fatalf("铁矿应被分拣器取走并送进熔炉，got %d（带子=%+v）", got, belt.Conveyor.Buffer)
	}
	if got := smelter.Storage.InputBuffer[model.ItemCopperOre]; got != 0 {
		t.Fatalf("被过滤掉的铜矿不该进熔炉，got %d", got)
	}
	if got := belt.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("带子上应只剩被过滤掉的 2 件铜矿，got %d（%+v）", got, belt.Conveyor.Buffer)
	}
	if len(belt.Conveyor.Buffer) == 0 || belt.Conveyor.Buffer[0].ItemID != model.ItemCopperOre {
		t.Fatalf("带子顺序应保持：铜矿仍在队首，got %+v", belt.Conveyor.Buffer)
	}
}

// 放货端收不下时也要继续往后找：队首物品熔炉不要（配方不需要）时，取后面能收的那件。
func TestSorterSkipsStackTargetRejects(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	smelter := newProductionTestBuilding("smelter", model.BuildingTypeArcSmelter, model.Position{X: 4, Y: 5}, "smelt_iron")
	belt := newConveyorBuilding("belt", model.Position{X: 2, Y: 6}, model.ConveyorEast)
	belt.Runtime.State = model.BuildingWorkRunning
	sorter := newSorterBuilding("sorter", model.Position{X: 3, Y: 6})
	sorter.Rotation = model.PlanRotation90
	sorter.Sorter.Range = 1
	sorter.Sorter.CycleTicks = 1
	// 不过滤（allow 空 = 全收），但熔炉的输入口只认铁矿：铜矿放不进去。
	attachBuilding(ws, smelter)
	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)

	belt.Conveyor.Insert(model.ItemCopperOre, 2)
	belt.Conveyor.Insert(model.ItemIronOre, 1)

	for tick := int64(1); tick <= 10; tick++ {
		ws.Tick = tick
		settleSorters(ws)
	}

	if got := smelter.Storage.InputBuffer[model.ItemIronOre]; got != 1 {
		t.Fatalf("熔炉收不下的队首铜矿应被跳过、取后面的铁矿，got %d（带子=%+v）", got, belt.Conveyor.Buffer)
	}
}

// 带尾对着空地：带上有货、连续 300 tick 一件都没动出去 → belt_blocked 告警，
// 指向带格本身；货被清空后告警解除（ActiveAlerts 清掉）。
func TestDeadEndBeltRaisesBeltBlockedAlert(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// (1,1) 朝东，东邻 (2,1) 是空地 → conveyorOutputTargets 找不到目标。
	belt := newConveyorBuilding("belt-dead", model.Position{X: 1, Y: 1}, model.ConveyorEast)
	belt.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, belt)
	belt.Conveyor.Insert(model.ItemIronOre, 2)

	var alerts []*model.ProductionAlert
	for tick := int64(1); tick <= beltBlockedWarnTicks+5; tick++ {
		ws.Tick = tick
		settleConveyors(ws)
		for _, evt := range settleBeltBlockAlerts(ws) {
			if alert, ok := evt.Payload["alert"].(*model.ProductionAlert); ok && alert != nil {
				alerts = append(alerts, alert)
			}
		}
	}
	if len(alerts) == 0 {
		t.Fatal("死头带应发出 belt_blocked 告警")
	}
	first := alerts[0]
	if first.AlertType != model.AlertTypeBeltBlocked {
		t.Fatalf("告警类型应为 belt_blocked，got %s", first.AlertType)
	}
	if first.BuildingID != belt.ID || first.BuildingType != belt.Type {
		t.Fatalf("告警应指向带格本身，got %+v", first)
	}
	if first.PlayerID != "p1" {
		t.Fatalf("告警应归属带子的拥有者，got %q", first.PlayerID)
	}
	// 只在越过阈值时报一次（同一问题持续期间不刷屏）。
	if len(alerts) != 1 {
		t.Fatalf("同一段堵塞只应报一次，got %d 条", len(alerts))
	}

	// 货被取走（带子清空）后：计数归零、告警解除。
	belt.Conveyor.Buffer = nil
	ws.Tick++
	settleConveyors(ws)
	if events := settleBeltBlockAlerts(ws); len(events) != 0 {
		t.Fatalf("带子清空后不该再报警，got %d 条", len(events))
	}
	if belt.Conveyor.BlockedTicks != 0 {
		t.Fatalf("带子清空后堵塞计数应归零，got %d", belt.Conveyor.BlockedTicks)
	}
	if belt.ProductionMonitor.ActiveAlerts[model.AlertTypeBeltBlocked] {
		t.Fatal("带子清空后 belt_blocked 应解除")
	}
}

// 正常流动的带子（下游收得下）不报警：动过一件就归零。
func TestFlowingBeltDoesNotRaiseBeltBlockedAlert(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	source := newConveyorBuilding("belt-a", model.Position{X: 1, Y: 1}, model.ConveyorEast)
	sink := newConveyorBuilding("belt-b", model.Position{X: 2, Y: 1}, model.ConveyorEast)
	sink.Runtime.State = model.BuildingWorkRunning
	source.Runtime.State = model.BuildingWorkRunning
	sink.Conveyor.MaxStack = 200
	attachBuilding(ws, source)
	attachBuilding(ws, sink)
	source.Conveyor.Insert(model.ItemIronOre, 5)

	for tick := int64(1); tick <= beltBlockedWarnTicks+5; tick++ {
		ws.Tick = tick
		settleConveyors(ws)
		if events := settleBeltBlockAlerts(ws); len(events) != 0 {
			t.Fatalf("流动中的带子不该报警（tick %d）", tick)
		}
		// 末端带每 tick 清空，模拟下游一直在消耗：整条线保持流动。
		sink.Conveyor.Take(sink.Conveyor.TotalItems())
	}
}
