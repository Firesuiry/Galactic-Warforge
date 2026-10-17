package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 试玩 1016 报告问题 2：传送带恢复流动后，告警快照里的 belt_blocked 条目
// 必须变成 active=false（带 resolved_tick），而不是永远挂着冻结的 last_tick。
// 其他告警类型（power_shortage / input_shortage / output_blocked /
// unit_spawn_blocked）同样走这一套：问题解除 → 历史条目标记已解除。

// newAlertTestCore 建一个带告警历史的小世界（32 面，全平地）。
func newAlertTestCore(t *testing.T, cfg *config.Config) *GameCore {
	t.Helper()
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 32, ResourceDensity: 0},
	}
	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	return core
}

// beltAlertCore 造一个「死头带」世界：带上有货、带尾对着空地。
func beltAlertCore(t *testing.T) (*GameCore, *model.WorldState, *model.Building) {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "alert-resolve", MaxTickRate: 10},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
		Server: config.ServerConfig{
			Port: 9999, RateLimit: 100, AlertHistoryLimit: 100,
			ProductionMonitor: newTestMonitorConfig(),
		},
	}
	core := newAlertTestCore(t, cfg)
	ws := core.World()
	belt := newConveyorBuilding("belt-dead", model.Position{X: 1, Y: 1}, model.ConveyorEast)
	belt.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, belt)
	belt.Conveyor.Insert(model.ItemIronOre, 2)
	return core, ws, belt
}

// activeAlerts 返回该玩家快照里的 active 告警（按 alert_id 索引）。
func activeAlerts(core *GameCore, playerID string) map[string]*model.ProductionAlert {
	alerts, _, _, _ := core.AlertHistory().Snapshot("", 0, 0, false)
	out := make(map[string]*model.ProductionAlert, len(alerts))
	for _, alert := range alerts {
		if alert != nil && alert.PlayerID == playerID && alert.Active {
			out[alert.AlertID] = alert
		}
	}
	return out
}

func alertByType(core *GameCore, playerID string, alertType model.ProductionAlertType) *model.ProductionAlert {
	alerts, _, _, _ := core.AlertHistory().Snapshot("", 0, 0, false)
	for _, alert := range alerts {
		if alert != nil && alert.PlayerID == playerID && alert.AlertType == alertType {
			return alert
		}
	}
	return nil
}

func TestBeltBlockedAlertResolvesInSnapshotWhenBeltFlowsAgain(t *testing.T) {
	core, ws, belt := beltAlertCore(t)
	for tick := int64(1); tick <= beltBlockedWarnTicks+5; tick++ {
		core.processTick()
	}
	alert := alertByType(core, "p1", model.AlertTypeBeltBlocked)
	if alert == nil {
		t.Fatal("死头带应产生 belt_blocked 告警")
	}
	if !alert.Active {
		t.Fatalf("堵塞期间告警应为 active，got %+v", alert)
	}
	if got := len(activeAlerts(core, "p1")); got != 1 {
		t.Fatalf("expected exactly 1 active alert, got %d", got)
	}
	blockedLastTick := alert.LastTick

	// 货被取走（带子恢复流动）：告警解除，快照条目 active=false。
	belt.Conveyor.Buffer = nil
	core.processTick()

	resolved := alertByType(core, "p1", model.AlertTypeBeltBlocked)
	if resolved == nil {
		t.Fatal("历史条目应保留（供复盘）")
	}
	if resolved.Active {
		t.Fatalf("带子恢复流动后告警必须解除，got %+v", resolved)
	}
	if resolved.ResolvedTick == 0 || resolved.ResolvedTick <= blockedLastTick {
		t.Fatalf("expected resolved_tick after the blocked phase, got %d (last_tick=%d)", resolved.ResolvedTick, blockedLastTick)
	}
	if got := len(activeAlerts(core, "p1")); got != 0 {
		t.Fatalf("expected no active alerts after recovery, got %d", got)
	}

	// 再次堵死：同一条目重新变成 active（保留首报 tick）。
	belt.Conveyor.Insert(model.ItemIronOre, 2)
	for tick := int64(0); tick < beltBlockedWarnTicks+5; tick++ {
		core.processTick()
	}
	again := alertByType(core, "p1", model.AlertTypeBeltBlocked)
	if again == nil || !again.Active {
		t.Fatalf("re-blocked belt must reactivate the alert, got %+v", again)
	}
	if again.AlertID != alert.AlertID {
		t.Fatalf("aggregation must reuse the original alert entry, got %q want %q", again.AlertID, alert.AlertID)
	}
	_ = ws
}

