package gateway_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/gateway"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
	"siliconworld/internal/startup"
)

// 契约 §8-16：限流删除后 1 秒内连发 50 次 POST /commands 全部受理（不再 429）。
func TestPostCommandsNoRateLimit(t *testing.T) {
	srv, _ := newTestServer(t)

	start := time.Now()
	for i := 0; i < 50; i++ {
		payload := model.CommandRequest{
			RequestID:  fmt.Sprintf("req-burst-%02d", i),
			IssuerType: "player",
			IssuerID:   "p1",
			Commands: []model.Command{{
				Type:   model.CmdScanGalaxy,
				Target: model.CommandTarget{Layer: "galaxy", GalaxyID: "galaxy-1"},
			}},
		}
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		req := httptest.NewRequest("POST", "/commands", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer key1")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("request %d: expected 202 (no rate limit), got %d: %s", i, rec.Code, rec.Body.String())
		}
		var resp model.CommandResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response %d: %v", i, err)
		}
		if !resp.Accepted {
			t.Fatalf("request %d not accepted: %+v", i, resp.Results)
		}
	}
	if elapsed := time.Since(start); elapsed >= time.Second {
		t.Logf("50 requests took %v (serial test client; no 429 observed)", elapsed)
	}
}

func postRawCommand(t *testing.T, srv *gateway.Server, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest("POST", "/commands", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer key1")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

// 契约 §8-17：HTTP issuer 校验。agent 配非法 ID / 等于玩家 ID → 400；
// HTTP 传 bot → 400；player 配别人的 ID → 403。
func TestPostCommandsIssuerValidation(t *testing.T) {
	srv, _ := newTestServer(t)
	scan := []map[string]any{{
		"type":   "scan_galaxy",
		"target": map[string]any{"layer": "galaxy", "galaxy_id": "galaxy-1"},
	}}

	cases := []struct {
		name       string
		issuerType string
		issuerID   string
		wantStatus int
	}{
		{"agent valid", "agent", "agent-a", http.StatusAccepted},
		{"agent with space", "agent", "agent a", http.StatusBadRequest},
		{"agent with slash", "agent", "agent/a", http.StatusBadRequest},
		{"agent too long", "agent", string(bytes.Repeat([]byte("a"), 65)), http.StatusBadRequest},
		{"agent equals player", "agent", "p1", http.StatusBadRequest},
		{"agent empty", "agent", "", http.StatusBadRequest},
		{"bot over http", "bot", "bot-1", http.StatusBadRequest},
		{"unknown type", "robot", "r-1", http.StatusBadRequest},
		{"player other id", "player", "p2", http.StatusForbidden},
		{"player own id", "player", "p1", http.StatusAccepted},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postRawCommand(t, srv, map[string]any{
				"request_id":  fmt.Sprintf("req-issuer-%02d", i),
				"issuer_type": tc.issuerType,
				"issuer_id":   tc.issuerID,
				"commands":    scan,
			})
			if rec.Code != tc.wantStatus {
				t.Fatalf("issuer_type=%q issuer_id=%q: expected %d, got %d: %s",
					tc.issuerType, tc.issuerID, tc.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}
}

// 契约 §8-18：command_result 事件带 issuer_type / issuer_id。
// 走真实 tick 循环：命令在下一个 tick 结算，事件进入历史后由 /events/snapshot 读回。
func TestCommandResultEventCarriesIssuer(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "issuer-events", MaxTickRate: 20},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1", Role: "admin"},
		},
		Server: config.ServerConfig{Port: 9090},
	}
	if err := config.ApplyDefaults(cfg); err != nil {
		t.Fatalf("apply defaults: %v", err)
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := gamecore.NewEventBus()
	core := gamecore.New(cfg, maps, q, bus, nil)
	rt := startup.NewStaticRuntime(startup.NewSession(cfg, maps, core, bus, q, startup.OriginNew))
	rt.Start()
	defer rt.Stop()
	srv := gateway.New(rt)

	for _, issuer := range []struct{ typ, id string }{{"agent", "agent-a"}, {"player", "p1"}} {
		rec := postRawCommand(t, srv, map[string]any{
			"request_id":  "req-event-" + issuer.id,
			"issuer_type": issuer.typ,
			"issuer_id":   issuer.id,
			"commands": []map[string]any{{
				"type":   "scan_galaxy",
				"target": map[string]any{"layer": "galaxy", "galaxy_id": "galaxy-1"},
			}},
		})
		if rec.Code != http.StatusAccepted {
			t.Fatalf("issuer %s: expected 202, got %d: %s", issuer.id, rec.Code, rec.Body.String())
		}
	}

	want := map[string]string{"req-event-agent-a": "agent-a", "req-event-p1": "p1"}
	wantType := map[string]string{"req-event-agent-a": "agent", "req-event-p1": "player"}
	seen := map[string]bool{}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && len(seen) < len(want) {
		rec := doGameRequest(t, srv, "GET", "/events/snapshot?since_tick=0&event_types=command_result", "key1", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("events snapshot: %d: %s", rec.Code, rec.Body.String())
		}
		var resp model.EventSnapshotResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode events snapshot: %v", err)
		}
		for _, evt := range resp.Events {
			reqID, _ := evt.Payload["request_id"].(string)
			if _, ok := want[reqID]; !ok {
				continue
			}
			if got := fmt.Sprint(evt.Payload["issuer_id"]); got != want[reqID] {
				t.Fatalf("event %s issuer_id = %v, want %s", reqID, evt.Payload["issuer_id"], want[reqID])
			}
			if got := fmt.Sprint(evt.Payload["issuer_type"]); got != wantType[reqID] {
				t.Fatalf("event %s issuer_type = %v, want %s", reqID, evt.Payload["issuer_type"], wantType[reqID])
			}
			seen[reqID] = true
		}
		if len(seen) < len(want) {
			time.Sleep(20 * time.Millisecond)
		}
	}
	if len(seen) != len(want) {
		t.Fatalf("expected command_result events for %v, got %v", want, seen)
	}
}

// 契约 §8-19：存档 → 读档往返后 mechas（操作者、背包、星球、复活 tick）完全一致。
func TestSnapshotRoundTripPreservesMechas(t *testing.T) {
	srv, rt, _, _ := newCheckpointServer(t)
	ws := rt.Current().Core.World()
	ws.Lock()
	starter := firstBoundMecha(ws.Players["p1"], "p1")
	if starter == nil {
		ws.Unlock()
		t.Fatal("expected starter mecha for p1")
	}
	ws.Players["p1"].Mechas["u-lost"] = &model.MechaRecord{
		UnitID:        "u-lost",
		PlanetID:      ws.PlanetID,
		Operator:      "agent-a",
		Inventory:     model.ItemInventory{"gear": 5, "circuit_board": 2},
		RespawnAtTick: 4321,
	}
	ws.Players["p1"].Mechas["u-idle"] = &model.MechaRecord{
		UnitID:    "u-idle",
		PlanetID:  "planet-1-1",
		Inventory: model.ItemInventory{"iron_ingot": 9},
	}
	starter.Inventory = model.ItemInventory{"iron_ingot": 11}
	before := map[string]model.MechaRecord{}
	for id, rec := range ws.Players["p1"].Mechas {
		before[id] = *rec.Clone()
	}
	ws.Unlock()

	rec := doGameRequest(t, srv, "POST", "/checkpoints", "key1", map[string]any{"name": "mecha-roundtrip"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create checkpoint: %d: %s", rec.Code, rec.Body.String())
	}
	// 破坏当前对局，再读档。
	ws.Lock()
	ws.Players["p1"].Mechas = map[string]*model.MechaRecord{}
	ws.Unlock()
	rec = doGameRequest(t, srv, "POST", "/checkpoints/mecha-roundtrip/load", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("load checkpoint: %d: %s", rec.Code, rec.Body.String())
	}

	after := rt.Current().Core.World().Players["p1"].Mechas
	if len(after) != len(before) {
		t.Fatalf("mecha count mismatch: got %d, want %d (%+v)", len(after), len(before), after)
	}
	for id, want := range before {
		got := after[id]
		if got == nil {
			t.Fatalf("mecha %s lost across checkpoint load", id)
		}
		if got.UnitID != want.UnitID || got.PlanetID != want.PlanetID ||
			got.Operator != want.Operator || got.RespawnAtTick != want.RespawnAtTick {
			t.Fatalf("mecha %s metadata mismatch: got %+v, want %+v", id, got, want)
		}
		if len(got.Inventory) != len(want.Inventory) {
			t.Fatalf("mecha %s inventory mismatch: got %+v, want %+v", id, got.Inventory, want.Inventory)
		}
		for item, qty := range want.Inventory {
			if got.Inventory[item] != qty {
				t.Fatalf("mecha %s item %s: got %d, want %d", id, item, got.Inventory[item], qty)
			}
		}
	}
}
