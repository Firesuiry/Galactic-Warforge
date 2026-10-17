package gamecore

import (
	"sort"
	"sync"

	"siliconworld/internal/model"
)

// AlertHistory stores recent production alerts for snapshot queries.
// Alerts sharing the same (building, alert type) pair are aggregated into a
// single entry: repeats bump RepeatCount and LastTick instead of appending
// new entries, so a persistent condition cannot flood the alert panel.
type AlertHistory struct {
	mu     sync.RWMutex
	limit  int
	alerts []*model.ProductionAlert
	keys   map[string]int
}

func NewAlertHistory(limit int) *AlertHistory {
	if limit <= 0 {
		limit = 1000
	}
	return &AlertHistory{
		limit: limit,
		keys:  make(map[string]int),
	}
}

// alertAggregationKey identifies the stream an alert belongs to.
// 建筑 ID 只在行星内唯一（不同行星都有 b-1），必须带上行星，否则两颗行星上
// 同 ID 建筑的同种告警会合并成一条、解除时也会互相误标。
func alertAggregationKey(alert *model.ProductionAlert) string {
	return alert.PlanetID + "|" + string(alert.AlertType) + "|" + alert.BuildingID
}

// Record appends alerts and enforces size limit. Repeats of an already
// recorded (planet, building, alert type) pair update the existing entry in place.
// 重新出现的告警会把条目恢复成 active（旧条目保留 first tick / repeat 计数，
// 只刷新 active / last_tick）。
func (ah *AlertHistory) Record(alerts []*model.ProductionAlert) {
	if len(alerts) == 0 {
		return
	}
	ah.mu.Lock()
	defer ah.mu.Unlock()
	for _, alert := range alerts {
		if alert == nil {
			continue
		}
		alert.Active = true
		alert.ResolvedTick = 0
		key := alertAggregationKey(alert)
		if pos, ok := ah.keys[key]; ok {
			existing := ah.alerts[pos]
			existing.PlanetID = alert.PlanetID
			existing.RepeatCount++
			existing.LastTick = alert.Tick
			existing.Severity = alert.Severity
			existing.Metrics = alert.Metrics
			existing.Details = alert.Details
			existing.Active = true
			existing.ResolvedTick = 0
			continue
		}
		ah.alerts = append(ah.alerts, alert)
		ah.keys[key] = len(ah.alerts) - 1
	}
	if len(ah.alerts) <= ah.limit {
		return
	}
	trim := len(ah.alerts) - ah.limit
	ah.alerts = ah.alerts[trim:]
	ah.rebuildIndex()
}

// Resolve 把「已解除」的告警条目标记为 inactive：问题第一次解除时写
// ResolvedTick（重复调用不改写），之后快照里的 active=false，客户端据此
// 撤掉告警条与地图红标（试玩 1016 报告问题 2）。没有对应条目时什么都不做。
// 旧存档里的条目没有 planet_id（PlanetID 为空）：带 planetID 查不到时退回
// 按「空行星」再查一次，避免读档后历史条目永远解除不了。
func (ah *AlertHistory) Resolve(playerID, planetID, buildingID string, alertType model.ProductionAlertType, tick int64) {
	if ah == nil || buildingID == "" {
		return
	}
	ah.mu.Lock()
	defer ah.mu.Unlock()
	pos, ok := ah.keys[alertAggregationKey(&model.ProductionAlert{PlanetID: planetID, BuildingID: buildingID, AlertType: alertType})]
	if !ok && planetID != "" {
		pos, ok = ah.keys[alertAggregationKey(&model.ProductionAlert{BuildingID: buildingID, AlertType: alertType})]
	}
	if !ok {
		return
	}
	alert := ah.alerts[pos]
	if alert == nil || !alert.Active || alert.PlayerID != playerID {
		return
	}
	alert.Active = false
	alert.ResolvedTick = tick
}

// ResolveBuilding 解除某座建筑（某行星）当前仍成立的全部告警：
// 建筑被拆除/摧毁后，它的 belt_blocked / haul_unreachable / output_blocked 等
// 条件永远不会再被结算，只能在这里统一收尾，否则告警条里会留下一条
// 「建筑已不存在、地图也没有红标、无法修复」的悬挂条目（试玩 1016 严重 3）。
// 只按 (planet, building) 匹配，不动其它建筑；playerID 非空时只解除该玩家的条目。
func (ah *AlertHistory) ResolveBuilding(playerID, planetID, buildingID string, tick int64) int {
	if ah == nil || buildingID == "" {
		return 0
	}
	ah.mu.Lock()
	defer ah.mu.Unlock()
	resolved := 0
	for _, alert := range ah.alerts {
		if alert == nil || !alert.Active || alert.BuildingID != buildingID {
			continue
		}
		// 旧存档条目没有 planet_id：planetID 非空时也允许解除（与 Resolve 的
		// 回退口径一致——同一建筑 ID 只在同行星内唯一，旧条目不会跨行星误伤）。
		if alert.PlanetID != "" && planetID != "" && alert.PlanetID != planetID {
			continue
		}
		if playerID != "" && alert.PlayerID != playerID {
			continue
		}
		alert.Active = false
		alert.ResolvedTick = tick
		resolved++
	}
	return resolved
}

func (ah *AlertHistory) All() []*model.ProductionAlert {
	ah.mu.RLock()
	defer ah.mu.RUnlock()
	return cloneAlerts(ah.alerts)
}

