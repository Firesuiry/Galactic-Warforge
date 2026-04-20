package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/snapshot"
	"siliconworld/internal/visibility"
)

const (
	cmdQueueMilitaryProduction = model.CommandType("queue_military_production")
	cmdRefitUnit               = model.CommandType("refit_unit")
)

func TestT113MilitaryProductionLineTracksSeriesBonusAndRetoolCost(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	ws.Players["p1"].SetPermissions([]string{"*"})
	grantTechs(ws, "p1", "prototype", "precision_drone", "corvette", "destroyer")

	base := newBuilding("base-t113-line", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	stockMilitaryMaterials(base.Storage.EnsureInventory())
	placeBuilding(ws, base)

	power := newBuilding("power-t113-line", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, power)

	createFinalizedBlueprint(t, core, "p1", "bp-ground-line", "Ground Line", "light_frame", map[string]string{
		"power":          "compact_reactor",
		"mobility":       "servo_actuator_pack",
		"defense":        "composite_armor_plating",
		"sensor":         "battlefield_sensor_suite",
		"primary_weapon": "pulse_laser_mount",
		"utility":        "command_uplink",
	})

	for _, blueprintID := range []string{"bp-ground-line", "bp-ground-line", model.ItemPrecisionDrone} {
		res := issueInternalCommand(core, "p1", model.Command{
			Type: cmdQueueMilitaryProduction,
			Payload: map[string]any{
				"building_id":   base.ID,
				"blueprint_id":  blueprintID,
				"count":         1,
			},
		})
		if res.Code != model.CodeOK {
			t.Fatalf("queue production %s failed: %s (%s)", blueprintID, res.Code, res.Message)
		}
	}

	runtimeView := planetRuntimeMap(t, core, ws)
	hub := deploymentHubByID(t, runtimeView, base.ID)
	queue := arrayField(t, hub, "production_queue")
	if len(queue) != 3 {
		t.Fatalf("expected three production orders, got %+v", queue)
	}

	first := objectItem(t, queue[0], "first order")
	second := objectItem(t, queue[1], "second order")
	third := objectItem(t, queue[2], "third order")

	if stringField(t, first, "blueprint_id") != "bp-ground-line" {
		t.Fatalf("unexpected first production order: %+v", first)
	}
	if numberField(t, second, "series_bonus_ratio") <= 0 {
		t.Fatalf("expected same-blueprint follow-up order to gain a series bonus, got %+v", second)
	}
	if numberField(t, third, "retool_ticks_total") <= 0 {
		t.Fatalf("expected switched blueprint order to carry retool cost, got %+v", third)
	}
}

func TestT113MilitaryProductionDeployAndRefitClosure(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	ws.Players["p1"].SetPermissions([]string{"*"})
	grantTechs(ws, "p1", "prototype", "precision_drone", "corvette", "destroyer")

	base := newBuilding("base-t113-closure", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	stockMilitaryMaterials(base.Storage.EnsureInventory())
	placeBuilding(ws, base)

	power := newBuilding("power-t113-closure", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, power)

	createFinalizedBlueprint(t, core, "p1", "bp-ground-refit", "Ground Refit", "light_frame", map[string]string{
		"power":          "compact_reactor",
		"mobility":       "servo_actuator_pack",
		"defense":        "composite_armor_plating",
		"sensor":         "battlefield_sensor_suite",
		"primary_weapon": "pulse_laser_mount",
		"utility":        "command_uplink",
	})

	queueRes := issueInternalCommand(core, "p1", model.Command{
		Type: cmdQueueMilitaryProduction,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "bp-ground-refit",
			"count":        1,
		},
	})
	if queueRes.Code != model.CodeOK {
		t.Fatalf("queue_military_production failed: %s (%s)", queueRes.Code, queueRes.Message)
	}

	if !waitForCondition(600, func() bool {
		hub := deploymentHubByID(t, planetRuntimeMap(t, core, ws), base.ID)
		payloads, ok := hub["payload_inventory"].(map[string]any)
		if !ok {
			return false
		}
		value, ok := payloads["bp-ground-refit"].(float64)
		return ok && value >= 1
	}, func() { core.processTick() }) {
		t.Fatalf("expected production to finish and create deployable payload, got %+v", deploymentHubByID(t, planetRuntimeMap(t, core, ws), base.ID))
	}

	deployRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":   base.ID,
			"blueprint_id":  "bp-ground-refit",
			"count":         1,
			"planet_id":     ws.PlanetID,
		},
	})
	if deployRes.Code != model.CodeOK {
		t.Fatalf("deploy_squad with blueprint_id failed: %s (%s)", deployRes.Code, deployRes.Message)
	}
	if ws.CombatRuntime == nil || len(ws.CombatRuntime.Squads) != 1 {
		t.Fatalf("expected one deployed combat squad, got %+v", ws.CombatRuntime)
	}

	planetView := planetRuntimeMap(t, core, ws)
	squads := arrayField(t, planetView, "combat_squads")
	if len(squads) != 1 {
		t.Fatalf("expected one combat squad in runtime query, got %+v", planetView)
	}
	squadView := objectItem(t, squads[0], "combat squad")
	if stringField(t, squadView, "blueprint_id") != "bp-ground-refit" {
		t.Fatalf("expected deployed squad to expose blueprint_id, got %+v", squadView)
	}

	var squadID string
	for id := range ws.CombatRuntime.Squads {
		squadID = id
	}
	if squadID == "" {
		t.Fatal("expected deployed squad id")
	}

	refitRes := issueInternalCommand(core, "p1", model.Command{
		Type: cmdRefitUnit,
		Payload: map[string]any{
			"building_id":          base.ID,
			"unit_id":              squadID,
			"target_blueprint_id":  model.ItemPrototype,
		},
	})
	if refitRes.Code != model.CodeOK {
		t.Fatalf("refit_unit failed: %s (%s)", refitRes.Code, refitRes.Message)
	}

	runtimeView := planetRuntimeMap(t, core, ws)
	hub := deploymentHubByID(t, runtimeView, base.ID)
	refits := arrayField(t, hub, "refit_queue")
	if len(refits) != 1 {
		t.Fatalf("expected one refit order, got %+v", hub)
	}
	refitView := objectItem(t, refits[0], "refit order")
	if stringField(t, refitView, "target_blueprint_id") != model.ItemPrototype {
		t.Fatalf("expected refit target blueprint to be visible, got %+v", refitView)
	}

	if !waitForCondition(600, func() bool {
		view := planetRuntimeMap(t, core, ws)
		raw, ok := view["combat_squads"]
		if !ok {
			return false
		}
		squads, ok := raw.([]any)
		if !ok {
			return false
		}
		if len(squads) != 1 {
			return false
		}
		squad := objectItem(t, squads[0], "refit result squad")
		return stringField(t, squad, "blueprint_id") == model.ItemPrototype
	}, func() { core.processTick() }) {
		t.Fatalf("expected refit to redeploy squad as target blueprint, got %+v", planetRuntimeMap(t, core, ws))
	}
}

