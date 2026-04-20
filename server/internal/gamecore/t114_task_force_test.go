package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT114TaskForceTheaterCommandsAndQuery(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "prototype", "corvette")

	base := newBuilding("base-t114", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	if base.Runtime.Functions.Energy != nil {
		base.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, base)

	power := newBuilding("power-t114", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      16,
		ReadyPayloads: map[string]int{model.ItemPrototype: 2, model.ItemCorvette: 1},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "prototype",
			"count":        1,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy squad failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    "sys-1",
			"fleet_id":     "fleet-t114",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceCreate,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"name":          "Alpha",
			"stance":        string(model.WarTaskForceStanceEscort),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_create failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTheaterCreate,
		Payload: map[string]any{
			"theater_id": "theater-front",
			"name":       "Frontline",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater_create failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTheaterDefineZone,
		Payload: map[string]any{
			"theater_id": "theater-front",
			"zone_type":  string(model.WarTheaterZoneTypePrimary),
			"planet_id":  ws.PlanetID,
			"position": map[string]any{
				"x": 8,
				"y": 8,
			},
			"radius": 5,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater_define_zone failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTheaterSetObjective,
		Payload: map[string]any{
			"theater_id":     "theater-front",
			"objective_type": "secure_planet",
			"system_id":      "sys-1",
			"planet_id":      ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater_set_objective failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"member_kind":   string(model.WarTaskForceMemberKindSquad),
			"member_ids":    []string{"squad-1"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign squad failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"member_kind":   string(model.WarTaskForceMemberKindFleet),
			"member_ids":    []string{"fleet-t114"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign fleet failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceSetStance,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"stance":        string(model.WarTaskForceStanceIntercept),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_set_stance failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceDeploy,
		Payload: map[string]any{
			"task_force_id": "tf-alpha",
			"theater_id":    "theater-front",
			"system_id":     "sys-1",
			"planet_id":     ws.PlanetID,
			"position": map[string]any{
				"x": 9,
				"y": 9,
			},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_deploy failed: %s (%s)", res.Code, res.Message)
	}

	coordination := ws.Players["p1"].WarCoordination
	if coordination == nil || coordination.TaskForces["tf-alpha"] == nil {
		t.Fatalf("expected task force state, got %+v", coordination)
	}
	taskForce := coordination.TaskForces["tf-alpha"]
	if taskForce.Stance != model.WarTaskForceStanceIntercept {
		t.Fatalf("expected intercept stance, got %+v", taskForce)
	}
	if taskForce.TheaterID != "theater-front" {
		t.Fatalf("expected theater binding, got %+v", taskForce)
	}
	if len(taskForce.Members) != 2 {
		t.Fatalf("expected squad and fleet members, got %+v", taskForce.Members)
	}
	if taskForce.Deployment == nil || taskForce.Deployment.PlanetID != ws.PlanetID || taskForce.Deployment.SystemID != "sys-1" {
		t.Fatalf("expected deployment target to persist, got %+v", taskForce.Deployment)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	taskForceView := ql.WarTaskForces(ws, "p1", core.worlds, core.spaceRuntime)
	if len(taskForceView.TaskForces) != 1 {
		t.Fatalf("expected one task force view, got %+v", taskForceView)
	}
	if taskForceView.TaskForces[0].Stance != string(model.WarTaskForceStanceIntercept) {
		t.Fatalf("expected intercept stance in query, got %+v", taskForceView.TaskForces[0])
	}
	if taskForceView.TaskForces[0].TheaterID != "theater-front" {
		t.Fatalf("expected theater in query, got %+v", taskForceView.TaskForces[0])
	}
	if len(taskForceView.TaskForces[0].Members) != 2 {
		t.Fatalf("expected two members in query, got %+v", taskForceView.TaskForces[0])
	}
	if taskForceView.TaskForces[0].CommandCapacity.Total <= 0 || taskForceView.TaskForces[0].CommandCapacity.Used <= 0 {
		t.Fatalf("expected non-empty command capacity, got %+v", taskForceView.TaskForces[0].CommandCapacity)
	}
	if len(taskForceView.TaskForces[0].CommandCapacity.Sources) == 0 {
		t.Fatalf("expected command capacity sources, got %+v", taskForceView.TaskForces[0].CommandCapacity)
	}

	theaterView := ql.WarTheaters(ws, "p1")
	if len(theaterView.Theaters) != 1 {
		t.Fatalf("expected one theater, got %+v", theaterView)
	}
	if len(theaterView.Theaters[0].Zones) != 1 || theaterView.Theaters[0].Zones[0].ZoneType != string(model.WarTheaterZoneTypePrimary) {
		t.Fatalf("expected primary theater zone, got %+v", theaterView.Theaters[0])
	}
	if theaterView.Theaters[0].Objective == nil || theaterView.Theaters[0].Objective.ObjectiveType != "secure_planet" {
		t.Fatalf("expected theater objective, got %+v", theaterView.Theaters[0])
	}
}

func TestT114TaskForceStanceAffectsEngagementAndRetreat(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "prototype")

	base := newBuilding("base-stance-t114", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	if base.Runtime.Functions.Energy != nil {
		base.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, base)

	power := newBuilding("power-stance-t114", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      8,
		ReadyPayloads: map[string]int{model.ItemPrototype: 1},
	}
	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-stance-t114",
			Type:         model.EnemyForceTypeHive,
			Position:     model.Position{X: 15, Y: 15},
			Strength:     120,
			SpreadRadius: 2,
			TargetPlayer: "p1",
			SpawnTick:    ws.Tick,
		}},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "prototype",
			"count":        1,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy squad failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceCreate,
		Payload: map[string]any{
			"task_force_id": "tf-stance",
			"stance":        string(model.WarTaskForceStanceHold),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_create failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-stance",
			"member_kind":   string(model.WarTaskForceMemberKindSquad),
			"member_ids":    []string{"squad-1"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign failed: %s (%s)", res.Code, res.Message)
	}

	holdEvents := settleCombatRuntime(ws, ws.Tick+1)
	if len(holdEvents) != 0 {
		t.Fatalf("expected hold stance to avoid far pursuit, got %+v", holdEvents)
	}
	if ws.CombatRuntime.Squads["squad-1"].State != model.CombatSquadStateIdle {
		t.Fatalf("expected hold stance squad to remain idle, got %+v", ws.CombatRuntime.Squads["squad-1"])
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceSetStance,
		Payload: map[string]any{
			"task_force_id": "tf-stance",
			"stance":        string(model.WarTaskForceStanceIntercept),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_set_stance intercept failed: %s (%s)", res.Code, res.Message)
	}

	interceptEvents := settleCombatRuntime(ws, ws.Tick+2)
	if len(interceptEvents) == 0 {
		t.Fatal("expected intercept stance to engage distant target")
	}
	if ws.CombatRuntime.Squads["squad-1"].TargetEnemyID != "enemy-stance-t114" {
		t.Fatalf("expected intercept stance to acquire target, got %+v", ws.CombatRuntime.Squads["squad-1"])
	}

	squad := ws.CombatRuntime.Squads["squad-1"]
	squad.HP = squad.MaxHP / 4
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceSetStance,
		Payload: map[string]any{
			"task_force_id": "tf-stance",
			"stance":        string(model.WarTaskForceStanceRetreatOnLosses),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_set_stance retreat failed: %s (%s)", res.Code, res.Message)
	}

	retreatEvents := settleCombatRuntime(ws, ws.Tick+3)
	if len(retreatEvents) != 0 {
		t.Fatalf("expected retreat stance to suppress further attacks after losses, got %+v", retreatEvents)
	}
	if squad.State != model.CombatSquadStateIdle || squad.TargetEnemyID != "" {
		t.Fatalf("expected retreat stance to clear engagement, got %+v", squad)
	}
}

func TestT114CommandCapacityPenaltyReducesFleetAttackDamage(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "corvette")

	base := newBuilding("base-capacity-t114", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	if base.Runtime.Functions.Energy != nil {
		base.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, base)

	power := newBuilding("power-capacity-t114", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      20,
		ReadyPayloads: map[string]int{model.ItemCorvette: 6},
	}
	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-capacity-t114",
			Type:         model.EnemyForceTypeHive,
			Position:     model.Position{X: 12, Y: 12},
			Strength:     300,
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
			"count":        6,
			"system_id":    "sys-1",
			"fleet_id":     "fleet-capacity",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceCreate,
		Payload: map[string]any{
			"task_force_id": "tf-capacity",
			"stance":        string(model.WarTaskForceStanceIntercept),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_create failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-capacity",
			"member_kind":   string(model.WarTaskForceMemberKindFleet),
			"member_ids":    []string{"fleet-capacity"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdFleetAttack,
		Payload: map[string]any{
			"fleet_id":  "fleet-capacity",
			"planet_id": ws.PlanetID,
			"target_id": "enemy-capacity-t114",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("fleet_attack failed: %s (%s)", res.Code, res.Message)
	}

	fleet := core.spaceRuntime.PlayerSystem("p1", "sys-1").Fleets["fleet-capacity"]
	unpenalizedDamage := max(1, fleet.Weapon.Damage/4)

	events := settleSpaceFleets(core.worlds, core.maps, core.spaceRuntime, ws.Tick+1)
	if len(events) == 0 {
		t.Fatal("expected fleet settlement damage event")
	}
	damage, ok := events[0].Payload["damage"].(int)
	if !ok {
		t.Fatalf("expected integer damage payload, got %+v", events[0].Payload)
	}
	if damage >= unpenalizedDamage {
		t.Fatalf("expected command capacity penalty to reduce damage below %d, got %d", unpenalizedDamage, damage)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	taskForceView := ql.WarTaskForces(ws, "p1", core.worlds, core.spaceRuntime)
	if len(taskForceView.TaskForces) != 1 {
		t.Fatalf("expected task force query view, got %+v", taskForceView)
	}
	if taskForceView.TaskForces[0].CommandCapacity.Over <= 0 {
		t.Fatalf("expected over-capacity task force, got %+v", taskForceView.TaskForces[0].CommandCapacity)
	}
	if taskForceView.TaskForces[0].CommandCapacity.HitPenalty <= 0 {
		t.Fatalf("expected hit penalty, got %+v", taskForceView.TaskForces[0].CommandCapacity)
	}
}
