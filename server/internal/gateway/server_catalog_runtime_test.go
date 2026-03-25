package gateway_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"siliconworld/internal/model"
)

func TestPlanetRuntimeEndpoint(t *testing.T) {
	srv, core := newTestServer(t)

	ws := core.World()
	ws.Lock()
	ws.Buildings["station-1"] = &model.Building{
		ID:          "station-1",
		Type:        model.BuildingTypePlanetaryLogisticsStation,
		OwnerID:     "p1",
		Position:    model.Position{X: 4, Y: 4},
		HP:          100,
		MaxHP:       100,
		Level:       1,
		VisionRange: 6,
		Runtime: model.BuildingRuntime{
			Params: model.BuildingRuntimeParams{Footprint: model.Footprint{Width: 1, Height: 1}},
			State:  model.BuildingWorkRunning,
		},
	}
	ws.LogisticsStations["station-1"] = model.NewLogisticsStationState()
	ws.Unlock()

	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/runtime", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if body["planet_id"] != "planet-1-1" {
		t.Fatalf("unexpected planet_id: %v", body["planet_id"])
	}
	if _, ok := body["logistics_stations"]; !ok {
		t.Fatalf("expected logistics_stations in body: %v", body)
	}
}

func TestCatalogEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest("GET", "/catalog", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if _, ok := body["buildings"]; !ok {
		t.Fatalf("expected buildings in catalog body: %v", body)
	}
	if _, ok := body["items"]; !ok {
		t.Fatalf("expected items in catalog body: %v", body)
	}
}