func TestT113MilitarySnapshotPreservesProductionAndBlueprintAssociations(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	ws.Players["p1"].SetPermissions([]string{"*"})
	grantTechs(ws, "p1", "prototype", "precision_drone", "corvette", "destroyer")

	base := newBuilding("base-t113-snapshot", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	stockMilitaryMaterials(base.Storage.EnsureInventory())
	placeBuilding(ws, base)

	power := newBuilding("power-t113-snapshot", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, power)

	createFinalizedBlueprint(t, core, "p1", "bp-ground-snapshot", "Ground Snapshot", "light_frame", map[string]string{
		"power":          "compact_reactor",
		"mobility":       "servo_actuator_pack",
		"defense":        "composite_armor_plating",
		"sensor":         "battlefield_sensor_suite",
		"primary_weapon": "pulse_laser_mount",
		"utility":        "command_uplink",
	})

	queueRes := issueInternalCommand(core, "p1", model.Command{
		Type: cmdQueueMilitaryProduction,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "bp-ground-snapshot",
			"count":        2,
		},
	})
	if queueRes.Code != model.CodeOK {
		t.Fatalf("queue_military_production failed: %s (%s)", queueRes.Code, queueRes.Message)
	}

	for i := 0; i < 5; i++ {
		core.processTick()
	}

	snap := snapshot.CaptureRuntime(core.worldMapSnapshot(), core.ActivePlanetID(), core.Discovery(), core.SpaceRuntime())
	worlds, activePlanetID, _, err := snap.RestoreRuntime()
	if err != nil {
		t.Fatalf("restore runtime: %v", err)
	}
	restoredWorld := worlds[activePlanetID]
	if restoredWorld == nil {
		t.Fatalf("expected restored world for %s", activePlanetID)
	}

	restoredView := planetRuntimeMapWithWorld(t, core, restoredWorld)
	hub := deploymentHubByID(t, restoredView, base.ID)
	queue := arrayField(t, hub, "production_queue")
	if len(queue) == 0 {
		t.Fatalf("expected restored runtime to keep military production queue, got %+v", restoredView)
	}
	firstOrder := objectItem(t, queue[0], "restored order")
	if stringField(t, firstOrder, "blueprint_id") != "bp-ground-snapshot" {
		t.Fatalf("expected restored order blueprint association, got %+v", firstOrder)
	}
}

