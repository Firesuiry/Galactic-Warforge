package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/model"
)

func newTestMonitorConfig() config.ProductionMonitorConfig {
	return config.ProductionMonitorConfig{
		SampleIntervalTicks:  5,
		MaxEntitiesPerSample: 500,
		BacklogWarnRatio:     0.6,
		BacklogCriticalRatio: 0.9,
		ShortageRatio:        0.2,
		EfficiencyWarnRatio:  0.5,
		AlertCooldownTicks:   20,
	}
}

func newTestAlert(buildingID string, alertType model.ProductionAlertType, tick int64) *model.ProductionAlert {
	return &model.ProductionAlert{
		AlertID:      "alert-" + buildingID + "-" + string(alertType),
		Tick:         tick,
		PlayerID:     "p1",
		BuildingID:   buildingID,
		BuildingType: model.BuildingTypeArcSmelter,
		AlertType:    alertType,
		Severity:     model.AlertSeverityWarning,
		Message:      model.AlertMessage(alertType, buildingID),
	}
}

// Repeated alerts for the same (building, alert type) pair must aggregate into
// a single history entry instead of flooding the snapshot with duplicates.
func TestAlertHistoryAggregatesRepeatOccurrences(t *testing.T) {
	ah := NewAlertHistory(10)

	first := newTestAlert("b-1", model.AlertTypeBacklog, 100)
	first.Metrics = model.MonitorStats{Throughput: 2, Backlog: 3}
	ah.Record([]*model.ProductionAlert{first})

	repeat := newTestAlert("b-1", model.AlertTypeBacklog, 120)
	repeat.Severity = model.AlertSeverityCritical
	repeat.Metrics = model.MonitorStats{Throughput: 2, Backlog: 9}
	repeat.Details = map[string]any{"backlog_ratio": 4.5}
	ah.Record([]*model.ProductionAlert{repeat})

	all := ah.All()
	if len(all) != 1 {
		t.Fatalf("expected 1 aggregated alert, got %d", len(all))
	}
	got := all[0]
	if got.AlertID != first.AlertID {
		t.Fatalf("aggregated entry must keep the first alert id %q, got %q", first.AlertID, got.AlertID)
	}
	if got.Tick != 100 {
		t.Fatalf("tick must stay at first occurrence 100, got %d", got.Tick)
	}
	if got.LastTick != 120 {
		t.Fatalf("last_tick must track latest occurrence 120, got %d", got.LastTick)
	}
	if got.RepeatCount != 1 {
		t.Fatalf("repeat_count must be 1, got %d", got.RepeatCount)
	}
	if got.Severity != model.AlertSeverityCritical {
		t.Fatalf("severity must refresh to latest critical, got %s", got.Severity)
	}
	if got.Metrics.Backlog != 9 {
		t.Fatalf("metrics must refresh to latest sample, got backlog %d", got.Metrics.Backlog)
	}
	if got.Details["backlog_ratio"] != 4.5 {
		t.Fatalf("details must refresh to latest, got %v", got.Details)
	}
}

// Aggregation is keyed by (building, alert type): different buildings or
// different alert types must keep separate entries.
func TestAlertHistoryKeepsDistinctStreamsSeparate(t *testing.T) {
	ah := NewAlertHistory(10)
	ah.Record([]*model.ProductionAlert{
		newTestAlert("b-1", model.AlertTypeBacklog, 100),
		newTestAlert("b-1", model.AlertTypeInputShortage, 100),
		newTestAlert("b-2", model.AlertTypeBacklog, 100),
	})
	if got := len(ah.All()); got != 3 {
		t.Fatalf("expected 3 distinct alert entries, got %d", got)
	}
}

