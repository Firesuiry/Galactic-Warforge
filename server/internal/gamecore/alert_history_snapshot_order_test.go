package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 严重 1：快照必须「仍成立的在前、最新的在前」。
// 旧实现按插入顺序（最老在前）返回，客户端只取 limit=50 时，
// 老对局里前 50 条全是早期告警，新出现的 haul_unreachable 永远进不了 UI。
func TestAlertSnapshotReturnsNewestActiveFirst(t *testing.T) {
	ah := NewAlertHistory(100)
	ah.Record([]*model.ProductionAlert{
		newTestAlert("b-old", model.AlertTypeBacklog, 100),
		newTestAlert("b-mid", model.AlertTypeOutputBlocked, 500),
		newTestAlert("b-new", model.AlertTypeHaulUnreachable, 900),
	})
	// 一条已解除的老告警：它不能排在仍成立的条目之前。
	ah.Resolve("p1", "", "b-old", model.AlertTypeBacklog, 950)

	alerts, _, hasMore, _ := ah.Snapshot("", 0, 2, true)
	if hasMore {
		t.Fatalf("active_only 下 2 条仍成立的告警在 limit=2 时不应再报 has_more: %+v", alerts)
	}
	if len(alerts) != 2 || alerts[0].BuildingID != "b-new" || alerts[1].BuildingID != "b-mid" {
		t.Fatalf("仍成立的条目应按最新在前返回，got %+v", alerts)
	}

	all, _, more, _ := ah.Snapshot("", 0, 0, false)
	if more || len(all) != 3 {
		t.Fatalf("全量快照 = %d 条 (more=%v), want 3", len(all), more)
	}
	if all[0].BuildingID != "b-new" || all[1].BuildingID != "b-mid" || all[2].BuildingID != "b-old" {
		t.Fatalf("已解除条目应排在仍成立条目之后，got %+v", all)
	}
	if all[2].Active {
		t.Fatalf("b-old 应已解除，got %+v", all[2])
	}
}

// 聚合告警按 last_tick 排序：一条老告警反复发生时应该浮到前面（它此刻仍在发生）。
func TestAlertSnapshotOrdersByLastTick(t *testing.T) {
	ah := NewAlertHistory(100)
	ah.Record([]*model.ProductionAlert{newTestAlert("b-1", model.AlertTypeBeltBlocked, 100)})
	ah.Record([]*model.ProductionAlert{newTestAlert("b-2", model.AlertTypeBacklog, 200)})
	ah.Record([]*model.ProductionAlert{newTestAlert("b-1", model.AlertTypeBeltBlocked, 300)})

	alerts, _, _, _ := ah.Snapshot("", 0, 0, false)
	if len(alerts) != 2 || alerts[0].BuildingID != "b-1" {
		t.Fatalf("last_tick 更新的 b-1 应排最前，got %+v", alerts)
	}
}

// active_only：只返回仍成立的告警；limit 不再被已解除的历史条目挤占。
func TestAlertSnapshotActiveOnly(t *testing.T) {
	ah := NewAlertHistory(100)
	ah.Record([]*model.ProductionAlert{
		newTestAlert("b-resolved", model.AlertTypeBacklog, 100),
		newTestAlert("b-active-old", model.AlertTypeInputShortage, 200),
		newTestAlert("b-active-new", model.AlertTypeHaulUnreachable, 300),
	})
	ah.Resolve("p1", "", "b-resolved", model.AlertTypeBacklog, 400)

	alerts, next, hasMore, _ := ah.Snapshot("", 0, 50, true)
	if hasMore || len(alerts) != 2 || next != "alert-b-active-old-input_shortage" {
		t.Fatalf("active_only 应只返回 2 条仍成立的告警（最新在前），got %+v (next=%q more=%v)", alerts, next, hasMore)
	}
	for _, alert := range alerts {
		if !alert.Active {
			t.Fatalf("active_only 返回了已解除条目: %+v", alert)
		}
	}
}

// active_only 分页：游标条目在 active_only 视图里不存在时（刚解除），
// 不能从头再来（否则客户端会重复拉同一页）。
func TestAlertSnapshotActiveOnlyCursorAfterResolved(t *testing.T) {
	ah := NewAlertHistory(100)
	ah.Record([]*model.ProductionAlert{
		newTestAlert("b-1", model.AlertTypeBacklog, 100),
		newTestAlert("b-2", model.AlertTypeBacklog, 200),
		newTestAlert("b-3", model.AlertTypeBacklog, 300),
	})
	firstPage, nextID, _, _ := ah.Snapshot("", 0, 1, true)
	if len(firstPage) != 1 || firstPage[0].BuildingID != "b-3" {
		t.Fatalf("第一页应为最新一条，got %+v", firstPage)
	}
	// 翻页前 b-2（游标之后的条目）被解除：它不再出现在下一页里，
	// 但更老的 b-1 仍要按顺序返回，不能从头再来。
	ah.Resolve("p1", "", "b-2", model.AlertTypeBacklog, 350)
	secondPage, _, _, _ := ah.Snapshot(nextID, 0, 10, true)
	if len(secondPage) != 1 || secondPage[0].BuildingID != "b-1" {
		t.Fatalf("游标之后的已解除条目应跳过、更老的条目继续返回，got %+v", secondPage)
	}
}

// since_tick 按「最近一次发生」tick 过滤：last_tick 刷新过的聚合条目要留下。
func TestAlertSnapshotSinceTickUsesLastTick(t *testing.T) {
	ah := NewAlertHistory(100)
	ah.Record([]*model.ProductionAlert{newTestAlert("b-1", model.AlertTypeBeltBlocked, 100)})
	ah.Record([]*model.ProductionAlert{newTestAlert("b-2", model.AlertTypeBacklog, 150)})
	ah.Record([]*model.ProductionAlert{newTestAlert("b-1", model.AlertTypeBeltBlocked, 400)})

	alerts, _, _, _ := ah.Snapshot("", 300, 0, false)
	if len(alerts) != 1 || alerts[0].BuildingID != "b-1" {
		t.Fatalf("since_tick 应保留 last_tick=400 的聚合条目，got %+v", alerts)
	}
}
