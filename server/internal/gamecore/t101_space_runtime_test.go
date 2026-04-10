package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func TestT101LaunchSolarSailUsesSpaceRuntimeIDsAndSystemScope(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_sail_orbit")

	ejector := newEMRailEjectorBuilding("ejector-t101", model.Position{X: 6, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 2
	attachBuilding(ws, ejector)

	res, events := core.execLaunchSolarSail(ws, "p1", model.Command{
		Type: model.CmdLaunchSolarSail,
		Payload: map[string]any{
			"building_id":  ejector.ID,
			"count":        float64(2),
			"orbit_radius": 1.2,
			"inclination":  5.0,
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("launch solar sail: %s (%s)", res.Code, res.Message)
	}
	if core.spaceRuntime == nil {
		t.Fatal("expected space runtime to be initialized")
	}
	if core.spaceRuntime.EntityCounter != 2 {
		t.Fatalf("expected space entity counter 2, got %d", core.spaceRuntime.EntityCounter)
	}

	orbit := GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1")
	if orbit == nil || len(orbit.Sails) != 2 {
		t.Fatalf("expected 2 sails in sys-1 orbit, got %+v", orbit)
	}

	seen := map[string]bool{}
	for _, sail := range orbit.Sails {
		if seen[sail.ID] {
			t.Fatalf("expected unique sail ids, got duplicate %s", sail.ID)
		}
		seen[sail.ID] = true
	}
	for _, evt := range events {
		entityID, _ := evt.Payload["entity_id"].(string)
		if entityID == "" {
			t.Fatalf("expected entity_created payload to carry entity_id, got %+v", evt.Payload)
		}
		if !seen[entityID] {
			t.Fatalf("expected event entity_id %s to match orbit state %+v", entityID, orbit.Sails)
		}
	}
	if got := GetSolarSailEnergy(core.spaceRuntime, "p1", "sys-2"); got != 0 {
		t.Fatalf("expected no solar sail energy in another system, got %d", got)
	}
}

func TestT101RayReceiverReadsSolarSailEnergyFromCurrentSystemOnly(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()

	receiver := newRayReceiverBuilding("receiver-t101", model.Position{X: 6, Y: 6}, "p1")
	receiver.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, receiver)

	LaunchSolarSail(core.spaceRuntime, "p1", "sys-2", 1.2, 5, 1)
	views := settleRayReceivers(ws, core.Maps(), core.spaceRuntime)
	if got := views[receiver.ID].AvailableDysonEnergy; got != 0 {
		t.Fatalf("expected no cross-system solar sail energy, got %d", got)
	}

	LaunchSolarSail(core.spaceRuntime, "p1", "sys-1", 1.2, 5, 1)
	views = settleRayReceivers(ws, core.Maps(), core.spaceRuntime)
	if got := views[receiver.ID].AvailableDysonEnergy; got == 0 {
		t.Fatalf("expected current-system solar sail energy to be visible, got %d", got)
	}
}

func TestT101SaveRestorePreservesSpaceRuntime(t *testing.T) {
	core := newSaveStateHarness(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_sail_orbit")

	ejector := newEMRailEjectorBuilding("ejector-save-t101", model.Position{X: 6, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 1
	attachBuilding(ws, ejector)

	res, _ := core.execLaunchSolarSail(ws, "p1", model.Command{
		Type: model.CmdLaunchSolarSail,
		Payload: map[string]any{
			"building_id": ejector.ID,
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("launch solar sail: %s (%s)", res.Code, res.Message)
	}

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	if save.Snapshot == nil || save.Snapshot.Space == nil {
		t.Fatalf("expected save snapshot to include space runtime, got %+v", save.Snapshot)
	}

	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	restored, err := NewFromSave(cfg, maps, q, bus, store, save)
	if err != nil {
		t.Fatalf("restore from save: %v", err)
	}

	orbit := GetSolarSailOrbit(restored.spaceRuntime, "p1", "sys-1")
	if orbit == nil || len(orbit.Sails) != 1 {
		t.Fatalf("expected restored orbit state, got %+v", orbit)
	}
	if restored.spaceRuntime.EntityCounter != 1 {
		t.Fatalf("expected restored space entity counter 1, got %d", restored.spaceRuntime.EntityCounter)
	}
}

func TestT101SaveRestorePreservesDysonSphereRuntime(t *testing.T) {
	core := newSaveStateHarness(t)

	state := model.EnsureDysonSphereState(core.spaceRuntime, "p1", "sys-1")
	state.AddLayer(0, 1.2)
	state.Layers[0].Nodes = append(state.Layers[0].Nodes, model.DysonNode{
		ID:           "node-save-t101",
		LayerIndex:   0,
		Latitude:     12,
		Longitude:    24,
		EnergyOutput: 10,
		Built:        true,
	})
	state.Layers[0].Shells = append(state.Layers[0].Shells, model.DysonShell{
		ID:           "shell-save-t101",
		LayerIndex:   0,
		LatitudeMin:  -10,
		LatitudeMax:  10,
		Coverage:     0.35,
		EnergyOutput: 350,
		Built:        true,
	})
	state.CalculateTotalEnergy(model.DefaultDysonStressParams())

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}

	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	restored, err := NewFromSave(cfg, maps, q, bus, store, save)
	if err != nil {
		t.Fatalf("restore from save: %v", err)
	}

	restoredState := model.GetDysonSphereState(restored.spaceRuntime, "p1", "sys-1")
	if restoredState == nil {
		t.Fatal("expected restored dyson sphere state")
	}
	if restoredState.TotalEnergy != state.TotalEnergy || len(restoredState.Layers) != 1 {
		t.Fatalf("unexpected restored dyson sphere: %+v", restoredState)
	}
	if len(restoredState.Layers[0].Nodes) != 1 || restoredState.Layers[0].Nodes[0].ID != "node-save-t101" {
		t.Fatalf("expected restored dyson sphere nodes, got %+v", restoredState.Layers[0].Nodes)
	}
}

func TestT101ReplayAndRollbackPreserveSpaceRuntime(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	core := New(cfg, maps, q, bus, store)
	ws := core.World()
	grantTechs(ws, "p1", "solar_sail_orbit")

	ejector := newEMRailEjectorBuilding("ejector-replay-t101", model.Position{X: 6, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 1
	attachBuilding(ws, ejector)

	store.SaveSnapshot(snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime))
	core.cmdLog.Append(commandLogEntry{
		Tick:      1,
		PlayerID:  "p1",
		RequestID: "req-t101-replay",
		Commands: []model.Command{{
			Type: model.CmdLaunchSolarSail,
			Payload: map[string]any{
				"building_id": ejector.ID,
			},
		}},
	})
	core.world.Tick = 1

	replayResp, err := core.Replay(model.ReplayRequest{FromTick: 1, ToTick: 1})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replayResp.Digest.SpaceEntityCounter != 1 || replayResp.Digest.SolarSailCount != 1 || replayResp.Digest.SolarSailSystems != 1 {
		t.Fatalf("expected replay digest to include space runtime state, got %+v", replayResp.Digest)
	}

	core.spaceRuntime = model.NewSpaceRuntimeState()
	ws.Tick = 1
	store.SaveSnapshot(snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime))
	LaunchSolarSail(core.spaceRuntime, "p1", "sys-1", 1.2, 5, 1)
	ws.Tick = 2
	store.SaveSnapshot(snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime))

	rollbackResp, err := core.Rollback(model.RollbackRequest{ToTick: 1})
	if err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if rollbackResp.Digest.SpaceEntityCounter != 0 || rollbackResp.Digest.SolarSailCount != 0 {
		t.Fatalf("expected rollback digest to reflect restored empty space runtime, got %+v", rollbackResp.Digest)
	}
	if orbit := GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1"); orbit != nil && len(orbit.Sails) != 0 {
		t.Fatalf("expected live space runtime to roll back to tick 0, got %+v", orbit)
	}
}
