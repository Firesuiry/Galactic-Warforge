package gamecore

import (
	"sort"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT119PlanetaryFrontlineCaptureAndRuntimeQuery(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID

	grantTechs(ws, "p1", "prototype", "precision_drone", "corvette")
	grantTechs(ws, "p2", "prototype", "corvette")

	p1Base := operationalWarHubForT118(ws, "hub-p1-t119", "p1", model.Position{X: 6, Y: 6})
	p2Base := operationalWarHubForT118(ws, "hub-p2-t119", "p2", model.Position{X: 18, Y: 18})

	loadBuildingItems(t, p1Base, map[string]int{
		model.ItemAmmoBullet:      50,
		model.ItemAmmoMissile:     20,
		model.ItemHydrogenFuelRod: 30,
		model.ItemGear:            20,
		model.ItemPhotonCombiner:  12,
		model.ItemPrecisionDrone:  8,
	})
	loadBuildingItems(t, p2Base, map[string]int{
		model.ItemAmmoBullet:      30,
		model.ItemAmmoMissile:     12,
		model.ItemHydrogenFuelRod: 18,
		model.ItemGear:            12,
		model.ItemPhotonCombiner:  8,
	})

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[p1Base.ID] = &model.WarDeploymentHubState{
		BuildingID: p1Base.ID,
		Capacity:   24,
		ReadyPayloads: map[string]int{
			model.ItemPrototype:      1,
			model.ItemPrecisionDrone: 1,
			model.ItemCorvette:       2,
		},
	}
	ws.Players["p2"].EnsureWarIndustry().DeploymentHubs[p2Base.ID] = &model.WarDeploymentHubState{
		BuildingID: p2Base.ID,
		Capacity:   24,
		ReadyPayloads: map[string]int{
			model.ItemPrototype: 1,
			model.ItemCorvette:  1,
		},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  p1Base.ID,
			"blueprint_id": model.ItemPrototype,
			"count":        1,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy p1 mech squad failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  p1Base.ID,
			"blueprint_id": model.ItemPrecisionDrone,
			"count":        1,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy p1 drone squad failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  p2Base.ID,
			"blueprint_id": model.ItemPrototype,
			"count":        1,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy p2 squad failed: %s (%s)", res.Code, res.Message)
	}

	p1Squads := ownerSquadIDs(ws, "p1")
	p2Squads := ownerSquadIDs(ws, "p2")
	if len(p1Squads) != 2 || len(p2Squads) != 1 {
		t.Fatalf("expected p1=2 p2=1 squads, got p1=%v p2=%v", p1Squads, p2Squads)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p1Base.ID,
			"blueprint_id": model.ItemCorvette,
			"count":        2,
			"system_id":    systemID,
			"fleet_id":     "fleet-p1-t119",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p1 fleet failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p2Base.ID,
			"blueprint_id": model.ItemCorvette,
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-p2-t119",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p2 fleet failed: %s (%s)", res.Code, res.Message)
	}

	createTaskForceForT118(t, core, "p1", "tf-orbit-p1-t119", "fleet-p1-t119", systemID, ws.PlanetID, model.WarTaskForceStanceEscort)
	createTaskForceForT118(t, core, "p2", "tf-orbit-p2-t119", "fleet-p2-t119", systemID, ws.PlanetID, model.WarTaskForceStanceSiege)

	createGroundTaskForceForT119(t, core, "p1", "tf-ground-p1-t119", p1Squads, model.WarTaskForceStanceSiege)
	createGroundTaskForceForT119(t, core, "p2", "tf-ground-p2-t119", p2Squads, model.WarTaskForceStanceHold)

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdLandingStart,
		Payload: map[string]any{
			"operation_id":  "landing-p1-t119",
			"task_force_id": "tf-orbit-p1-t119",
			"planet_id":     ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("landing_start failed: %s (%s)", res.Code, res.Message)
	}

	for i := 0; i < 4; i++ {
		core.processTick()
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	planetView, ok := ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	planetBody := marshalAnyMap(t, mustValue(t, planetView, ok))

	bridgeheads, ok := planetBody["bridgeheads"].([]any)
	if !ok || len(bridgeheads) != 1 {
		t.Fatalf("expected one bridgehead in planet runtime, got %+v", planetBody["bridgeheads"])
	}
	bridgehead := bridgeheads[0].(map[string]any)
	frontlineID, ok := bridgehead["frontline_id"].(string)
	if !ok || frontlineID == "" {
		t.Fatalf("expected bridgehead frontline link, got %+v", bridgehead)
	}
	initialExpansion, ok := bridgehead["expansion_level"].(float64)
	if !ok || initialExpansion <= 0 {
		t.Fatalf("expected bridgehead expansion level in query, got %+v", bridgehead)
	}

	squads, ok := planetBody["combat_squads"].([]any)
	if !ok || len(squads) < 2 {
		t.Fatalf("expected visible combat squads, got %+v", planetBody["combat_squads"])
	}
	classes := map[string]bool{}
	for _, raw := range squads {
		squad := raw.(map[string]any)
		if class, ok := squad["platform_class"].(string); ok {
			classes[class] = true
		}
	}
	if !classes["mech"] || !classes["drone"] {
		t.Fatalf("expected mech and drone platform classes in planet runtime, got %+v", classes)
	}

	for _, spec := range []struct {
		playerID    string
		taskForceID string
		order       string
		supportMode string
	}{
		{playerID: "p1", taskForceID: "tf-ground-p1-t119", order: "occupy", supportMode: "fire_support"},
		{playerID: "p2", taskForceID: "tf-ground-p2-t119", order: "hold", supportMode: "none"},
	} {
		if res := issueInternalCommand(core, spec.playerID, model.Command{
			Type: model.CmdTaskForceDeploy,
			Payload: map[string]any{
				"task_force_id": spec.taskForceID,
				"system_id":     systemID,
				"planet_id":     ws.PlanetID,
				"frontline_id":  frontlineID,
				"ground_order":  spec.order,
				"support_mode":  spec.supportMode,
			},
		}); res.Code != model.CodeOK {
			t.Fatalf("task_force_deploy %s failed: %s (%s)", spec.taskForceID, res.Code, res.Message)
		}
	}

	core.processTick()

	planetView, ok = ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	planetBody = marshalAnyMap(t, mustValue(t, planetView, ok))

	frontline := findPlanetFrontlineByID(t, planetBody, frontlineID)
	if frontline["status"] != "contested" {
		t.Fatalf("expected contested frontline after both sides commit, got %+v", frontline)
	}

	p1TaskForce := findPlanetGroundTaskForceByID(t, planetBody, "tf-ground-p1-t119")
	if p1TaskForce["ground_order"] != "occupy" {
		t.Fatalf("expected occupy order in planet runtime, got %+v", p1TaskForce)
	}
	if _, ok := p1TaskForce["orbital_support_cooldown"].(float64); !ok {
		t.Fatalf("expected orbital support cooldown in planet runtime, got %+v", p1TaskForce)
	}

	for i := 0; i < 4; i++ {
		core.processTick()
	}

	planetView, ok = ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	planetBody = marshalAnyMap(t, mustValue(t, planetView, ok))

	frontline = findPlanetFrontlineByID(t, planetBody, frontlineID)
	if frontline["owner_id"] != "p1" {
		t.Fatalf("expected frontline to flip to p1, got %+v", frontline)
	}
	control, ok := frontline["control"].(float64)
	if !ok || control <= 0.5 {
		t.Fatalf("expected frontline control progress, got %+v", frontline)
	}

	bridgehead = findPlanetBridgeheadByID(t, planetBody, bridgehead["id"].(string))
	expansion, ok := bridgehead["expansion_level"].(float64)
	if !ok || expansion <= initialExpansion {
		t.Fatalf("expected bridgehead expansion to increase, before=%f after=%+v", initialExpansion, bridgehead)
	}
}

func TestT119PlanetaryDefenseBlocksOrbitalSupport(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID

	grantTechs(ws, "p1", "prototype", "corvette")
	grantTechs(ws, "p2", "prototype", "corvette", "planetary_shield", "plasma_turret")

	p1Base := operationalWarHubForT118(ws, "hub-p1-defense-t119", "p1", model.Position{X: 6, Y: 6})
	p2Base := operationalWarHubForT118(ws, "hub-p2-defense-t119", "p2", model.Position{X: 18, Y: 18})

	loadBuildingItems(t, p1Base, map[string]int{
		model.ItemAmmoBullet:      40,
		model.ItemHydrogenFuelRod: 24,
		model.ItemGear:            16,
		model.ItemPhotonCombiner:  8,
	})
	loadBuildingItems(t, p2Base, map[string]int{
		model.ItemAmmoBullet:      30,
		model.ItemHydrogenFuelRod: 24,
		model.ItemGear:            16,
		model.ItemPhotonCombiner:  8,
	})

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[p1Base.ID] = &model.WarDeploymentHubState{
		BuildingID: p1Base.ID,
		Capacity:   16,
		ReadyPayloads: map[string]int{
			model.ItemPrototype: 1,
			model.ItemCorvette:  2,
		},
	}
	ws.Players["p2"].EnsureWarIndustry().DeploymentHubs[p2Base.ID] = &model.WarDeploymentHubState{
		BuildingID: p2Base.ID,
		Capacity:   16,
		ReadyPayloads: map[string]int{
			model.ItemCorvette: 1,
		},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  p1Base.ID,
			"blueprint_id": model.ItemPrototype,
			"count":        1,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy p1 squad failed: %s (%s)", res.Code, res.Message)
	}

	p1Squads := ownerSquadIDs(ws, "p1")
	if len(p1Squads) != 1 {
		t.Fatalf("expected one p1 squad, got %v", p1Squads)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p1Base.ID,
			"blueprint_id": model.ItemCorvette,
			"count":        2,
			"system_id":    systemID,
			"fleet_id":     "fleet-p1-defense-t119",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p1 fleet failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p2", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p2Base.ID,
			"blueprint_id": model.ItemCorvette,
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-p2-defense-t119",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission p2 fleet failed: %s (%s)", res.Code, res.Message)
	}

	createTaskForceForT118(t, core, "p1", "tf-orbit-p1-defense-t119", "fleet-p1-defense-t119", systemID, ws.PlanetID, model.WarTaskForceStanceEscort)
	createTaskForceForT118(t, core, "p2", "tf-orbit-p2-defense-t119", "fleet-p2-defense-t119", systemID, ws.PlanetID, model.WarTaskForceStanceSiege)
	createGroundTaskForceForT119(t, core, "p1", "tf-ground-p1-defense-t119", p1Squads, model.WarTaskForceStanceSiege)

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdLandingStart,
		Payload: map[string]any{
			"operation_id":  "landing-defense-t119",
			"task_force_id": "tf-orbit-p1-defense-t119",
			"planet_id":     ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("landing_start failed: %s (%s)", res.Code, res.Message)
	}
	for i := 0; i < 4; i++ {
		core.processTick()
	}

	shield := newBuilding("shield-t119", model.BuildingTypePlanetaryShieldGenerator, "p2", model.Position{X: 17, Y: 17})
	shield.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, shield)
	if shield.Runtime.Functions.Shield == nil {
		t.Fatalf("expected shield module on %s", shield.ID)
	}
	shield.Runtime.Functions.Shield.CurrentCharge = shield.Runtime.Functions.Shield.Capacity

	missile := newBuilding("missile-t119", model.BuildingTypeMissileTurret, "p2", model.Position{X: 16, Y: 17})
	missile.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, missile)

	jammer := newBuilding("jammer-t119", model.BuildingTypeJammerTower, "p2", model.Position{X: 16, Y: 18})
	jammer.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, jammer)

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	planetView, ok := ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	planetBody := marshalAnyMap(t, mustValue(t, planetView, ok))
	bridgehead := firstPlanetBridgehead(t, planetBody)
	frontlineID, ok := bridgehead["frontline_id"].(string)
	if !ok || frontlineID == "" {
		t.Fatalf("expected frontline id on bridgehead, got %+v", bridgehead)
	}

	beforeCharge := shield.Runtime.Functions.Shield.CurrentCharge
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceDeploy,
		Payload: map[string]any{
			"task_force_id": "tf-ground-p1-defense-t119",
			"system_id":     systemID,
			"planet_id":     ws.PlanetID,
			"frontline_id":  frontlineID,
			"ground_order":  "advance",
			"support_mode":  "fire_support",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_deploy failed: %s (%s)", res.Code, res.Message)
	}

	core.processTick()

	planetView, ok = ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	planetBody = marshalAnyMap(t, mustValue(t, planetView, ok))
	p1TaskForce := findPlanetGroundTaskForceByID(t, planetBody, "tf-ground-p1-defense-t119")
	if blocked, ok := p1TaskForce["orbital_support_blocked_reason"].(string); !ok || blocked == "" {
		t.Fatalf("expected blocked orbital support reason, got %+v", p1TaskForce)
	}
	if cooldown, ok := p1TaskForce["orbital_support_cooldown"].(float64); !ok || cooldown != 0 {
		t.Fatalf("expected blocked orbital support to keep zero cooldown, got %+v", p1TaskForce)
	}
	if shield.Runtime.Functions.Shield.CurrentCharge >= beforeCharge {
		t.Fatalf("expected planetary shield to absorb/support-intercept some pressure, before=%d after=%d", beforeCharge, shield.Runtime.Functions.Shield.CurrentCharge)
	}

	frontline := findPlanetFrontlineByID(t, planetBody, frontlineID)
	if _, ok := frontline["last_orbital_support_tick"].(float64); ok {
		t.Fatalf("expected blocked support to avoid frontline support tick, got %+v", frontline)
	}
}