// 到不了的运输目标解除：机器人重新到达后快照条目 active=false（与其他告警同路径）。
func TestHaulUnreachableAlertActiveThenResolved(t *testing.T) {
	f := newUnreachableHaulFixture(t)
	events := advanceAutoTicksEvents(f.core, f.ws, 200)
	if countHaulAlertEvents(events, model.AlertTypeHaulUnreachable) != 1 {
		t.Fatalf("应产生一条 haul_unreachable 事件")
	}
	// advanceAutoTicksEvents 是精简结算子集（不含告警历史管线）：手工按管线口径 Record。
	alert := alertByType(f.core, "p1", model.AlertTypeHaulUnreachable)
	if alert == nil {
		t.Fatal("到不了的建筑应产生 haul_unreachable 告警")
	}
	if !alert.Active {
		t.Fatalf("产生时快照条目必须 active=true，got %+v", alert)
	}
	if alert.PlanetID != f.ws.PlanetID {
		t.Fatalf("planet_id = %q, want %q", alert.PlanetID, f.ws.PlanetID)
	}

	// 拆掉一圈里的第一台带子，留出一个落点；清冷却让派单重新选中它。
	for _, cell := range f.ws.SurfaceDisc(f.blocked.Position, buildingRingSearchRadius(f.ws, f.blocked)) {
		if !ringHasBuilding(f.ws, f.blocked, cell) {
			continue
		}
		if id := f.ws.Grid[cell.Y][cell.X].BuildingID; id != "" && f.ws.Buildings[id] != nil {
			demolishAutoBuilding(f.ws, id)
			break
		}
	}
	delete(f.robot.Haul.UnreachableCooldowns, f.blocked.ID)
	haulFill(f.open, model.ItemIronOre, 8)
	for i := 0; i < 800; i++ {
		advanceAutoTicksEvents(f.core, f.ws, 1)
		if !f.blocked.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
			break
		}
	}
	if f.blocked.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		t.Fatalf("机器人没有重新到达被围死的建筑: robot=%+v", f.robot.Haul)
	}
	resolved := alertByType(f.core, "p1", model.AlertTypeHaulUnreachable)
	if resolved == nil {
		t.Fatal("历史条目应保留")
	}
	if resolved.Active {
		t.Fatalf("机器人到达后快照条目必须 active=false，got %+v", resolved)
	}
	if resolved.ResolvedTick == 0 {
		t.Fatalf("解除的条目必须带 resolved_tick，got %+v", resolved)
	}
}

