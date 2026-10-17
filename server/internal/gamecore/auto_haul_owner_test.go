package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 严重 1：自动派单必须只看机器人**自己**的建筑。
//
// 旧实现遍历全图建筑：p1 的机器人被派去给 p2 的熔炉（cp-logistics 的 b-112）送矿，
// 每 tick 被 haulEndpointLost 判定「终点不属于本玩家」→ abort → fallback 又选回
// 同一座 → 永久空转（u-212 带着 4 铁矿卡了 10000+ tick）。

// placeEnemySmelter 摆一座属于 p2、缺料、已通电的熔炉（需求侧诱饵）。
func placeEnemySmelter(t *testing.T, ws *model.WorldState, id string, pos model.Position) *model.Building {
	t.Helper()
	smelter := placeAutoSmelter(t, ws, id, pos)
	smelter.OwnerID = "p2"
	return smelter
}

// placeEnemyDepot 摆一座属于 p2、装满铁矿的储物仓（供给侧诱饵）。
func placeEnemyDepot(t *testing.T, ws *model.WorldState, id string, pos model.Position, qty int) *model.Building {
	t.Helper()
	depot := placeAutoBuilding(t, ws, id, model.BuildingTypeDepotMk1, pos)
	depot.OwnerID = "p2"
	haulFill(depot, model.ItemIronOre, qty)
	return depot
}

// 1) 敌方熔炉缺料时，p1 的机器人绝不被派去送料；需求清单里也没有敌方建筑。
func TestAutoHaulNeverTargetsEnemyDemand(t *testing.T) {
	f := newAutoHaulFixture(t)
	enemy := placeEnemySmelter(t, f.ws, "b-enemy", model.Position{X: 40, Y: 40})
	haulFill(f.depot, model.ItemIronOre, 60)
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})

	// 需求清单只含己方建筑。
	for _, demand := range haulDemands(f.ws, haulClaims(f.ws), "p1") {
		if demand.buildingID == enemy.ID {
			t.Fatalf("需求清单包含敌方熔炉: %+v", demand)
		}
	}
	// 供给清单也只含己方建筑（敌方仓储不能当取货点）。
	enemyDepot := placeEnemyDepot(t, f.ws, "b-enemy-depot", model.Position{X: 20, Y: 40}, 60)
	for _, supply := range haulSupplies(f.ws, haulClaims(f.ws), "p1") {
		if supply.buildingID == enemyDepot.ID {
			t.Fatalf("供给清单包含敌方仓储: %+v", supply)
		}
	}

	toDispatchTick(f.core, f.ws)
	if robot.Haul.ToBuildingID == enemy.ID {
		t.Fatalf("机器人被派往敌方熔炉: %+v", robot.Haul)
	}
	if robot.Haul.FromBuildingID == enemyDepot.ID {
		t.Fatalf("机器人被派去敌方仓储取货: %+v", robot.Haul)
	}
	// 跑一段：敌方熔炉永远拿不到 p1 的矿，机器人也不会产生 abort 循环。
	advanceAutoTicks(f.core, f.ws, 1200)
	if got := haulStored(enemy, model.ItemIronOre); got != 0 {
		t.Fatalf("敌方熔炉收到了 p1 的矿: %d", got)
	}
	if robot.Haul.ToBuildingID == enemy.ID {
		t.Fatalf("机器人仍在服务敌方熔炉: %+v", robot.Haul)
	}
	// 己方熔炉照常被喂（证明过滤没有把正常派单也挡掉）。
	if got := haulStored(f.smelter, model.ItemIronOre); got == 0 {
		t.Fatalf("己方熔炉没有收到料: robot=%+v", robot.Haul)
	}
}

// 2) 车上带货、唯一的「需求」是敌方熔炉：绝不改派过去，而是送回己方仓储。
func TestAutoHaulCargoNeverReroutesToEnemyDemand(t *testing.T) {
	f := newAutoHaulFixture(t)
	// 拆掉己方熔炉的需求（改成满料），只留敌方熔炉缺料。
	haulFill(f.smelter, model.ItemIronOre, 8)
	enemy := placeEnemySmelter(t, f.ws, "b-enemy", model.Position{X: 40, Y: 40})
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	robot.Haul.Load(model.ItemIronOre, 4)

	advanceAutoTicks(f.core, f.ws, 1200)

	if robot.Haul.ToBuildingID == enemy.ID {
		t.Fatalf("带货机器人被改派给敌方熔炉: %+v", robot.Haul)
	}
	if got := haulStored(enemy, model.ItemIronOre); got != 0 {
		t.Fatalf("敌方熔炉收到了货: %d", got)
	}
	// 货送回己方落货点（储物仓或 HQ 都算，取决于谁更近）：车空了且计入送达。
	if robot.Haul.CargoQuantity() != 0 || robot.Haul.DeliveredTotal != 4 {
		t.Fatalf("货没有送回己方仓储: depot=%d haul=%+v", haulStored(f.depot, model.ItemIronOre), robot.Haul)
	}
}

