package gateway_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"siliconworld/internal/gamecore"
)

// 狂飙模式（POST /admin/advance、/admin/advance/cancel）的 HTTP 层测试：
// 权限、多人门禁、参数校验、并发 409、取消、查询可用性，以及一次完整的快进。

// advanceBody 是 POST /admin/advance 的响应体。
type advanceBody struct {
	StartTick     int64   `json:"start_tick"`
	EndTick       int64   `json:"end_tick"`
	StoppedReason string  `json:"stopped_reason"`
	Detail        string  `json:"detail"`
	ElapsedMS     int64   `json:"elapsed_ms"`
	TicksPerSec   float64 `json:"ticks_per_sec"`
}

func decodeInto(t *testing.T, rec *httptest.ResponseRecorder, out any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
		t.Fatalf("decode response body: %v (%s)", err, rec.Body.String())
	}
}

func decodeAdvance(t *testing.T, rec *httptest.ResponseRecorder) advanceBody {
	t.Helper()
	var out advanceBody
	decodeInto(t, rec, &out)
	return out
}

// eliminatePlayerForGatewayTest 清空指定玩家在在场判定中的实体（HQ 与单位），
// 使下一次结算把它淘汰（与 gamecore 内部 eliminatePlayerForTest 同口径）。
func eliminatePlayerForGatewayTest(t *testing.T, core *gamecore.GameCore, playerID string) {
	t.Helper()
	ws := core.World()
	ws.Lock()
	defer ws.Unlock()
	for id, b := range ws.Buildings {
		if b.OwnerID == playerID {
			delete(ws.Buildings, id)
			ws.UnindexBuilding(b)
		}
	}
	for id, u := range ws.Units {
		if u.OwnerID == playerID {
			delete(ws.Units, id)
		}
	}
}

// TestAdvanceRequiresAdmin：非 admin 玩家被拒（403），admin 通过。
func TestAdvanceRequiresAdmin(t *testing.T) {
	srv, rt, _ := newResettableServer(t)

	rec := doGameRequest(t, srv, "POST", "/admin/advance", "key2", map[string]any{"ticks": 5})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin advance = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	if got := rt.Current().Core.CurrentTick(); got != 0 {
		t.Fatalf("rejected advance must not move the tick, got %d", got)
	}

	rec = doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"ticks": 5})
	if rec.Code != http.StatusOK {
		t.Fatalf("admin advance = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeAdvance(t, rec)
	if body.StartTick != 0 || body.EndTick != 5 || body.StoppedReason != "reached" {
		t.Fatalf("unexpected advance result: %+v", body)
	}
	if got := rt.Current().Core.CurrentTick(); got != 5 {
		t.Fatalf("core tick = %d, want 5", got)
	}
}

// TestAdvanceCancelRequiresAdmin：取消同样是 admin 专属。
func TestAdvanceCancelRequiresAdmin(t *testing.T) {
	srv, _, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "POST", "/admin/advance/cancel", "key2", nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin cancel = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	rec = doGameRequest(t, srv, "POST", "/admin/advance/cancel", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin cancel = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Cancelled bool `json:"cancelled"`
	}
	decodeInto(t, rec, &body)
	if body.Cancelled {
		t.Fatal("cancel without a running advance must report cancelled=false")
	}
}

// TestAdvanceMultiplayerGate：多人对局里非 admin 被 403 并说明原因，admin 可快进。
func TestAdvanceMultiplayerGate(t *testing.T) {
	srv, _, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed":         "seed-mp",
		"enemy_difficulty": "off",
		"victory_mode":     "sandbox",
		"players": []map[string]any{
			{"player_id": "p1", "key": "key1", "role": "admin"},
			{"player_id": "p3", "key": "key3"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("new game = %d: %s", rec.Code, rec.Body.String())
	}

	rec = doGameRequest(t, srv, "POST", "/admin/advance", "key3", map[string]any{"ticks": 5})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("multiplayer non-admin advance = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	if msg, _ := decodeGameBody(t, rec)["error"].(string); msg == "" {
		t.Fatalf("403 must explain the reason, got %v", decodeGameBody(t, rec))
	}

	rec = doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"ticks": 5})
	if rec.Code != http.StatusOK {
		t.Fatalf("multiplayer admin advance = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

// TestAdvanceSingleHumanWithBotAllowed：单人类 + bot 的对局不触发多人门禁。
func TestAdvanceSingleHumanWithBotAllowed(t *testing.T) {
	srv, _, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed":         "seed-bot",
		"enemy_difficulty": "off",
		"victory_mode":     "sandbox",
		"players": []map[string]any{
			{"player_id": "p1", "key": "key1", "role": "admin"},
			{"player_id": "p2", "key": "key2", "bot": "easy"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("new game = %d: %s", rec.Code, rec.Body.String())
	}
	rec = doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"ticks": 5})
	if rec.Code != http.StatusOK {
		t.Fatalf("single human + bot advance = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

// TestAdvanceSpecValidation：to_tick 与 ticks 必须且只能给一个；取值范围有校验。
func TestAdvanceSpecValidation(t *testing.T) {
	srv, _, _ := newResettableServer(t)
	cases := []struct {
		name string
		body map[string]any
	}{
		{"both", map[string]any{"ticks": 5, "to_tick": 10}},
		{"neither", map[string]any{}},
		{"zero ticks", map[string]any{"ticks": 0}},
		{"negative ticks", map[string]any{"ticks": -3}},
		{"to_tick not ahead", map[string]any{"to_tick": 0}},
		{"unknown field", map[string]any{"ticks": 5, "bogus": true}},
	}
	for _, tc := range cases {
		rec := doGameRequest(t, srv, "POST", "/admin/advance", "key1", tc.body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d, want 400: %s", tc.name, rec.Code, rec.Body.String())
		}
	}
}

// TestAdvanceToTick：to_tick 形态推进到绝对 tick。
func TestAdvanceToTick(t *testing.T) {
	srv, rt, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"to_tick": 7})
	if rec.Code != http.StatusOK {
		t.Fatalf("advance = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeAdvance(t, rec)
	if body.StartTick != 0 || body.EndTick != 7 {
		t.Fatalf("tick range = %d → %d, want 0 → 7", body.StartTick, body.EndTick)
	}
	if got := rt.Current().Core.CurrentTick(); got != 7 {
		t.Fatalf("core tick = %d, want 7", got)
	}
}

// TestAdvanceConcurrentReturns409：已有快进在跑时再调返回 409，取消后第一个请求正常返回。
func TestAdvanceConcurrentReturns409(t *testing.T) {
	srv, _, _ := newResettableServer(t)

	done := make(chan int, 1)
	go func() {
		rec := doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"ticks": 5_000_000})
		done <- rec.Code
	}()

	conflict := false
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) && !conflict {
		rec := doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"ticks": 1})
		switch rec.Code {
		case http.StatusConflict:
			conflict = true
		case http.StatusOK:
			// 第一个请求还没开跑（或已被它自己跑完）：继续探。
		default:
			t.Fatalf("probe advance = %d: %s", rec.Code, rec.Body.String())
		}
	}
	if !conflict {
		t.Fatal("concurrent advance never returned 409")
	}

	rec := doGameRequest(t, srv, "POST", "/admin/advance/cancel", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel = %d: %s", rec.Code, rec.Body.String())
	}
	var cancelBody struct {
		Cancelled bool `json:"cancelled"`
	}
	decodeInto(t, rec, &cancelBody)
	if !cancelBody.Cancelled {
		t.Fatal("cancel must report a running advance")
	}
	select {
	case code := <-done:
		if code != http.StatusOK {
			t.Fatalf("first advance = %d, want 200", code)
		}
	case <-time.After(120 * time.Second):
		t.Fatal("first advance did not return after cancel")
	}
}

