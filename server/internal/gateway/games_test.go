package gateway_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/gateway"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/startup"
)

// newResettableServer 构建一个支持热重置的完整 runtime（不 Start，因此测试内无
// tick/autosave goroutine，断言保持确定性）；data dir 位于 t.TempDir()。
func newResettableServer(t *testing.T) (*gateway.Server, *startup.Runtime, string) {
	t.Helper()
	dataDir := t.TempDir()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed: "seed-boot", MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1", Role: "admin"},
		},
		Server: config.ServerConfig{Port: 9090, RateLimit: 100, DataDir: dataDir},
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
	return gateway.New(rt), rt, dataDir
}

func doGameRequest(t *testing.T, srv *gateway.Server, method, path, bearer string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

func decodeGameBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	return body
}

func summaryPlayers(body map[string]any) []string {
	players, _ := body["players"].([]any)
	ids := make([]string, 0, len(players))
	for _, raw := range players {
		if m, ok := raw.(map[string]any); ok {
			ids = append(ids, fmt.Sprint(m["player_id"]))
		}
	}
	return ids
}

func TestGameNewReplacesWorldAndRotatesKeys(t *testing.T) {
	srv, rt, _ := newResettableServer(t)

	// 旧局：p1 带 bootstrap，世界里有 4242 矿物。
	oldSess := rt.Current()
	oldSess.Core.World().Lock()
	oldSess.Core.World().Players["p1"].Resources.Minerals = 4242
	oldSess.Core.World().Unlock()
	oldSess.Bus.Subscribe("legacy-sub", nil)

	rec := doGameRequest(t, srv, "GET", "/state/summary", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("old summary: %d", rec.Code)
	}
	oldSummary := decodeGameBody(t, rec)
	if got := oldSummary["players"].(map[string]any)["p1"].(map[string]any)["resources"].(map[string]any)["minerals"]; got != float64(4242) {
		t.Fatalf("old world minerals mismatch: %v", got)
	}

	// admin 开新局：换种子、关黑雾、sandbox 胜利模式、全新玩家。
	rec = doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed":         "seed-new",
		"enemy_difficulty": "off",
		"victory_mode":     "sandbox",
		"players": []map[string]any{
			{"player_id": "q1", "key": "nq1", "role": "admin"},
			{"player_id": "q2", "key": "nq2", "bot": "easy"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	created := decodeGameBody(t, rec)
	if created["map_seed"] != "seed-new" || created["enemy_difficulty"] != "off" || created["victory_mode"] != "sandbox" {
		t.Fatalf("unexpected created summary: %v", created)
	}
	if created["tick"] != float64(0) {
		t.Fatalf("new game must start at tick 0, got %v", created["tick"])
	}
	if createdBody := rec.Body.String(); bytes.Contains([]byte(createdBody), []byte("nq1")) || bytes.Contains([]byte(createdBody), []byte("nq2")) {
		t.Fatalf("summary must not leak player keys: %s", createdBody)
	}
	got := summaryPlayers(created)
	if len(got) != 2 || got[0] != "q1" || got[1] != "q2" {
		t.Fatalf("expected players [q1 q2], got %v", got)
	}
	if created["victory"].(map[string]any)["declared"] != false {
		t.Fatalf("new game must not have declared victory")
	}

	// session 已原子切换，旧总线订阅被断开。
	if rt.Current() == oldSess {
		t.Fatalf("session pointer must change after reset")
	}
	if n := oldSess.Bus.SubscriberCount(); n != 0 {
		t.Fatalf("old bus must drop subscribers after reset, got %d", n)
	}

	// 新局 key 可认证；/games/current 可被查。
	rec = doGameRequest(t, srv, "GET", "/games/current", "nq2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("games/current with new key: %d: %s", rec.Code, rec.Body.String())
	}
	current := decodeGameBody(t, rec)
	if current["map_seed"] != "seed-new" {
		t.Fatalf("games/current seed mismatch: %v", current["map_seed"])
	}

	// 新世界状态为空：q2 资源为零（旧局 4242 已消失）。
	rec = doGameRequest(t, srv, "GET", "/state/summary", "nq2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("new summary: %d", rec.Code)
	}
	newSummary := decodeGameBody(t, rec)
	newPlayers := newSummary["players"].(map[string]any)
	if _, ok := newPlayers["p1"]; ok {
		t.Fatalf("old player p1 must not exist in new game summary")
	}
	if got := newPlayers["q2"].(map[string]any)["resources"].(map[string]any)["minerals"]; got != float64(200) {
		t.Fatalf("new world must reset to default resources (200), got minerals=%v (old game had 4242)", got)
	}

	// 旧局所有 key 立即失效。
	for _, oldKey := range []string{"key1", "key2"} {
		rec = doGameRequest(t, srv, "GET", "/state/summary", oldKey, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("old key %s must be rejected, got %d", oldKey, rec.Code)
		}
	}
}

func TestGameCurrentAvailableToAnyPlayer(t *testing.T) {
	srv, _, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "GET", "/games/current", "key2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("key1")) || bytes.Contains(rec.Body.Bytes(), []byte("key2")) {
		t.Fatalf("games/current must not leak keys: %s", rec.Body.String())
	}
	body := decodeGameBody(t, rec)
	if body["victory_mode"] != "elimination" {
		t.Fatalf("default victory_mode must be elimination, got %v", body["victory_mode"])
	}
}

func TestGameNewRequiresAdmin(t *testing.T) {
	srv, _, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "POST", "/games/new", "key2", map[string]any{
		"players": []map[string]any{{"player_id": "q1", "key": "nq1"}},
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin, got %d: %s", rec.Code, rec.Body.String())
	}
	// 无认证 401。
	rec = doGameRequest(t, srv, "POST", "/games/new", "", map[string]any{})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestGameNewRejectsBadBodies(t *testing.T) {
	srv, rt, _ := newResettableServer(t)
	before := rt.Current()

	cases := []struct {
		name string
		body any
	}{
		{"empty players", map[string]any{"players": []any{}}},
		{"missing players", map[string]any{}},
		{"bad difficulty", map[string]any{"enemy_difficulty": "weird", "players": []map[string]any{{"player_id": "q1", "key": "k1"}}}},
		{"bad victory mode", map[string]any{"victory_mode": "weird", "players": []map[string]any{{"player_id": "q1", "key": "k1"}}}},
		{"bad bot", map[string]any{"players": []map[string]any{{"player_id": "q1", "key": "k1", "bot": "impossible"}}}},
		{"bad role", map[string]any{"players": []map[string]any{{"player_id": "q1", "key": "k1", "role": "superuser"}}}},
		{"dup player id", map[string]any{"players": []map[string]any{{"player_id": "q1", "key": "k1"}, {"player_id": "q1", "key": "k2"}}}},
		{"dup key", map[string]any{"players": []map[string]any{{"player_id": "q1", "key": "k1"}, {"player_id": "q2", "key": "k1"}}}},
		{"missing key", map[string]any{"players": []map[string]any{{"player_id": "q1"}}}},
		{"unknown field", map[string]any{"map_config": map[string]any{"face_size": 24}, "players": []map[string]any{{"player_id": "q1", "key": "k1"}}}},
	}
	for _, tc := range cases {
		rec := doGameRequest(t, srv, "POST", "/games/new", "key1", tc.body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d: %s", tc.name, rec.Code, rec.Body.String())
		}
	}
	// 非 JSON 请求体。
	req := httptest.NewRequest("POST", "/games/new", bytes.NewReader([]byte("{")))
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid json: expected 400, got %d", rec.Code)
	}

	if rt.Current() != before {
		t.Fatalf("failed resets must not swap the session")
	}
}

func TestGameNewSequentialAndConcurrentResets(t *testing.T) {
	srv, rt, _ := newResettableServer(t)
	rt.Start() // 打开 tick loop 与 autosave，验证热重置后 goroutine 交接正确
	t.Cleanup(rt.Stop)

	first := rt.Current()

	// 顺序两次 reset：第二次排队执行并覆盖第一局。
	rec := doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed": "seed-a",
		"players":  []map[string]any{{"player_id": "a1", "key": "ka1", "role": "admin"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("first reset: %d: %s", rec.Code, rec.Body.String())
	}
	second := rt.Current()
	rec = doGameRequest(t, srv, "POST", "/games/new", "ka1", map[string]any{
		"map_seed": "seed-b",
		"players":  []map[string]any{{"player_id": "b1", "key": "kb1", "role": "admin"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("second reset: %d: %s", rec.Code, rec.Body.String())
	}

	// 两局旧 session 的 tick 循环都应停止（tick 冻结），说明 goroutine 已交接。
	for i, sess := range []*startup.Session{first, second} {
		t1 := sess.Core.CurrentTick()
		time.Sleep(120 * time.Millisecond)
		if t2 := sess.Core.CurrentTick(); t2 != t1 {
			t.Fatalf("old session %d tick loop still running: %d -> %d", i, t1, t2)
		}
	}
	// 当前 session（b 局）仍在正常 tick。
	cur := rt.Current()
	t1 := cur.Core.CurrentTick()
	time.Sleep(300 * time.Millisecond)
	if t2 := cur.Core.CurrentTick(); t2 <= t1 {
		t.Fatalf("current game tick loop not running: %d -> %d", t1, t2)
	}

	// 并发两个 reset：互斥（排队执行），两者都应成功，最终状态=二者之一。
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i, marker := range []string{"seed-c", "seed-d"} {
		wg.Add(1)
		go func(marker string, idx int) {
			defer wg.Done()
			rec := doGameRequest(t, srv, "POST", "/games/new", "kb1", map[string]any{
				"map_seed": marker,
				"players":  []map[string]any{{"player_id": "root", "key": "rootkey", "role": "admin"}},
			})
			codes <- rec.Code
		}(marker, i)
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusCreated {
			t.Fatalf("concurrent reset must succeed (queued), got %d", code)
		}
	}
	seed := rt.Current().Config.Battlefield.MapSeed
	if seed != "seed-c" && seed != "seed-d" {
		t.Fatalf("final game must be one of the concurrent resets, got seed %q", seed)
	}
}

func TestRollbackAfterResetUsesNewGameSnapshots(t *testing.T) {
	srv, rt, _ := newResettableServer(t)

	// 旧局有 2 个玩家且快照 store 里有 tick 0 快照；重置为 1 人新局后，
	// rollback 必须基于新局自己的快照，绝不能回滚出旧局状态。
	if got := len(rt.Current().Config.Players); got != 2 {
		t.Fatalf("old game should have 2 players, got %d", got)
	}
	rec := doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed": "seed-single",
		"players":  []map[string]any{{"player_id": "solo", "key": "sk1", "role": "admin"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("reset: %d: %s", rec.Code, rec.Body.String())
	}

	rec = doGameRequest(t, srv, "POST", "/rollback", "sk1", map[string]any{"to_tick": 0})
	if rec.Code != http.StatusOK {
		t.Fatalf("rollback after reset: %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGameBody(t, rec)
	digest := body["digest"].(map[string]any)
	if got := digest["players"]; got != float64(1) {
		t.Fatalf("rollback must use new game snapshot (1 player), got %v", got)
	}

	// 回滚后世界仍是新局的 1 名玩家。
	rec = doGameRequest(t, srv, "GET", "/games/current", "sk1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("games/current after rollback: %d", rec.Code)
	}
	if players := summaryPlayers(decodeGameBody(t, rec)); len(players) != 1 || players[0] != "solo" {
		t.Fatalf("world after rollback must still be the new game, got %v", players)
	}
}

func TestSaveAfterResetWritesNewGameDir(t *testing.T) {
	srv, _, dataDir := newResettableServer(t)

	rec := doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed":     "seed-new-game",
		"victory_mode": "sandbox",
		"players": []map[string]any{
			{"player_id": "fresh1", "key": "fk1", "role": "admin"},
			{"player_id": "fresh2", "key": "fk2"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("reset: %d: %s", rec.Code, rec.Body.String())
	}

	rec = doGameRequest(t, srv, "POST", "/save", "fk1", map[string]any{"reason": "post-reset"})
	if rec.Code != http.StatusOK {
		t.Fatalf("save after reset: %d: %s", rec.Code, rec.Body.String())
	}
	saveBody := decodeGameBody(t, rec)
	if saveBody["trigger"] != "post-reset" {
		t.Fatalf("save trigger mismatch: %v", saveBody["trigger"])
	}

	// meta.json/save.json 都已切到新局。
	dir := gamedir.Open(dataDir)
	meta, save, err := dir.Load()
	if err != nil {
		t.Fatalf("load game dir after reset: %v", err)
	}
	if len(meta.GameplayConfig.Players) != 2 {
		t.Fatalf("meta must describe new game players, got %+v", meta.GameplayConfig.Players)
	}
	if meta.GameplayConfig.Players[0].PlayerID != "fresh1" && meta.GameplayConfig.Players[1].PlayerID != "fresh1" {
		t.Fatalf("meta players must be the new game players: %+v", meta.GameplayConfig.Players)
	}
	if meta.GameplayConfig.Battlefield.MapSeed != "seed-new-game" {
		t.Fatalf("meta seed must be the new game seed, got %q", meta.GameplayConfig.Battlefield.MapSeed)
	}
	if meta.GameplayConfig.Battlefield.VictoryRule != "sandbox" {
		t.Fatalf("meta victory rule must be sandbox, got %q", meta.GameplayConfig.Battlefield.VictoryRule)
	}
	if save == nil || save.Snapshot == nil {
		t.Fatalf("save.json must contain the new game snapshot")
	}
	if int64(saveBody["tick"].(float64)) != save.Tick {
		t.Fatalf("save tick must match response, got save=%d resp=%v", save.Tick, saveBody["tick"])
	}
}