func (ah *AlertHistory) ReplaceAll(alerts []*model.ProductionAlert) {
	ah.mu.Lock()
	defer ah.mu.Unlock()
	ah.alerts = cloneAlerts(alerts)
	if len(ah.alerts) > ah.limit {
		ah.alerts = ah.alerts[len(ah.alerts)-ah.limit:]
	}
	ah.rebuildIndex()
}

// Snapshot returns alerts for the production alert panel.
//
// 顺序（试玩 1016 严重 1）：仍成立的条目在前，按「最近一次发生」tick
// （last_tick，缺省回退 tick）倒序——最新的告警永远排在最前，客户端只取
// limit=50 也能看到刚发生的 haul_unreachable / belt_blocked；其后是已解除的
// 历史条目，同样按最近 tick 倒序（供复盘）。旧实现按插入顺序（最老在前）
// 返回，老对局里前 50 条全是早期告警，新告警永远进不了客户端。
//
// 分页：
//   - after_alert_id 是本顺序里的游标，返回它之后的条目（找不到时从头开始）；
//   - since_tick 过滤「最近一次发生 tick >= since_tick」的条目；
//   - active_only 只返回仍成立的条目（顶栏/警报条/地图红标用）。
//
// 返回的 available_from_tick 是历史里最老的首次出现 tick（含已解除条目）。
// 返回的是条目副本：序列化在 RUnlock 之后进行，直接交出内部指针会与
// Resolve/Record 的原地修改形成数据竞争。
func (ah *AlertHistory) Snapshot(afterAlertID string, sinceTick int64, limit int, activeOnly bool) ([]*model.ProductionAlert, string, bool, int64) {
	ah.mu.RLock()
	defer ah.mu.RUnlock()

	availableFrom := int64(0)
	if len(ah.alerts) > 0 {
		availableFrom = ah.alerts[0].Tick
	}
	// 游标先在「完整顺序」里定位：active_only 下如果游标条目恰好刚被解除，
	// 它仍是一个有效位置，不能退回从头开始（否则客户端会重复拉同一页）。
	ordered := ah.orderedLocked(false)
	start := 0
	if afterAlertID != "" {
		for i, alert := range ordered {
			if alert.AlertID == afterAlertID {
				start = i + 1
				break
			}
		}
	}
	filtered := make([]*model.ProductionAlert, 0, len(ordered))
	for _, alert := range ordered[start:] {
		if activeOnly && !alert.Active {
			continue
		}
		if sinceTick > 0 && alertSortTick(alert) < sinceTick {
			continue
		}
		filtered = append(filtered, alert)
	}
	if limit <= 0 || limit > len(filtered) {
		limit = len(filtered)
	}
	result := cloneAlerts(filtered[:limit])
	nextID := ""
	if len(result) > 0 {
		nextID = result[len(result)-1].AlertID
	}
	hasMore := limit < len(filtered)
	return result, nextID, hasMore, availableFrom
}

// alertSortTick 告警的「最近一次发生」tick：聚合条目用 LastTick，未重复过时回退 Tick。
func alertSortTick(alert *model.ProductionAlert) int64 {
	if alert == nil {
		return 0
	}
	if alert.LastTick > alert.Tick {
		return alert.LastTick
	}
	return alert.Tick
}

// orderedLocked 返回快照顺序（仍成立在前，其次按最近 tick 倒序）。
// Callers must hold the read lock.
func (ah *AlertHistory) orderedLocked(activeOnly bool) []*model.ProductionAlert {
	ordered := make([]*model.ProductionAlert, 0, len(ah.alerts))
	for _, alert := range ah.alerts {
		if alert == nil || (activeOnly && !alert.Active) {
			continue
		}
		ordered = append(ordered, alert)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		left, right := ordered[i], ordered[j]
		if left.Active != right.Active {
			return left.Active
		}
		leftTick, rightTick := alertSortTick(left), alertSortTick(right)
		if leftTick != rightTick {
			return leftTick > rightTick
		}
		// 同 tick 时按 alert_id 倒序，保证分页游标稳定、不随 map 顺序抖动。
		return left.AlertID > right.AlertID
	})
	return ordered
}

// TrimAfterTick removes alerts with tick greater than target tick.
func (ah *AlertHistory) TrimAfterTick(tick int64) int {
	ah.mu.Lock()
	defer ah.mu.Unlock()
	if len(ah.alerts) == 0 {
		return 0
	}
	keep := len(ah.alerts)
	for keep > 0 && ah.alerts[keep-1].Tick > tick {
		keep--
	}
	if keep == len(ah.alerts) {
		return 0
	}
	removed := len(ah.alerts) - keep
	ah.alerts = ah.alerts[:keep]
	ah.rebuildIndex()
	return removed
}

// rebuildIndex recomputes the aggregation key index.
// Callers must hold the write lock.
func (ah *AlertHistory) rebuildIndex() {
	ah.keys = make(map[string]int, len(ah.alerts))
	for i, alert := range ah.alerts {
		if alert == nil {
			continue
		}
		ah.keys[alertAggregationKey(alert)] = i
	}
}

func cloneAlerts(alerts []*model.ProductionAlert) []*model.ProductionAlert {
	if len(alerts) == 0 {
		return nil
	}
	out := make([]*model.ProductionAlert, 0, len(alerts))
	for _, alert := range alerts {
		if alert == nil {
			continue
		}
		cp := *alert
		if len(alert.Details) > 0 {
			cp.Details = make(map[string]any, len(alert.Details))
			for key, value := range alert.Details {
				cp.Details[key] = value
			}
		}
		out = append(out, &cp)
	}
	return out
}
