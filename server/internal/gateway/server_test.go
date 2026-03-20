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

func TestFogMapEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/fog", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestPlanetEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/world/planets/planet-1-1", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
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
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/events/snapshot?since_tick=0", nil)
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
	if resp.Events == nil {
		t.Error("events field should be present")
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