// 缺电解除：power_shortage 也要在快照里变成 inactive。
func TestPowerShortageAlertResolvesWhenPowerReturns(t *testing.T) {
	core, ws, _ := beltAlertCore(t)
	miner := newMiningTestBuilding("miner", model.BuildingTypeMiningMachine, model.Position{X: 5, Y: 5}, 8)
	// 夹具默认把耗电清零；这里恢复耗电，让电网结算把「无供电」写回 no_power。
	miner.Runtime.Params.EnergyConsume = 4
	if miner.Runtime.Functions.Energy != nil {
		miner.Runtime.Functions.Energy.ConsumePerTick = 4
	}
	miner.Runtime.State = model.BuildingWorkNoPower
	attachBuilding(ws, miner)

	for i := 0; i < 30; i++ {
		core.processTick()
	}
	alert := alertByType(core, "p1", model.AlertTypePowerShortage)
	if alert == nil || !alert.Active {
		t.Fatalf("断电的采矿机应产生 active 的 power_shortage 告警，got %+v", alert)
	}

	// 接上电：夹具里没有电网，先把建筑改成「无需供电」，电网结算就会把它
	// 写回 running（PowerDemandForBuilding 也看 Functions.Energy）。
	miner.Runtime.Params.EnergyConsume = 0
	if miner.Runtime.Functions.Energy != nil {
		miner.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	miner.Runtime.Functions.Energy = nil
	// 生产监视器按 5 tick 采样，解除要在下一个采样点才被看到。
	for i := 0; i < 6; i++ {
		core.processTick()
	}
	resolved := alertByType(core, "p1", model.AlertTypePowerShortage)
	if resolved == nil || resolved.Active {
		t.Fatalf("恢复供电后 power_shortage 必须解除，got %+v", resolved)
	}
}

// 产物阻塞解除：output_blocked 也要在快照里变成 inactive。
func TestOutputBlockedAlertResolvesWhenOutputDrains(t *testing.T) {
	core, ws, _ := beltAlertCore(t)
	miner := newMiningTestBuilding("miner", model.BuildingTypeMiningMachine, model.Position{X: 5, Y: 5}, 8)
	attachBuilding(ws, miner)
	// mining_machine: capacity 48, buffer 12 (in 4 / out 8)：全部塞满 → 产物阻塞。
	miner.Storage.Inventory = model.ItemInventory{model.ItemSiliconOre: 48}
	miner.Storage.OutputBuffer = model.ItemInventory{model.ItemSiliconOre: 8}
	miner.Storage.InputBuffer = model.ItemInventory{model.ItemSiliconOre: 4}

	for i := 0; i < 30; i++ {
		core.processTick()
	}
	alert := alertByType(core, "p1", model.AlertTypeOutputBlocked)
	if alert == nil || !alert.Active {
		t.Fatalf("满仓采矿机应产生 active 的 output_blocked 告警，got %+v", alert)
	}

	miner.Storage.Inventory = model.ItemInventory{}
	miner.Storage.OutputBuffer = model.ItemInventory{}
	miner.Storage.InputBuffer = model.ItemInventory{}
	// 生产监视器按 sample_interval（5 tick）采样：跑到下一个采样点。
	for i := 0; i < 6; i++ {
		core.processTick()
	}
	resolved := alertByType(core, "p1", model.AlertTypeOutputBlocked)
	if resolved == nil || resolved.Active {
		t.Fatalf("清空库存后 output_blocked 必须解除，got %+v", resolved)
	}
}

// 出厂口堵塞解除：兵营队列清空后 unit_spawn_blocked 变成 inactive。
// 告警条目由结算管线自己 Record（不再手工塞历史），解除走真实路径。
func TestUnitSpawnBlockedAlertResolvesWhenQueueClears(t *testing.T) {
	core, ws, _ := beltAlertCore(t)
	barracks := newBuilding("barracks", "barracks", "p1", model.Position{X: 5, Y: 5})
	barracks.Runtime.State = model.BuildingWorkRunning
	// 兵营耗电：把耗电清零，免得没有电网时掉进 no_power 而永远不出厂。
	barracks.Runtime.Params.EnergyConsume = 0
	if barracks.Runtime.Functions.Energy != nil {
		barracks.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, barracks)
	barracks.UnitQueue = []model.UnitProductionOrder{{UnitType: model.UnitTypeSoldier}}
	// 把出生半径内的每一格都用传送带封死：单位只能留在队列里等。
	blocked := 0
	for _, tile := range ws.SurfaceDisc(barracks.Position, unitSpawnRadius+1) {
		if !ws.InBounds(tile.X, tile.Y) || !tileWalkableForUnit(ws, tile, "") || ws.BuildingOccupies(barracks, tile) {
			continue
		}
		belt := newBuilding("wall-"+model.TileKey(tile.X, tile.Y), model.BuildingTypeConveyorBeltMk1, "p1", tile)
		belt.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, belt)
		blocked++
	}
	if blocked == 0 {
		t.Fatal("夹具没有封住出生圈")
	}
	for i := 0; i < 60; i++ {
		core.processTick()
	}
	alert := alertByType(core, "p1", model.AlertTypeUnitSpawnBlocked)
	if alert == nil || !alert.Active {
		t.Fatalf("出生点被占满时应记录 active 的 unit_spawn_blocked，got %+v", alert)
	}
	if len(barracks.UnitQueue) != 1 {
		t.Fatalf("单位应留在队列里等待，queue=%d", len(barracks.UnitQueue))
	}

	barracks.UnitQueue = nil
	core.processTick()
	alert = alertByType(core, "p1", model.AlertTypeUnitSpawnBlocked)
	if alert == nil || alert.Active {
		t.Fatalf("队列清空后 unit_spawn_blocked 必须解除，got %+v", alert)
	}
	if alert.ResolvedTick == 0 {
		t.Fatalf("解除的条目必须带 resolved_tick，got %+v", alert)
	}
}
