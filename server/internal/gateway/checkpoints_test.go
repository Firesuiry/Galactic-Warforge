package gateway_test

import (
	"encoding/json"
	"net/http"
	"os"
	"testing"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/config"
	"siliconworld/internal/gateway"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/model"
	"siliconworld/internal/startup"
)

// newCheckpointServer 在 newResettableServer 之上补一个 checkpoint_dir（默认夹具没有）。
func newCheckpointServer(t *testing.T) (*gateway.Server, *startup.Runtime, string, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-boot", MaxTickRate: 10},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1", Role: "admin"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9090, RateLimit: 100, DataDir: dir, CheckpointDir: dir + "/checkpoints"},
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
	return gateway.New(rt), rt, dir, dir + "/checkpoints"
}

// advanceTicks 直接把世界 tick 推到目标值（不跑结算），便于断言读档 tick 一致。
func advanceTicks(t *testing.T, rt *startup.Runtime, tick int64) {
	t.Helper()
	ws := rt.Current().Core.World()
	ws.Lock()
	ws.Tick = tick
	ws.Unlock()
}

// 存档点 API 全流程：创建 → 列表 → 同名拒绝 → 契约失败拒绝 → bug 不拒绝 →
// 热加载后 tick/实体一致、started_at 变化、parent 正确、stale 警告。
func TestCheckpointAPILifecycle(t *testing.T) {
	srv, rt, _, cpDir := newCheckpointServer(t)
	_ = cpDir

	// 造一点可断言的实体状态：p1 背包里的铁块。
	ws := rt.Current().Core.World()
	ws.Lock()
	ws.Players["p1"].Inventory = model.ItemInventory{"iron_ingot": 7}
	ws.Unlock()
	advanceTicks(t, rt, 1234)
	startedBefore := rt.Current().StartedAt

	// 1) 创建（admin）→ 201。
	rec := doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key1", map[string]any{
		"name": "base-ok",
		"note": "首个存档点",
		"contract": map[string]any{"checks": []map[string]any{
			{"kind": "tick_gte", "tick": 1000},
			{"kind": "item_gte", "player": "p1", "item_id": "iron_ingot", "n": 5},
		}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create checkpoint: %d %s", rec.Code, rec.Body.String())
	}
	created := decodeGameBody(t, rec)
	if created["name"] != "base-ok" || created["kind"] != checkpoint.KindRegression {
		t.Fatalf("created summary wrong: %v", created)
	}
	if report, _ := created["contract_report"].(map[string]any); report == nil || report["passed"] != true {
		t.Fatalf("contract report missing/not passed: %v", created["contract_report"])
	}
	if _, ok := created["players"]; !ok {
		t.Fatalf("manifest must list players with login keys: %v", created)
	}

	// 2) 列表（任意登录玩家可查）→ 200，含该存档点与来源。
	rec = doGameRequest(t, srv, http.MethodGet, "/checkpoints", "key2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list checkpoints: %d %s", rec.Code, rec.Body.String())
	}
	listBody := decodeGameBody(t, rec)
	items, _ := listBody["checkpoints"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 checkpoint, got %v", listBody["checkpoints"])
	}
	first, _ := items[0].(map[string]any)
	if first["name"] != "base-ok" || first["tick"] != float64(1234) {
		t.Fatalf("list item wrong: %v", first)
	}

	// 3) 同名再创建（无 replace）→ 409。
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key1", map[string]any{"name": "base-ok"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate name must be rejected with 409, got %d %s", rec.Code, rec.Body.String())
	}

	// 4) regression 契约失败 → 400，且不落盘。
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key1", map[string]any{
		"name": "should-fail",
		"contract": map[string]any{"checks": []map[string]any{
			{"kind": "item_gte", "player": "p1", "item_id": "iron_ingot", "n": 999},
		}},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("contract failure must be 400, got %d %s", rec.Code, rec.Body.String())
	}
	rec = doGameRequest(t, srv, http.MethodGet, "/checkpoints", "key1", nil)
	items, _ = decodeGameBody(t, rec)["checkpoints"].([]any)
	for _, raw := range items {
		if item, _ := raw.(map[string]any); item["name"] == "should-fail" {
			t.Fatal("failed regression checkpoint must not be written")
		}
	}

	// 5) bug 存档点同样契约失败却允许创建（只记录结果）。
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key1", map[string]any{
		"name": "bug-lost-miner",
		"note": "采矿机丢失",
		"contract": map[string]any{"checks": []map[string]any{
			{"kind": "item_gte", "player": "p1", "item_id": "iron_ingot", "n": 999},
		}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("bug checkpoint must be created despite failing contract, got %d %s", rec.Code, rec.Body.String())
	}
	bugBody := decodeGameBody(t, rec)
	if bugBody["kind"] != checkpoint.KindBug {
		t.Fatalf("bug- prefix must map to kind=bug: %v", bugBody["kind"])
	}
	if report, _ := bugBody["contract_report"].(map[string]any); report == nil || report["passed"] != false {
		t.Fatalf("bug checkpoint must record failing contract result: %v", bugBody["contract_report"])
	}

	// 6) 先破坏当前对局，再热加载 base-ok：tick 回到存档点、玩家物资恢复。
	ws = rt.Current().Core.World()
	ws.Lock()
	ws.Tick = 99999
	ws.Players["p1"].Inventory = model.ItemInventory{"iron_ingot": 0}
	ws.Unlock()

	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints/base-ok/load", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("load checkpoint: %d %s", rec.Code, rec.Body.String())
	}
	loaded := decodeGameBody(t, rec)
	manifest, _ := loaded["manifest"].(map[string]any)
	if manifest == nil || manifest["name"] != "base-ok" {
		t.Fatalf("loaded manifest wrong: %v", manifest)
	}
	if parent, _ := manifest["parent"].(string); parent != "" {
		t.Fatalf("新局创建的存档点 parent 必须为空，实际 %q", parent)
	}
	game, _ := loaded["game"].(map[string]any)
	if game == nil || game["tick"] != float64(1234) {
		t.Fatalf("loaded game tick wrong: %v", game)
	}
	newSess := rt.Current()
	if newSess.StartedAt.Equal(startedBefore) {
		t.Fatal("hot load must produce a new session (started_at should change)")
	}
	if newSess.Core.World().Players["p1"].Inventory["iron_ingot"] != 7 {
		t.Fatalf("player inventory lost across checkpoint load: %d", newSess.Core.World().Players["p1"].Inventory["iron_ingot"])
	}
	if rt.SourceCheckpoint() != "base-ok" {
		t.Fatalf("runtime source checkpoint = %q, want base-ok", rt.SourceCheckpoint())
	}

	// 7) 从已加载的对局再存一个存档点：parent 必须指向 base-ok。
	advanceTicks(t, rt, 1300)
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key1", map[string]any{"name": "second-step"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create derived checkpoint: %d %s", rec.Code, rec.Body.String())
	}
	derived := decodeGameBody(t, rec)
	if derived["parent"] != "base-ok" {
		t.Fatalf("derived checkpoint parent = %v, want base-ok", derived["parent"])
	}
	if derived["stale"] != false {
		t.Fatalf("fresh checkpoint should not be stale: %v", derived["stale"])
	}

	// 8) 非 admin 不能创建/加载。
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key2", map[string]any{"name": "nope"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin create must be 403, got %d", rec.Code)
	}
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints/base-ok/load", "key2", nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin load must be 403, got %d", rec.Code)
	}

	// 9) 不存在的存档点 → 404。
	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints/does-not-exist/load", "key1", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown checkpoint must be 404, got %d %s", rec.Code, rec.Body.String())
	}
}

