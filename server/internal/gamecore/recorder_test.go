package gamecore

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"siliconworld/internal/model"
)

func TestBattleRecorderWritesMetaEventsStatesAndVictory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "battle.jsonl")
	rec, err := NewBattleRecorder(path, 10)
	if err != nil {
		t.Fatalf("NewBattleRecorder: %v", err)
	}

	ws := model.NewWorldState("planet-1-1", 16)
	ws.MapWidth = 48
	ws.MapHeight = 48
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", TeamID: "team-1", Role: "commander"}
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", TeamID: "team-2", Role: "commander"}
	ws.Units["u1"] = &model.Unit{
		ID: "u1", Type: model.UnitTypeSoldier, OwnerID: "p1",
		Position: model.Position{X: 3, Y: 4}, HP: 90, MaxHP: 100,
	}
	ws.Buildings["b1"] = &model.Building{
		ID: "b1", Type: model.BuildingTypeBattlefieldAnalysisBase, OwnerID: "p2",
		Position: model.Position{X: 40, Y: 40}, HP: 700, MaxHP: 700,
	}
	worlds := map[string]*model.WorldState{"planet-1-1": ws}

	// tick 1: meta + 一个伤害事件（tick_completed 应被跳过）
	rec.OnTick(worlds, "planet-1-1", 1, []*model.GameEvent{
		{EventID: "evt-1-1", Tick: 1, EventType: model.EvtDamageApplied, VisibilityScope: "p1", Payload: map[string]any{"damage": 10}},
		{EventID: "evt-1-2", Tick: 1, EventType: model.EvtTickCompleted, VisibilityScope: "all"},
	})
	// tick 10: 触发状态采样 + 胜利事件
	rec.OnTick(worlds, "planet-1-1", 10, []*model.GameEvent{
		{EventID: "evt-10-1", Tick: 10, EventType: model.EvtVictoryDeclared, VisibilityScope: "all", Payload: map[string]any{"winner_id": "p1"}},
	})
	if err := rec.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	// 幂等
	if err := rec.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}

	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open record: %v", err)
	}
	defer f.Close()

	var rows []map[string]any
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	for sc.Scan() {
		var row map[string]any
		if err := json.Unmarshal(sc.Bytes(), &row); err != nil {
			t.Fatalf("invalid json row %q: %v", sc.Text(), err)
		}
		rows = append(rows, row)
	}

	kinds := []string{}
	for _, r := range rows {
		kinds = append(kinds, r["kind"].(string))
	}
	// 期望顺序：meta, event(damage), event(victory_declared), victory, state
	want := []string{"meta", "event", "event", "victory", "state"}
	if len(kinds) != len(want) {
		t.Fatalf("kinds=%v", kinds)
	}
	for i := range want {
		if kinds[i] != want[i] {
			t.Fatalf("row %d kind=%s want %s (all=%v)", i, kinds[i], want[i], kinds)
		}
	}

	// meta 内容
	meta := rows[0]
	if meta["active_planet_id"] != "planet-1-1" {
		t.Errorf("meta active_planet_id=%v", meta["active_planet_id"])
	}
	if players, ok := meta["players"].([]any); !ok || len(players) != 2 {
		t.Errorf("meta players=%v", meta["players"])
	}

	// state 采样内容
	state := rows[4]
	planets := state["planets"].(map[string]any)
	p := planets["planet-1-1"].(map[string]any)
	units := p["units"].([]any)
	if len(units) != 1 {
		t.Fatalf("state units=%v", units)
	}
	u := units[0].(map[string]any)
	if u["id"] != "u1" || u["o"] != "p1" || u["hp"].(float64) != 90 {
		t.Errorf("unit row=%v", u)
	}
	b := p["buildings"].([]any)[0].(map[string]any)
	if b["id"] != "b1" || b["o"] != "p2" || b["hp"].(float64) != 700 {
		t.Errorf("building row=%v", b)
	}
}

func TestBattleRecorderNilSafe(t *testing.T) {
	var rec *BattleRecorder
	// nil 接收者不应 panic
	rec.OnTick(nil, "", 0, nil)
}