// 游标分页按快照顺序（仍成立在前、最新在前）工作：翻页不会漏条目，
// 聚合更新只刷新原条目（不产生新 alert_id、不新增条目）。
func TestAlertHistoryCursorStableUnderAggregation(t *testing.T) {
	ah := NewAlertHistory(10)
	first := newTestAlert("b-1", model.AlertTypeBacklog, 100)
	second := newTestAlert("b-2", model.AlertTypeBacklog, 105)
	ah.Record([]*model.ProductionAlert{first, second})

	// 最新在前：second(105) → first(100)；按 limit=1 翻两页恰好各取一条。
	alerts, nextID, hasMore, _ := ah.Snapshot("", 0, 1, false)
	if !hasMore || len(alerts) != 1 || alerts[0].AlertID != second.AlertID || nextID != second.AlertID {
		t.Fatalf("first page must be the newest alert, got %+v (next=%q more=%v)", alerts, nextID, hasMore)
	}
	alerts, _, hasMore, _ = ah.Snapshot(second.AlertID, 0, 1, false)
	if hasMore || len(alerts) != 1 || alerts[0].AlertID != first.AlertID {
		t.Fatalf("second page must be the older alert, got %+v (more=%v)", alerts, hasMore)
	}

	// 聚合重复：原条目只刷新 last_tick/repeat_count，不新增条目、不新铸 alert_id。
	repeat := newTestAlert("b-1", model.AlertTypeBacklog, 120)
	ah.Record([]*model.ProductionAlert{repeat})

	all := ah.All()
	if len(all) != 2 || all[0].RepeatCount != 1 || all[0].LastTick != 120 {
		t.Fatalf("expected repeat aggregated into first entry, got %+v", all)
	}
	ids := map[string]bool{}
	alerts, _, _, _ = ah.Snapshot("", 0, 10, false)
	for _, alert := range alerts {
		if ids[alert.AlertID] {
			t.Fatalf("聚合更新后同一 alert_id 出现了两次: %q", alert.AlertID)
		}
		ids[alert.AlertID] = true
	}
	if len(ids) != 2 {
		t.Fatalf("聚合更新后条目数 = %d, want 2", len(ids))
	}
}

// When the history trims old entries, aggregation keys must be rebuilt:
// repeats of surviving alerts still aggregate, repeats of trimmed alerts
// start a fresh entry.
func TestAlertHistoryTrimRebuildsAggregationKeys(t *testing.T) {
	ah := NewAlertHistory(2)
	ah.Record([]*model.ProductionAlert{
		newTestAlert("b-1", model.AlertTypeBacklog, 100),
		newTestAlert("b-2", model.AlertTypeBacklog, 105),
		newTestAlert("b-3", model.AlertTypeBacklog, 110),
	})
	if got := len(ah.All()); got != 2 {
		t.Fatalf("expected history trimmed to limit 2, got %d", got)
	}

	// b-2 survived the trim: its repeat must aggregate in place.
	ah.Record([]*model.ProductionAlert{newTestAlert("b-2", model.AlertTypeBacklog, 125)})
	all := ah.All()
	if len(all) != 2 || all[0].BuildingID != "b-2" || all[0].RepeatCount != 1 || all[0].LastTick != 125 {
		t.Fatalf("expected b-2 repeat aggregated, got %+v", all)
	}

	// b-1 was trimmed: its repeat starts a new entry, evicting b-2.
	ah.Record([]*model.ProductionAlert{newTestAlert("b-1", model.AlertTypeBacklog, 130)})
	all = ah.All()
	if len(all) != 2 || all[1].BuildingID != "b-1" || all[1].RepeatCount != 0 || all[1].Tick != 130 {
		t.Fatalf("expected fresh entry for trimmed alert stream, got %+v", all)
	}
}

// ReplaceAll (save/load path) must rebuild aggregation keys so repeats
// recorded after a restore still aggregate.
func TestAlertHistoryReplaceAllRebuildsAggregationKeys(t *testing.T) {
	ah := NewAlertHistory(10)
	ah.ReplaceAll([]*model.ProductionAlert{newTestAlert("b-1", model.AlertTypeBacklog, 100)})
	ah.Record([]*model.ProductionAlert{newTestAlert("b-1", model.AlertTypeBacklog, 140)})
	all := ah.All()
	if len(all) != 1 || all[0].RepeatCount != 1 || all[0].LastTick != 140 {
		t.Fatalf("expected repeat after ReplaceAll to aggregate, got %+v", all)
	}
}

// Alerts raised for the same building at the same tick must not share an id,
// otherwise history indexing and cursor pagination would conflate them.
func TestBuildAlertIDsAreUniquePerAlertType(t *testing.T) {
	pm := newProductionMonitor(newTestMonitorConfig())
	building := &model.Building{ID: "b-1", Type: model.BuildingTypeArcSmelter, OwnerID: "p1"}
	a := pm.buildAlert("planet-1", building, 100, model.AlertTypeBacklog, model.AlertSeverityWarning, model.MonitorStats{}, nil)
	b := pm.buildAlert("planet-1", building, 100, model.AlertTypeInputShortage, model.AlertSeverityWarning, model.MonitorStats{}, nil)
	if a.AlertID == b.AlertID {
		t.Fatalf("alert ids must differ per alert type, both were %q", a.AlertID)
	}
}
