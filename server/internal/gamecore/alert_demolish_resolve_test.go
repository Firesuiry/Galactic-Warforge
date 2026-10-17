package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 严重 3：建筑被拆除 / 摧毁后，它名下的产线告警必须全部解除
// （active=false + resolved_tick），否则告警条里会留下「建筑已不存在、地图
// 也没有红标、无法修复」的悬挂条目。
//
// 覆盖三条移除路径：拆除命令（即时）、拆除作业完成、战斗摧毁。
// 另外：同 ID 的另一颗行星上的告警不能误解除；只解除目标建筑的告警。

// alertResolveCore 造一个带告警历史、玩家有执行体的小世界。
func alertResolveCore(t *testing.T) (*GameCore, *model.WorldState) {
	t.Helper()
	core, ws := haulTestCoreWithFace(t, 32)
	// 世界 tick 从 0 起，而 resolved_tick=0 表示「未解除」；先推进到非零 tick。
	ws.Tick = 500
	return core, ws
}

func recordBeltBlockedAlert(core *GameCore, planetID, buildingID string, tick int64) {
	core.AlertHistory().Record([]*model.ProductionAlert{{
		AlertID:      "alert-" + itoa(int(tick)) + "-" + buildingID + "-belt_blocked",
		Tick:         tick,
		LastTick:     tick,
		Active:       true,
		PlayerID:     "p1",
		PlanetID:     planetID,
		BuildingID:   buildingID,
		BuildingType: model.BuildingTypeConveyorBeltMk1,
		AlertType:    model.AlertTypeBeltBlocked,
		Severity:     model.AlertSeverityWarning,
	}})
}

func alertActiveByID(core *GameCore, alertID string) *model.ProductionAlert {
	alerts, _, _, _ := core.AlertHistory().Snapshot("", 0, 0, false)
	for _, alert := range alerts {
		if alert != nil && alert.AlertID == alertID {
			return alert
		}
	}
	return nil
}

// 1) 拆除命令（无作业时长）立即解除该建筑的全部告警；别的建筑不受影响。
func TestDemolishCommandResolvesBuildingAlerts(t *testing.T) {
	core, ws := alertResolveCore(t)
	belt := placeAutoBuilding(t, ws, "b-51", model.BuildingTypeConveyorBeltMk1, model.Position{X: 10, Y: 10})
	other := placeAutoBuilding(t, ws, "b-52", model.BuildingTypeConveyorBeltMk1, model.Position{X: 14, Y: 10})
	recordBeltBlockedAlert(core, ws.PlanetID, belt.ID, 100)
	recordBeltBlockedAlert(core, ws.PlanetID, other.ID, 120)

	res, _ := execCommand(core, model.CmdDemolish, ws, "p1", model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: belt.ID},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("拆除失败: %+v", res)
	}
	if _, ok := ws.Buildings[belt.ID]; ok {
		t.Fatal("建筑应已移除")
	}
	resolved := alertActiveByID(core, "alert-100-b-51-belt_blocked")
	if resolved == nil {
		t.Fatal("告警历史条目应保留")
	}
	if resolved.Active || resolved.ResolvedTick <= resolved.Tick {
		t.Fatalf("拆除后告警必须解除（active=false + resolved_tick），got %+v", resolved)
	}
	if kept := alertActiveByID(core, "alert-120-b-52-belt_blocked"); kept == nil || !kept.Active {
		t.Fatalf("别的建筑的告警不该被解除，got %+v", kept)
	}
}

// 2) 拆除作业完成（settleBuildingJobs 走到 demolishBuilding）同样解除告警。
func TestDemolishJobCompletionResolvesBuildingAlerts(t *testing.T) {
	core, ws := alertResolveCore(t)
	belt := placeAutoBuilding(t, ws, "b-53", model.BuildingTypeConveyorBeltMk1, model.Position{X: 10, Y: 10})
	recordBeltBlockedAlert(core, ws.PlanetID, belt.ID, 100)

	belt.Job = &model.BuildingJob{Type: model.BuildingJobDemolish, RemainingTicks: 1, RefundRate: 0.5}
	settleBuildingJobs(ws, core.AlertHistory())
	if _, ok := ws.Buildings[belt.ID]; ok {
		t.Fatal("拆除作业完成后建筑应移除")
	}
	alert := alertActiveByID(core, "alert-100-b-53-belt_blocked")
	if alert == nil || alert.Active || alert.ResolvedTick <= alert.Tick {
		t.Fatalf("拆除作业完成后告警必须解除，got %+v", alert)
	}
}

// 3) 战斗摧毁：destroyBuildingCombat 也要解除该建筑的告警。
func TestCombatDestroyResolvesBuildingAlerts(t *testing.T) {
	core, ws := alertResolveCore(t)
	belt := placeAutoBuilding(t, ws, "b-54", model.BuildingTypeConveyorBeltMk1, model.Position{X: 10, Y: 10})
	recordBeltBlockedAlert(core, ws.PlanetID, belt.ID, 100)
	recordBeltBlockedAlert(core, "planet-other", belt.ID, 100)

	destroyBuildingCombat(ws, core.AlertHistory(), belt, "u-enemy", "p2", "unit")
	if _, ok := ws.Buildings[belt.ID]; ok {
		t.Fatal("建筑应已摧毁")
	}
	// 同 ID 的另一颗行星上的告警不能误解除（两条 alert_id 相同，按行星取）。
	byPlanet := map[string]*model.ProductionAlert{}
	for _, candidate := range core.AlertHistory().All() {
		byPlanet[candidate.PlanetID] = candidate
	}
	own := byPlanet[ws.PlanetID]
	if own == nil || own.Active || own.ResolvedTick <= own.Tick {
		t.Fatalf("战斗摧毁后本行星的告警必须解除，got %+v", own)
	}
	if other := byPlanet["planet-other"]; other == nil || !other.Active {
		t.Fatalf("另一颗行星上同 ID 建筑的告警被误解除: %+v", other)
	}
}

//  4. 拆除事件（entity_destroyed）带上被拆除建筑当前仍成立的告警类型，
//     供结算管线 / 客户端知道该建筑的问题已随建筑消失。
func TestDemolishEventListsResolvedAlertTypes(t *testing.T) {
	core, ws := alertResolveCore(t)
	belt := placeAutoBuilding(t, ws, "b-55", model.BuildingTypeConveyorBeltMk1, model.Position{X: 10, Y: 10})
	recordBeltBlockedAlert(core, ws.PlanetID, belt.ID, 100)

	res, events := execCommand(core, model.CmdDemolish, ws, "p1", model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: belt.ID},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("拆除失败: %+v", res)
	}
	found := false
	for _, evt := range events {
		if evt == nil || evt.EventType != model.EvtEntityDestroyed {
			continue
		}
		if id, _ := evt.Payload["entity_id"].(string); id != belt.ID {
			continue
		}
		found = true
		types, _ := evt.Payload["resolved_alert_types"].([]string)
		if len(types) != 1 || types[0] != string(model.AlertTypeBeltBlocked) {
			t.Fatalf("entity_destroyed 应带 resolved_alert_types=[belt_blocked]，got %+v", evt.Payload["resolved_alert_types"])
		}
	}
	if !found {
		t.Fatal("缺少 entity_destroyed 事件")
	}
}
