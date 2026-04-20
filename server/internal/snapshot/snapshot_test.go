package snapshot_test

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
	"siliconworld/internal/terrain"
)

func TestSnapshotRoundTrip(t *testing.T) {
	ws := model.NewWorldState("planet-1", 4, 4)
	ws.Tick = 42
	ws.EntityCounter = 7
	ws.Grid[0][1].Terrain = terrain.TileWater

	player := &model.PlayerState{
		PlayerID:  "player-1",
		TeamID:    "team-1",
		Role:      "commander",
		Resources: model.Resources{Minerals: 120, Energy: 55},
		IsAlive:   true,
	}
	player.SetPermissions([]string{"build", "move"})
	player.Executor = model.NewExecutorState("unit-1", 1.2, 3, 2, 1.1)
	ws.Players[player.PlayerID] = player

	resource := &model.ResourceNodeState{
		ID:           "res-1",
		PlanetID:     "planet-1",
		Kind:         "iron_ore",
		Behavior:     "finite",
		Position:     model.Position{X: 2, Y: 1},
		MaxAmount:    100,
		Remaining:    80,
		BaseYield:    4,
		CurrentYield: 4,
	}
	ws.Resources[resource.ID] = resource
	ws.Grid[1][2].ResourceNodeID = resource.ID

	profile := model.BuildingProfileFor(model.BuildingTypeMiningMachine, 1)
	building := &model.Building{
		ID:          "b-1",
		Type:        model.BuildingTypeMiningMachine,
		OwnerID:     player.PlayerID,
		Position:    model.Position{X: 1, Y: 1},
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
		Job: &model.BuildingJob{
			Type:           model.BuildingJobUpgrade,
			RemainingTicks: 2,
			TargetLevel:    2,
			PrevState:      model.BuildingWorkRunning,
		},
	}
	model.InitBuildingStorage(building)
	ws.Buildings[building.ID] = building
	ws.TileBuilding[model.TileKey(1, 1)] = building.ID
	ws.Grid[1][1].BuildingID = building.ID

	unit := &model.Unit{
		ID:          "u-1",
		Type:        model.UnitTypeExecutor,
		OwnerID:     player.PlayerID,
		Position:    model.Position{X: 0, Y: 1},
		HP:          100,
		MaxHP:       100,
		VisionRange: 4,
	}
	ws.Units[unit.ID] = unit
	ws.TileUnits[model.TileKey(0, 1)] = []string{unit.ID}
	ws.CombatRuntime = &model.CombatRuntimeState{
		EntityCounter: 3,
		Squads: map[string]*model.CombatSquad{
			"squad-1": {
				ID:               "squad-1",
				OwnerID:          player.PlayerID,
				PlanetID:         ws.PlanetID,
				SourceBuildingID: building.ID,
				BlueprintID:      "prototype",
				Count:            2,
				HP:               160,
				MaxHP:            160,
				Shield:           model.ShieldState{Level: 20, MaxLevel: 20, RechargeRate: 1, RechargeDelay: 10},
				Weapon:           model.WeaponState{Type: model.WeaponTypeLaser, Damage: 20, FireRate: 10, Range: 8},
				State:            model.CombatSquadStateIdle,
			},
		},
		OrbitalPlatforms: map[string]*model.OrbitalPlatform{},
	}

	ws.Pipelines = &model.PipelineNetworkState{
		Nodes: map[string]*model.PipelineNode{
			"n-1": {
				ID:       "n-1",
				Position: model.Position{X: 0, Y: 0},
				State: model.PipelineNodeState{
					Buffer:   4,
					Pressure: 2,
					FluidID:  model.ItemWater,
				},
			},
			"n-2": {
				ID:       "n-2",
				Position: model.Position{X: 1, Y: 0},
				State: model.PipelineNodeState{
					Buffer:   1,
					Pressure: 3,
					FluidID:  model.ItemWater,
				},
			},
		},
		Segments: map[string]*model.PipelineSegment{
			"s-1": {
				ID:   "s-1",
				From: "n-1",
				To:   "n-2",
				Params: model.PipelineSegmentParams{
					FlowRate:    5,
					Pressure:    4,
					Capacity:    10,
					Attenuation: 0.1,
				},
				State: model.PipelineSegmentState{
					CurrentFlow: 3,
					Buffer:      2,
					Pressure:    3,
					FluidID:     model.ItemWater,
				},
			},
		},
	}

	discovery := buildDiscovery()
	space := model.NewSpaceRuntimeState()
	systemRuntime := space.EnsurePlayerSystem(player.PlayerID, "sys-1")
	systemRuntime.Fleets["fleet-1"] = &model.SpaceFleet{
		ID:               "fleet-1",
		OwnerID:          player.PlayerID,
		SystemID:         "sys-1",
		SourceBuildingID: building.ID,
		Formation:        model.FormationTypeLine,
		State:            model.FleetStateIdle,
		Units:            []model.FleetUnitStack{{BlueprintID: "corvette", Count: 2}},
		Weapon:           model.WeaponState{Type: model.WeaponTypeLaser, Damage: 80, FireRate: 10, Range: 24},
		Shield:           model.ShieldState{Level: 80, MaxLevel: 80, RechargeRate: 2, RechargeDelay: 10},
	}
	snap := snapshot.CaptureRuntime(map[string]*model.WorldState{ws.PlanetID: ws}, ws.PlanetID, discovery, space)

	data, err := snapshot.Encode(snap)
	if err != nil {
		t.Fatalf("encode snapshot: %v", err)
	}
	decoded, err := snapshot.Decode(data)
	if err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}

	worlds, activePlanetID, restoredSpace, err := decoded.RestoreRuntime()
	if err != nil {
		t.Fatalf("restore runtime: %v", err)
	}
	restored := worlds[activePlanetID]
	if restored == nil {
		t.Fatalf("expected restored active world for %s", activePlanetID)
	}

	if restored.Tick != ws.Tick {
		t.Fatalf("tick mismatch: %d != %d", restored.Tick, ws.Tick)
	}
	if restored.PlanetID != ws.PlanetID {
		t.Fatalf("planet id mismatch: %s != %s", restored.PlanetID, ws.PlanetID)
	}
	if restored.Grid[0][1].Terrain != terrain.TileWater {
		t.Fatalf("terrain mismatch: %s", restored.Grid[0][1].Terrain)
	}
	if restored.Grid[1][2].ResourceNodeID != resource.ID {
		t.Fatalf("resource id mismatch: %s", restored.Grid[1][2].ResourceNodeID)
	}
	if restored.TileBuilding[model.TileKey(1, 1)] != building.ID {
		t.Fatalf("building occupancy missing")
	}
	if len(restored.TileUnits[model.TileKey(0, 1)]) != 1 {
		t.Fatalf("unit occupancy mismatch")
	}
	if restored.Buildings[building.ID].Job == nil || restored.Buildings[building.ID].Job.PrevState != model.BuildingWorkRunning {
		t.Fatalf("building job prev_state lost")
	}
	if !restored.Players[player.PlayerID].HasPermission(model.CmdBuild) {
		t.Fatalf("player permissions not restored")
	}
	if restored.Pipelines == nil || restored.Pipelines.Nodes == nil || restored.Pipelines.Segments == nil {
		t.Fatalf("pipeline snapshot missing")
	}
	node := restored.Pipelines.Nodes["n-1"]
	if node == nil || node.State.Buffer != 4 || node.State.Pressure != 2 {
		t.Fatalf("pipeline node state mismatch")
	}
	segment := restored.Pipelines.Segments["s-1"]
	if segment == nil || segment.State.CurrentFlow != 3 || segment.State.Buffer != 2 {
		t.Fatalf("pipeline segment state mismatch")
	}
	if segment.Params.Attenuation < 0.09 || segment.Params.Attenuation > 0.11 {
		t.Fatalf("pipeline segment attenuation mismatch: %f", segment.Params.Attenuation)
	}
	if restored.CombatRuntime == nil || restored.CombatRuntime.Squads["squad-1"] == nil || restored.CombatRuntime.Squads["squad-1"].BlueprintID != "prototype" {
		t.Fatalf("expected combat runtime blueprint_id roundtrip, got %+v", restored.CombatRuntime)
	}
	if restoredSpace == nil || restoredSpace.PlayerSystem(player.PlayerID, "sys-1") == nil {
		t.Fatalf("expected restored space runtime, got %+v", restoredSpace)
	}
	fleet := restoredSpace.PlayerSystem(player.PlayerID, "sys-1").Fleets["fleet-1"]
	if fleet == nil || len(fleet.Units) != 1 || fleet.Units[0].BlueprintID != "corvette" {
		t.Fatalf("expected fleet blueprint_id roundtrip, got %+v", fleet)
	}

	restoredDiscovery, err := decoded.RestoreDiscovery()
	if err != nil {
		t.Fatalf("restore discovery: %v", err)
	}
	if restoredDiscovery == nil {
		t.Fatalf("discovery snapshot missing")
	}
	if !restoredDiscovery.IsGalaxyDiscovered(player.PlayerID, "g1") {
		t.Fatalf("discovery galaxy missing")
	}
	if !restoredDiscovery.IsSystemDiscovered(player.PlayerID, "s2") {
		t.Fatalf("discovery system missing")
	}
	if !restoredDiscovery.IsPlanetDiscovered(player.PlayerID, "p2") {
		t.Fatalf("discovery planet missing")
	}
}

func buildDiscovery() *mapstate.Discovery {
	players := []config.PlayerConfig{{PlayerID: "player-1"}}
	universe := &mapmodel.Universe{
		PrimaryGalaxyID: "g1",
		PrimaryPlanetID: "p1",
		Galaxies: map[string]*mapmodel.Galaxy{
			"g1": {ID: "g1", SystemIDs: []string{"s1"}},
		},
		Systems: map[string]*mapmodel.System{
			"s1": {ID: "s1", GalaxyID: "g1", PlanetIDs: []string{"p1"}},
		},
		Planets: map[string]*mapmodel.Planet{
			"p1": {ID: "p1", SystemID: "s1"},
		},
	}
	discovery := mapstate.NewDiscovery(players, universe)
	discovery.DiscoverGalaxy("player-1", "g2")
	discovery.DiscoverSystem("player-1", "s2")
	discovery.DiscoverPlanet("player-1", "p2")
	return discovery
}
