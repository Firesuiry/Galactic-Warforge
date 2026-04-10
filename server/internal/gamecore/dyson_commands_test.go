package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestDysonCommandsExecute(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "lightweight_structure")

	nodeCmdA := model.Command{
		Type: model.CmdBuildDysonNode,
		Payload: map[string]any{
			"system_id":   "sys-1",
			"layer_index": 0,
			"latitude":    5.0,
			"longitude":   10.0,
		},
	}
	res, _ := core.execBuildDysonNode(ws, "p1", nodeCmdA)
	if res.Code != model.CodeOK {
		t.Fatalf("build dyson node A failed: %s (%s)", res.Code, res.Message)
	}

	nodeCmdB := model.Command{
		Type: model.CmdBuildDysonNode,
		Payload: map[string]any{
			"system_id":   "sys-1",
			"layer_index": 0,
			"latitude":    12.0,
			"longitude":   25.0,
		},
	}
	res, _ = core.execBuildDysonNode(ws, "p1", nodeCmdB)
	if res.Code != model.CodeOK {
		t.Fatalf("build dyson node B failed: %s (%s)", res.Code, res.Message)
	}

	state := GetDysonSphereState(core.spaceRuntime, "p1", "sys-1")
	if state == nil || len(state.Layers) == 0 || len(state.Layers[0].Nodes) != 2 {
		t.Fatal("expected dyson nodes to be created")
	}
	for _, node := range state.Layers[0].Nodes {
		if node.ID == "" || node.ID == "p1-node-\x00" {
			t.Fatalf("unexpected node id %q", node.ID)
		}
		for _, r := range node.ID {
			if r < 32 {
				t.Fatalf("node id contains control character: %q", node.ID)
			}
		}
	}

	frameCmd := model.Command{
		Type: model.CmdBuildDysonFrame,
		Payload: map[string]any{
			"system_id":   "sys-1",
			"layer_index": 0,
			"node_a_id":   state.Layers[0].Nodes[0].ID,
			"node_b_id":   state.Layers[0].Nodes[1].ID,
		},
	}
	res, _ = core.execBuildDysonFrame(ws, "p1", frameCmd)
	if res.Code != model.CodeOK {
		t.Fatalf("build dyson frame failed: %s (%s)", res.Code, res.Message)
	}

	shellCmd := model.Command{
		Type: model.CmdBuildDysonShell,
		Payload: map[string]any{
			"system_id":    "sys-1",
			"layer_index":  0,
			"latitude_min": -10.0,
			"latitude_max": 10.0,
			"coverage":     0.35,
		},
	}
	res, _ = core.execBuildDysonShell(ws, "p1", shellCmd)
	if res.Code != model.CodeOK {
		t.Fatalf("build dyson shell failed: %s (%s)", res.Code, res.Message)
	}

	shellID := state.Layers[0].Shells[0].ID
	demolishCmd := model.Command{
		Type: model.CmdDemolishDyson,
		Payload: map[string]any{
			"system_id":      "sys-1",
			"component_type": "shell",
			"component_id":   shellID,
		},
	}
	res, _ = core.execDemolishDyson(ws, "p1", demolishCmd)
	if res.Code != model.CodeOK {
		t.Fatalf("demolish dyson shell failed: %s (%s)", res.Code, res.Message)
	}
	if len(state.Layers[0].Shells) != 0 {
		t.Fatal("expected dyson shell to be removed after demolish")
	}
}

func TestDysonCommandsRequireResearchUnlock(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()

	cmd := model.Command{
		Type: model.CmdBuildDysonNode,
		Payload: map[string]any{
			"system_id":   "sys-1",
			"layer_index": 0,
			"latitude":    5.0,
			"longitude":   10.0,
		},
	}
	res, _ := core.execBuildDysonNode(ws, "p1", cmd)
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failure without unlock, got %s", res.Code)
	}
}

