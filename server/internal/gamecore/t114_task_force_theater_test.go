package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestT114TaskForceAndTheaterCommandsBuildAuthoritativeRuntime(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "prototype", "corvette")

	base := newBuilding("base-t114", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.DeploymentState.PayloadInventory[model.ItemPrototype] = 6
	base.DeploymentState.PayloadInventory[model.ItemCorvette] = 4
	attachBuilding(ws, base)

	power := newBuilding("power-t114", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	aiCore := newBuilding("ai-core-t114", model.BuildingTypeSelfEvolutionLab, "p1", model.Position{X: 7, Y: 6})
	aiCore.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, aiCore)

	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{
			{
				ID:           "enemy-priority-heavy",
				Type:         model.EnemyForceTypeHive,
				Position:     model.Position{X: 13, Y: 12},
				Strength:     200,
				SpreadRadius: 2,
				TargetPlayer: "p1",
				SpawnTick:    ws.Tick,
			},
			{
				ID:           "enemy-priority-light",
				Type:         model.EnemyForceTypeHive,
				Position:     model.Position{X: 10, Y: 10},
				Strength:     80,
				SpreadRadius: 1,
				TargetPlayer: "p1",
				SpawnTick:    ws.Tick,
			},
		},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "prototype",
			"count":        4,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy squad failed: %s (%s)", res.Code, res.Message)
	}

	var squadID string
	for id := range ws.CombatRuntime.Squads {
		squadID = id
	}
	if squadID == "" {
		t.Fatal("expected deployed squad id")
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "corvette",
			"count":        3,
			"system_id":    "sys-1",
			"fleet_id":     "fleet-alpha",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet alpha failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    "sys-1",
			"fleet_id":     "fleet-beta",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet beta failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTheaterCreate,
		Payload: map[string]any{
			"theater_id": "theater-home",
			"system_id":  "sys-1",
			"name":       "Home Theater",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater create failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTheaterDefineZone,
		Payload: map[string]any{
			"theater_id": "theater-home",
			"zone_type":  string(model.TheaterZonePrimary),
			"planet_id":  ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater define zone failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTheaterSetObjective,
		Payload: map[string]any{
			"theater_id":       "theater-home",
			"objective_type":   "secure_orbit",
			"target_planet_id": ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater set objective failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceCreate,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"system_id":     "sys-1",
			"theater_id":    "theater-home",
			"name":          "Alpha Task Force",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force create failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"fleet_ids":     []string{"fleet-alpha", "fleet-beta"},
			"squad_ids":     []string{squadID},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force assign failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceSetStance,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"stance":        string(model.TaskForceStanceAggressivePursuit),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force stance failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceDeploy,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"planet_id":     ws.PlanetID,
			"position": map[string]any{
				"x": 11,
				"y": 11,
			},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force deploy failed: %s (%s)", res.Code, res.Message)
	}

	systemRuntime := core.spaceRuntime.PlayerSystem("p1", "sys-1")
	if systemRuntime == nil {
		t.Fatal("expected system runtime")
	}
	taskForce := systemRuntime.TaskForces["tf-alpha"]
	if taskForce == nil {
		t.Fatalf("expected task force runtime, got %+v", systemRuntime.TaskForces)
	}
	if taskForce.TheaterID != "theater-home" {
		t.Fatalf("expected task force theater theater-home, got %+v", taskForce)
	}
	if taskForce.Stance != model.TaskForceStanceAggressivePursuit {
		t.Fatalf("expected aggressive pursuit stance, got %+v", taskForce)
	}
	if len(taskForce.Members) != 3 {
		t.Fatalf("expected 3 task force members, got %+v", taskForce.Members)
	}
	if taskForce.CommandCapacity.Total <= 0 || taskForce.CommandCapacity.Used <= 0 {
		t.Fatalf("expected command capacity accounting, got %+v", taskForce.CommandCapacity)
	}
	if taskForce.CommandCapacity.Over <= 0 {
		t.Fatalf("expected over-capacity penalty for mixed oversized task force, got %+v", taskForce.CommandCapacity)
	}
	if taskForce.CommandCapacity.Penalty.DelayTicks <= 0 {
		t.Fatalf("expected positive command delay penalty, got %+v", taskForce.CommandCapacity.Penalty)
	}
	if taskForce.Behavior.TargetPriority == "" || !taskForce.Behavior.Pursue || taskForce.Behavior.EngagementRangeMultiplier <= 1 {
		t.Fatalf("expected aggressive pursuit behavior profile, got %+v", taskForce.Behavior)
	}

	sourceTypes := map[model.CommandCapacitySourceType]bool{}
	for _, source := range taskForce.CommandCapacity.Sources {
		sourceTypes[source.Type] = true
	}
	for _, required := range []model.CommandCapacitySourceType{
		model.CommandCapacitySourceCommandCenter,
		model.CommandCapacitySourceCommandShip,
		model.CommandCapacitySourceBattlefieldAnalysisBase,
		model.CommandCapacitySourceMilitaryAICore,
	} {
		if !sourceTypes[required] {
			t.Fatalf("expected command capacity source %s, got %+v", required, taskForce.CommandCapacity.Sources)
		}
	}

	theater := systemRuntime.Theaters["theater-home"]
	if theater == nil {
		t.Fatalf("expected theater runtime, got %+v", systemRuntime.Theaters)
	}
	if len(theater.Zones) != 1 || theater.Zones[0].ZoneType != model.TheaterZonePrimary {
		t.Fatalf("expected primary theater zone, got %+v", theater)
	}
	if theater.Objective == nil || theater.Objective.TargetPlanetID != ws.PlanetID {
		t.Fatalf("expected theater objective on %s, got %+v", ws.PlanetID, theater.Objective)
	}

	enemyBefore := ws.EnemyForces.Forces[0].Strength + ws.EnemyForces.Forces[1].Strength
	planetEvents := settleCombatRuntime(ws, ws.Tick+1)
	spaceEvents := settleSpaceFleets(core.worlds, core.maps, core.spaceRuntime, ws.Tick+1)
	if len(planetEvents) == 0 && len(spaceEvents) == 0 {
		t.Fatal("expected task force deployment to drive runtime combat events")
	}
	enemyAfter := 0
	for _, force := range ws.EnemyForces.Forces {
		enemyAfter += force.Strength
	}
	if enemyAfter >= enemyBefore {
		t.Fatalf("expected enemy strength to drop after task force settlement, before=%d after=%d", enemyBefore, enemyAfter)
	}
}

func TestT114RetreatOnLossesStanceTriggersRetreat(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "corvette")

	base := newBuilding("base-retreat-t114", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.DeploymentState.PayloadInventory[model.ItemCorvette] = 1
	attachBuilding(ws, base)

	power := newBuilding("power-retreat-t114", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-retreat-t114",
			Type:         model.EnemyForceTypeHive,
			Position:     model.Position{X: 12, Y: 12},
			Strength:     120,
			SpreadRadius: 2,
			TargetPlayer: "p1",
			SpawnTick:    ws.Tick,
		}},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    "sys-1",
			"fleet_id":     "fleet-retreat",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceCreate,
		Payload: map[string]any{
			"task_force_id": "tf-retreat",
			"system_id":     "sys-1",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force create failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-retreat",
			"fleet_ids":     []string{"fleet-retreat"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force assign failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceSetStance,
		Payload: map[string]any{
			"task_force_id": "tf-retreat",
			"stance":        string(model.TaskForceStanceRetreatOnLosses),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force stance failed: %s (%s)", res.Code, res.Message)
	}

	systemRuntime := core.spaceRuntime.PlayerSystem("p1", "sys-1")
	fleet := systemRuntime.Fleets["fleet-retreat"]
	if fleet == nil {
		t.Fatal("expected fleet-retreat to exist")
	}
	fleet.Shield.Level = fleet.Shield.MaxLevel * 0.2

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceDeploy,
		Payload: map[string]any{
			"task_force_id": "tf-retreat",
			"planet_id":     ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task force deploy failed: %s (%s)", res.Code, res.Message)
	}

	events := settleSpaceFleets(core.worlds, core.maps, core.spaceRuntime, ws.Tick+1)
	if len(events) == 0 {
		t.Fatal("expected retreat settlement events")
	}

	taskForce := systemRuntime.TaskForces["tf-retreat"]
	if taskForce == nil {
		t.Fatal("expected task force runtime")
	}
	if taskForce.Status != model.TaskForceStatusRetreating {
		t.Fatalf("expected retreating task force, got %+v", taskForce)
	}
	if fleet.State != model.FleetStateIdle || fleet.Target != nil {
		t.Fatalf("expected fleet to clear attack target after retreat, got %+v", fleet)
	}
}
