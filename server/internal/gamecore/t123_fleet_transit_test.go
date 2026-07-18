package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 期7c：fleet_move 跨星系跃迁（最小可行机制）。
// 语义：跃迁中 State 保持 idle、transit 非空即跃迁中；舰队挂靠在出发星系
// 存储桶直到到达，不计入任何星系的轨道优势评分；跃迁中不可
// assign/attack/disband，也不可增援（commission_fleet 同 fleet_id）。

func newFleetTransitTestCore(t *testing.T) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "t123-transit-seed",
			MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 2},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 32, Height: 32, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	return New(cfg, maps, queue.New(), NewEventBus(), nil)
}

func addTransitTestFleet(core *GameCore, playerID, systemID, fleetID string) *model.SpaceFleet {
	fleet := &model.SpaceFleet{
		ID:         fleetID,
		OwnerID:    playerID,
		SystemID:   systemID,
		Formation:  model.FormationTypeLine,
		State:      model.FleetStateIdle,
		Units:      []model.FleetUnitStack{{BlueprintID: "corvette", Count: 2}},
		Subsystems: model.DefaultSpaceFleetSubsystemState(),
	}
	core.spaceRuntime.EnsurePlayerSystem(playerID, systemID).Fleets[fleetID] = fleet
	return fleet
}

func fleetMoveCommand(fleetID, targetSystemID string) model.Command {
	return model.Command{
		Type: model.CmdFleetMove,
		Payload: map[string]any{
			"fleet_id":         fleetID,
			"target_system_id": targetSystemID,
		},
	}
}

func TestT123FleetMoveValidation(t *testing.T) {
	core := newFleetTransitTestCore(t)
	ws := core.World()
	addTransitTestFleet(core, "p1", "sys-1", "fleet-t123")

	// 舰队不存在
	res, _ := core.execFleetMove(ws, "p1", fleetMoveCommand("ghost", "sys-2"))
	if res.Code != model.CodeEntityNotFound {
		t.Fatalf("expected ENTITY_NOT_FOUND for unknown fleet, got %s (%s)", res.Code, res.Message)
	}
	// 他人舰队不可见
	res, _ = core.execFleetMove(ws, "p2", fleetMoveCommand("fleet-t123", "sys-2"))
	if res.Code != model.CodeEntityNotFound {
		t.Fatalf("expected ENTITY_NOT_FOUND for foreign fleet, got %s (%s)", res.Code, res.Message)
	}
	// 目标 = 当前星系
	res, _ = core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-1"))
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected INVALID_TARGET for same-system move, got %s (%s)", res.Code, res.Message)
	}
	// 目标星系不存在
	res, _ = core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-99"))
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected INVALID_TARGET for unknown system, got %s (%s)", res.Code, res.Message)
	}
	// attacking 中不可移动
	fleet := core.spaceRuntime.PlayerSystem("p1", "sys-1").Fleets["fleet-t123"]
	fleet.State = model.FleetStateAttacking
	res, _ = core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-2"))
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected INVALID_TARGET for attacking fleet, got %s (%s)", res.Code, res.Message)
	}
	fleet.State = model.FleetStateIdle

	// 正常跃迁：sys-1 → sys-2（双星系互为最近邻，必有航线）
	res, events := core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-2"))
	if res.Code != model.CodeOK {
		t.Fatalf("fleet_move failed: %s (%s)", res.Code, res.Message)
	}
	if len(events) != 1 || events[0].EventType != model.EvtFleetMoveStarted {
		t.Fatalf("expected fleet_move_started event, got %+v", events)
	}
	payload := events[0].Payload
	if payload["fleet_id"] != "fleet-t123" || payload["from_system_id"] != "sys-1" || payload["to_system_id"] != "sys-2" || payload["total_ticks"] != FleetTransitTicks {
		t.Fatalf("unexpected fleet_move_started payload: %+v", payload)
	}
	if fleet.Transit == nil {
		t.Fatal("expected fleet transit state to be set")
	}
	if fleet.Transit.FromSystemID != "sys-1" || fleet.Transit.TargetSystemID != "sys-2" || fleet.Transit.TotalTicks != FleetTransitTicks || fleet.Transit.RemainingTicks != FleetTransitTicks {
		t.Fatalf("unexpected transit state: %+v", fleet.Transit)
	}
	if fleet.State != model.FleetStateIdle {
		t.Fatalf("expected state to stay idle during transit, got %s", fleet.State)
	}
	if fleet.SystemID != "sys-1" {
		t.Fatalf("expected fleet to stay in origin system until arrival, got %s", fleet.SystemID)
	}

	// 跃迁中再次跃迁 → 拒绝
	res, _ = core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-1"))
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected INVALID_TARGET for in-transit move, got %s (%s)", res.Code, res.Message)
	}
}