func TestLaunchSolarSailConsumesLoadedPayload(t *testing.T) {
	ClearSolarSailOrbits()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_sail_orbit")

	ejector := newEMRailEjectorBuilding("ejector-1", model.Position{X: 6, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 3
	attachBuilding(ws, ejector)

	cmd := model.Command{
		Type: model.CmdLaunchSolarSail,
		Payload: map[string]any{
			"building_id":  ejector.ID,
			"count":        float64(2),
			"orbit_radius": 1.2,
			"inclination":  5.0,
		},
	}
	res, events := core.execLaunchSolarSail(ws, "p1", cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("launch solar sail failed: %s (%s)", res.Code, res.Message)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 entity_created events, got %d", len(events))
	}
	if got := ejector.Storage.OutputQuantity(model.ItemSolarSail); got != 1 {
		t.Fatalf("expected 1 remaining loaded solar sail, got %d", got)
	}

	orbit := GetSolarSailOrbit(core.spaceRuntime, "p1", "sys-1")
	if orbit == nil || len(orbit.Sails) != 2 {
		t.Fatalf("expected 2 solar sails in orbit, got %#v", orbit)
	}
}

func TestLaunchSolarSailRejectsNonEjectorTarget(t *testing.T) {
	ClearSolarSailOrbits()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_sail_orbit")

	silo := newVerticalLaunchingSiloBuilding("silo-1", model.Position{X: 8, Y: 8}, "p1")
	silo.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, silo)

	cmd := model.Command{
		Type: model.CmdLaunchSolarSail,
		Payload: map[string]any{
			"building_id": silo.ID,
		},
	}
	res, _ := core.execLaunchSolarSail(ws, "p1", cmd)
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected invalid target for silo launch, got %s (%s)", res.Code, res.Message)
	}
}

func TestLaunchRocketConsumesStoredRocketAndBoostsLayer(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "vertical_launching", "lightweight_structure")

	silo := newVerticalLaunchingSiloBuilding("silo-1", model.Position{X: 8, Y: 8}, "p1")
	silo.Runtime.State = model.BuildingWorkRunning
	silo.Storage.EnsureInventory()[model.ItemSmallCarrierRocket] = 2
	attachBuilding(ws, silo)

	AddDysonLayer(core.spaceRuntime, "p1", "sys-1", 0, 1.2)
	if _, err := AddDysonNode(core.spaceRuntime, "p1", "sys-1", 0, 10, 20); err != nil {
		t.Fatalf("add dyson node: %v", err)
	}

	cmd := model.Command{
		Type: model.CmdLaunchRocket,
		Payload: map[string]any{
			"building_id": silo.ID,
			"system_id":   "sys-1",
			"layer_index": 0,
			"count":       float64(2),
		},
	}
	res, events := core.execLaunchRocket(ws, "p1", cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("launch rocket failed: %s (%s)", res.Code, res.Message)
	}
	if len(events) != 1 {
		t.Fatalf("expected one rocket launch event, got %d", len(events))
	}
	if events[0].EventType != model.EvtRocketLaunched {
		t.Fatalf("expected rocket_launched event, got %s", events[0].EventType)
	}
	if got := silo.Storage.OutputQuantity(model.ItemSmallCarrierRocket); got != 0 {
		t.Fatalf("expected silo rockets consumed, got %d", got)
	}

	state := GetDysonSphereState(core.spaceRuntime, "p1", "sys-1")
	if state == nil || len(state.Layers) == 0 {
		t.Fatal("expected dyson layer state")
	}
	layer := state.Layers[0]
	if layer.RocketLaunches != 2 {
		t.Fatalf("expected rocket launches 2, got %d", layer.RocketLaunches)
	}
	if layer.ConstructionBonus != 0.04 {
		t.Fatalf("expected construction bonus 0.04, got %v", layer.ConstructionBonus)
	}
}

func TestLaunchRocketRequiresExistingDysonScaffold(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "vertical_launching")

	silo := newVerticalLaunchingSiloBuilding("silo-1", model.Position{X: 8, Y: 8}, "p1")
	silo.Runtime.State = model.BuildingWorkRunning
	silo.Storage.EnsureInventory()[model.ItemSmallCarrierRocket] = 1
	attachBuilding(ws, silo)

	AddDysonLayer(core.spaceRuntime, "p1", "sys-1", 0, 1.2)

	res, _ := core.execLaunchRocket(ws, "p1", model.Command{
		Type: model.CmdLaunchRocket,
		Payload: map[string]any{
			"building_id": silo.ID,
			"system_id":   "sys-1",
			"layer_index": 0,
		},
	})
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failure without dyson scaffold, got %s (%s)", res.Code, res.Message)
	}
}

func newEMRailEjectorBuilding(id string, pos model.Position, owner string) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeEMRailEjector, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeEMRailEjector,
		OwnerID:     owner,
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b)
	if b.Runtime.Functions.Launch != nil {
		b.Runtime.Functions.Launch.SuccessRate = 1
	}
	return b
}

func newVerticalLaunchingSiloBuilding(id string, pos model.Position, owner string) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeVerticalLaunchingSilo, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeVerticalLaunchingSilo,
		OwnerID:     owner,
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b)
	model.InitBuildingProduction(b)
	if b.Runtime.Functions.Launch != nil {
		b.Runtime.Functions.Launch.SuccessRate = 1
	}
	return b
}
