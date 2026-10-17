package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
)

// 不同行星上同 ID 建筑的同种告警必须分开聚合、分开解除（审查问题 4）：
// 建筑 ID 只在行星内唯一，聚合键不带 planet_id 时两条会合并成一条，
// 解除一台会把另一台的告警一起标成 inactive。
func TestAlertHistorySeparatesSameBuildingIDAcrossPlanets(t *testing.T) {
	ah := NewAlertHistory(10)
	ah.Record([]*model.ProductionAlert{
		{AlertID: "alert-1-b1-backlog", Tick: 10, Active: true, PlayerID: "p1", PlanetID: "planet-1-1", BuildingID: "b1", AlertType: model.AlertTypeBacklog},
		{AlertID: "alert-1-b1-backlog-p2", Tick: 10, Active: true, PlayerID: "p1", PlanetID: "planet-1-2", BuildingID: "b1", AlertType: model.AlertTypeBacklog},
	})
	all := ah.All()
	if len(all) != 2 {
		t.Fatalf("两颗行星的同 ID 建筑应各留一条，got %d: %+v", len(all), all)
	}

	ah.Resolve("p1", "planet-1-1", "b1", model.AlertTypeBacklog, 50)
	all = ah.All()
	byPlanet := map[string]*model.ProductionAlert{}
	for _, alert := range all {
		byPlanet[alert.PlanetID] = alert
	}
	if first := byPlanet["planet-1-1"]; first == nil || first.Active {
		t.Fatalf("planet-1-1 的告警应解除，got %+v", first)
	}
	if second := byPlanet["planet-1-2"]; second == nil || !second.Active {
		t.Fatalf("planet-1-2 的同 ID 告警不应被误解除，got %+v", second)
	}

	// 快照返回副本：改返回值不能改内部状态（审查问题 7）。
	snap, _, _, _ := ah.Snapshot("", 0, 0, false)
	for _, alert := range snap {
		if alert.PlanetID == "planet-1-2" {
			alert.Active = false
			alert.Details = map[string]any{"mutated": true}
		}
	}
	for _, alert := range ah.All() {
		if alert.PlanetID == "planet-1-2" && !alert.Active {
			t.Fatal("Snapshot 返回了内部指针：调用方的修改污染了历史条目")
		}
	}
}

// 旧存档（第 16 轮之前写入）的 alert_history 条目没有 active 字段：
// 解码时必须按「仍成立」处理，否则读档后整段历史看起来都解除了（审查问题 2）。
func TestProductionAlertLegacyJSONDefaultsToActive(t *testing.T) {
	var legacy model.ProductionAlert
	if err := json.Unmarshal([]byte(`{"alert_id":"alert-1-b1-backlog","tick":10,"player_id":"p1","building_id":"b1","alert_type":"backlog"}`), &legacy); err != nil {
		t.Fatalf("decode legacy alert: %v", err)
	}
	if !legacy.Active {
		t.Fatalf("缺省 active 的旧条目应按 active=true 解码，got %+v", legacy)
	}

	var resolved model.ProductionAlert
	if err := json.Unmarshal([]byte(`{"alert_id":"alert-2","tick":20,"active":false,"resolved_tick":30}`), &resolved); err != nil {
		t.Fatalf("decode resolved alert: %v", err)
	}
	if resolved.Active || resolved.ResolvedTick != 30 {
		t.Fatalf("显式 active=false 必须保留，got %+v", resolved)
	}

	// 显式 true 也保留。
	var active model.ProductionAlert
	if err := json.Unmarshal([]byte(`{"alert_id":"alert-3","tick":40,"active":true}`), &active); err != nil {
		t.Fatalf("decode active alert: %v", err)
	}
	if !active.Active {
		t.Fatalf("显式 active=true 必须保留，got %+v", active)
	}
}