// stale 标记：把 manifest 的 commit 改成别的版本，列表与读档都应提示。
func TestCheckpointStaleFlagAndLoadWarning(t *testing.T) {
	srv, rt, _, cpDir := newCheckpointServer(t)

	rec := doGameRequest(t, srv, http.MethodPost, "/checkpoints", "key1", map[string]any{"name": "old-build"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create checkpoint: %d %s", rec.Code, rec.Body.String())
	}
	// 直接改写 manifest：commit 变成另一个二进制，dirty 置真。
	manifestPath := cpDir + "/old-build/manifest.json"
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	manifest["commit"] = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
	manifest["dirty"] = true
	patched, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("encode manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, patched, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	rec = doGameRequest(t, srv, http.MethodGet, "/checkpoints", "key2", nil)
	items, _ := decodeGameBody(t, rec)["checkpoints"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 checkpoint, got %v", items)
	}
	item, _ := items[0].(map[string]any)
	if item["stale"] != true {
		t.Fatalf("checkpoint from another build must be flagged stale: %v", item)
	}

	rec = doGameRequest(t, srv, http.MethodPost, "/checkpoints/old-build/load", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stale checkpoint must still load: %d %s", rec.Code, rec.Body.String())
	}
	warnings, _ := decodeGameBody(t, rec)["warnings"].([]any)
	if len(warnings) != 1 {
		t.Fatalf("stale load must warn, got %v", warnings)
	}
	if rt.SourceCheckpoint() != "old-build" {
		t.Fatalf("source checkpoint = %q, want old-build", rt.SourceCheckpoint())
	}
}
