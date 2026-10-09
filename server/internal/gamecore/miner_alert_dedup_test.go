package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 满仓采矿机必须在整条结算链（资源结算 + 监控）里只报一次「产物阻塞」，
// 之后每 ProductionAlertRemindTicks 才提醒一次（试玩报告新问题 #9：
// 满仓后每 5 tick 刷一条）。此前测试只单独调用 settleProductionMonitoring，
// 没有覆盖 settleResources 真正把产物塞满输出缓存 → 监控判定的组合链路。
func TestJammedMinerAlertsOncePerRemindWindow(t *testing.T) {
	ws := newMiningTestWorld(4)
	addFiniteVein(ws, "r1", "iron_ore", "c1", 4, 4, 20, 100000)
	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 4, Y: 4}, 8)
	ws.Buildings["b1"] = miner
	miner.Runtime.State = model.BuildingWorkRunning
	pm := newProductionMonitor(newTestMonitorConfig())

	alertsAt := func(tick int64) int {
		ws.Tick = tick
		settleResources(ws)
		settleStorage(ws)
		_, alerts := pm.settleProductionMonitoring(ws, tick)
		return len(alerts)
	}

	// 1 个 tick 采 8 个：容量 48 + 输出缓存 8 = 56，第 7 个 tick 开始满仓。
	firstAlertTick := int64(-1)
	for tick := int64(5); tick <= 200; tick += 5 {
		if alertsAt(tick) > 0 {
			firstAlertTick = tick
			break
		}
	}
	if firstAlertTick < 0 {
		t.Fatalf("expected a first output_blocked alert for the jammed miner (storage=%d/%d out=%d/%d)",
			miner.Storage.UsedInventory(), miner.Storage.Capacity, miner.Storage.UsedOutputBuffer(), miner.Storage.OutputBufferCapacity())
	}
	if got := alertsAt(firstAlertTick + 5); got != 0 {
		t.Fatalf("persistent blockage must not repeat on the next sample, got %d alerts", got)
	}
	for tick := firstAlertTick + 10; tick < firstAlertTick+model.ProductionAlertRemindTicks; tick += 5 {
		if got := alertsAt(tick); got != 0 {
			t.Fatalf("jammed miner re-alerted at tick %d (%d alerts) before the remind window", tick, got)
		}
	}
	if got := alertsAt(firstAlertTick + model.ProductionAlertRemindTicks); got != 1 {
		t.Fatalf("expected exactly one reminder after %d ticks, got %d", model.ProductionAlertRemindTicks, got)
	}
	// 每次告警恰好一条事件，客户端才能一条一条合并。
	ws.Tick = firstAlertTick + model.ProductionAlertRemindTicks*2
	settleResources(ws)
	settleStorage(ws)
	events, alerts := pm.settleProductionMonitoring(ws, ws.Tick)
	if len(alerts) != 1 || len(events) != 1 {
		t.Fatalf("expected 1 alert / 1 event on reminder, got %d alerts / %d events", len(alerts), len(events))
	}
	if alerts[0].AlertType != model.AlertTypeOutputBlocked {
		t.Fatalf("unexpected alert type: %s", alerts[0].AlertType)
	}
	if alerts[0].BuildingID != miner.ID || alerts[0].PlayerID != "p1" {
		t.Fatalf("alert bound to wrong building: %+v", alerts[0])
	}
}