func TestT123FleetTransitBlocksCommands(t *testing.T) {
	core := newFleetTransitTestCore(t)
	ws := core.World()
	addTransitTestFleet(core, "p1", "sys-1", "fleet-t123")

	if res, _ := core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-2")); res.Code != model.CodeOK {
		t.Fatalf("fleet_move failed: %s (%s)", res.Code, res.Message)
	}

	res, _ := core.execFleetAssign(ws, "p1", model.Command{
		Type:    model.CmdFleetAssign,
		Payload: map[string]any{"fleet_id": "fleet-t123", "formation": string(model.FormationTypeWedge)},
	})
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected fleet_assign blocked during transit, got %s (%s)", res.Code, res.Message)
	}

	res, _ = core.execFleetAttack(ws, "p1", model.Command{
		Type:    model.CmdFleetAttack,
		Payload: map[string]any{"fleet_id": "fleet-t123", "planet_id": ws.PlanetID, "target_id": "enemy-1"},
	})
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected fleet_attack blocked during transit, got %s (%s)", res.Code, res.Message)
	}

	res, _ = core.execFleetDisband(ws, "p1", model.Command{
		Type:    model.CmdFleetDisband,
		Payload: map[string]any{"fleet_id": "fleet-t123"},
	})
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected fleet_disband blocked during transit, got %s (%s)", res.Code, res.Message)
	}

	// 跃迁中不可增援（commission_fleet 指向同一 fleet_id）
	grantTechs(ws, "p1", "corvette")
	base := newBuilding("base-t123", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	if base.Runtime.Functions.Energy != nil {
		base.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, base)
	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      12,
		ReadyPayloads: map[string]int{model.ItemCorvette: 1},
	}
	res, _ = core.execCommissionFleet(ws, "p1", model.Command{
		Type:   model.CmdCommissionFleet,
		Target: model.CommandTarget{EntityID: base.ID, SystemID: "sys-1"},
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    "sys-1",
			"fleet_id":     "fleet-t123",
		},
	})
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected commission_fleet reinforcement blocked during transit, got %s (%s)", res.Code, res.Message)
	}
	// 拒绝路径不得扣减部署库存
	hub := ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID]
	if hub.ReadyPayloads[model.ItemCorvette] != 1 {
		t.Fatalf("expected hub payload to stay intact on rejection, got %+v", hub.ReadyPayloads)
	}
}

