package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 报告问题 3 的服务端回归：目标建筑外圈被围死（无落点 / 无路径）时，
// 自动模式机器人必须放弃这一单、记冷却、改服务别的缺料机器并发出 haul_unreachable
// 告警，而不是永远在 to_target ↔ waiting_target 之间空转。

// advanceAutoTicksEvents 与 advanceAutoTicks 相同的确定性子集，但把每 tick
// 运输机器人结算产生的事件收集起来（用于断言放弃/告警事件），并按结算管线
// 的口径把 haul_unreachable 告警写进告警历史、把解除写回（快照条目 active）。
func advanceAutoTicksEvents(core *GameCore, ws *model.WorldState, ticks int) []*model.GameEvent {
	var events []*model.GameEvent
	for i := 0; i < ticks; i++ {
		ws.Tick++
		settlePowerGeneration(ws, currentPlanetEnvironment(core.maps, ws.PlanetID))
		finalizePowerSettlement(ws, nil)
		settleResources(ws)
		settleProduction(ws)
		settleStorage(ws)
		settleUnitProduction(ws)
		settleUnitMovement(ws)
		robotEvents, robotResolved := settleTransportRobots(ws)
		events = append(events, robotEvents...)
		for _, evt := range robotEvents {
			if alert, ok := evt.Payload["alert"].(*model.ProductionAlert); ok && alert != nil {
				core.alertHistory.Record([]*model.ProductionAlert{alert})
			}
		}
		for _, res := range robotResolved {
			core.alertHistory.Resolve(res.playerID, res.planetID, res.buildingID, res.alertType, res.tick)
		}
	}
	return events
}

// encloseBuildingRing 用 1×1 传送带把建筑占地外圈整圈填满（所有落点都被占）。
// 逐个尝试外圈格：摆不下的格子跳过，直到外圈再没有空落点为止。
func encloseBuildingRing(t *testing.T, ws *model.WorldState, building *model.Building) []*model.Building {
	t.Helper()
	var belts []*model.Building
	for round := 0; round < 4; round++ {
		index := 0
		for _, cell := range ws.SurfaceDisc(building.Position, buildingRingSearchRadius(ws, building)) {
			if !ringHasBuilding(ws, building, cell) {
				continue
			}
			if !tileWalkableForUnit(ws, cell, "") {
				continue
			}
			id := "b-ring-" + itoa(round) + "-" + itoa(index)
			index++
			belt := placeAutoBuilding(t, ws, id, model.BuildingTypeConveyorBeltMk1, cell)
			if belt.Position != cell {
				t.Fatalf("围堵带落到了 %+v，want %+v", belt.Position, cell)
			}
			belts = append(belts, belt)
		}
	}
	if len(belts) == 0 {
		t.Fatal("没有围住建筑外圈")
	}
	if _, ok := haulApproachCell(ws, &model.Unit{ID: "probe", Position: model.Position{X: 1, Y: 1}}, building); ok {
		t.Fatal("外圈仍有落点，围堵不完整")
	}
	return belts
}

// countHaulAlertEvents 统计事件里的某类产线告警。
func countHaulAlertEvents(events []*model.GameEvent, alertType model.ProductionAlertType) int {
	count := 0
	for _, evt := range events {
		if evt == nil || evt.EventType != model.EvtProductionAlert {
			continue
		}
		if alert, ok := evt.Payload["alert"].(*model.ProductionAlert); ok && alert != nil && alert.AlertType == alertType {
			count++
		}
	}
	return count
}

// unreachableHaulFixture 仓库（供给）+ 被围死的熔炉 A + 可达的熔炉 B。
type unreachableHaulFixture struct {
	core    *GameCore
	ws      *model.WorldState
	depot   *model.Building
	blocked *model.Building
	open    *model.Building
	robot   *model.Unit
}

func newUnreachableHaulFixture(t *testing.T) unreachableHaulFixture {
	t.Helper()
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 20})
	blocked := placeAutoSmelter(t, ws, "b-blocked", model.Position{X: 40, Y: 20})
	open := placeAutoSmelter(t, ws, "b-open", model.Position{X: 40, Y: 40})
	encloseBuildingRing(t, ws, blocked)
	haulFill(depot, model.ItemIronOre, 80)
	// 机器人离被围死的熔炉更近：第一次派单一定先选中它。
	robot := autoRobot(t, ws, model.Position{X: 30, Y: 20})
	return unreachableHaulFixture{core: core, ws: ws, depot: depot, blocked: blocked, open: open, robot: robot}
}