// 3) abort 冷却：端点不属于自己时记冷却，同一座建筑不会被立刻重新选中；
//    abort 后机器人空闲原因写明「上一单中止」。
func TestAutoHaulAbortCooldownPreventsImmediateReassign(t *testing.T) {
	f := newAutoHaulFixture(t)
	enemy := placeEnemySmelter(t, f.ws, "b-enemy", model.Position{X: 40, Y: 40})
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	// 人为把机器人塞进「去敌方熔炉」的坏任务（模拟旧档/敌方建筑易主）。
	robot.Haul.Claim = &model.HaulClaim{DemandBuildingID: enemy.ID, ItemID: model.ItemIronOre, Quantity: 4}
	robot.Haul.ToBuildingID = enemy.ID
	robot.Haul.ItemID = model.ItemIronOre
	robot.Haul.Phase = model.HaulPhaseToTarget

	settleTransportRobots(f.ws)

	if robot.Haul.ToBuildingID == enemy.ID {
		t.Fatalf("abort 后立刻又被派回敌方熔炉: %+v", robot.Haul)
	}
	until, ok := robot.Haul.UnreachableCooldowns[enemy.ID]
	if !ok || until <= f.ws.Tick {
		t.Fatalf("abort 后没有记录冷却: %+v", robot.Haul.UnreachableCooldowns)
	}
	if robot.Haul.IdleReason != string(model.HaulIdleLastAborted) || robot.Haul.IdleDetail == "" {
		t.Fatalf("空闲原因应写明上一单中止: reason=%q detail=%q", robot.Haul.IdleReason, robot.Haul.IdleDetail)
	}
	// 冷却期内再派几轮：不会再选中敌方熔炉。
	for i := 0; i < 20; i++ {
		toDispatchTick(f.core, f.ws)
		if robot.Haul.ToBuildingID == enemy.ID {
			t.Fatalf("冷却期内又被派往敌方熔炉: tick=%d haul=%+v", f.ws.Tick, robot.Haul)
		}
	}
}

// 4) 空闲原因：无需求 / 带货无处可送 / 有需求但都不可达，分别写明。
func TestAutoHaulIdleReasonReported(t *testing.T) {
	// 无需求：熔炉满料、无其它生产建筑。
	f := newAutoHaulFixture(t)
	haulFill(f.smelter, model.ItemIronOre, 8)
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	toDispatchTick(f.core, f.ws)
	if robot.Haul.IdleReason != string(model.HaulIdleNoDemand) {
		t.Fatalf("无需求时 idle_reason = %q, want %q", robot.Haul.IdleReason, model.HaulIdleNoDemand)
	}

	// 带货无处可送：拆掉所有落货建筑（仓储/HQ），只剩缺料熔炉。
	f2 := newAutoHaulFixture(t)
	demolishAutoBuilding(f2.ws, f2.depot.ID)
	demolishAutoBuildingsOfType(f2.ws, model.BuildingTypeBattlefieldAnalysisBase)
	robot2 := autoRobot(t, f2.ws, model.Position{X: 30, Y: 20})
	robot2.Haul.Load(model.ItemCopperOre, 4)
	toDispatchTick(f2.core, f2.ws)
	if robot2.Haul.IdleReason != string(model.HaulIdleCargoNoDestination) {
		t.Fatalf("带货无处可送时 idle_reason = %q, want %q (haul=%+v)",
			robot2.Haul.IdleReason, model.HaulIdleCargoNoDestination, robot2.Haul)
	}

	// 有需求但都不可达：唯一需求建筑被围死、冷却已生效。
	f3 := newUnreachableHaulFixture(t)
	advanceAutoTicks(f3.core, f3.ws, 400)
	if f3.robot.Haul.ToBuildingID != "" {
		t.Fatalf("夹具预期机器人空闲，got %+v", f3.robot.Haul)
	}
	if f3.robot.Haul.IdleReason != string(model.HaulIdleNoReachableDemand) &&
		f3.robot.Haul.IdleReason != string(model.HaulIdleNoDemand) {
		t.Fatalf("不可达时 idle_reason = %q（want no_reachable_demand 或 no_demand）", f3.robot.Haul.IdleReason)
	}
}

