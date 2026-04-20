package gamecore

import (
	"testing"

	"siliconworld/internal/query"
	"siliconworld/internal/model"
	"siliconworld/internal/visibility"
)

func TestT100HiddenTechGateBlocksDarkFogButFleetTechsAreResearchable(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-t100", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 400); err != nil {
		t.Fatalf("load matrices: %v", err)
	}
	attachBuilding(ws, lab)

	grantTechs(ws, "p1", "battlefield_analysis", "plasma_control")

	visibleRes, _ := core.execStartResearch(ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "prototype"},
	})
	if visibleRes.Code != model.CodeOK {
		t.Fatalf("expected prototype research to be queueable, got %s (%s)", visibleRes.Code, visibleRes.Message)
	}

	hiddenRes, _ := core.execStartResearch(ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "dark_fog_matrix"},
	})
	if hiddenRes.Code != model.CodeValidationFailed {
		t.Fatalf("expected hidden tech to fail validation, got %s (%s)", hiddenRes.Code, hiddenRes.Message)
	}
	if hiddenRes.Message != "tech dark_fog_matrix is hidden and cannot be researched directly" {
		t.Fatalf("unexpected hidden-tech message: %s", hiddenRes.Message)
	}
}

func TestT100DeploySquadFleetQueryAndAttackClosure(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "prototype", "corvette")

	base := newBuilding("base-t100", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.DeploymentState.PayloadInventory[model.ItemPrototype] = 3
	base.DeploymentState.PayloadInventory[model.ItemCorvette] = 2
	attachBuilding(ws, base)
	power := newBuilding("power-t100", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-t100",
			Type:         model.EnemyForceTypeHive,
			Position:     model.Position{X: 12, Y: 12},
			Strength:     120,
			SpreadRadius: 2,
			TargetPlayer: "p1",
			SpawnTick:    ws.Tick,
		}},
	}

	deployRes, deployEvents := core.execDeploySquad(ws, "p1", model.Command{
		Type:   model.CmdDeploySquad,
		Target: model.CommandTarget{EntityID: base.ID},
		Payload: map[string]any{
			"building_id": base.ID,
			"blueprint_id": "prototype",
			"count":       2,
			"planet_id":   ws.PlanetID,
		},
	})
	if deployRes.Code != model.CodeOK {
		t.Fatalf("deploy squad failed: %s (%s)", deployRes.Code, deployRes.Message)
	}
	if len(deployEvents) == 0 || deployEvents[0].EventType != model.EvtSquadDeployed {
		t.Fatalf("expected squad_deployed event, got %+v", deployEvents)
	}
	if ws.CombatRuntime == nil || len(ws.CombatRuntime.Squads) != 1 {
		t.Fatalf("expected squad runtime to be created, got %+v", ws.CombatRuntime)
	}

	commissionRes, commissionEvents := core.execCommissionFleet(ws, "p1", model.Command{
		Type:   model.CmdCommissionFleet,
		Target: model.CommandTarget{EntityID: base.ID, SystemID: "sys-1"},
		Payload: map[string]any{
			"building_id": base.ID,
			"blueprint_id": "corvette",
			"count":       1,
			"system_id":   "sys-1",
			"fleet_id":    "fleet-alpha",
		},
	})
	if commissionRes.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", commissionRes.Code, commissionRes.Message)
	}
	if len(commissionEvents) == 0 || commissionEvents[0].EventType != model.EvtFleetCommissioned {
		t.Fatalf("expected fleet_commissioned event, got %+v", commissionEvents)
	}

	assignRes, _ := core.execFleetAssign(ws, "p1", model.Command{
		Type: model.CmdFleetAssign,
		Payload: map[string]any{
			"fleet_id":   "fleet-alpha",
			"formation":  string(model.FormationTypeWedge),
		},
	})
	if assignRes.Code != model.CodeOK {
		t.Fatalf("fleet assign failed: %s (%s)", assignRes.Code, assignRes.Message)
	}

	attackRes, _ := core.execFleetAttack(ws, "p1", model.Command{
		Type: model.CmdFleetAttack,
		Payload: map[string]any{
			"fleet_id":   "fleet-alpha",
			"planet_id":  ws.PlanetID,
			"target_id":  "enemy-t100",
		},
	})
	if attackRes.Code != model.CodeOK {
		t.Fatalf("fleet attack failed: %s (%s)", attackRes.Code, attackRes.Message)
	}

	planetEvents := settleCombatRuntime(ws, ws.Tick+1)
	spaceEvents := settleSpaceFleets(core.worlds, core.maps, core.spaceRuntime, ws.Tick+1)
	if len(planetEvents) == 0 && len(spaceEvents) == 0 {
		t.Fatal("expected combat settlement events after squad/fleet attack")
	}
	if ws.EnemyForces.Forces[0].Strength >= 120 {
		t.Fatalf("expected enemy strength to drop after attack, got %+v", ws.EnemyForces.Forces[0])
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	systemRuntimeView, ok := ql.SystemRuntime("p1", "sys-1", ws.PlanetID, ws, core.spaceRuntime)
	if !ok || len(systemRuntimeView.Fleets) != 1 {
		t.Fatalf("expected one fleet in system runtime view, got %+v", systemRuntimeView)
	}
	if systemRuntimeView.Fleets[0].Formation != string(model.FormationTypeWedge) {
		t.Fatalf("expected wedge formation in runtime view, got %+v", systemRuntimeView.Fleets[0])
	}

	fleetView, ok := ql.Fleet("p1", "fleet-alpha", core.spaceRuntime)
	if !ok || fleetView.FleetID != "fleet-alpha" {
		t.Fatalf("expected fleet detail view, got %+v", fleetView)
	}

	disbandRes, _ := core.execFleetDisband(ws, "p1", model.Command{
		Type:    model.CmdFleetDisband,
		Payload: map[string]any{"fleet_id": "fleet-alpha"},
	})
	if disbandRes.Code != model.CodeOK {
		t.Fatalf("fleet disband failed: %s (%s)", disbandRes.Code, disbandRes.Message)
	}
	if runtime := core.spaceRuntime.PlayerSystem("p1", "sys-1"); runtime == nil || len(runtime.Fleets) != 0 {
		t.Fatalf("expected fleet to be removed from space runtime, got %+v", runtime)
	}
}

