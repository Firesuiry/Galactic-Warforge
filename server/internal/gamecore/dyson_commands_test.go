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

	state := GetDysonSphereState("p1")
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

	orbit := GetSolarSailOrbit("p1")
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
	return b
}