func createFinalizedBlueprint(
	t *testing.T,
	core *GameCore,
	playerID, blueprintID, name, baseFrameID string,
	assignments map[string]string,
) {
	t.Helper()
	if res := issueInternalCommand(core, playerID, model.Command{
		Type: model.CmdBlueprintCreate,
		Payload: map[string]any{
			"blueprint_id":  blueprintID,
			"name":          name,
			"base_frame_id": baseFrameID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blueprint_create %s failed: %s (%s)", blueprintID, res.Code, res.Message)
	}
	for slotID, componentID := range assignments {
		if res := issueInternalCommand(core, playerID, model.Command{
			Type: model.CmdBlueprintSetComponent,
			Payload: map[string]any{
				"blueprint_id": blueprintID,
				"slot_id":      slotID,
				"component_id": componentID,
			},
		}); res.Code != model.CodeOK {
			t.Fatalf("blueprint_set_component %s/%s failed: %s (%s)", blueprintID, slotID, res.Code, res.Message)
		}
	}
	if res := issueInternalCommand(core, playerID, model.Command{
		Type: model.CmdBlueprintValidate,
		Payload: map[string]any{
			"blueprint_id": blueprintID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blueprint_validate %s failed: %s (%s)", blueprintID, res.Code, res.Message)
	}
	if res := issueInternalCommand(core, playerID, model.Command{
		Type: model.CmdBlueprintFinalize,
		Payload: map[string]any{
			"blueprint_id": blueprintID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blueprint_finalize %s failed: %s (%s)", blueprintID, res.Code, res.Message)
	}
}

func stockMilitaryMaterials(inv model.ItemInventory) {
	for _, itemID := range []string{
		model.ItemIronIngot,
		model.ItemCopperIngot,
		model.ItemGear,
		model.ItemCircuitBoard,
		model.ItemProcessor,
		model.ItemSiliconIngot,
		model.ItemTitaniumIngot,
		model.ItemTitaniumAlloy,
		model.ItemCarbonNanotube,
		model.ItemFrameMaterial,
		model.ItemQuantumChip,
	} {
		inv[itemID] = 500
	}
}

func planetRuntimeMap(t *testing.T, core *GameCore, ws *model.WorldState) map[string]any {
	t.Helper()
	return planetRuntimeMapWithWorld(t, core, ws)
}

func planetRuntimeMapWithWorld(t *testing.T, core *GameCore, ws *model.WorldState) map[string]any {
	t.Helper()
	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	view, ok := ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatalf("planet runtime view missing for %s", ws.PlanetID)
	}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("marshal planet runtime: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode planet runtime: %v", err)
	}
	return out
}

func deploymentHubByID(t *testing.T, runtimeView map[string]any, buildingID string) map[string]any {
	t.Helper()
	hubs := arrayField(t, runtimeView, "deployment_hubs")
	for _, raw := range hubs {
		hub := objectItem(t, raw, "deployment hub")
		if stringField(t, hub, "building_id") == buildingID {
			return hub
		}
	}
	t.Fatalf("expected deployment hub %s, got %+v", buildingID, runtimeView)
	return nil
}

func arrayField(t *testing.T, obj map[string]any, field string) []any {
	t.Helper()
	raw, ok := obj[field]
	if !ok {
		t.Fatalf("expected field %s in %+v", field, obj)
	}
	arr, ok := raw.([]any)
	if !ok {
		t.Fatalf("expected field %s to be an array, got %T", field, raw)
	}
	return arr
}

func objectField(t *testing.T, obj map[string]any, field string) map[string]any {
	t.Helper()
	raw, ok := obj[field]
	if !ok {
		t.Fatalf("expected field %s in %+v", field, obj)
	}
	out, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("expected field %s to be an object, got %T", field, raw)
	}
	return out
}

func objectItem(t *testing.T, raw any, label string) map[string]any {
	t.Helper()
	out, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("expected %s to be an object, got %T", label, raw)
	}
	return out
}

func stringField(t *testing.T, obj map[string]any, field string) string {
	t.Helper()
	raw, ok := obj[field]
	if !ok {
		t.Fatalf("expected string field %s in %+v", field, obj)
	}
	out, ok := raw.(string)
	if !ok {
		t.Fatalf("expected string field %s, got %T", field, raw)
	}
	return out
}

func numberField(t *testing.T, obj map[string]any, field string) float64 {
	t.Helper()
	raw, ok := obj[field]
	if !ok {
		t.Fatalf("expected numeric field %s in %+v", field, obj)
	}
	out, ok := raw.(float64)
	if !ok {
		t.Fatalf("expected numeric field %s, got %T", field, raw)
	}
	return out
}

func waitForCondition(limit int, ok func() bool, step func()) bool {
	for i := 0; i < limit; i++ {
		if ok() {
			return true
		}
		step()
	}
	return ok()
}
