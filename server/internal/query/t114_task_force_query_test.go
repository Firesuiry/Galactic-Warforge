package query

import (
	"testing"

	"siliconworld/internal/model"
)

func TestSystemRuntimeIncludesTaskForcesAndTheaters(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 16, 16)
	spaceRuntime := model.NewSpaceRuntimeState()
	systemRuntime := spaceRuntime.EnsurePlayerSystem("p1", "sys-1")
	systemRuntime.Fleets["fleet-alpha"] = &model.SpaceFleet{
		ID:        "fleet-alpha",
		OwnerID:   "p1",
		SystemID:  "sys-1",
		Formation: model.FormationTypeWedge,
		State:     model.FleetStateAttacking,
		Units: []model.FleetUnitStack{
			{BlueprintID: "corvette", UnitType: "corvette", Count: 2},
		},
	}
	systemRuntime.TaskForces["tf-alpha"] = &model.TaskForce{
		ID:        "tf-alpha",
		OwnerID:   "p1",
		SystemID:  "sys-1",
		TheaterID: "theater-home",
		Stance:    model.TaskForceStanceAggressivePursuit,
		Status:    model.TaskForceStatusEngaging,
		Members: []model.TaskForceMemberRef{
			{UnitKind: model.RuntimeUnitKindFleet, UnitID: "fleet-alpha", SystemID: "sys-1"},
		},
		DeploymentTarget: &model.TaskForceDeploymentTarget{
			Layer:    "planet",
			SystemID: "sys-1",
			PlanetID: planetID,
			Position: &model.Position{X: 9, Y: 9},
		},
		Behavior: model.TaskForceBehaviorProfile{
			TargetPriority:            "highest_threat",
			EngagementRangeMultiplier: 1.25,
			Pursue:                    true,
		},
		CommandCapacity: model.TaskForceCommandCapacity{
			Total: 8,
			Used:  11,
			Over:  3,
			Sources: []model.CommandCapacitySource{
				{Type: model.CommandCapacitySourceCommandShip, SourceID: "fleet-alpha", Capacity: 3},
			},
			Penalty: model.CommandCapacityPenalty{
				DelayTicks:             2,
				HitRateMultiplier:      0.8,
				FormationMultiplier:    0.75,
				CoordinationMultiplier: 0.7,
			},
		},
	}
	systemRuntime.Theaters["theater-home"] = &model.Theater{
		ID:       "theater-home",
		OwnerID:  "p1",
		SystemID: "sys-1",
		Name:     "Home Theater",
		Zones: []model.TheaterZone{
			{ZoneType: model.TheaterZonePrimary, PlanetID: planetID},
		},
		Objective: &model.TheaterObjective{
			ObjectiveType:  "secure_orbit",
			TargetPlanetID: planetID,
		},
	}

	view, ok := ql.SystemRuntime("p1", "sys-1", planetID, ws, spaceRuntime)
	if !ok {
		t.Fatal("expected system runtime view")
	}
	if len(view.TaskForces) != 1 {
		t.Fatalf("expected one task force in runtime view, got %+v", view.TaskForces)
	}
	if view.TaskForces[0].TaskForceID != "tf-alpha" || view.TaskForces[0].TheaterID != "theater-home" {
		t.Fatalf("unexpected task force runtime view: %+v", view.TaskForces[0])
	}
	if len(view.Theaters) != 1 || view.Theaters[0].TheaterID != "theater-home" {
		t.Fatalf("unexpected theater runtime view: %+v", view.Theaters)
	}
	if view.TaskForces[0].CommandCapacity.Over != 3 {
		t.Fatalf("expected command over-capacity in runtime view, got %+v", view.TaskForces[0].CommandCapacity)
	}
}

func TestTaskForceAndTheaterDetailQueries(t *testing.T) {
	ql, _, planetID := newPlanetQueryFixture(t, 16, 16)
	spaceRuntime := model.NewSpaceRuntimeState()
	systemRuntime := spaceRuntime.EnsurePlayerSystem("p1", "sys-1")

	systemRuntime.TaskForces["tf-alpha"] = &model.TaskForce{
		ID:        "tf-alpha",
		OwnerID:   "p1",
		SystemID:  "sys-1",
		TheaterID: "theater-home",
		Stance:    model.TaskForceStanceHold,
		Status:    model.TaskForceStatusIdle,
		Members: []model.TaskForceMemberRef{
			{UnitKind: model.RuntimeUnitKindFleet, UnitID: "fleet-alpha", SystemID: "sys-1"},
			{UnitKind: model.RuntimeUnitKindCombatSquad, UnitID: "squad-alpha", PlanetID: planetID},
		},
		CommandCapacity: model.TaskForceCommandCapacity{
			Total: 12,
			Used:  7,
		},
	}
	systemRuntime.Theaters["theater-home"] = &model.Theater{
		ID:       "theater-home",
		OwnerID:  "p1",
		SystemID: "sys-1",
		Objective: &model.TheaterObjective{
			ObjectiveType:  "defend",
			TargetPlanetID: planetID,
		},
	}

	taskForces := ql.TaskForces("p1", spaceRuntime)
	if len(taskForces) != 1 {
		t.Fatalf("expected one task force in list, got %+v", taskForces)
	}
	taskForce, ok := ql.TaskForce("p1", "tf-alpha", spaceRuntime)
	if !ok {
		t.Fatal("expected task force detail")
	}
	if len(taskForce.Members) != 2 {
		t.Fatalf("expected task force members in detail, got %+v", taskForce)
	}
	if taskForce.CommandCapacity.Total != 12 || taskForce.CommandCapacity.Used != 7 {
		t.Fatalf("unexpected command capacity detail: %+v", taskForce.CommandCapacity)
	}

	theaters := ql.Theaters("p1", spaceRuntime)
	if len(theaters) != 1 {
		t.Fatalf("expected one theater in list, got %+v", theaters)
	}
	theater, ok := ql.Theater("p1", "theater-home", spaceRuntime)
	if !ok {
		t.Fatal("expected theater detail")
	}
	if len(theater.TaskForceIDs) != 1 || theater.TaskForceIDs[0] != "tf-alpha" {
		t.Fatalf("expected theater detail to include affiliated task force, got %+v", theater)
	}
}
