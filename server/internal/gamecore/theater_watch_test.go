package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

// U8 战区防区警戒：区域内有敌方实体时向拥有者发 theater_zone_alert，
// 敌情持续有冷却不刷屏，清空后自动复位；查询视图暴露区域敌情状态。
func TestTheaterZoneAlertFiresCoolsDownAndClears(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	if res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdTheaterCreate,
		Payload: map[string]any{"theater_id": "theater-watch", "name": "防区"},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater_create failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTheaterDefineZone,
		Payload: map[string]any{
			"theater_id": "theater-watch",
			"zone_type":  "primary",
			"planet_id":  ws.PlanetID,
			"position":   map[string]any{"x": 10, "y": 10},
			"radius":     6,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("theater_define_zone failed: %s (%s)", res.Code, res.Message)
	}

	// 区域内无敌人：不告警。
	if events := settleTheaterWatch(core.worlds, ws.Tick); len(events) != 0 {
		t.Fatalf("expected no alert without hostiles, got %+v", events)
	}

	// 放入一个敌方单位（p2）与一个黑雾巢穴。
	ws.Units["enemy-watch-1"] = &model.Unit{
		ID:       "enemy-watch-1",
		OwnerID:  "p2",
		HP:       100,
		Position: model.Position{X: 11, Y: 10},
	}
	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{{
			ID:        "nest-watch-1",
			Type:      model.EnemyForceTypeHive,
			Position:  model.Position{X: 12, Y: 12},
			Strength:  40,
			SpawnTick: ws.Tick,
		}},
	}

	events := settleTheaterWatch(core.worlds, ws.Tick)
	if len(events) != 1 {
		t.Fatalf("expected one theater_zone_alert, got %+v", events)
	}
	alert := events[0]
	if alert.EventType != model.EvtTheaterZoneAlert {
		t.Fatalf("expected theater_zone_alert, got %s", alert.EventType)
	}
	if alert.VisibilityScope != "p1" {
		t.Fatalf("expected alert scoped to p1, got %s", alert.VisibilityScope)
	}
	if alert.Payload["theater_id"] != "theater-watch" {
		t.Fatalf("expected theater id in payload, got %+v", alert.Payload)
	}
	if count, ok := alert.Payload["hostile_count"].(int); !ok || count != 2 {
		t.Fatalf("expected hostile_count=2, got %+v", alert.Payload["hostile_count"])
	}

	// 冷却期内敌情持续：不重复告警。
	for i := 0; i < 3; i++ {
		if dup := settleTheaterWatch(core.worlds, ws.Tick+int64(i)+1); len(dup) != 0 {
			t.Fatalf("expected cooldown to suppress repeated alerts, got %+v", dup)
		}
	}

	// 查询视图暴露区域敌情状态。
	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	view := ql.WarTheaters(ws, "p1")
	if len(view.Theaters) != 1 || len(view.Theaters[0].Zones) != 1 {
		t.Fatalf("expected one theater with one zone, got %+v", view.Theaters)
	}
	zoneView := view.Theaters[0].Zones[0]
	if !zoneView.Alerted || zoneView.HostileCount != 2 {
		t.Fatalf("expected alerted zone with hostile_count=2, got %+v", zoneView)
	}

	// 冷却结束后仍在敌情：重报一次。
	rearm := settleTheaterWatch(core.worlds, ws.Tick+theaterZoneAlertCooldownTicks)
	if len(rearm) != 1 {
		t.Fatalf("expected re-alert after cooldown, got %+v", rearm)
	}

	// 敌情清空：状态复位，不再告警。
	delete(ws.Units, "enemy-watch-1")
	ws.EnemyForces.Forces = nil
	if cleared := settleTheaterWatch(core.worlds, ws.Tick+theaterZoneAlertCooldownTicks+1); len(cleared) != 0 {
		t.Fatalf("expected no alert after hostiles cleared, got %+v", cleared)
	}
	zone := ws.Players["p1"].WarCoordination.Theaters["theater-watch"].Zones[0]
	if zone.HostileCount != 0 || zone.Alerted {
		t.Fatalf("expected zone state reset, got %+v", zone)
	}
}
