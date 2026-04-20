package gateway_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"siliconworld/internal/model"
)

func TestTaskForceAndTheaterEndpoints(t *testing.T) {
	srv, core := newTestServer(t)
	systemRuntime := core.SpaceRuntime().EnsurePlayerSystem("p1", "sys-1")
	systemRuntime.TaskForces["tf-alpha"] = &model.TaskForce{
		ID:        "tf-alpha",
		OwnerID:   "p1",
		SystemID:  "sys-1",
		TheaterID: "theater-home",
		Stance:    model.TaskForceStanceHold,
		Status:    model.TaskForceStatusIdle,
		CommandCapacity: model.TaskForceCommandCapacity{
			Total: 10,
			Used:  6,
		},
	}
	systemRuntime.Theaters["theater-home"] = &model.Theater{
		ID:       "theater-home",
		OwnerID:  "p1",
		SystemID: "sys-1",
		Name:     "Home Theater",
		Objective: &model.TheaterObjective{
			ObjectiveType:  "defend",
			TargetPlanetID: "planet-1-1",
		},
	}

	req := httptest.NewRequest("GET", "/world/task-forces/tf-alpha", nil)
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
	if taskForceBody["task_force_id"] != "tf-alpha" {
		t.Fatalf("unexpected task force body: %+v", taskForceBody)
	}

	req = httptest.NewRequest("GET", "/world/theaters/theater-home", nil)
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
	if theaterBody["theater_id"] != "theater-home" {
		t.Fatalf("unexpected theater body: %+v", theaterBody)
	}

	systemBody := getAuthorizedJSON(t, srv, "/world/systems/sys-1/runtime")
	if _, ok := systemBody["task_forces"]; !ok {
		t.Fatalf("expected task_forces in system runtime response: %+v", systemBody)
	}
	if _, ok := systemBody["theaters"]; !ok {
		t.Fatalf("expected theaters in system runtime response: %+v", systemBody)
	}
}
