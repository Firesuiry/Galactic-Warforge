package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 分拣器停工告警（sorter_stalled）验收：
//   - 断电 / 暂停的分拣器连续 300 tick 不搬 → 报警，指向分拣器本身、details 写
//     目标建筑与 reason；恢复搬运后解除（快照条目 active=false）；
//   - pick_empty 只在目标机器确实缺料时报警（机器还够料时不刷噪音）；
//   - drop_blocked 只在取货端确实有货时报警。
//
// 自动运输机器人会跳过「已有分拣器喂料」的建筑（haulSorterFedBuildings），所以
// 分拣器停工时那台机器会静默断料——这条告警就是为此存在的。

// sorterStallFixture 一条「带子 → 分拣器 → 熔炉」的最小产线。
type sorterStallFixture struct {
	core    *GameCore
	ws      *model.WorldState
	belt    *model.Building
	sorter  *model.Building
	smelter *model.Building
}

func newSorterStallFixture(t *testing.T) sorterStallFixture {
	t.Helper()
	core, ws := haulTestCoreWithFace(t, 32)
	smelter := newProductionTestBuilding("b-smelter", model.BuildingTypeArcSmelter, model.Position{X: 4, Y: 5}, "smelt_iron")
	attachBuilding(ws, smelter)
	belt := newConveyorBuilding("b-belt", model.Position{X: 2, Y: 6}, model.ConveyorEast)
	belt.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, belt)
	sorter := newSorterBuilding("b-sorter", model.Position{X: 3, Y: 6})
	sorter.Sorter.Range = 1
	sorter.Sorter.CycleTicks = 1
	attachBuilding(ws, sorter)
	return sorterStallFixture{core: core, ws: ws, belt: belt, sorter: sorter, smelter: smelter}
}

// settleStallTicks 推进 n tick 的分拣器结算（分拣器 → 停工告警），返回本段
// 新发出的 sorter_stalled 告警。
func (f sorterStallFixture) settleStallTicks(n int) []*model.ProductionAlert {
	var out []*model.ProductionAlert
	for i := 0; i < n; i++ {
		f.ws.Tick++
		settleSorters(f.ws)
		events, resolved := settleSorterStallAlerts(f.ws)
		for _, evt := range events {
			if alert, ok := evt.Payload["alert"].(*model.ProductionAlert); ok && alert != nil {
				out = append(out, alert)
				f.core.alertHistory.Record([]*model.ProductionAlert{alert})
			}
		}
		for _, res := range resolved {
			f.core.alertHistory.Resolve(res.playerID, res.planetID, res.buildingID, res.alertType, res.tick)
		}
	}
	return out
}

func TestSorterStalledAlertForNoPowerSorter(t *testing.T) {
	f := newSorterStallFixture(t)
	f.belt.Conveyor.Insert(model.ItemIronOre, 3)
	f.sorter.Runtime.State = model.BuildingWorkNoPower

	alerts := f.settleStallTicks(sorterStallWarnTicks + 5)
	if len(alerts) != 1 {
		t.Fatalf("断电分拣器应发 1 条 sorter_stalled，got %d", len(alerts))
	}
	alert := alerts[0]
	if alert.AlertType != model.AlertTypeSorterStalled {
		t.Fatalf("告警类型 = %s，want sorter_stalled", alert.AlertType)
	}
	if alert.BuildingID != f.sorter.ID || alert.BuildingType != f.sorter.Type {
		t.Fatalf("告警应指向分拣器本身，got %+v", alert)
	}
	if alert.PlayerID != "p1" || alert.PlanetID != f.ws.PlanetID {
		t.Fatalf("告警应带拥有者与行星，got player=%q planet=%q", alert.PlayerID, alert.PlanetID)
	}
	if got := alert.Details["reason"]; got != sorterStallReasonNoPower {
		t.Fatalf("reason = %v，want %s", got, sorterStallReasonNoPower)
	}
	if got := alert.Details["building_id"]; got != f.smelter.ID {
		t.Fatalf("details.building_id = %v，want 目标熔炉 %s", got, f.smelter.ID)
	}
	if alert.Message == "" || alert.Active != true {
		t.Fatalf("告警文案/active 不对：%+v", alert)
	}

	// 恢复供电后分拣器搬货：告警解除（历史条目 active=false）。
	f.sorter.Runtime.State = model.BuildingWorkRunning
	f.settleStallTicks(3)
	history := alertByType(f.core, "p1", model.AlertTypeSorterStalled)
	if history == nil || history.Active {
		t.Fatalf("恢复搬运后告警应解除，got %+v", history)
	}
	if history.ResolvedTick == 0 {
		t.Fatalf("解除时应写 resolved_tick，got %+v", history)
	}
}