// TestAdvanceQueriesStayAvailable：快进期间 HTTP 查询照常可用（不阻塞、不报错）。
func TestAdvanceQueriesStayAvailable(t *testing.T) {
	srv, rt, _ := newResettableServer(t)

	done := make(chan struct{})
	go func() {
		defer close(done)
		doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"ticks": 5_000_000})
	}()

	// 一边快进一边查询：至少有一次查询落在「已经推进了很多 tick」之后。
	queries := 0
	movedDuringQuery := false
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		rec := doGameRequest(t, srv, "GET", "/state/summary", "key1", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("query during fast forward = %d: %s", rec.Code, rec.Body.String())
		}
		queries++
		if rt.Current().Core.CurrentTick() > 200 {
			movedDuringQuery = true
			break
		}
	}
	if queries == 0 || !movedDuringQuery {
		t.Fatalf("queries during fast forward = %d (moved=%v)", queries, movedDuringQuery)
	}

	doGameRequest(t, srv, "POST", "/admin/advance/cancel", "key1", nil)
	select {
	case <-done:
	case <-time.After(120 * time.Second):
		t.Fatal("advance did not return after cancel")
	}
}

// TestAdvanceStopOnGameOver：淘汰对手后快进立刻以 game_over 收尾。
func TestAdvanceStopOnGameOver(t *testing.T) {
	srv, rt, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed":         "seed-over",
		"enemy_difficulty": "off",
		"victory_mode":     "elimination",
		"players": []map[string]any{
			{"player_id": "p1", "key": "key1", "role": "admin"},
			{"player_id": "p2", "key": "key2"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("new game = %d: %s", rec.Code, rec.Body.String())
	}
	eliminatePlayerForGatewayTest(t, rt.Current().Core, "p2")

	rec = doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{"ticks": 500})
	if rec.Code != http.StatusOK {
		t.Fatalf("advance = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeAdvance(t, rec)
	if body.StoppedReason != "game_over" {
		t.Fatalf("stopped_reason = %q (detail=%q), want game_over", body.StoppedReason, body.Detail)
	}
	if body.EndTick >= 500 {
		t.Fatalf("advance must stop early on game over, end_tick = %d", body.EndTick)
	}
}

// TestAdvanceStopConditionsDisabled：显式 stop_on 全关时跑满目标（即便对局已结束）。
func TestAdvanceStopConditionsDisabled(t *testing.T) {
	srv, rt, _ := newResettableServer(t)
	rec := doGameRequest(t, srv, "POST", "/games/new", "key1", map[string]any{
		"map_seed":         "seed-over-off",
		"enemy_difficulty": "off",
		"victory_mode":     "elimination",
		"players": []map[string]any{
			{"player_id": "p1", "key": "key1", "role": "admin"},
			{"player_id": "p2", "key": "key2"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("new game = %d: %s", rec.Code, rec.Body.String())
	}
	eliminatePlayerForGatewayTest(t, rt.Current().Core, "p2")

	rec = doGameRequest(t, srv, "POST", "/admin/advance", "key1", map[string]any{
		"ticks": 20,
		"stop_on": map[string]any{
			"game_over":      false,
			"under_attack":   false,
			"critical_alert": false,
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("advance = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeAdvance(t, rec)
	if body.StoppedReason != "reached" || body.EndTick != 20 {
		t.Fatalf("with stop_on off the advance must reach the target, got %+v", body)
	}
}
