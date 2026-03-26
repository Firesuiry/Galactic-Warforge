package gateway_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/gateway"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func newTestServer(t *testing.T) (*gateway.Server, *gamecore.GameCore) {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed: "test", MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9090, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := gamecore.NewEventBus()
	core := gamecore.New(cfg, maps, q, bus, nil)
	srv := gateway.New(cfg, core, bus, q)
	return srv, core
}

func TestHealthEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", body["status"])
	}
}

func TestUnauthorizedRequest(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/state/summary", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInvalidKey(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/state/summary", nil)
	req.Header.Set("Authorization", "Bearer invalid-key")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestStateSummaryAuthorized(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/state/summary", nil)
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
	if _, ok := body["tick"]; !ok {
		t.Error("response should include tick")
	}
}

func TestPostCommandsMissingRequestID(t *testing.T) {
	srv, _ := newTestServer(t)

	payload := model.CommandRequest{
		IssuerType: "player",
		IssuerID:   "p1",
		Commands: []model.Command{
			{Type: model.CmdScanGalaxy, Target: model.CommandTarget{GalaxyID: "galaxy-1"}},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/commands", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer key1")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPostCommandsValid(t *testing.T) {
	srv, _ := newTestServer(t)

	payload := model.CommandRequest{
		RequestID:  "req-test-001",
		IssuerType: "player",
		IssuerID:   "p1",
		Commands: []model.Command{
			{
				Type: model.CmdScanGalaxy,
				Target: model.CommandTarget{
					Layer:    "galaxy",
					GalaxyID: "galaxy-1",
				},
			},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/commands", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer key1")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp model.CommandResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.RequestID != "req-test-001" {
		t.Errorf("expected request_id=req-test-001, got %s", resp.RequestID)
	}
	if !resp.Accepted {
		t.Error("expected accepted=true")
	}
}

func TestPostCommandsMissingIssuerType(t *testing.T) {
	srv, _ := newTestServer(t)

	payload := model.CommandRequest{
		RequestID: "req-missing-issuer-type",
		IssuerID:  "p1",
		Commands: []model.Command{
			{Type: model.CmdScanGalaxy, Target: model.CommandTarget{GalaxyID: "galaxy-1"}},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/commands", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer key1")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPostCommandsIssuerMismatch(t *testing.T) {
	srv, _ := newTestServer(t)

	payload := model.CommandRequest{
		RequestID:  "req-issuer-mismatch",
		IssuerType: "player",
		IssuerID:   "p2",
		Commands: []model.Command{
			{Type: model.CmdScanGalaxy, Target: model.CommandTarget{GalaxyID: "galaxy-1"}},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/commands", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer key1")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}

func TestPostCommandsDuplicate(t *testing.T) {
	srv, _ := newTestServer(t)

	payload := model.CommandRequest{
		RequestID:  "req-dup-test",
		IssuerType: "player",
		IssuerID:   "p1",
		Commands: []model.Command{
			{Type: model.CmdScanGalaxy, Target: model.CommandTarget{GalaxyID: "galaxy-1"}},
		},
	}
	body, _ := json.Marshal(payload)

	// First request
	req1 := httptest.NewRequest("POST", "/commands", bytes.NewReader(body))
	req1.Header.Set("Authorization", "Bearer key1")
	req1.Header.Set("Content-Type", "application/json")
	rec1 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec1, req1)

	// Second request with same request_id
	body2, _ := json.Marshal(payload)
	req2 := httptest.NewRequest("POST", "/commands", bytes.NewReader(body2))
	req2.Header.Set("Authorization", "Bearer key1")
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec2, req2)

	var resp2 model.CommandResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp2.Accepted {
		t.Error("duplicate request should not be accepted")
	}
	if resp2.Results[0].Code != model.CodeDuplicate {
		t.Errorf("expected DUPLICATE code, got %s", resp2.Results[0].Code)
	}
}

func TestPostCommandsPermissionDenied(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed: "test", MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1", Role: "observer"},
		},
		Server: config.ServerConfig{Port: 9090, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := gamecore.NewEventBus()
	core := gamecore.New(cfg, maps, q, bus, nil)
	srv := gateway.New(cfg, core, bus, q)

	payload := model.CommandRequest{
		RequestID:  "req-perm-deny",
		IssuerType: "player",
		IssuerID:   "p1",
		Commands: []model.Command{
			{
				Type: model.CmdBuild,
				Target: model.CommandTarget{
					Position: &model.Position{X: 1, Y: 1},
				},
				Payload: map[string]any{
					"building_type": "mining_machine",
				},
			},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/commands", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer key1")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp model.CommandResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.Accepted {
		t.Error("expected accepted=false due to permission denial")
	}
	if resp.Results[0].Code != model.CodeUnauthorized {
		t.Errorf("expected UNAUTHORIZED code, got %s", resp.Results[0].Code)
	}
}

func TestGalaxyEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/world/galaxy", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if _, ok := body["systems"]; !ok {
		t.Error("galaxy response should include systems")
	}
}

func TestFogMapEndpointIsRemoved(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/fog", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestPlanetEndpointReturnsSummaryModel(t *testing.T) {
	srv, core := newTestServer(t)
	ws := core.World()
	ws.Lock()
	ws.Buildings["summary-building"] = &model.Building{
		ID:          "summary-building",
		Type:        model.BuildingTypeMiningMachine,
		OwnerID:     "p1",
		Position:    model.Position{X: 1, Y: 1},
		HP:          100,
		MaxHP:       100,
		Level:       1,
		VisionRange: 4,
	}
	ws.Units["summary-unit"] = &model.Unit{
		ID:          "summary-unit",
		Type:        "worker",
		OwnerID:     "p1",
		Position:    model.Position{X: 2, Y: 2},
		HP:          24,
		MaxHP:       24,
		VisionRange: 3,
	}
	ws.Resources["summary-resource"] = &model.ResourceNodeState{
		ID:       "summary-resource",
		PlanetID: ws.PlanetID,
		Position: model.Position{X: 3, Y: 3},
	}
	expectedBuildingCount := len(ws.Buildings)
	expectedUnitCount := len(ws.Units)
	expectedResourceCount := len(ws.Resources)
	ws.Unlock()

	req := httptest.NewRequest("GET", "/world/planets/planet-1-1", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if body["building_count"] != float64(expectedBuildingCount) {
		t.Fatalf("unexpected building_count: %v", body["building_count"])
	}
	if body["unit_count"] != float64(expectedUnitCount) {
		t.Fatalf("unexpected unit_count: %v", body["unit_count"])
	}
	if body["resource_count"] != float64(expectedResourceCount) {
		t.Fatalf("unexpected resource_count: %v", body["resource_count"])
	}
	if _, ok := body["terrain"]; ok {
		t.Fatal("planet summary should not expose terrain payload")
	}
	if _, ok := body["buildings"]; ok {
		t.Fatal("planet summary should not expose building payload")
	}
}

func TestPlanetSceneEndpointTranslatesViewportQuery(t *testing.T) {
	srv, core := newTestServer(t)
	ws := core.World()
	ws.Lock()
	ws.Buildings["scene-in"] = &model.Building{
		ID:          "scene-in",
		Type:        model.BuildingTypeMiningMachine,
		OwnerID:     "p1",
		Position:    model.Position{X: 3, Y: 4},
		HP:          100,
		MaxHP:       100,
		Level:       1,
		VisionRange: 4,
	}
	ws.Buildings["scene-out"] = &model.Building{
		ID:          "scene-out",
		Type:        model.BuildingTypeMiningMachine,
		OwnerID:     "p1",
		Position:    model.Position{X: 10, Y: 10},
		HP:          100,
		MaxHP:       100,
		Level:       1,
		VisionRange: 4,
	}
	ws.Unlock()

	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/scene?x=2&y=3&width=4&height=2&detail_level=tile&layers=terrain,buildings", nil)
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
	if body["detail_level"] != "tile" {
		t.Fatalf("unexpected detail_level: %v", body["detail_level"])
	}
	bounds, ok := body["bounds"].(map[string]any)
	if !ok {
		t.Fatalf("expected bounds object, got %T", body["bounds"])
	}
	if bounds["min_x"] != float64(2) || bounds["min_y"] != float64(3) || bounds["max_x"] != float64(5) || bounds["max_y"] != float64(4) {
		t.Fatalf("unexpected bounds: %+v", bounds)
	}
	terrainRows, ok := body["terrain"].([]any)
	if !ok || len(terrainRows) != 2 {
		t.Fatalf("expected 2 cropped terrain rows, got %#v", body["terrain"])
	}
	firstRow, ok := terrainRows[0].([]any)
	if !ok || len(firstRow) != 4 {
		t.Fatalf("expected terrain row width 4, got %#v", terrainRows[0])
	}
	buildings, ok := body["buildings"].(map[string]any)
	if !ok {
		t.Fatalf("expected buildings payload, got %T", body["buildings"])
	}
	if _, exists := buildings["scene-in"]; !exists {
		t.Fatal("expected in-bounds building in scene payload")
	}
	if _, exists := buildings["scene-out"]; exists {
		t.Fatal("did not expect out-of-bounds building in scene payload")
	}
}

func TestPlanetInspectEndpointReturnsStructuredEntityPayload(t *testing.T) {
	srv, core := newTestServer(t)
	ws := core.World()
	ws.Lock()
	ws.Buildings["inspect-building"] = &model.Building{
		ID:          "inspect-building",
		Type:        model.BuildingTypeMiningMachine,
		OwnerID:     "p1",
		Position:    model.Position{X: 4, Y: 5},
		HP:          120,
		MaxHP:       150,
		Level:       2,
		VisionRange: 5,
	}
	ws.Unlock()

	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/inspect?entity_kind=building&entity_id=inspect-building", nil)
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
	if body["entity_kind"] != "building" {
		t.Fatalf("unexpected entity_kind: %v", body["entity_kind"])
	}
	if body["entity_id"] != "inspect-building" {
		t.Fatalf("unexpected entity_id: %v", body["entity_id"])
	}
	building, ok := body["building"].(map[string]any)
	if !ok {
		t.Fatalf("expected building payload, got %T", body["building"])
	}
	if building["id"] != "inspect-building" {
		t.Fatalf("unexpected building id: %v", building["id"])
	}
}

func TestMetricsEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestEventSnapshotEndpoint(t *testing.T) {
	srv, core := newTestServer(t)
	core.EventHistory().Record([]*model.GameEvent{
		{EventID: "evt-10-1", Tick: 10, EventType: model.EvtTickCompleted, VisibilityScope: "all"},
		{EventID: "evt-10-2", Tick: 10, EventType: model.EvtCommandResult, VisibilityScope: "p1"},
	})

	req := httptest.NewRequest("GET", "/events/snapshot?since_tick=0&event_types=command_result", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp model.EventSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if len(resp.EventTypes) != 1 || resp.EventTypes[0] != model.EvtCommandResult {
		t.Fatalf("unexpected event_types: %#v", resp.EventTypes)
	}
	if len(resp.Events) != 1 || resp.Events[0].EventType != model.EvtCommandResult {
		t.Fatalf("expected only command_result events, got %#v", resp.Events)
	}
}

func TestEventSnapshotRequiresEventTypes(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/events/snapshot?since_tick=0", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestEventStreamRequiresEventTypes(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/events/stream", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestProductionAlertSnapshotEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/alerts/production/snapshot?since_tick=0", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp model.ProductionAlertSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.Alerts == nil {
		t.Error("alerts field should be present")
	}
}