func TestSorterStalledAlertForPausedSorter(t *testing.T) {
	f := newSorterStallFixture(t)
	f.belt.Conveyor.Insert(model.ItemIronOre, 3)
	f.sorter.Runtime.State = model.BuildingWorkPaused

	alerts := f.settleStallTicks(sorterStallWarnTicks + 5)
	if len(alerts) != 1 {
		t.Fatalf("暂停分拣器应发 1 条 sorter_stalled，got %d", len(alerts))
	}
	if got := alerts[0].Details["reason"]; got != sorterStallReasonPaused {
		t.Fatalf("reason = %v，want %s", got, sorterStallReasonPaused)
	}
}

// pick_empty：带子空了、目标机器也真的断料 → 报警。
func TestSorterStalledAlertForPickEmptyWhenTargetStarved(t *testing.T) {
	f := newSorterStallFixture(t)
	// 熔炉没有任何原料：状态 running、进度 0、配方要铁块 → haulBuildingStarved 成立。
	if !haulBuildingStarved(f.smelter) {
		t.Fatalf("夹具不对：熔炉应处于缺料停工状态")
	}
	alerts := f.settleStallTicks(sorterStallWarnTicks + 5)
	if len(alerts) != 1 {
		t.Fatalf("取不到货且目标断料时应报警，got %d", len(alerts))
	}
	if got := alerts[0].Details["reason"]; got != sorterStallReasonPickEmpty {
		t.Fatalf("reason = %v，want %s", got, sorterStallReasonPickEmpty)
	}
}

// pick_empty 防噪音：目标机器料还够（不是 input_shortage）时不报警。
func TestSorterStalledPickEmptyQuietWhenTargetHasInputs(t *testing.T) {
	f := newSorterStallFixture(t)
	// 熔炉主库存里有足够的铁块：机器不缺料，分拣器取不到货只是正常等货。
	f.smelter.Storage.EnsureInventory()[model.ItemIronOre] = 10
	if haulBuildingStarved(f.smelter) {
		t.Fatalf("夹具不对：熔炉不该缺料")
	}
	if alerts := f.settleStallTicks(sorterStallWarnTicks + 5); len(alerts) != 0 {
		t.Fatalf("目标机器不缺料时不该报 pick_empty，got %+v", alerts)
	}
}

// drop_blocked：带上有货但放货端（熔炉输入口）收不下 → 报 drop_blocked。
func TestSorterStalledAlertForDropBlocked(t *testing.T) {
	f := newSorterStallFixture(t)
	// 把熔炉的输入缓冲和主库存（非预留段）都塞满：StoragePortPreviewInput 会返回 0。
	f.smelter.Storage.EnsureInputBuffer()[model.ItemIronOre] = f.smelter.Storage.InputBufferCapacity()
	f.smelter.Storage.EnsureInventory()[model.ItemCopperOre] = f.smelter.Storage.Capacity
	f.belt.Conveyor.Insert(model.ItemIronOre, 3)

	alerts := f.settleStallTicks(sorterStallWarnTicks + 5)
	if len(alerts) != 1 {
		t.Fatalf("放货端收不下且有货时应报警，got %d", len(alerts))
	}
	if got := alerts[0].Details["reason"]; got != sorterStallReasonDropBlocked {
		t.Fatalf("reason = %v，want %s", got, sorterStallReasonDropBlocked)
	}
}
