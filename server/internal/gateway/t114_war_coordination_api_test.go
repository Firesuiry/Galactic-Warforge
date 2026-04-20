package gateway_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"siliconworld/internal/model"
)

func TestWarCoordinationEndpoints(t *testing.T) {
	srv, core := newTestServer(t)
	ws := core.World()
	ws.Players["p1"].SetPermissions([]string{"*"})

	ws.Buildings["analysis-1"] = &model.Building{
		ID:       "analysis-1",
		Type:     model.BuildingTypeBattlefieldAnalysisBase,
		OwnerID:  "p1",
		Position: model.Position{X: 6, Y: 6},
	}
	ws.CombatRuntime.Squads["squad-api"] = &model.CombatSquad{
		ID:          "squad-api",
		OwnerID:     "p1",
		PlanetID:    ws.PlanetID,
		BlueprintID: model.ItemPrototype,
		Count:       1,
		State:       model.CombatSquadStateIdle,
	}
	core.SpaceRuntime().EnsurePlayerSystem("p1", "sys-1").Fleets["fleet-api"] = &model.SpaceFleet{
		ID:       "fleet-api",
		OwnerID:  "p1",
		SystemID: "sys-1",
		State:    model.FleetStateIdle,
		Units: []model.FleetUnitStack{{
			BlueprintID: model.ItemCorvette,
			UnitType:    model.ItemCorvette,
			Count:       1,
		}},
	}

	coordination := ws.Players["p1"].EnsureWarCoordination()
	coordination.TaskForces["tf-api"] = &model.WarTaskForce{
		ID:        "tf-api",
		OwnerID:   "p1",
		Name:      "API Task Force",
		TheaterID: "theater-api",
		Stance:    model.WarTaskForceStanceIntercept,
		Members: []model.WarTaskForceMemberRef{
			{Kind: model.WarTaskForceMemberKindSquad, EntityID: "squad-api"},
			{Kind: model.WarTaskForceMemberKindFleet, EntityID: "fleet-api"},
		},
		Deployment: &model.WarTaskForceDeployment{
			SystemID: "sys-1",
			PlanetID: ws.PlanetID,
			Position: &model.Position{X: 8, Y: 8},
		},
	}
	coordination.Theaters["theater-api"] = &model.WarTheater{
		ID:      "theater-api",
		OwnerID: "p1",
		Name:    "API Theater",
		Zones: []model.WarTheaterZone{{
			ZoneType: model.WarTheaterZoneTypePrimary,
			SystemID: "sys-1",
			PlanetID: ws.PlanetID,
			Position: &model.Position{X: 8, Y: 8},
			Radius:   5,
		}},
		Objective: &model.WarTheaterObjective{
			ObjectiveType: "secure_planet",
			SystemID:      "sys-1",
			PlanetID:      ws.PlanetID,
		},
	}

	req := httptest.NewRequest("GET", "/war/task-forces", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var taskForceBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &taskForceBody); err != nil {
		t.Fatalf("decode task force response: %v", err)
	}
	taskForces, ok := taskForceBody["task_forces"].([]any)
	if !ok || len(taskForces) != 1 {
		t.Fatalf("expected one task force, got %+v", taskForceBody)
	}

	req = httptest.NewRequest("GET", "/war/theaters", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var theaterBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &theaterBody); err != nil {
		t.Fatalf("decode theater response: %v", err)
	}
	theaters, ok := theaterBody["theaters"].([]any)
	if !ok || len(theaters) != 1 {
		t.Fatalf("expected one theater, got %+v", theaterBody)
	}
}