func createGroundTaskForceForT119(
	t *testing.T,
	core *GameCore,
	playerID, taskForceID string,
	squadIDs []string,
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
		t.Fatalf("task_force_create %s failed: %s (%s)", taskForceID, res.Code, res.Message)
	}
	if res := issueInternalCommand(core, playerID, model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": taskForceID,
			"member_kind":   string(model.WarTaskForceMemberKindSquad),
			"member_ids":    squadIDs,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign %s failed: %s (%s)", taskForceID, res.Code, res.Message)
	}
}

func ownerSquadIDs(ws *model.WorldState, ownerID string) []string {
	if ws == nil || ws.CombatRuntime == nil {
		return nil
	}
	ids := make([]string, 0)
	for id, squad := range ws.CombatRuntime.Squads {
		if squad != nil && squad.OwnerID == ownerID {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func firstPlanetBridgehead(t *testing.T, planetBody map[string]any) map[string]any {
	t.Helper()
	raw, ok := planetBody["bridgeheads"].([]any)
	if !ok || len(raw) == 0 {
		t.Fatalf("expected bridgeheads in planet runtime, got %+v", planetBody)
	}
	bridgehead, ok := raw[0].(map[string]any)
	if !ok {
		t.Fatalf("expected first bridgehead to be object, got %T", raw[0])
	}
	return bridgehead
}

func findPlanetBridgeheadByID(t *testing.T, planetBody map[string]any, bridgeheadID string) map[string]any {
	t.Helper()
	raw, ok := planetBody["bridgeheads"].([]any)
	if !ok {
		t.Fatalf("expected bridgeheads in planet runtime, got %+v", planetBody)
	}
	for _, entry := range raw {
		bridgehead, ok := entry.(map[string]any)
		if ok && bridgehead["id"] == bridgeheadID {
			return bridgehead
		}
	}
	t.Fatalf("expected bridgehead %s in %+v", bridgeheadID, raw)
	return nil
}

func findPlanetFrontlineByID(t *testing.T, planetBody map[string]any, frontlineID string) map[string]any {
	t.Helper()
	raw, ok := planetBody["frontlines"].([]any)
	if !ok {
		t.Fatalf("expected frontlines in planet runtime, got %+v", planetBody)
	}
	for _, entry := range raw {
		frontline, ok := entry.(map[string]any)
		if ok && frontline["id"] == frontlineID {
			return frontline
		}
	}
	t.Fatalf("expected frontline %s in %+v", frontlineID, raw)
	return nil
}

func findPlanetGroundTaskForceByID(t *testing.T, planetBody map[string]any, taskForceID string) map[string]any {
	t.Helper()
	raw, ok := planetBody["ground_task_forces"].([]any)
	if !ok {
		t.Fatalf("expected ground task forces in planet runtime, got %+v", planetBody)
	}
	for _, entry := range raw {
		taskForce, ok := entry.(map[string]any)
		if ok && taskForce["task_force_id"] == taskForceID {
			return taskForce
		}
	}
	t.Fatalf("expected ground task force %s in %+v", taskForceID, raw)
	return nil
}
