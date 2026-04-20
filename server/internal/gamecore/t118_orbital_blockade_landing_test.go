package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT118BlockadeInterdictsSupplyAndLandingWithoutSuperiority(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID

	grantTechs(ws, "p1", "corvette")
	grantTechs(ws, "p2", "corvette")

	p1Base := operationalWarHubForT118(ws, "hub-p1-t118", "p1", model.Position{X: 6, Y: 6})
	p2Base := operationalWarHubForT118(ws, "hub-p2-t118", "p2", model.Position{X: 18, Y: 18})

	p1Base.Storage.EnsureInventory()[model.ItemAmmoBullet] = 50
	p1Base.Storage.EnsureInventory()[model.ItemHydrogenFuelRod] = 30
	p1Base.Storage.EnsureInventory()[model.ItemGear] = 20
	p1Base.Storage.EnsureInventory()[model.ItemPhotonCombiner] = 12
	p1Base.Storage.EnsureInventory()[model.ItemPrecisionDrone] = 8

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[p1Base.ID] = &model.WarDeploymentHubState{
		BuildingID:    p1Base.ID,
		Capacity:      16,
		ReadyPayloads: map[string]int{"corvette": 1},
	}
	ws.Players["p2"].EnsureWarIndustry().DeploymentHubs[p2Base.ID] = &model.WarDeploymentHubState{
		BuildingID:    p2Base.ID,
		Capacity:      16,
		ReadyPayloads: map[string]int{"corvette": 2},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p1Base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-p1-t118",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p1 fleet failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p2Base.ID,
			"blueprint_id": "corvette",
			"count":        2,
			"system_id":    systemID,
			"fleet_id":     "fleet-p2-t118",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p2 fleet failed: %s (%s)", res.Code, res.Message)
	}

	createTaskForceForT118(t, core, "p1", "tf-landing-t118", "fleet-p1-t118", systemID, ws.PlanetID, model.WarTaskForceStanceEscort)
	createTaskForceForT118(t, core, "p2", "tf-blockade-t118", "fleet-p2-t118", systemID, ws.PlanetID, model.WarTaskForceStanceSiege)

	p1Fleet := core.SpaceRuntime().PlayerSystem("p1", systemID).Fleets["fleet-p1-t118"]
	if p1Fleet == nil {
		t.Fatal("expected p1 fleet runtime")
	}
	p1Fleet.Sustainment.Current = model.WarSupplyStock{}

	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CommandType("blockade_planet"),
		Payload: map[string]any{
			"task_force_id": "tf-blockade-t118",
			"planet_id":     ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blockade_planet failed: %s (%s)", res.Code, res.Message)
	}

	core.processTick()

	if p1Fleet.Sustainment.Current.Fuel != 0 || p1Fleet.Sustainment.Current.Ammo != 0 {
		t.Fatalf("expected blockade to prevent offworld resupply, got %+v", p1Fleet.Sustainment.Current)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	systemView, ok := ql.SystemRuntime("p1", systemID, ws.PlanetID, ws, core.SpaceRuntime())
	if !ok {
		t.Fatal("expected system runtime query view")
	}
	systemBody := marshalAnyMap(t, systemView)
	superiority := expectMapField(t, systemBody, "orbital_superiority")
	if superiority["advantage_player_id"] != "p2" {
		t.Fatalf("expected p2 orbital superiority, got %+v", superiority)
	}
	blockade := firstListEntryMap(t, systemBody, "planet_blockades")
	if blockade["status"] != "active" {
		t.Fatalf("expected active blockade, got %+v", blockade)
	}
	if blockade["interdicted_supply"].(float64) < 1 {
		t.Fatalf("expected blockade to record interdicted supply, got %+v", blockade)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("landing_start"),
		Payload: map[string]any{
			"operation_id":  "landing-fail-t118",
			"task_force_id": "tf-landing-t118",
			"planet_id":     ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("landing_start failed: %s (%s)", res.Code, res.Message)
	}

	core.processTick()

	systemView, ok = ql.SystemRuntime("p1", systemID, ws.PlanetID, ws, core.SpaceRuntime())
	if !ok {
		t.Fatal("expected system runtime query view after landing failure")
	}
	systemBody = marshalAnyMap(t, systemView)
	landing := findOperationByID(t, systemBody, "landing_operations", "landing-fail-t118")
	if landing["result"] != "failed" {
		t.Fatalf("expected failed landing result, got %+v", landing)
	}
	if landing["blocked_reason"] != "insufficient_orbital_superiority" {
		t.Fatalf("expected superiority failure reason, got %+v", landing)
	}
	blockade = firstListEntryMap(t, systemBody, "planet_blockades")
	if blockade["interdicted_landings"].(float64) < 1 {
		t.Fatalf("expected blockade to record interdicted landing, got %+v", blockade)
	}
}

func TestT118LandingOperationEstablishesBeachheadAfterBlockadeBreaks(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID

	grantTechs(ws, "p1", "corvette")
	grantTechs(ws, "p2", "corvette")

	p1Base := operationalWarHubForT118(ws, "hub-p1-success-t118", "p1", model.Position{X: 6, Y: 6})
	p2Base := operationalWarHubForT118(ws, "hub-p2-success-t118", "p2", model.Position{X: 18, Y: 18})

	p1Base.Storage.EnsureInventory()[model.ItemAmmoBullet] = 50
	p1Base.Storage.EnsureInventory()[model.ItemHydrogenFuelRod] = 30
	p1Base.Storage.EnsureInventory()[model.ItemGear] = 20
	p1Base.Storage.EnsureInventory()[model.ItemPhotonCombiner] = 12
	p1Base.Storage.EnsureInventory()[model.ItemPrecisionDrone] = 8

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[p1Base.ID] = &model.WarDeploymentHubState{
		BuildingID:    p1Base.ID,
		Capacity:      16,
		ReadyPayloads: map[string]int{"corvette": 1},
	}
	ws.Players["p2"].EnsureWarIndustry().DeploymentHubs[p2Base.ID] = &model.WarDeploymentHubState{
		BuildingID:    p2Base.ID,
		Capacity:      16,
		ReadyPayloads: map[string]int{"corvette": 2},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p1Base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-p1-success-t118",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p1 fleet failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p2Base.ID,
			"blueprint_id": "corvette",
			"count":        2,
			"system_id":    systemID,
			"fleet_id":     "fleet-p2-success-t118",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p2 fleet failed: %s (%s)", res.Code, res.Message)
	}

	createTaskForceForT118(t, core, "p1", "tf-landing-success-t118", "fleet-p1-success-t118", systemID, ws.PlanetID, model.WarTaskForceStanceEscort)
	createTaskForceForT118(t, core, "p2", "tf-blockade-success-t118", "fleet-p2-success-t118", systemID, ws.PlanetID, model.WarTaskForceStanceSiege)

	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CommandType("blockade_planet"),
		Payload: map[string]any{
			"task_force_id": "tf-blockade-success-t118",
			"planet_id":     ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blockade_planet failed: %s (%s)", res.Code, res.Message)
	}
	core.processTick()

	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CmdFleetDisband,
		Payload: map[string]any{
			"fleet_id": "fleet-p2-success-t118",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("fleet_disband failed: %s (%s)", res.Code, res.Message)
	}
	core.processTick()

	p1Fleet := core.SpaceRuntime().PlayerSystem("p1", systemID).Fleets["fleet-p1-success-t118"]
	if p1Fleet == nil {
		t.Fatal("expected p1 fleet runtime")
	}
	if p1Fleet.Sustainment.Current.Fuel == 0 {
		t.Fatalf("expected p1 fleet to resupply once blockade breaks, got %+v", p1Fleet.Sustainment.Current)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("landing_start"),
		Payload: map[string]any{
			"operation_id":  "landing-success-t118",
			"task_force_id": "tf-landing-success-t118",
			"planet_id":     ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("landing_start failed: %s (%s)", res.Code, res.Message)
	}

	for i := 0; i < 4; i++ {
		core.processTick()
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	systemView, ok := ql.SystemRuntime("p1", systemID, ws.PlanetID, ws, core.SpaceRuntime())
	if !ok {
		t.Fatal("expected system runtime query view")
	}
	systemBody := marshalAnyMap(t, systemView)
	superiority := expectMapField(t, systemBody, "orbital_superiority")
	if superiority["advantage_player_id"] != "p1" {
		t.Fatalf("expected p1 orbital superiority after blockade breaks, got %+v", superiority)
	}
	blockade := firstListEntryMap(t, systemBody, "planet_blockades")
	if blockade["status"] != "broken" {
		t.Fatalf("expected broken blockade after fleet disband, got %+v", blockade)
	}
	landing := findOperationByID(t, systemBody, "landing_operations", "landing-success-t118")
	if landing["result"] != "success" {
		t.Fatalf("expected successful landing result, got %+v", landing)
	}
	if landing["stage"] != "beachhead_established" {
		t.Fatalf("expected beachhead stage, got %+v", landing)
	}
	if landing["bridgehead_id"] == "" {
		t.Fatalf("expected bridgehead id, got %+v", landing)
	}
	combatBody := marshalAnyMap(t, ws.CombatRuntime)
	bridgeheads, ok := combatBody["bridgeheads"].(map[string]any)
	if !ok || len(bridgeheads) != 1 {
		t.Fatalf("expected one planetary bridgehead, got %+v", combatBody["bridgeheads"])
	}
}

func operationalWarHubForT118(ws *model.WorldState, buildingID, ownerID string, pos model.Position) *model.Building {
	hub := newBuilding(buildingID, model.BuildingTypeBattlefieldAnalysisBase, ownerID, pos)
	hub.Runtime.State = model.BuildingWorkRunning
	hub.Runtime.Params.EnergyConsume = 0
	if hub.Runtime.Functions.Energy != nil {
		hub.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, hub)

	power := newBuilding(buildingID+"-power", model.BuildingTypeWindTurbine, ownerID, model.Position{X: pos.X - 1, Y: pos.Y})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)
	return hub
}

func createTaskForceForT118(
	t *testing.T,
	core *GameCore,
	playerID, taskForceID, fleetID, systemID, planetID string,
	stance model.WarTaskForceStance,
) {
	t.Helper()

	if res := issueInternalCommand(core, playerID, model.Command{
		Type: model.CmdTaskForceCreate,
		Payload: map[string]any{
			"task_force_id": taskForceID,
			"stance":        string(stance),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_create failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, playerID, model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": taskForceID,
			"member_kind":   string(model.WarTaskForceMemberKindFleet),
			"member_ids":    []string{fleetID},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, playerID, model.Command{
		Type: model.CmdTaskForceDeploy,
		Payload: map[string]any{
			"task_force_id": taskForceID,
			"system_id":     systemID,
			"planet_id":     planetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_deploy failed: %s (%s)", res.Code, res.Message)
	}
}

func expectMapField(t *testing.T, body map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := body[key]
	if !ok || value == nil {
		t.Fatalf("expected field %q in %+v", key, body)
	}
	out, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected field %q to be object, got %T", key, value)
	}
	return out
}

func firstListEntryMap(t *testing.T, body map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := body[key]
	if !ok {
		t.Fatalf("expected field %q in %+v", key, body)
	}
	list, ok := value.([]any)
	if !ok || len(list) == 0 {
		t.Fatalf("expected non-empty list %q, got %+v", key, value)
	}
	entry, ok := list[0].(map[string]any)
	if !ok {
		t.Fatalf("expected first %q entry to be object, got %T", key, list[0])
	}
	return entry
}

func findOperationByID(t *testing.T, body map[string]any, key, operationID string) map[string]any {
	t.Helper()
	value, ok := body[key]
	if !ok {
		t.Fatalf("expected field %q in %+v", key, body)
	}
	list, ok := value.([]any)
	if !ok {
		t.Fatalf("expected list field %q, got %T", key, value)
	}
	for _, entry := range list {
		obj, ok := entry.(map[string]any)
		if ok && obj["id"] == operationID {
			return obj
		}
	}
	t.Fatalf("expected operation %q in %+v", operationID, value)
	return nil
}