// 5) 分拣器喂料的机器不派自动运输单（DSP 式布局，试玩 1016 一般 3）。
func TestAutoHaulSkipsSorterFedBuildings(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 30})
	smelter := placeAutoSmelter(t, ws, "b-smelter", model.Position{X: 40, Y: 30})
	// 分拣器在熔炉西侧一格，正面朝东对着熔炉（放货端落在熔炉上）。
	sorter := placeAutoBuilding(t, ws, "b-feeder", model.BuildingTypeSorterMk1, model.Position{X: 39, Y: 31})
	sorter.Rotation = model.PlanRotation90
	model.InitBuildingSorter(sorter)
	sorter.Sorter.Range = 1
	sorter.Sorter.CycleTicks = 1
	haulFill(depot, model.ItemIronOre, 60)
	robot := autoRobot(t, ws, model.Position{X: 30, Y: 20})

	if !haulSorterFedBuildings(ws, "p1")[smelter.ID] {
		t.Fatalf("夹具不对：分拣器放货端没有连到熔炉（sorter=%+v）", sorter.Sorter)
	}
	for _, demand := range haulDemands(ws, haulClaims(ws), "p1") {
		if demand.buildingID == smelter.ID {
			t.Fatalf("分拣器喂料的熔炉仍在需求清单里: %+v", demand)
		}
	}
	toDispatchTick(core, ws)
	if robot.Haul.ToBuildingID == smelter.ID {
		t.Fatalf("机器人被派去分拣器喂料的熔炉: %+v", robot.Haul)
	}
	if robot.Haul.IdleReason != string(model.HaulIdleNoDemand) {
		t.Fatalf("idle_reason = %q, want no_demand", robot.Haul.IdleReason)
	}

	// 分拣器拆掉后，熔炉重新进入自动派单范围。
	demolishAutoBuilding(ws, sorter.ID)
	toDispatchTick(core, ws)
	if robot.Haul.ToBuildingID != smelter.ID {
		t.Fatalf("分拣器拆除后熔炉应重新被派单: %+v", robot.Haul)
	}
}

// 6) 分拣器喂料的建筑到不了时静默放弃：不发 haul_unreachable 告警（不刷告警条）。
func TestAutoHaulSorterFedUnreachableStaysSilent(t *testing.T) {
	_, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 20})
	smelter := placeAutoSmelter(t, ws, "b-smelter", model.Position{X: 40, Y: 20})
	// 分拣器放在熔炉西侧，正面朝东喂料；然后把外圈全部围死（分拣器自身也占一格）。
	sorter := placeAutoBuilding(t, ws, "b-feeder", model.BuildingTypeSorterMk1, model.Position{X: 39, Y: 21})
	sorter.Rotation = model.PlanRotation90
	model.InitBuildingSorter(sorter)
	encloseBuildingRing(t, ws, smelter)
	haulFill(depot, model.ItemIronOre, 40)
	robot := autoRobot(t, ws, model.Position{X: 30, Y: 20})

	// 派单本身会跳过它；这里直接走「放弃」路径（模拟冷却失效/被别的路径选中），
	// 断言不产生 haul_unreachable 告警。
	events := haulGiveUpUnreachable(ws, robot, smelter)
	if got := countHaulAlertEvents(events, model.AlertTypeHaulUnreachable); got != 0 {
		t.Fatalf("分拣器喂料的建筑放弃了 %d 条 haul_unreachable 告警，want 0", got)
	}
	if smelter.ProductionMonitor != nil && smelter.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		t.Fatal("分拣器喂料的建筑不应产生 haul_unreachable 告警")
	}
	// 对照：没有分拣器喂料的可达建筑被围死时仍要报警（原有语义不变）。
	plain := placeAutoSmelter(t, ws, "b-plain", model.Position{X: 40, Y: 40})
	encloseBuildingRing(t, ws, plain)
	events = haulGiveUpUnreachable(ws, robot, plain)
	if got := countHaulAlertEvents(events, model.AlertTypeHaulUnreachable); got != 1 {
		t.Fatalf("普通不可达建筑 haul_unreachable 告警 = %d, want 1", got)
	}
}
