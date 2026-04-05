package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT096OfficialMidgameRayReceiverPowerUsesSingleAuthoritativeTick(t *testing.T) {
	ClearSolarSailOrbits()
	ClearDysonSphereStates()
	t.Cleanup(func() {
		ClearSolarSailOrbits()
		ClearDysonSphereStates()
	})

	core := newOfficialMidgameTestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}
	if exec := player.ExecutorForPlanet(ws.PlanetID); exec != nil {
		exec.OperateRange = 100
	}
	player.SyncLegacyExecutor(ws.PlanetID)

	wind := newBuilding("wind-t096", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	wind.Runtime.State = model.BuildingWorkRunning

	receiver := newBuilding("receiver-t096", model.BuildingTypeRayReceiver, "p1", model.Position{X: 6, Y: 6})
	receiver.Runtime.State = model.BuildingWorkRunning
	receiver.Storage.EnsureInventory()[model.ItemCriticalPhoton] = 3

	ejector := newEMRailEjectorBuilding("ejector-t096", model.Position{X: 7, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning

	silo := newVerticalLaunchingSiloBuilding("silo-t096", model.Position{X: 8, Y: 6}, "p1")
	silo.Runtime.State = model.BuildingWorkRunning

	for _, building := range []*model.Building{wind, receiver, ejector, silo} {
		placeBuilding(ws, building)
		model.RegisterPowerGridBuilding(ws, building)
	}

	modeRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdSetRayReceiverMode,
		Payload: map[string]any{
			"building_id": receiver.ID,
			"mode":        string(model.RayReceiverModePower),
		},
	})
	if modeRes.Code != model.CodeOK {
		t.Fatalf("set ray receiver mode: %s (%s)", modeRes.Code, modeRes.Message)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())

	core.processTick()

	baselineSummary := ql.Summary(ws, "p1", core.Victory())
	baselineStats := ql.Stats(ws, "p1")
	baselineNetworks, ok := ql.PlanetNetworks(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected baseline networks view")
	}

	baselineEnergy := baselineSummary.Players["p1"].Resources.Energy
	baselineGeneration := baselineStats.EnergyStats.Generation
	baselineSupply := totalPowerNetworkSupply(baselineNetworks)
	baselinePhotons := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton)

	buildNodeRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBuildDysonNode,
		Payload: map[string]any{
			"system_id":    "sys-1",
			"layer_index":  float64(0),
			"latitude":     float64(10),
			"longitude":    float64(20),
			"orbit_radius": 1.2,
		},
	})
	if buildNodeRes.Code != model.CodeOK {
		t.Fatalf("build dyson node: %s (%s)", buildNodeRes.Code, buildNodeRes.Message)
	}

	transferSailRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": ejector.ID,
			"item_id":     model.ItemSolarSail,
			"quantity":    float64(2),
		},
	})
	if transferSailRes.Code != model.CodeOK {
		t.Fatalf("transfer solar sail: %s (%s)", transferSailRes.Code, transferSailRes.Message)
	}

	transferRocketRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": silo.ID,
			"item_id":     model.ItemSmallCarrierRocket,
			"quantity":    float64(1),
		},
	})
	if transferRocketRes.Code != model.CodeOK {
		t.Fatalf("transfer rocket: %s (%s)", transferRocketRes.Code, transferRocketRes.Message)
	}

	launchSailRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdLaunchSolarSail,
		Payload: map[string]any{
			"building_id":  ejector.ID,
			"count":        float64(1),
			"orbit_radius": 1.2,
			"inclination":  float64(5),
		},
	})
	if launchSailRes.Code != model.CodeOK {
		t.Fatalf("launch solar sail: %s (%s)", launchSailRes.Code, launchSailRes.Message)
	}

	launchRocketRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdLaunchRocket,
		Payload: map[string]any{
			"building_id": silo.ID,
			"system_id":   "sys-1",
			"layer_index": float64(0),
			"count":       float64(1),
		},
	})
	if launchRocketRes.Code != model.CodeOK {
		t.Fatalf("launch rocket: %s (%s)", launchRocketRes.Code, launchRocketRes.Message)
	}

	core.processTick()

	postSummary := ql.Summary(ws, "p1", core.Victory())
	postStats := ql.Stats(ws, "p1")
	postNetworks, ok := ql.PlanetNetworks(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected post-dyson networks view")
	}
	inspectView, ok := ql.PlanetInspect(ws, "p1", ws.PlanetID, query.PlanetInspectRequest{
		TargetType: "building",
		TargetID:   receiver.ID,
	})
	if !ok {
		t.Fatal("expected inspect view for receiver")
	}

	postEnergy := postSummary.Players["p1"].Resources.Energy
	postGeneration := postStats.EnergyStats.Generation
	postSupply := totalPowerNetworkSupply(postNetworks)
	postPhotons := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton)

	if postEnergy < baselineEnergy {
		t.Fatalf("expected summary energy to stay non-decreasing, baseline=%d post=%d", baselineEnergy, postEnergy)
	}
	if postGeneration <= baselineGeneration {
		t.Fatalf("expected stats generation to increase, baseline=%d post=%d", baselineGeneration, postGeneration)
	}
	if postSupply <= baselineSupply {
		t.Fatalf("expected network supply to increase, baseline=%d post=%d", baselineSupply, postSupply)
	}
	if postPhotons != baselinePhotons {
		t.Fatalf("expected power mode to preserve existing photon stock, baseline=%d post=%d", baselinePhotons, postPhotons)
	}

	inspectPayload := inspectViewAsMap(t, inspectView)
	powerPayload, ok := inspectPayload["power"].(map[string]any)
	if !ok {
		t.Fatalf("expected inspect payload to expose power settlement view, got %+v", inspectPayload)
	}
	if value := floatFromAny(powerPayload["power_output"]); value <= 0 {
		t.Fatalf("expected inspect power_output > 0, got %+v", powerPayload)
	}
	if value := floatFromAny(powerPayload["photon_output"]); value != 0 {
		t.Fatalf("expected inspect photon_output == 0 in power mode, got %+v", powerPayload)
	}
	if networkID, _ := powerPayload["network_id"].(string); networkID == "" {
		t.Fatalf("expected inspect power.network_id, got %+v", powerPayload)
	}
	if settledTick := int64(floatFromAny(powerPayload["settled_tick"])); settledTick != ws.Tick {
		t.Fatalf("expected settled_tick %d, got %+v", ws.Tick, powerPayload)
	}

	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtResourceChanged}, "", ws.Tick, 50)
	playerEnergyEvents := 0
	lastEnergy := baselineSummary.Players["p1"].Resources.Energy
	finalEnergy := postSummary.Players["p1"].Resources.Energy
	for _, evt := range events {
		if evt == nil {
			continue
		}
		if evt.Tick != ws.Tick {
			continue
		}
		if evt.VisibilityScope != "p1" {
			continue
		}
		rawEnergy, ok := evt.Payload["energy"]
		if !ok {
			continue
		}
		energy := int(floatFromAny(rawEnergy))
		if energy == lastEnergy {
			continue
		}
		if energy == finalEnergy {
			playerEnergyEvents++
		}
		lastEnergy = energy
	}
	expectedEnergyEvents := 0
	if finalEnergy != baselineEnergy {
		expectedEnergyEvents = 1
	}
	if playerEnergyEvents != expectedEnergyEvents {
		t.Fatalf("expected %d energy-changing resource_changed events reaching active planet final energy %d in tick %d, got %d", expectedEnergyEvents, finalEnergy, ws.Tick, playerEnergyEvents)
	}
}

func inspectViewAsMap(t *testing.T, view *query.PlanetInspectView) map[string]any {
	t.Helper()

	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("marshal inspect view: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal inspect view: %v", err)
	}
	return payload
}

func floatFromAny(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case int32:
		return float64(typed)
	default:
		return 0
	}
}
