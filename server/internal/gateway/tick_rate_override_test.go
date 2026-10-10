package gateway_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gateway"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/startup"
)

// newTickOverrideServer 起一个带 server.tick_rate_override 的服务端（存档里固化 10）。
func newTickOverrideServer(t *testing.T, override int) (*gateway.Server, *startup.Runtime, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-boot", MaxTickRate: 10},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1", Role: "admin"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{
			Port:             9090,
			RateLimit:        100,
			DataDir:          dir,
			CheckpointDir:    dir + "/checkpoints",
			TickRateOverride: override,
		},
	}
	if err := config.ApplyDefaults(cfg); err != nil {
		t.Fatalf("apply defaults: %v", err)
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 12},
	}
	rt, err := startup.NewRuntime(cfg.Server, mapCfg)
	if err != nil {
		t.Fatalf("new runtime: %v", err)
	}
	if _, err := rt.Reset(startup.NewGameRequest{
		MapSeed: "seed-old",
		Players: []startup.NewGamePlayer{
			{PlayerID: "p1", Key: "key1", Role: "admin"},
			{PlayerID: "p2", Key: "key2"},
		},
	}); err != nil {
		t.Fatalf("bootstrap game: %v", err)
	}
	return gateway.New(rt), rt, dir
}

// /games/current 的 max_tick_rate 报实际调度速率：有覆盖报覆盖值，没有报对局配置。
func TestGameCurrentReportsTickRateOverride(t *testing.T) {
	srv, rt, _ := newTickOverrideServer(t, 3)
	if got := rt.Current().Core.TickRate(); got != 3 {
		t.Fatalf("tick rate with override = %d, want 3", got)
	}

	rec := doGameRequest(t, srv, http.MethodGet, "/games/current", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("games/current: %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["max_tick_rate"] != float64(3) {
		t.Fatalf("max_tick_rate = %v, want 3 (覆盖值)", body["max_tick_rate"])
	}

	// 新开局（POST /games/new）后同样是覆盖值。
	rec = doGameRequest(t, srv, http.MethodPost, "/games/new", "key1", map[string]any{
		"map_seed": "seed-next",
		"players":  []map[string]any{{"player_id": "p1", "key": "key1", "role": "admin"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("games/new: %d %s", rec.Code, rec.Body.String())
	}
	body = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode new game body: %v", err)
	}
	if body["max_tick_rate"] != float64(3) {
		t.Fatalf("new game max_tick_rate = %v, want 3 (覆盖值)", body["max_tick_rate"])
	}

	// 读档（热加载存档点）后也是覆盖值。
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key1", map[string]any{"name": "cp-tick"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("save checkpoint: %d %s", rec.Code, rec.Body.String())
	}
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints/cp-tick/load", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("load checkpoint: %d %s", rec.Code, rec.Body.String())
	}
	body = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode load body: %v", err)
	}
	game, _ := body["game"].(map[string]any)
	if game == nil || game["max_tick_rate"] != float64(3) {
		t.Fatalf("loaded game max_tick_rate = %v, want 3 (覆盖值)", body["game"])
	}
}

// 不给覆盖时 /games/current 报对局配置的速率。
func TestGameCurrentKeepsConfigTickRateWithoutOverride(t *testing.T) {
	srv, _, _ := newTickOverrideServer(t, 0)

	rec := doGameRequest(t, srv, http.MethodGet, "/games/current", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("games/current: %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["max_tick_rate"] != float64(10) {
		t.Fatalf("max_tick_rate = %v, want 10 (对局配置)", body["max_tick_rate"])
	}
}