func TestT123FleetTransitSettlement(t *testing.T) {
	core := newFleetTransitTestCore(t)
	ws := core.World()
	addTransitTestFleet(core, "p1", "sys-1", "fleet-t123")

	if res, _ := core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-2")); res.Code != model.CodeOK {
		t.Fatalf("fleet_move failed: %s (%s)", res.Code, res.Message)
	}

	origin := core.spaceRuntime.PlayerSystem("p1", "sys-1")
	for i := int64(1); i < FleetTransitTicks; i++ {
		if events := settleFleetTransit(core.spaceRuntime); len(events) != 0 {
			t.Fatalf("expected no arrival events at tick %d, got %+v", i, events)
		}
		fleet := origin.Fleets["fleet-t123"]
		if fleet == nil || fleet.Transit == nil {
			t.Fatalf("expected fleet to stay in transit at tick %d, got %+v", i, fleet)
		}
		if fleet.Transit.RemainingTicks != FleetTransitTicks-i {
			t.Fatalf("expected remaining %d at tick %d, got %d", FleetTransitTicks-i, i, fleet.Transit.RemainingTicks)
		}
		if fleet.SystemID != "sys-1" {
			t.Fatalf("expected fleet to stay in sys-1 until arrival, got %s", fleet.SystemID)
		}
	}

	events := settleFleetTransit(core.spaceRuntime)
	if len(events) != 1 || events[0].EventType != model.EvtFleetArrived {
		t.Fatalf("expected fleet_arrived event, got %+v", events)
	}
	payload := events[0].Payload
	if payload["fleet_id"] != "fleet-t123" || payload["system_id"] != "sys-2" || payload["from_system_id"] != "sys-1" {
		t.Fatalf("unexpected fleet_arrived payload: %+v", payload)
	}
	if len(origin.Fleets) != 0 {
		t.Fatalf("expected origin system to release the fleet, got %+v", origin.Fleets)
	}
	target := core.spaceRuntime.PlayerSystem("p1", "sys-2")
	fleet := target.Fleets["fleet-t123"]
	if fleet == nil {
		t.Fatalf("expected fleet in sys-2 after arrival, got %+v", target.Fleets)
	}
	if fleet.SystemID != "sys-2" || fleet.Transit != nil || fleet.State != model.FleetStateIdle {
		t.Fatalf("unexpected fleet state after arrival: %+v", fleet)
	}
}

func TestT123FleetTransitExcludedFromOrbitalSuperiority(t *testing.T) {
	core := newFleetTransitTestCore(t)
	ws := core.World()
	addTransitTestFleet(core, "p1", "sys-1", "fleet-t123")

	superiority := evaluateOrbitalSuperiority(core.worlds, core.spaceRuntime, "sys-1", ws.Tick)
	if superiority.AdvantagePlayerID != "p1" {
		t.Fatalf("expected p1 orbital advantage before transit, got %+v", superiority)
	}

	if res, _ := core.execFleetMove(ws, "p1", fleetMoveCommand("fleet-t123", "sys-2")); res.Code != model.CodeOK {
		t.Fatalf("fleet_move failed: %s (%s)", res.Code, res.Message)
	}
	superiority = evaluateOrbitalSuperiority(core.worlds, core.spaceRuntime, "sys-1", ws.Tick)
	if superiority.AdvantagePlayerID != "" {
		t.Fatalf("expected in-transit fleet to be excluded from superiority, got %+v", superiority)
	}

	for i := int64(0); i < FleetTransitTicks; i++ {
		settleFleetTransit(core.spaceRuntime)
	}
	superiority = evaluateOrbitalSuperiority(core.worlds, core.spaceRuntime, "sys-2", ws.Tick)
	if superiority.AdvantagePlayerID != "p1" {
		t.Fatalf("expected p1 orbital advantage in sys-2 after arrival, got %+v", superiority)
	}
}

func TestT123FleetMoveThroughDispatcherAndPipeline(t *testing.T) {
	core := newFleetTransitTestCore(t)
	addTransitTestFleet(core, "p1", "sys-1", "fleet-t123")

	if res := issueInternalCommand(core, "p1", fleetMoveCommand("fleet-t123", "sys-2")); res.Code != model.CodeOK {
		t.Fatalf("dispatch fleet_move failed: %s (%s)", res.Code, res.Message)
	}

	for i := int64(0); i < FleetTransitTicks; i++ {
		core.processTick()
	}
	if runtime := core.spaceRuntime.PlayerSystem("p1", "sys-1"); runtime == nil || len(runtime.Fleets) != 0 {
		t.Fatalf("expected sys-1 to be empty after transit, got %+v", runtime)
	}
	target := core.spaceRuntime.PlayerSystem("p1", "sys-2")
	if target == nil || target.Fleets["fleet-t123"] == nil || target.Fleets["fleet-t123"].Transit != nil {
		t.Fatalf("expected fleet to arrive in sys-2 after %d ticks, got %+v", FleetTransitTicks, target)
	}
}