func TestT100FleetCommandsFlowThroughDispatcherAndTickSettlement(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "prototype", "corvette")

	base := newBuilding("dispatcher-base-t100", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.DeploymentState.PayloadInventory[model.ItemPrototype] = 2
	base.DeploymentState.PayloadInventory[model.ItemCorvette] = 1
	attachBuilding(ws, base)
	power := newBuilding("dispatcher-power-t100", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-dispatcher-t100",
			Type:         model.EnemyForceTypeHive,
			Position:     model.Position{X: 12, Y: 12},
			Strength:     120,
			SpreadRadius: 2,
			TargetPlayer: "p1",
			SpawnTick:    ws.Tick,
		}},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type:   model.CmdDeploySquad,
		Target: model.CommandTarget{EntityID: base.ID},
		Payload: map[string]any{
			"building_id": base.ID,
			"blueprint_id": "prototype",
			"count":       2,
			"planet_id":   ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("dispatch deploy_squad failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type:   model.CmdCommissionFleet,
		Target: model.CommandTarget{EntityID: base.ID, SystemID: "sys-1"},
		Payload: map[string]any{
			"building_id": base.ID,
			"blueprint_id": "corvette",
			"count":       1,
			"system_id":   "sys-1",
			"fleet_id":    "fleet-dispatcher",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("dispatch commission_fleet failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdFleetAssign,
		Payload: map[string]any{
			"fleet_id":  "fleet-dispatcher",
			"formation": string(model.FormationTypeWedge),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("dispatch fleet_assign failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdFleetAttack,
		Payload: map[string]any{
			"fleet_id":  "fleet-dispatcher",
			"planet_id": ws.PlanetID,
			"target_id": "enemy-dispatcher-t100",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("dispatch fleet_attack failed: %s (%s)", res.Code, res.Message)
	}

	core.processTick()

	if ws.CombatRuntime == nil || len(ws.CombatRuntime.Squads) != 1 {
		t.Fatalf("expected dispatched deploy_squad to create combat runtime, got %+v", ws.CombatRuntime)
	}
	if runtime := core.spaceRuntime.PlayerSystem("p1", "sys-1"); runtime == nil || len(runtime.Fleets) != 1 {
		t.Fatalf("expected dispatched commission_fleet to persist in space runtime, got %+v", runtime)
	}
	if ws.EnemyForces == nil || len(ws.EnemyForces.Forces) != 1 || ws.EnemyForces.Forces[0].Strength >= 120 {
		t.Fatalf("expected tick settlement to damage enemy force, got %+v", ws.EnemyForces)
	}
}