// 1) 到不了的终点：连续几次规划失败后放弃，释放认领、记冷却、改服务另一台熔炉，
//    并发出 haul_unreachable 告警（details 带 unit_id / building_id / position）。
func TestAutoHaulGivesUpUnreachableTargetAndServesAnother(t *testing.T) {
	f := newUnreachableHaulFixture(t)
	// 夹具自检：被围死的熔炉外圈确实没有落点。
	if _, ok := haulApproachCell(f.ws, f.robot, f.blocked); ok {
		t.Fatal("夹具不对：被围死的熔炉仍能找到落点")
	}

	events := advanceAutoTicksEvents(f.core, f.ws, 200)

	if f.robot.Haul.ToBuildingID == f.blocked.ID {
		t.Fatalf("机器人仍咬着到不了的熔炉: %+v", f.robot.Haul)
	}
	until, ok := f.robot.Haul.UnreachableCooldowns[f.blocked.ID]
	if !ok {
		t.Fatalf("放弃后没有记录冷却: %+v", f.robot.Haul.UnreachableCooldowns)
	}
	if until <= f.ws.Tick {
		t.Fatalf("冷却应立即生效: until=%d tick=%d", until, f.ws.Tick)
	}
	if f.robot.Haul.UnreachableAttempts != 0 || f.robot.Haul.UnreachableSinceTick != 0 {
		t.Fatalf("放弃后失败计数未清零: attempts=%d since=%d", f.robot.Haul.UnreachableAttempts, f.robot.Haul.UnreachableSinceTick)
	}
	// 告警：只发一次，指向到不了的建筑。
	if !f.blocked.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		t.Fatal("到不了的建筑没有 haul_unreachable 告警")
	}
	if got := countHaulAlertEvents(events, model.AlertTypeHaulUnreachable); got != 1 {
		t.Fatalf("haul_unreachable 告警事件 = %d, want 1", got)
	}
	gaveUp := 0
	for _, evt := range events {
		if evt != nil && evt.Payload["order"] == "auto_haul_unreachable" {
			gaveUp++
		}
	}
	if gaveUp == 0 {
		t.Fatal("没有发出放弃这一单的事件")
	}

	// 冷却期内派单跳过被围死的熔炉：机器人改服务可达的那台，并真的送到料。
	advanceAutoTicks(f.core, f.ws, 1500)
	if f.robot.Haul.ToBuildingID == f.blocked.ID {
		t.Fatalf("放弃后又回被围死的熔炉: %+v", f.robot.Haul)
	}
	if f.robot.Haul.DeliveredTotal == 0 {
		t.Fatalf("改派后一件都没送到: %+v", f.robot.Haul)
	}
	if got := haulStored(f.open, model.ItemIronOre); got == 0 {
		t.Fatal("可达的熔炉没有收到铁矿")
	}
}

// 2) 冷却期内该建筑对这台机器人不再派单；冷却结束后可以重新尝试。
func TestAutoHaulCooldownSkipsBuildingUntilExpired(t *testing.T) {
	f := newUnreachableHaulFixture(t)
	advanceAutoTicks(f.core, f.ws, 200)
	until := f.robot.Haul.UnreachableCooldowns[f.blocked.ID]
	if until == 0 {
		t.Fatalf("没有冷却记录: %+v", f.robot.Haul.UnreachableCooldowns)
	}
	// 冷却期内即使可达熔炉的需求已被填满，机器人也不会再回被围死的熔炉。
	haulFill(f.open, model.ItemIronOre, 8)
	for f.ws.Tick < until-20 {
		advanceAutoTicks(f.core, f.ws, 10)
		if f.robot.Haul.ToBuildingID == f.blocked.ID {
			t.Fatalf("冷却期内又被派往到不了的建筑: tick=%d haul=%+v", f.ws.Tick, f.robot.Haul)
		}
	}
	// 冷却到期后条目被清掉（派单时 prune），建筑重新进入候选。
	advanceAutoTicks(f.core, f.ws, 30)
	if _, ok := f.robot.Haul.UnreachableCooldowns[f.blocked.ID]; ok {
		t.Fatalf("冷却到期后条目未清除: %+v", f.robot.Haul.UnreachableCooldowns)
	}
}

// 3) 机器人重新到达该建筑后告警解除（外圈腾出落点，冷却清掉后重新派单）。
func TestAutoHaulUnreachableAlertResolvesOnArrival(t *testing.T) {
	f := newUnreachableHaulFixture(t)
	advanceAutoTicks(f.core, f.ws, 200)
	if !f.blocked.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		t.Fatal("前置条件不成立：没有 haul_unreachable 告警")
	}
	// 拆掉一圈里的第一台带子，留出一个落点。
	for _, cell := range f.ws.SurfaceDisc(f.blocked.Position, buildingRingSearchRadius(f.ws, f.blocked)) {
		if !ringHasBuilding(f.ws, f.blocked, cell) {
			continue
		}
		id := f.ws.Grid[cell.Y][cell.X].BuildingID
		if id != "" && f.ws.Buildings[id] != nil {
			demolishAutoBuilding(f.ws, id)
			break
		}
	}
	// 清掉冷却，让派单重新选中它。
	delete(f.robot.Haul.UnreachableCooldowns, f.blocked.ID)
	// 可达熔炉的需求先填满，避免机器人被别的单吸走。
	haulFill(f.open, model.ItemIronOre, 8)
	for i := 0; i < 800; i++ {
		advanceAutoTicks(f.core, f.ws, 1)
		if !f.blocked.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
			break
		}
	}
	if f.blocked.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		t.Fatalf("机器人到达后告警未解除: robot=%+v pos=%+v", f.robot.Haul, f.robot.Position)
	}
}

// 4) 固定路线（route）模式语义不变：走不通时原地等待，不放弃、不记冷却、不发告警。
func TestRouteModeHaulStillWaitsWhenUnreachable(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 20})
	target := placeAutoSmelter(t, ws, "b-target", model.Position{X: 40, Y: 20})
	encloseBuildingRing(t, ws, target)
	haulFill(depot, model.ItemIronOre, 40)
	robot := haulSpawnRobot(t, ws, model.Position{X: 30, Y: 20})
	res := haulOrder(core, ws, robot.ID, depot.ID, target.ID, model.ItemIronOre)
	if res.Status != model.StatusExecuted {
		t.Fatalf("haul 指令失败: %s %s", res.Code, res.Message)
	}
	events := advanceAutoTicksEvents(core, ws, 200)
	if robot.Haul.Mode != model.HaulModeRoute {
		t.Fatalf("模式被改成了 %s", robot.Haul.Mode)
	}
	if robot.Haul.Phase != model.HaulPhaseWaitingSource && robot.Haul.Phase != model.HaulPhaseWaitingTarget &&
		robot.Haul.Phase != model.HaulPhaseToSource && robot.Haul.Phase != model.HaulPhaseToTarget {
		t.Fatalf("固定路线模式出现了意外阶段: %s", robot.Haul.Phase)
	}
	if len(robot.Haul.UnreachableCooldowns) != 0 {
		t.Fatalf("固定路线模式不应记冷却: %+v", robot.Haul.UnreachableCooldowns)
	}
	if target.ProductionMonitor != nil && target.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		t.Fatal("固定路线模式不应发 haul_unreachable 告警")
	}
	if got := countHaulAlertEvents(events, model.AlertTypeHaulUnreachable); got != 0 {
		t.Fatalf("固定路线模式发了 %d 条 haul_unreachable 事件", got)
	}
}

// 5) 车上有货、唯一能收货的仓储也被围死：fallback 必须跳过冷却中的建筑，
//    否则「放弃 → 改派回原目标 → 再放弃」会无限循环（每 ~15 tick 一条放弃事件）。
func TestAutoHaulFallbackSkipsCooldownNoGiveUpLoop(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 20})
	encloseBuildingRing(t, ws, depot)
	blocked := placeAutoSmelter(t, ws, "b-blocked", model.Position{X: 40, Y: 20})
	encloseBuildingRing(t, ws, blocked)
	// 开局 HQ 也是落货建筑，留着的话机器人会改送 HQ（那是正确行为，
	// 但测不到「唯一落货点也被围死」）。这里只保留两台被围死的建筑。
	demolishAutoBuildingsOfType(ws, model.BuildingTypeBattlefieldAnalysisBase)
	robot := autoRobot(t, ws, model.Position{X: 30, Y: 20})
	robot.Haul.Load(model.ItemIronOre, 4)

	events := advanceAutoTicksEvents(core, ws, 1000)
	gaveUp := 0
	for _, evt := range events {
		if evt != nil && evt.Payload["order"] == "auto_haul_unreachable" {
			gaveUp++
		}
	}
	// 两台建筑各放弃一次（之后都在冷却里，fallback 与派单都不再选它们）。
	if gaveUp > 2 {
		t.Fatalf("放弃事件 = %d，fallback 把货又派回了冷却中的建筑", gaveUp)
	}
	if robot.Haul.ToBuildingID == depot.ID || robot.Haul.ToBuildingID == blocked.ID {
		t.Fatalf("机器人仍被派往到不了的建筑: %+v", robot.Haul)
	}
	if robot.Haul.CargoQuantity() != 4 {
		t.Fatalf("车上的货不该丢: %+v", robot.Haul.Cargo)
	}
}
